// Configurazione Firebase Realtime Database
const firebaseConfig = {
    databaseURL: "https://listaspesafamiglia-default-rtdb.europe-west1.firebasedatabase.app"
};

let db = null;
let itemsRef = null;
let favoritesRef = null;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        itemsRef = db.ref('items');
        favoritesRef = db.ref('favorites');
    }
} catch (err) {
    console.warn('Firebase init error:', err);
}

const STORAGE_ITEMS_KEY = 'lista_spesa_items_v1';
const STORAGE_FAVS_KEY = 'lista_spesa_favorites_v1';

const CATEGORIES = [
    { id: 'Ortofrutta', label: '🥬 Ortofrutta' },
    { id: 'Frigo e Latticini', label: '🧀 Frigo e Latticini' },
    { id: 'Dispensa', label: '🍝 Dispensa' },
    { id: 'Carne e Pesce', label: '🥩 Carne e Pesce' },
    { id: 'Casa e Pulizia', label: '🧽 Casa e Pulizia' },
    { id: 'Altro', label: '📦 Altro' }
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const DEFAULT_FAVORITES = {
    fav_pane: { name: 'Pane', category: 'Dispensa' },
    fav_latte: { name: 'Latte', category: 'Frigo e Latticini' },
    fav_acqua: { name: 'Acqua', category: 'Dispensa' },
    fav_uova: { name: 'Uova', category: 'Frigo e Latticini' },
    fav_caffe: { name: 'Caffè', category: 'Dispensa' },
    fav_pasta: { name: 'Pasta', category: 'Dispensa' }
};

let currentQty = 1;
let selectedCategory = 'Altro';
let latestItems = loadLocalJSON(STORAGE_ITEMS_KEY, {});
let latestFavorites = loadLocalJSON(STORAGE_FAVS_KEY, null);
let firebaseConnected = false;
let wakeLockSentinel = null;
let wakeLockEnabled = false;
let deferredInstallPrompt = null;

if (latestFavorites === null) {
    latestFavorites = { ...DEFAULT_FAVORITES };
    saveLocalJSON(STORAGE_FAVS_KEY, latestFavorites);
}

// Elementi DOM
const itemInput = document.getElementById('item-input');
const noteInput = document.getElementById('note-input');
const itemQtySpan = document.getElementById('item-qty');
const increaseQtyBtn = document.getElementById('increase-qty');
const decreaseQtyBtn = document.getElementById('decrease-qty');
const addBtn = document.getElementById('add-btn');
const deleteAllBtn = document.getElementById('delete-all-btn');
const clearPendingBtn = document.getElementById('clear-pending-btn');
const clearBoughtBtn = document.getElementById('clear-bought-btn');
const pendingContainer = document.getElementById('pending-container');
const boughtList = document.getElementById('bought-list');
const pendingCount = document.getElementById('pending-count');
const boughtCount = document.getElementById('bought-count');
const categoryChips = document.getElementById('category-chips');
const favoritesBar = document.getElementById('favorites-bar');
const addFavoriteBtn = document.getElementById('add-favorite-btn');
const syncStatusEl = document.getElementById('sync-status');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');
const themeColorMeta = document.getElementById('theme-color-meta');
const wakeLockBtn = document.getElementById('wake-lock-btn');

// Modale
const modal = document.getElementById('custom-modal');
const modalMessage = document.getElementById('modal-message');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');

function loadLocalJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveLocalJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignora errori di quota localStorage
    }
}

function generateLocalId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function showModal(message, onConfirm) {
    modalMessage.textContent = message;
    modalCancel.style.display = '';
    modalConfirm.textContent = 'Conferma';
    modal.style.display = 'flex';

    const cleanup = () => {
        modal.style.display = 'none';
        modalConfirm.onclick = null;
        modalCancel.onclick = null;
    };

    modalConfirm.onclick = () => {
        cleanup();
        onConfirm();
    };
    modalCancel.onclick = cleanup;
}

function showInfoModal(message) {
    modalMessage.textContent = message;
    modalCancel.style.display = 'none';
    modalConfirm.textContent = 'Capito';
    modal.style.display = 'flex';

    modalConfirm.onclick = () => {
        modal.style.display = 'none';
        modalCancel.style.display = '';
        modalConfirm.textContent = 'Conferma';
        modalConfirm.onclick = null;
    };
}

