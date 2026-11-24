// Configurazione Firebase Realtime Database (invariata)
const firebaseConfig = {
    databaseURL: "https://listaspesafamiglia-default-rtdb.europe-west1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const itemsRef = db.ref('items');
const favoritesRef = db.ref('favorites');

const CATEGORIES = [
    { id: 'Ortofrutta', label: '🥬 Ortofrutta' },
    { id: 'Frigo e Latticini', label: '🧀 Frigo e Latticini' },
    { id: 'Dispensa', label: '🍝 Dispensa' },
    { id: 'Carne e Pesce', label: '🥩 Carne e Pesce' },
    { id: 'Casa e Pulizia', label: '🧽 Casa e Pulizia' },
    { id: 'Altro', label: '📦 Altro' }
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const DEFAULT_FAVORITES = [
    { name: 'Pane', category: 'Dispensa' },
    { name: 'Latte', category: 'Frigo e Latticini' },
    { name: 'Acqua', category: 'Dispensa' },
    { name: 'Uova', category: 'Frigo e Latticini' },
    { name: 'Caffè', category: 'Dispensa' },
    { name: 'Pasta', category: 'Dispensa' }
];

let currentQty = 1;
let selectedCategory = 'Altro';
let latestItems = {};
let wakeLockSentinel = null;
let wakeLockEnabled = false;
let deferredInstallPrompt = null;

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
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');
const themeColorMeta = document.getElementById('theme-color-meta');
const wakeLockBtn = document.getElementById('wake-lock-btn');

// Modale
const modal = document.getElementById('custom-modal');
const modalMessage = document.getElementById('modal-message');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');

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

// ---------- Tema Chiaro / Scuro ----------
function getEffectiveTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
        document.documentElement.setAttribute('data-theme', theme);
    }
    const effective = getEffectiveTheme();
    themeIcon.textContent = effective === 'dark' ? '☀️' : '🌙';
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', effective === 'dark' ? '#181e19' : '#2e7d32');
    }
}

applyTheme(localStorage.getItem('theme'));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem('theme')) {
        applyTheme(null);
    }
});

themeToggleBtn.addEventListener('click', () => {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
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
            if (!wakeLockEnabled) {
                updateWakeLockUI(false);
            }
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
            // Ignora eventuali errori di rilascio
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
        const ok = await requestWakeLock();
        wakeLockEnabled = ok;
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

// ---------- Aggiunta Prodotto ----------
function addItem() {
    const name = formatItemName(itemInput.value);
    const note = noteInput.value.trim();
    if (!name) return;

    itemsRef.once('value', (snapshot) => {
        const items = snapshot.val() || {};
        let exists = false;

        for (const key in items) {
            if (items[key].name && items[key].name.toLowerCase() === name.toLowerCase()) {
                exists = true;
                break;
            }
        }

        if (exists) {
            showInfoModal(`“${name}” è già nella lista! Se vuoi puoi modificarne la quantità direttamente sotto.`);
            resetInputs();
        } else {
            const payload = {
                name: name,
                quantity: currentQty,
                bought: false,
                category: selectedCategory
            };
            if (note) {
                payload.note = note;
            }
            itemsRef.push(payload);
            resetInputs();
        }
    });
}

addBtn.addEventListener('click', addItem);

[itemInput, noteInput].forEach((input) => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addItem();
        }
    });
});

// ---------- Preferiti / Acquisti Frequenti ----------
function seedFavoritesIfEmpty(snapshot) {
    if (snapshot.exists() || localStorage.getItem('favoritesSeeded') === '1') {
        return;
    }
    localStorage.setItem('favoritesSeeded', '1');
    DEFAULT_FAVORITES.forEach((fav) => {
        favoritesRef.push(fav);
    });
}

favoritesRef.on('value', (snapshot) => {
    if (!snapshot.exists() && localStorage.getItem('favoritesSeeded') !== '1') {
        seedFavoritesIfEmpty(snapshot);
        return;
    }

    const data = snapshot.val() || {};
    favoritesBar.innerHTML = '';

    const entries = Object.entries(data);
    if (entries.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'item-note';
        hint.textContent = 'Nessun preferito salvato. Scrivi un prodotto e tocca "+ Salva preferito".';
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
                favoritesRef.child(favId).remove();
            });
        });

        chip.appendChild(labelBtn);
        chip.appendChild(removeBtn);
        favoritesBar.appendChild(chip);
    });
});

