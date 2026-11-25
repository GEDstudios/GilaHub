/* Gila Hub service worker — offline app shell + private push.
 * Push payloads arrive sealed with the household (or personal) key; this worker
 * opens them with the key stored on this device, so neither the push service nor
 * the relay ever sees what a reminder says. */

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `gila-${VERSION}`;
const RUNTIME = 'gila-runtime';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gila-') && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// "Is this page's code in your build?" — a page running an older build hears "no" and offers
// Refresh. (iPhone apps often miss the moment the new worker takes over.)
self.addEventListener('message', (event) => {
  const d = event.data;
  if (d && d.type === 'has' && event.ports[0]) event.ports[0].postMessage({ has: PRECACHE.includes(d.path), version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // App shell: answer instantly from cache, refresh it in the background.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match('/');
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put('/', res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Hashed assets, fonts and icons never change: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(RUNTIME).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});

// ---------------------------------------------------------------- push

function fromB64u(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readSession() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('gila-hub');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction('meta', 'readonly');
        const get = tx.objectStore('meta').get('session');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      } catch (e) {
        reject(e);
      }
    };
  });
}

async function openNote(msg) {
  const s = await readSession();
  if (!s) throw new Error('no session');
  const material = msg.k === 'h' ? s.householdKey : msg.k === `p:${s.memberId}` ? s.personalKey : null;
  if (!material) throw new Error('not for me');
  const key = await crypto.subtle.importKey('raw', fromB64u(material), { name: 'AES-GCM' }, false, ['decrypt']);
  const raw = fromB64u(msg.c);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: new TextEncoder().encode(`${s.householdId}|${msg.k}|push`) },
    key,
    raw.subarray(12),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let note = { title: 'Gila Hub', body: 'Something needs you.', url: '/' };
      try {
        const msg = event.data ? event.data.json() : null;
        if (msg && msg.c) note = { ...note, ...(await openNote(msg)) };
      } catch {
        /* show the generic note */
      }
      // A thing to do (its page is /i/<id>) gets Done and Tomorrow right on the notification.
      const isItem = /^\/i\/[A-Za-z0-9]+$/.test(note.url || '');
      await self.registration.showNotification(note.title, {
        body: note.body || '',
        tag: note.tag || undefined,
        renotify: !!note.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        timestamp: Date.now(),
        vibrate: [12, 60, 12],
        actions: isItem
          ? [
              { action: 'done', title: '✓ Done' },
              { action: 'later', title: 'Tomorrow' },
            ]
          : [],
        data: { url: note.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const base = (event.notification.data && event.notification.data.url) || '/';
  // Done / Tomorrow: the app does it when it opens the thing (?do=done / ?do=later).
  const url = event.action === 'done' || event.action === 'later' ? `${base}?do=${event.action}` : base;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = all.find((c) => new URL(c.url).origin === location.origin);
      if (client) {
        await client.focus();
        client.postMessage({ type: 'navigate', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
