const el = id => document.getElementById(id);
let auth, family, admin = false;
let stopProfile = () => {};
let stopPerson = () => {};
const subscriptions = [];

function watch(ref, receive, fail = accessError) {
    let active = true;
    const callback = snap => { if (active) receive(snap); };
    ref.on('value', callback, error => { if (active) fail(error); });
    return () => { active = false; ref.off('value', callback); };
}

function screen(name) {
    document.querySelectorAll('.screen').forEach(section =>
        section.classList.toggle('screen-active', section.id === 'screen-' + name));
}

function drawer(open) {
    el('members-drawer').setAttribute('aria-hidden', String(!open));
    el('members-drawer').inert = !open;
    el('members-overlay').style.display = open ? 'block' : 'none';
    if (open) el('close-drawer-btn').focus();
}

function clearFamilyView() {
    subscriptions.splice(0).forEach(stop => stop());
    drawer(false);
    admin = false;
    el('push-section').hidden = true;
    el('push-status').textContent = '';
    el('pending-requests-section').style.display = 'none';
    itemsRef = favoritesRef = null;
    renderItems(latestItems = {});
    renderFavorites(latestFavorites = {});
    resetInputs();
    el('members-list').replaceChildren();
    el('pending-requests-list').replaceChildren();
    el('members-btn').removeAttribute('data-count');
    for (const id of ['drawer-family-name','app-family-name','drawer-invite-code']) el(id).textContent = '';
    modal.style.display = 'none';
    modalConfirm.onclick = null;
}

function accessError() {
    clearFamilyView();
    screen(auth?.currentUser ? 'onboarding' : 'auth');
    showInfoModal('Accesso ai dati non riuscito. Verifica la connessione e le regole Firebase, poi ricarica la pagina.');
}

function action(button, run) {
    button.onclick = async () => {
        button.disabled = true;
        try { await run(); }
        catch { showInfoModal('Operazione non riuscita. Controlla la connessione e riprova.'); }
        finally { button.disabled = false; }
    };
}

function peopleList(snapshot, pending) {
    const list = el(pending ? 'pending-requests-list' : 'members-list');
    list.replaceChildren();
    snapshot.forEach(child => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = child.val().name;
        row.append(label);
        if (pending) {
            for (const approve of [true, false]) {
                const button = document.createElement('button');
                button.textContent = approve ? 'Approva' : 'Rifiuta';
                action(button, () => approve ? child.ref.update({status: 'approved'}) : child.ref.remove());
                row.append(button);
            }
        }
        list.append(row);
    });
    if (pending) {
        el('pending-requests-section').style.display = snapshot.exists() ? '' : 'none';
        const button = el('members-btn');
        if (snapshot.exists()) button.dataset.count = snapshot.numChildren();
        else button.removeAttribute('data-count');
        button.setAttribute('aria-label', 'Famiglia, richieste in attesa: ' + snapshot.numChildren());
    }
}

function openShopping(ref, uid) {
    itemsRef = ref.child('items');
    favoritesRef = ref.child('favorites');
    el('drawer-invite-code').textContent = ref.key;
    subscriptions.push(watch(ref.child('owner'), snap => {
        admin = snap.val() === uid;
        el('push-section').hidden = !admin;
        el('leave-family-btn').querySelector('span').textContent = admin ? 'Elimina famiglia' : 'Esci dalla famiglia';
        if (admin) subscriptions.push(watch(ref.child('people').orderByChild('status').equalTo('pending'), snap => peopleList(snap, true)));
    }));
    subscriptions.push(watch(ref.child('name'), snap => {
        el('app-family-name').textContent = el('drawer-family-name').textContent = snap.val();
        screen('app');
    }));
    subscriptions.push(watch(ref.child('people').orderByChild('status').equalTo('approved'), snap => peopleList(snap, false)));
    subscriptions.push(watch(itemsRef, snap => renderItems(latestItems = snap.val() || {})));
    subscriptions.push(watch(favoritesRef, snap => renderFavorites(latestFavorites = snap.val() || {})));
    subscriptions.push(watch(db.ref('.info/connected'), snap =>
        setSyncState(snap.val(), snap.val() ? 'Connesso alla famiglia' : 'Offline · in attesa di sincronizzazione')));
}

function session(user) {
    stopProfile();
    stopPerson();
    clearFamilyView();
    family = null;
    for (const id of ['login-form','register-form','create-family-form','join-family-form']) el(id).reset();
    if (!user) {
        el('tab-login').click();
        el('login-password').type = el('reg-password').type = 'password';
        forgetPushOwner().catch(() => {});
        return screen('auth');
    }
    screen('loading');
    const link = db.ref('users').child(user.uid);
    stopProfile = watch(link, snap => {
        stopPerson();
        clearFamilyView();
        family = null;
        if (!snap.exists()) return screen('onboarding');
        const code = snap.val();
        const ref = db.ref('families').child(code);
        family = ref;
        screen('loading');
        stopPerson = watch(ref.child('people').child(user.uid), person => {
            clearFamilyView();
            if (!person.exists()) {
                screen('onboarding');
                link.transaction(value => value === code ? null : undefined).catch(accessError);
            } else if (person.val().status === 'pending') {
                el('pending-family-name').textContent = 'famiglia ' + code;
                screen('pending');
                subscriptions.push(watch(ref.child('name'), name => {
                    el('pending-family-name').textContent = name.val();
                }));
            } else {
                openShopping(ref, user.uid);
            }
        });
    });
}

