const CACHE = 'sharkdark-v38';
const ARCHIVOS = ['./', '/control-escolar', 'index.html', 'bundle.js', 'bundle.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-192-claro.png', 'icon-512-claro.png', 'img/tiburon.png', 'img/tiburon-claro.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARCHIVOS.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // Caché primero; se actualiza en segundo plano cuando hay internet
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const red = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || red;
  }));
});
