let db, itemsRef;

const CATEGORIES = [
    { id: 'Ortofrutta', label: 'Ortofrutta', icon: 'apple' },
    { id: 'Frigo e Latticini', label: 'Frigo e Latticini', icon: 'snowflake' },
    { id: 'Dispensa', label: 'Dispensa', icon: 'package' },
    { id: 'Carne e Pesce', label: 'Carne e Pesce', icon: 'fish' },
    { id: 'Casa e Pulizia', label: 'Casa e Pulizia', icon: 'home' },
    { id: 'Altro', label: 'Altro', icon: 'layers' }
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

let purchaseHistory = {};
let hiddenFrequent = {};

let currentQty = 1;
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
const categorySelect = document.getElementById('category-select');
const syncStatusEl = document.getElementById('sync-status');
const syncDotEl = document.getElementById('sync-dot');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeColorMeta = document.getElementById('theme-color-meta');
const wakeLockBtn = document.getElementById('wake-lock-btn');

// Modale
const modal = document.getElementById('custom-modal');
const modalMessage = document.getElementById('modal-message');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');

function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function createLucideIcon(name) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    return i;
}

function shoppingError() {
    showInfoModal("Modifica non salvata. Controlla la connessione e riprova.");
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

// ---------- Tema Chiaro / Scuro ----------
function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggleBtn.innerHTML = '<i data-lucide="sun" id="theme-icon"></i> Tema chiaro';
        if (themeColorMeta) themeColorMeta.setAttribute('content', '#121212');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        themeToggleBtn.innerHTML = '<i data-lucide="moon" id="theme-icon"></i> Tema scuro';
        if (themeColorMeta) themeColorMeta.setAttribute('content', '#1f6f4a');
    }
    refreshIcons();
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
for (const category of CATEGORIES) {
    const option = new Option(category.label, category.id);
    const icon = createLucideIcon(category.icon);
    icon.setAttribute('aria-hidden', 'true');
    option.prepend(icon);
    categorySelect.add(option);
}
categorySelect.value = 'Altro';
categorySelect.addEventListener('change', () => {
    const category = CATEGORIES[categorySelect.selectedIndex];
    document.querySelector('.category-symbol').replaceChildren(createLucideIcon(category.icon));
    refreshIcons();
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

// ---------- Operazioni su Prodotti ----------

function addItem() {
    const name = formatItemName(itemInput.value);
    const note = noteInput.value.trim();
    if (!name) return;

    for (const key in latestItems) {
        const existing = latestItems[key];
        if (existing && !existing.bought && existing.name && existing.name.toLowerCase() === name.toLowerCase()) {
            showInfoModal(`“${name}” è già nella lista! Puoi modificarne la quantità direttamente sotto.`);
            resetInputs();
            return;
        }
    }

    const payload = {
        name: name,
        quantity: currentQty,
        bought: false,
        category: categorySelect.value
    };
    if (note) {
        payload.note = note;
    }

    if (!itemsRef) return;
    itemsRef.push(payload).catch(shoppingError);

    resetInputs();
}

addBtn.addEventListener('click', addItem);

[itemInput, noteInput].forEach((input) => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addItem();
    });
});

function toggleBought(id, currentStatus) {
    const item = latestItems[id];
    if (!itemsRef || !item) return;
    itemsRef.parent.update({
        ['items/' + id + '/bought']: !currentStatus,
        ['purchases/' + id]: currentStatus ? null : { name: item.name, category: item.category }
    }).catch(shoppingError);
}

function updateQty(id, delta) {
    if (delta < 0 && latestItems[id]?.quantity === 1) return deleteItem(id, false);
    itemsRef?.child(id).transaction(item => {
        if (!item) return;
        const quantity = item.quantity + delta;
        return quantity > 0 ? { ...item, quantity } : undefined;
    }).catch(shoppingError);
}

function deleteItem(id, countRemoved = true) {
    if (itemsRef && latestItems[id]) removeItems(itemsRef, [[id, latestItems[id]]], countRemoved);
}

function removeItems(ref, entries, countRemoved = true) {
    const changes = {};
    for (const [id, item] of entries) {
        changes['items/' + id] = null;
        if (countRemoved || item.bought) changes['purchases/' + id] = {name: item.name, category: item.category};
    }
    if (entries.length) ref.parent.update(changes).catch(shoppingError);
}

function clearItems(message, matches, countRemoved = true) {
    const ref = itemsRef;
    showModal(message, () => {
        if (!ref || ref !== itemsRef) return;
        removeItems(ref, Object.entries(latestItems).filter(([, item]) => matches(item)), countRemoved);
    });
}

clearPendingBtn.onclick = () => clearItems('Eliminare i prodotti da comprare?', item => !item.bought);
clearBoughtBtn.onclick = () => clearItems('Eliminare i prodotti già comprati?', item => item.bought);
deleteAllBtn.onclick = () => clearItems('Eliminare tutti i prodotti della lista?', () => true, false);