function form(id, errorId, run) {
    const form = el(id);
    form.onsubmit = async event => {
        event.preventDefault();
        const errorBox = el(errorId);
        errorBox.style.display = 'none';
        const submit = form.querySelector('button[type=submit]');
        submit.disabled = true;
        try { await run(); }
        catch (error) {
            const messages = {
                'auth/network-request-failed': 'Connessione assente. Riprova tra poco.',
                'auth/operation-not-allowed': 'Attivare il provider Email/password in Firebase Authentication.',
                'auth/too-many-requests': 'Troppi tentativi. Attendi qualche minuto.',
                'auth/weak-password': 'Scegli una password più lunga.'
            };
            errorBox.textContent = error instanceof InputError ? error.message : messages[error.code] ||
                (id === 'login-form' ? 'Accesso non riuscito. Controlla email e password.' :
                 id === 'join-family-form' ? 'Richiesta non inviata. Verifica il codice famiglia.' : 'Operazione non riuscita. Controlla i dati e riprova.');
            errorBox.style.display = '';
        } finally { submit.disabled = false; }
    };
}

class InputError extends Error {}
for (const tab of ['login', 'register']) {
    el('tab-' + tab).onclick = () => {
        for (const name of ['login', 'register']) {
            const selected = name === tab;
            el('tab-' + name).classList.toggle('active', selected);
            el('tab-' + name).setAttribute('aria-selected', selected);
            el('panel-' + name).style.display = selected ? '' : 'none';
        }
    };
}
for (const prefix of ['login', 'reg']) {
    el('toggle-' + prefix + '-pwd').onclick = () => {
        const field = el(prefix + '-password');
        field.type = field.type === 'password' ? 'text' : 'password';
    };
}
form('login-form', 'login-error', () => auth.signInWithEmailAndPassword(el('login-email').value.trim(), el('login-password').value));
el('google-login').onclick = async () => {
    const button = el('google-login');
    const message = el('google-error');
    message.hidden = true;
    button.disabled = true;
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({prompt: 'select_account'});
        await auth.signInWithPopup(provider);
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
        const messages = {
            'auth/popup-blocked': 'Consenti le finestre popup per questo sito e riprova.',
            'auth/account-exists-with-different-credential': 'Hai già un account con questa email. Accedi con il metodo che hai usato per registrarti.'
        };
        message.textContent = messages[error.code] || 'Accesso con Google non riuscito. Riprova dal browser.';
        message.hidden = false;
    } finally {
        button.disabled = false;
    }
};
let registrationName = '';
form('register-form', 'register-error', async () => {
    const name = el('reg-name').value.trim();
    if (!name) throw new InputError('Inserisci il tuo nome.');
    const password = el('reg-password').value;
    if (password !== el('reg-confirm').value) throw new InputError('Le due password devono coincidere.');
    registrationName = name;
    try {
        const result = await auth.createUserWithEmailAndPassword(el('reg-email').value.trim(), password);
        await result.user.updateProfile({displayName: name});
    } finally { registrationName = ''; }
});

function personName() {
    return auth.currentUser.displayName || registrationName || 'Membro della famiglia';
}

form('create-family-form', 'create-error', async () => {
    const uid = auth.currentUser.uid;
    const name = el('family-name').value.trim();
    if (!name) throw new InputError('Inserisci il nome della famiglia.');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % 32]).join('');
    await db.ref().update({
        ['users/' + uid]: code,
        ['families/' + code]: {owner: uid, name, favorites: DEFAULT_FAVORITES,
            people: {[uid]: {name: personName(), status: 'approved'}}}
    });
});
form('join-family-form', 'join-error', async () => {
    const uid = auth.currentUser.uid;
    const code = el('invite-code').value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) throw new InputError('Inserisci gli 8 caratteri del codice.');
    await db.ref().update({['users/' + uid]: code,
        ['families/' + code + '/people/' + uid]: {name: personName(), status:'pending'}});
});

function leave() {
    const ref = family;
    const uid = auth.currentUser.uid;
    const deleting = admin;
    const path = 'families/' + ref.key + (deleting ? '' : '/people/' + uid);
    const message = deleting ? 'Eliminare la famiglia e la sua lista per tutti i membri?' : 'Confermi di voler uscire dalla famiglia?';
    showModal(message, () => {
        if (ref === family) db.ref().update({[path]: null, ['users/' + uid]: null}).catch(accessError);
    });
}
el('cancel-request-btn').onclick = leave;
el('leave-family-btn').onclick = leave;
el('members-btn').onclick = () => drawer(true);
el('members-overlay').onclick = el('close-drawer-btn').onclick = () => drawer(false);
document.addEventListener('keydown', event => { if (event.key === 'Escape') drawer(false); });
action(el('copy-code-btn'), async () => {
    await navigator.clipboard.writeText(family.key);
    showInfoModal('Codice di invito copiato.');
});
for (const id of ['pending','app','onboarding']) action(el(id + '-signout-btn'), async () => { await forgetPushOwner(); await auth.signOut(); });

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    auth = firebase.auth();
    auth.languageCode = 'it';
    auth.onAuthStateChanged(session, accessError);
} catch {
    screen('auth');
    el('login-error').textContent = 'Firebase non disponibile. Controlla la connessione e ricarica la pagina.';
    el('login-error').style.display = '';
}