// ---------- Tema Chiaro (default originale) / Scuro ----------
function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeIcon.textContent = '☀️';
        if (themeColorMeta) themeColorMeta.setAttribute('content', '#1c221e');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        themeIcon.textContent = '🌙';
        if (themeColorMeta) themeColorMeta.setAttribute('content', '#235c3f');
    }
}

applyTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');

themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
});

// ---------- Screen Wake Lock ----------
function updateWakeLockUI(active) {
    wakeLockBtn.classList.toggle('active', active);
    wakeLockBtn.setAttribute('aria-pressed', String(active));
    const label = wakeLockBtn.querySelector('.btn-label');
    if (label) {
        label.textContent = active ? 'Schermo: ON' : 'Schermo attivo';
    }
}

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        showInfoModal('Il tuo browser non supporta la funzione "Schermo attivo".');
        return false;
    }
    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            if (!wakeLockEnabled) updateWakeLockUI(false);
        });
        updateWakeLockUI(true);
        return true;
    } catch {
        updateWakeLockUI(false);
        return false;
    }
}

async function releaseWakeLock() {
    if (wakeLockSentinel) {
        try {
            await wakeLockSentinel.release();
        } catch {
            // Ignora
        }
        wakeLockSentinel = null;
    }
    updateWakeLockUI(false);
}

wakeLockBtn.addEventListener('click', async () => {
    if (wakeLockEnabled) {
        wakeLockEnabled = false;
        await releaseWakeLock();
    } else {
        wakeLockEnabled = await requestWakeLock();
    }
});

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLockEnabled) {
        await requestWakeLock();
    }
});

// ---------- Selettore Reparti & Quantità ----------
categoryChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.category-chip');
    if (!btn) return;
    selectedCategory = btn.dataset.category || 'Altro';
    categoryChips.querySelectorAll('.category-chip').forEach((chip) => {
        const isActive = chip === btn;
        chip.classList.toggle('active', isActive);
        chip.setAttribute('aria-pressed', String(isActive));
    });
});

increaseQtyBtn.addEventListener('click', () => {
    currentQty++;
    itemQtySpan.textContent = currentQty;
});

decreaseQtyBtn.addEventListener('click', () => {
    if (currentQty > 1) {
        currentQty--;
        itemQtySpan.textContent = currentQty;
    }
});

function formatItemName(name) {
    if (!name) return '';
    const trimmed = name.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function resetInputs() {
    itemInput.value = '';
    noteInput.value = '';
    currentQty = 1;
    itemQtySpan.textContent = currentQty;
}

// ---------- Operazioni su Prodotti (immediate + sync Firebase) ----------
function persistAndRenderItems() {
    saveLocalJSON(STORAGE_ITEMS_KEY, latestItems);
    renderItems(latestItems);
}

function addItem() {
    const name = formatItemName(itemInput.value);
    const note = noteInput.value.trim();
    if (!name) return;

    for (const key in latestItems) {
        const existing = latestItems[key];
        if (existing && existing.name && existing.name.toLowerCase() === name.toLowerCase()) {
            showInfoModal(`“${name}” è già nella lista! Puoi modificarne la quantità direttamente sotto.`);
            resetInputs();
            return;
        }
    }

    const payload = {
        name: name,
        quantity: currentQty,
        bought: false,
        category: selectedCategory
    };
    if (note) {
        payload.note = note;
    }

    if (itemsRef && firebaseConnected) {
        itemsRef.push(payload);
    } else {
        const localId = generateLocalId('item');
        latestItems[localId] = payload;
        persistAndRenderItems();
        if (itemsRef) {
            itemsRef.child(localId).set(payload).catch(() => {});
        }
    }

    resetInputs();
}

addBtn.addEventListener('click', addItem);

[itemInput, noteInput].forEach((input) => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addItem();
    });
});