function addFavoriteToShoppingList(fav) {
    const targetName = fav.name.toLowerCase();
    let existingId = null;
    let existingItem = null;

    for (const id in latestItems) {
        const item = latestItems[id];
        if (item && item.name && item.name.toLowerCase() === targetName) {
            existingId = id;
            existingItem = item;
            break;
        }
    }

    if (existingId && existingItem) {
        if (existingItem.bought) {
            itemsRef.child(existingId).update({
                bought: false,
                quantity: 1
            });
        } else {
            itemsRef.child(existingId).update({
                quantity: (existingItem.quantity || 1) + 1
            });
        }
    } else {
        const payload = {
            name: formatItemName(fav.name),
            quantity: 1,
            bought: false,
            category: CATEGORY_IDS.includes(fav.category) ? fav.category : 'Altro'
        };
        if (fav.note) {
            payload.note = fav.note;
        }
        itemsRef.push(payload);
    }
}

addFavoriteBtn.addEventListener('click', () => {
    const name = formatItemName(itemInput.value);
    if (!name) {
        showInfoModal('Scrivi prima il nome di un prodotto nel campo sopra per salvarlo tra i preferiti.');
        itemInput.focus();
        return;
    }

    const note = noteInput.value.trim();
    favoritesRef.once('value', (snapshot) => {
        const favs = snapshot.val() || {};
        for (const id in favs) {
            if (favs[id].name && favs[id].name.toLowerCase() === name.toLowerCase()) {
                showInfoModal(`“${name}” è già nei preferiti!`);
                return;
            }
        }
        const favPayload = {
            name: name,
            category: selectedCategory
        };
        if (note) {
            favPayload.note = note;
        }
        favoritesRef.push(favPayload);
        localStorage.setItem('favoritesSeeded', '1');
        showInfoModal(`“${name}” aggiunto agli acquisti frequenti!`);
    });
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
    nameSpan.textContent = `${item.name} (${qty})`;
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

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-item-btn';
    delBtn.textContent = '✕';
    delBtn.setAttribute('aria-label', `Elimina ${item.name}`);
    delBtn.addEventListener('click', () => deleteItem(id));

    actionsDiv.appendChild(minusBtn);
    actionsDiv.appendChild(qtyVal);
    actionsDiv.appendChild(plusBtn);
    actionsDiv.appendChild(delBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);
    return li;
}

itemsRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    latestItems = data;

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
        empty.textContent = 'La lista da comprare è vuota. Aggiungi un prodotto o scegli dai preferiti!';
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
});

function toggleBought(id, currentStatus) {
    itemsRef.child(id).update({ bought: !currentStatus });
}

function updateQty(id, currentQtyVal, delta) {
    const newQty = currentQtyVal + delta;
    if (newQty > 0) {
        itemsRef.child(id).update({ quantity: newQty });
    } else {
        deleteItem(id);
    }
}

function deleteItem(id) {
    itemsRef.child(id).remove();
}

// Pulsanti di pulizia con conferme
clearPendingBtn.addEventListener('click', () => {
    showModal('Sei sicuro di voler pulire la lista degli oggetti da comprare?', () => {
        itemsRef.once('value', (snapshot) => {
            const data = snapshot.val() || {};
            for (const id in data) {
                if (!data[id].bought) {
                    itemsRef.child(id).remove();
                }
            }
        });
    });
});

clearBoughtBtn.addEventListener('click', () => {
    showModal('Sei sicuro di voler rimuovere tutti i prodotti già comprati?', () => {
        itemsRef.once('value', (snapshot) => {
            const data = snapshot.val() || {};
            for (const id in data) {
                if (data[id].bought) {
                    itemsRef.child(id).remove();
                }
            }
        });
    });
});

deleteAllBtn.addEventListener('click', () => {
    showModal("Sei sicuro di voler eliminare tutto l'archivio della spesa?", () => {
        itemsRef.remove();
    });
});

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
