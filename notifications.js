async function enablePush() {
    if (!window.firebase?.messaging || !firebase.messaging.isSupported() || !('Notification' in window)) {
        throw new InputError('Questo browser non supporta le push. Su iPhone apri l’app dalla schermata Home.');
    }
    if (!webPushPublicKey) throw new InputError('Le notifiche richiedono la chiave pubblica Web Push del progetto Firebase.');
    const uid = auth.currentUser.uid;
    const ref = family;
    if (!admin || await Notification.requestPermission() !== 'granted') {
        throw new InputError('Per ricevere gli avvisi, consenti le notifiche nelle impostazioni del browser.');
    }
    const registration = await navigator.serviceWorker.ready;
    const token = await firebase.messaging().getToken({vapidKey: webPushPublicKey, serviceWorkerRegistration: registration});
    let device = localStorage.getItem('push-device');
    if (!device) {
        device = crypto.randomUUID();
        localStorage.setItem('push-device', device);
    }
    if (auth.currentUser?.uid !== uid || family !== ref || !admin) return;
    await db.ref('devices').child(uid).child(device).set(token);
    if (auth.currentUser?.uid !== uid || family !== ref || !admin) return;
    await (await caches.open(pushCacheName)).put(pushStateKey, new Response(JSON.stringify({uid, code:ref.key})));
    el('push-status').textContent = 'Notifiche attivate su questo dispositivo.';
}

el('push-btn').onclick = async () => {
    el('push-btn').disabled = true;
    try { await enablePush(); }
    catch (error) {
        el('push-status').textContent = error instanceof InputError ? error.message : 'Attivazione non riuscita. Verifica connessione e permessi del browser.';
    } finally { el('push-btn').disabled = false; }
};