function toggleBought(id, currentStatus) {
    if (!latestItems[id]) return;
    latestItems[id].bought = !currentStatus;
    persistAndRenderItems();
    if (itemsRef) {
        itemsRef.child(id).update({ bought: !currentStatus }).catch(() => {});
    }
}

function updateQty(id, currentQtyVal, delta) {
    if (!latestItems[id]) return;
    const newQty = currentQtyVal + delta;
    if (newQty > 0) {
        latestItems[id].quantity = newQty;
        persistAndRenderItems();
        if (itemsRef) {
            itemsRef.child(id).update({ quantity: newQty }).catch(() => {});
        }
    } else {
        deleteItem(id);
    }
}

function deleteItem(id) {
    delete latestItems[id];
    persistAndRenderItems();
    if (itemsRef) {
        itemsRef.child(id).remove().catch(() => {});
    }
}

// Pulsanti di pulizia con conferme
clearPendingBtn.addEventListener('click', () => {
    showModal('Sei sicuro di voler pulire la lista degli oggetti da comprare?', () => {
        for (const id in latestItems) {
            if (!latestItems[id].bought) {
                delete latestItems[id];
                if (itemsRef) itemsRef.child(id).remove().catch(() => {});
            }
        }
        persistAndRenderItems();
    });
});

clearBoughtBtn.addEventListener('click', () => {
    showModal('Sei sicuro di voler rimuovere tutti i prodotti già comprati?', () => {
        for (const id in latestItems) {
            if (latestItems[id].bought) {
                delete latestItems[id];
                if (itemsRef) itemsRef.child(id).remove().catch(() => {});
            }
        }
        persistAndRenderItems();
    });
});

deleteAllBtn.addEventListener('click', () => {
    showModal("Sei sicuro di voler eliminare tutto l'archivio della spesa?", () => {
        latestItems = {};
        persistAndRenderItems();
        if (itemsRef) itemsRef.remove().catch(() => {});
    });
});