function renderFrequentProducts() {
    const products = new Map();
    // Una riga ancora presente nella lista ha la precedenza sul suo storico.
    const receipts = {...purchaseHistory};
    for (const [id, item] of Object.entries(latestItems)) {
        if (item.bought) receipts[id] = item;
        else delete receipts[id];
    }
    for (const item of Object.values(receipts)) {
        const key = productKey(item.name);
        const previous = products.get(key);
        if (previous) previous.count++;
        else products.set(key, {name: item.name, category: item.category, count: 1});
    }
    const ranked = [...products.values()].filter(product => !hiddenFrequent[frequentId(product.name)]).sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name, 'it'));
    const bar = document.getElementById('frequent-products');
    bar.replaceChildren();
    if (!ranked.length) bar.textContent = 'Qui vedrai i prodotti che la famiglia segna come comprati.';
    for (const product of ranked.slice(0, 6)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fav-chip';
        button.textContent = product.name;
        button.setAttribute('aria-label', 'Aggiungi ' + product.name + ' alla lista');
        button.onclick = () => addFrequentProduct(product);
        const chip = document.createElement('div');
        chip.className = 'frequent-chip';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'frequent-remove';
        remove.setAttribute('aria-label', 'Rimuovi ' + product.name + ' dagli acquisti frequenti');
        remove.textContent = '×';
        remove.onclick = () => {
            const ref = itemsRef?.parent.child('hiddenFrequent').child(frequentId(product.name));
            if (ref) ref.set(true).catch(shoppingError);
        };
        chip.append(button, remove);
        bar.append(chip);
    }
}

function frequentId(name) {
    return Array.from(new TextEncoder().encode(productKey(name)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function productKey(name) {
    return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
}

function addFrequentProduct(product) {
    const targetName = productKey(product.name);
    let existingId = null;

    for (const id in latestItems) {
        const item = latestItems[id];
        if (item && !item.bought && item.name && productKey(item.name) === targetName) {
            existingId = id;
            break;
        }
    }

    if (existingId) {
        itemsRef?.child(existingId).transaction(item => item && !item.bought ? {
            ...item, quantity: item.quantity + 1
        } : undefined).catch(shoppingError);

    } else {
        const payload = {
            name: formatItemName(product.name),
            quantity: 1,
            bought: false,
            category: CATEGORY_IDS.includes(product.category) ? product.category : 'Altro'
        };

        itemsRef?.push(payload).catch(shoppingError);

    }
}

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
    checkCircle.appendChild(createLucideIcon('check'));

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
    minusBtn.appendChild(createLucideIcon('minus'));
    minusBtn.setAttribute('aria-label', `Diminuisci quantità di ${item.name}`);
    minusBtn.addEventListener('click', () => updateQty(id, -1));

    const qtyVal = document.createElement('span');
    qtyVal.className = 'qty-value';
    qtyVal.textContent = String(qty);

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'qty-btn';
    plusBtn.appendChild(createLucideIcon('plus'));
    plusBtn.setAttribute('aria-label', `Aumenta quantità di ${item.name}`);
    plusBtn.addEventListener('click', () => updateQty(id, 1));

    qtyPill.appendChild(minusBtn);
    qtyPill.appendChild(qtyVal);
    qtyPill.appendChild(plusBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-item-btn';
    delBtn.appendChild(createLucideIcon('x'));
    delBtn.setAttribute('aria-label', `Elimina ${item.name}`);
    delBtn.addEventListener('click', () => deleteItem(id));

    actionsDiv.appendChild(qtyPill);
    actionsDiv.appendChild(delBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);
    return li;
}

const shoppingWidget = document.getElementById('shopping-widget');
document.getElementById('shopping-widget-open').onclick = () => shoppingWidget.showModal();
document.getElementById('shopping-widget-close').onclick = () => shoppingWidget.close();

function renderShoppingWidget(data) {
    const list = shoppingWidget.querySelector('ul');
    list.replaceChildren();
    for (const item of Object.values(data)) {
        if (item.bought) continue;
        const row = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = item.name;
        const quantity = document.createElement('span');
        quantity.textContent = '×' + item.quantity;
        row.append(name, quantity);
        if (item.note) {
            const note = document.createElement('small');
            note.textContent = item.note;
            row.append(note);
        }
        list.append(row);
    }
    shoppingWidget.querySelector('p').hidden = list.childElementCount > 0;
}

function renderItems(data) {
    renderShoppingWidget(data);
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

            const titleWrap = document.createElement('span');
            titleWrap.className = 'category-group-title';
            titleWrap.appendChild(createLucideIcon(cat.icon));
            const titleText = document.createElement('span');
            titleText.textContent = cat.label;
            titleWrap.appendChild(titleText);

            const countSpan = document.createElement('span');
            countSpan.textContent = `${entries.length}`;

            groupHeader.appendChild(titleWrap);
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
    refreshIcons();
}

// Render iniziale immediato
renderItems(latestItems);

// Sincronizzazione Firebase Realtime Database
function setSyncState(online, message) {
    syncStatusEl.textContent = message;
    if (syncDotEl) {
        syncDotEl.classList.toggle('online', online);
    }
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
refreshIcons();

// ---------- Registrazione Service Worker ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('Service Worker non registrato:', err);
        });
    });
}
