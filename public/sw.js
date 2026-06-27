/* AcadFlow service worker - offline shell + FCM background push.
 * Hand-rolled (no build dependency). Strictly additive:
 *  - Only intercepts same-origin GET requests.
 *  - Never touches Firestore / Google / cross-origin traffic, so real-time
 *    sync and all existing network calls behave exactly as before.
 */
const CACHE_VERSION = 'acadflow-v30';
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle our own origin. Firebase, fonts, and CDN libs pass straight
  // through to the network, untouched.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so deploys show immediately; fall back to the
  // cached shell (and finally the offline page) when the network is down.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  // Static same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* ── Firebase Cloud Messaging - background push (optional) ─────────────────
 * Wrapped in try/catch: if the FCM compat libraries can't load (e.g. offline
 * at install, or push simply isn't configured) the worker keeps working as a
 * pure offline-shell cache with zero side effects.                          */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyDXHkKZlDPs1oSWWtELXqXF2YVT9T73CJA',
    authDomain: 'collegeportal-d2b98.firebaseapp.com',
    projectId: 'collegeportal-d2b98',
    storageBucket: 'collegeportal-d2b98.firebasestorage.app',
    messagingSenderId: '219297076744',
    appId: '1:219297076744:web:825a6c587dbaee327e23bd',
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    // Messages are sent data-only (title/body live in payload.data) so they are
    // displayed here exactly once. Fall back to payload.notification just in
    // case an older sender or another source delivers a notification message.
    const n = payload.notification || {};
    const d = payload.data || {};
    self.registration.showNotification(n.title || d.title || 'AcadFlow', {
      body: n.body || d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || 'acadflow',
      data: { url: d.url || '/' },
    });
  });
} catch (e) {
  /* FCM unavailable - offline shell still active */
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
