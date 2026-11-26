const CACHE = 'sharkdark-v58';
const ARCHIVOS = ['./', '/control-escolar', 'index.html', 'bundle.js', 'bundle.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-acceso-192.png', 'icon-acceso-512.png', 'icon-192-claro.png', 'icon-512-claro.png', 'img/logo-oscuro.png', 'img/logo-claro.png', 'img/tiburon.png', 'img/icono-tiburon.png', 'fonts/Montserrat-var.woff', 'fonts/Lora-var.woff', 'img/tiburon-claro.png', 'img/logo-nuevo-claro.jpeg', 'img/logo-nuevo-oscuro.jpeg'];
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
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() || '' }; }
  const icon = '/icon-192.png';
  e.waitUntil(self.registration.showNotification(data.title || 'TIBURONES', {
    body: data.body || 'Tienes un nuevo aviso escolar.', icon, badge: icon,
    data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const tab = list.find(c => c.url.startsWith(self.location.origin));
    if (tab) return tab.focus().then(() => tab.navigate(url));
    return clients.openWindow(url);
  }));
});
