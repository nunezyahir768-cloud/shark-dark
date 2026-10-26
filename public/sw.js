const CACHE = 'sharkdark-v6';
const ARCHIVOS = ['entrada.html','inicio_alumno.html','registro_alumno.html','menu_alumnos.html','qr_alumno.html',
  'inicio_docente.html','registro_docente.html','menu_docentes.html','escanear.html',
  'inicio_tutor.html','registro_tutor.html','menu_tutor.html','app.js','manifest.webmanifest','img/tiburon.png','img/texto.png','img/barra.png','icon-192.png','icon-512.png','lib/jsQR.js'];

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
  // Caché primero, y se actualiza en segundo plano cuando hay internet
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const red = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || red;
  }));
});