// ---------- Preferiti / Acquisti Frequenti ----------
function renderFavorites(data) {
    favoritesBar.innerHTML = '';
    const entries = Object.entries(data || {});

    if (entries.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'item-note';
        hint.textContent = 'Nessun preferito salvato.';
        favoritesBar.appendChild(hint);
        return;
    }

    entries.forEach(([favId, fav]) => {
        if (!fav || !fav.name) return;
        const chip = document.createElement('div');
        chip.className = 'fav-chip';
        chip.setAttribute('role', 'listitem');

        const labelBtn = document.createElement('span');
        labelBtn.textContent = `+ ${fav.name}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'fav-chip-remove';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', `Rimuovi ${fav.name} dai preferiti`);

        chip.addEventListener('click', (e) => {
            if (e.target === removeBtn) return;
            addFavoriteToShoppingList(fav);
        });

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showModal(`Rimuovere “${fav.name}” dagli acquisti frequenti?`, () => {
                delete latestFavorites[favId];
                saveLocalJSON(STORAGE_FAVS_KEY, latestFavorites);
                renderFavorites(latestFavorites);
                if (favoritesRef) {
                    favoritesRef.child(favId).remove().catch(() => {});
                }
            });
        });

        chip.appendChild(labelBtn);
        chip.appendChild(removeBtn);
        favoritesBar.appendChild(chip);
    });
}

function addFavoriteToShoppingList(fav) {
    const targetName = fav.name.toLowerCase();
    let existingId = null;

    for (const id in latestItems) {
        const item = latestItems[id];
        if (item && item.name && item.name.toLowerCase() === targetName) {
            existingId = id;
            break;
        }
    }

    if (existingId) {
        const existingItem = latestItems[existingId];
        if (existingItem.bought) {
            existingItem.bought = false;
            existingItem.quantity = 1;
        } else {
            existingItem.quantity = (Number(existingItem.quantity) || 1) + 1;
        }
        persistAndRenderItems();
        if (itemsRef) {
            itemsRef.child(existingId).update({
                bought: existingItem.bought,
                quantity: existingItem.quantity
            }).catch(() => {});
        }
    } else {
        const payload = {
            name: formatItemName(fav.name),
            quantity: 1,
            bought: false,
            category: CATEGORY_IDS.includes(fav.category) ? fav.category : 'Altro'
        };
        if (fav.note) payload.note = fav.note;

        const id = generateLocalId('item');
        latestItems[id] = payload;
        persistAndRenderItems();
        if (itemsRef) {
            itemsRef.child(id).set(payload).catch(() => {});
        }
    }
}

addFavoriteBtn.addEventListener('click', () => {
    const name = formatItemName(itemInput.value);
    if (!name) {
        showInfoModal('Scrivi prima il nome di un prodotto nel campo sopra per salvarlo tra i preferiti.');
        itemInput.focus();
        return;
    }

    for (const id in latestFavorites) {
        if (latestFavorites[id].name && latestFavorites[id].name.toLowerCase() === name.toLowerCase()) {
            showInfoModal(`“${name}” è già nei preferiti!`);
            return;
        }
    }

    const note = noteInput.value.trim();
    const favPayload = {
        name: name,
        category: selectedCategory
    };
    if (note) favPayload.note = note;

    const favId = generateLocalId('fav');
    latestFavorites[favId] = favPayload;
    saveLocalJSON(STORAGE_FAVS_KEY, latestFavorites);
    renderFavorites(latestFavorites);
    if (favoritesRef) {
        favoritesRef.child(favId).set(favPayload).catch(() => {});
    }
    showInfoModal(`“${name}” aggiunto agli acquisti frequenti!`);
});

// ---------- Rendering Lista Prodotti ----------
function createItemElement(id, item) {
    const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const isBought = Boolean(item.bought);
    const noteText = item.note ? String(item.note).trim() : '';

    const li = document.createElement('li');
    li.className = `shopping-item ${isBought ? 'bought' : ''}`;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'item-info';
    infoDiv.addEventListener('click', () => toggleBought(id, isBought));

    const checkCircle = document.createElement('span');
    checkCircle.className = 'check-circle';
    checkCircle.setAttribute('aria-hidden', 'true');
    checkCircle.textContent = isBought ? '✓' : '';

    const textGroup = document.createElement('div');
    textGroup.className = 'item-text-group';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = item.name;
    textGroup.appendChild(nameSpan);

    if (noteText) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'item-note';
        noteSpan.textContent = noteText;
        textGroup.appendChild(noteSpan);
    }

    infoDiv.appendChild(checkCircle);
    infoDiv.appendChild(textGroup);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'item-actions';

    const qtyPill = document.createElement('div');
    qtyPill.className = 'item-qty-pill';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'qty-btn';
    minusBtn.textContent = '−';
    minusBtn.setAttribute('aria-label', `Diminuisci quantità di ${item.name}`);
    minusBtn.addEventListener('click', () => updateQty(id, qty, -1));

    const qtyVal = document.createElement('span');
    qtyVal.className = 'qty-value';
    qtyVal.textContent = String(qty);

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'qty-btn';
    plusBtn.textContent = '+';
    plusBtn.setAttribute('aria-label', `Aumenta quantità di ${item.name}`);
    plusBtn.addEventListener('click', () => updateQty(id, qty, 1));

    qtyPill.appendChild(minusBtn);
    qtyPill.appendChild(qtyVal);
    qtyPill.appendChild(plusBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-item-btn';
    delBtn.textContent = '✕';
    delBtn.setAttribute('aria-label', `Elimina ${item.name}`);
    delBtn.addEventListener('click', () => deleteItem(id));

    actionsDiv.appendChild(qtyPill);
    actionsDiv.appendChild(delBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);
    return li;
}

function renderItems(data) {
    pendingContainer.innerHTML = '';
    boughtList.innerHTML = '';

    const groupedPending = {};
    CATEGORIES.forEach((cat) => {
        groupedPending[cat.id] = [];
    });

    let pCount = 0;
    let bCount = 0;

    for (const id in data) {
        const item = data[id];
        if (!item || !item.name) continue;

        if (item.bought) {
            boughtList.appendChild(createItemElement(id, item));
            bCount++;
        } else {
            const cat = CATEGORY_IDS.includes(item.category) ? item.category : 'Altro';
            groupedPending[cat].push({ id, item });
            pCount++;
        }
    }

    if (pCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Nessun prodotto da comprare.';
        pendingContainer.appendChild(empty);
    } else {
        CATEGORIES.forEach((cat) => {
            const entries = groupedPending[cat.id];
            if (entries.length === 0) return;

            const groupDiv = document.createElement('div');
            groupDiv.className = 'category-group';

            const groupHeader = document.createElement('div');
            groupHeader.className = 'category-group-header';
            const titleSpan = document.createElement('span');
            titleSpan.textContent = cat.label;
            const countSpan = document.createElement('span');
            countSpan.textContent = `${entries.length}`;
            groupHeader.appendChild(titleSpan);
            groupHeader.appendChild(countSpan);

            const ul = document.createElement('ul');
            ul.className = 'shopping-list';
            entries.forEach(({ id, item }) => {
                ul.appendChild(createItemElement(id, item));
            });

            groupDiv.appendChild(groupHeader);
            groupDiv.appendChild(ul);
            pendingContainer.appendChild(groupDiv);
        });
    }

    pendingCount.textContent = pCount;
    boughtCount.textContent = bCount;
}

// Render iniziale immediato da localStorage
renderItems(latestItems);
renderFavorites(latestFavorites);

// Sincronizzazione Firebase Realtime Database
if (db && itemsRef && favoritesRef) {
    db.ref('.info/connected').on('value', (snap) => {
        firebaseConnected = Boolean(snap.val());
        if (firebaseConnected) {
            syncStatusEl.textContent = 'Sincronizzato in tempo reale';
        }
    });

    setTimeout(() => {
        if (!firebaseConnected) {
            syncStatusEl.textContent = 'Modalità locale (database offline)';
        }
    }, 3000);

    itemsRef.on('value', (snapshot) => {
        firebaseConnected = true;
        syncStatusEl.textContent = 'Sincronizzato in tempo reale';
        latestItems = snapshot.val() || {};
        persistAndRenderItems();
    }, () => {
        syncStatusEl.textContent = 'Modalità locale (database non raggiungibile)';
    });

    favoritesRef.on('value', (snapshot) => {
        if (!snapshot.exists() && localStorage.getItem('favoritesSeeded') !== '1') {
            localStorage.setItem('favoritesSeeded', '1');
            favoritesRef.set(DEFAULT_FAVORITES).catch(() => {});
            latestFavorites = { ...DEFAULT_FAVORITES };
        } else {
            latestFavorites = snapshot.val() || {};
        }
        saveLocalJSON(STORAGE_FAVS_KEY, latestFavorites);
        renderFavorites(latestFavorites);
    }, () => {
        // Mantiene i preferiti locali in caso di errore Firebase
    });
} else {
    syncStatusEl.textContent = 'Modalità locale';
}

// ---------- Banner Installazione PWA (Android & iOS) ----------
const installBanner = document.getElementById('install-banner');
const installBannerDesc = document.getElementById('install-banner-desc');
const installActionBtn = document.getElementById('install-action-btn');
const installDismissBtn = document.getElementById('install-dismiss-btn');

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function showInstallBannerIfNeeded() {
    if (isStandaloneMode() || localStorage.getItem('installBannerDismissed') === '1') {
        return;
    }
    if (deferredInstallPrompt) {
        installBannerDesc.textContent = 'Aggiungi alla schermata Home per usarla come app.';
        installActionBtn.style.display = 'inline-block';
        installBanner.style.display = 'flex';
    } else if (isIosDevice()) {
        installBannerDesc.textContent = 'Tocca Condividi (↑) → "Aggiungi alla schermata Home".';
        installActionBtn.style.display = 'none';
        installBanner.style.display = 'flex';
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBannerIfNeeded();
});

installActionBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice && choice.outcome === 'accepted') {
        installBanner.style.display = 'none';
    }
});

installDismissBtn.addEventListener('click', () => {
    installBanner.style.display = 'none';
    localStorage.setItem('installBannerDismissed', '1');
});

window.addEventListener('appinstalled', () => {
    installBanner.style.display = 'none';
    deferredInstallPrompt = null;
});

showInstallBannerIfNeeded();

// ---------- Registrazione Service Worker ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('Service Worker non registrato:', err);
        });
    });
}
