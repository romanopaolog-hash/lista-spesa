const CACHE_NAME = 'lista-spesa-v5';

const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './firebase-config.js',
    './family.js',
    './notifications.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith('lista-spesa-v') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Ignora richieste non-GET e qualsiasi traffico verso domini esterni (es. Firebase, CDN)
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !STATIC_ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;

    // Strategia Network-First solo per gli asset statici locali
    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
});

self.addEventListener('push', event => {
    const data = event.data?.json()?.data;
    if (data?.kind !== 'family-request') return;
    event.waitUntil((async () => {
        const state = await (await caches.open('lista-spesa-push')).match(new URL('./push-owner', self.registration.scope));
        if (!state) return;
        const {uid, code} = await state.json();
        if (uid !== data.owner || code !== data.code) return;
        await self.registration.showNotification('La nostra spesa', {
            body: 'Hai una richiesta di ingresso in famiglia.',
            icon: new URL('./icons/icon-192.png', self.registration.scope).href,
            tag: 'family-request'
        });
    })());
});

self.addEventListener('notificationclick', event => {
    if (event.notification.tag !== 'family-request') return;
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({type:'window'});
        const app = windows.find(client => client.url.startsWith(self.registration.scope));
        if (app) await app.focus();
        else await self.clients.openWindow(self.registration.scope);
    })());
});
