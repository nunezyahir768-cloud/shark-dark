/* SHARK DARK · núcleo offline: IndexedDB + cola de sincronización + QR (generar y leer) */
  /* ---------- Base de datos local ---------- */
  const dbp = new Promise((ok, fail) => {
    const r = indexedDB.open('sharkdark', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      const mk = (n, o) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, o); };
      mk('usuarios', { keyPath: '_id' }); mk('alumnos', { keyPath: 'curp' }); mk('asistencias', { keyPath: 'uid' });
      mk('cola', { keyPath: 'qid', autoIncrement: true }); mk('avisos', { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await dbp;
    return new Promise((ok, fail) => {
      const t = d.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => ok(rq && rq.result);
      t.onerror = () => fail(t.error);
    });
  };
  const put = (s, v) => tx(s, 'readwrite', st => st.put(v));
  const get = (s, k) => tx(s, 'readonly', st => st.get(k));
  const all = s => tx(s, 'readonly', st => st.getAll());
  const del = (s, k) => tx(s, 'readwrite', st => st.delete(k));

  /* ---------- Sesión y API ---------- */
  const ses = () => { try { return JSON.parse(localStorage.getItem('sd_ses')); } catch { return null; } };
  const setSes = u => localStorage.setItem('sd_ses', JSON.stringify({
    rol: u.rol, id: u.id, nombre: u.nombre, curp: u.curp, area: u.area, semestre: u.semestre,
    grupo: u.grupo, curpAlumno: u.curpAlumno, debeCambiarPassword: !!u.debeCambiarPassword, token: u.token || null
  }));

  async function api(path, opt = {}) {
    const s = ses(), h = { 'Content-Type': 'application/json' };
    if (s && s.token) h.Authorization = 'Bearer ' + s.token;
    const r = await fetch(path, { method: opt.method || 'GET', headers: h, body: opt.body && JSON.stringify(opt.body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  async function hash(pw, salt) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256);
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- Inicio de sesión con contraseña ---------- */
  async function login(rol, id, password) {
    id = String(id).trim().toUpperCase();
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para iniciar sesión. Si ya habías iniciado sesión, puedes seguir usando la sesión guardada sin conexión.');
    const r = await api('/api/login', { method: 'POST', body: { rol: rol || '', id, password } });
    rol = r.usuario.rol;
    const uid = r.usuario.id || id;
    const u = { ...r.usuario, _id: rol + ':' + uid, rol, id: uid, token: r.token };
    await put('usuarios', u);
    await cambioDeUsuario(rol, uid);
    setSes(u);
    sync();
    return u;
  }

  async function activarCuenta(rol, curp, nombre, password, confirmar) {
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para crear tu contraseña.');
    return api('/api/cuenta/activar', { method: 'POST', body: { rol, curp: String(curp).trim().toUpperCase(), nombre, password, confirmar } });
  }
  const activarAlumno = (curp, nombre, password, confirmar) => activarCuenta('alumno', curp, nombre, password, confirmar);

  async function solicitarRecuperacion(rol, id) {
    return api('/api/recuperacion', { method: 'POST', body: { rol, id: String(id).trim().toUpperCase() } });
  }
  async function cambiarPassword(actual, nueva) {
    const r = await api('/api/cambiar-password', { method: 'POST', body: { actual, nueva } });
    const u = ses(); if (u) { u.debeCambiarPassword = false; localStorage.setItem('sd_ses', JSON.stringify(u)); }
    return r;
  }

  async function cambioDeUsuario(rol, id) {
    const k = rol + ':' + id;
    if (localStorage.getItem('sd_last') !== k) {
      for (const [st, kp] of [['alumnos', 'curp'], ['asistencias', 'uid'], ['avisos', 'id']]) for (const x of await all(st)) await del(st, x[kp]);
      localStorage.setItem('sd_last', k);
      Object.keys(localStorage).filter(x => x.startsWith('sdc_')).forEach(x => localStorage.removeItem(x));
    }
  }
  const logout = () => { localStorage.removeItem('sd_ses'); location.hash = ''; location.reload(); };

  /* ---------- Asistencias y consulta ---------- */
  const mat = m => String(m || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  async function asistencia(curp, clase) {
    const s = ses(), n = new Date(), materia = mat(clase.materia), k = materia.toLowerCase();
    const fecha = n.toLocaleDateString('sv-SE');           // YYYY-MM-DD en hora local
    const hora = n.toTimeString().slice(0, 5);
    const ya = (await all('asistencias')).find(a => a.curp === curp && a.fecha === fecha && a.estado !== 'falta' && mat(a.materia).toLowerCase() === k);
    if (ya) return { duplicada: true, asistencia: ya };
    await del('asistencias', `F:${curp}:${fecha}:${k}`);
    const a = { uid: crypto.randomUUID(), curp, fecha, hora, estado: 'asistio', materia, horaInicio: clase.horaInicio || '', horaFin: clase.horaFin || '', docente: s.id, docenteNombre: s.nombre, pendiente: true };
    await put('asistencias', a);
    await put('cola', { tipo: 'asistencia', uid: a.uid, datos: a });
    refrescarBadge();
    sync();
    return { duplicada: false, asistencia: a };
  }

  /* Cierre de lista de una clase: quien no asistió a esa materia hoy queda con falta */
  async function cierre(clase) {
    const s = ses(), n = new Date(), fecha = n.toLocaleDateString('sv-SE'), hora = n.toTimeString().slice(0, 5);
    const materia = mat(clase.materia), k = materia.toLowerCase();
    if (navigator.onLine) { try { for (const x of await api('/api/alumnos')) await put('alumnos', x); } catch (e) {} }
    const d = await datos(), presentes = new Set(d.asistencias.filter(a => a.fecha === fecha && a.estado !== 'falta' && mat(a.materia).toLowerCase() === k).map(a => a.curp));
    const ausentes = d.alumnos.filter(x => x.area === clase.area && x.semestre === clase.semestre && x.grupo === clase.grupo && !presentes.has(x.curp));
    let ap = []; if (navigator.onLine) { try { ap = (await api('/api/permisos')).filter(p => p.estado === 'aprobado'); } catch (e) {} }
    const just = x => ap.some(p => p.curp === x.curp && p.desde <= fecha && fecha <= p.hasta);
    for (const x of ausentes) await put('asistencias', { uid: `F:${x.curp}:${fecha}:${k}`, curp: x.curp, fecha, hora, estado: just(x) ? 'justificada' : 'falta', materia, horaInicio: clase.horaInicio || '', horaFin: clase.horaFin || '', docente: s.id, docenteNombre: s.nombre, pendiente: true });
    await put('cola', { tipo: 'cierre', datos: { area: clase.area, semestre: clase.semestre, grupo: clase.grupo, materia, fecha, hora, docenteNombre: s.nombre } });
    refrescarBadge(); sync();
    return ausentes.filter(x => !just(x)).map(x => x.nombre);
  }

  /* Corregir (solo con internet): justificar una falta o quitar un registro */
  async function corregir(uid, accion, motivo) {
    if (!navigator.onLine) throw new Error('Necesitas internet para corregir registros');
    await api(`/api/asistencias/${encodeURIComponent(uid)}/${accion}`, { method: 'POST', body: { motivo } });
    const r = await get('asistencias', uid);
    if (accion === 'quitar') await del('asistencias', uid); else if (r) await put('asistencias', { ...r, estado: 'justificada', motivo });
    sync();
  }

  async function consultar(curp) {
    curp = String(curp).trim().toUpperCase();
    let alumno = await get('alumnos', curp), origen = 'local';
    if (navigator.onLine && ses() && ses().token) {
      try { const fresco = await api('/api/alumno/' + curp); await put('alumnos', fresco); alumno = fresco; origen = 'nube'; }
      catch (e) { if (e.status === 404) return { alumno: null }; }
    }
    if (!alumno) return { alumno: null, offline: !navigator.onLine };
    const asistencias = (await all('asistencias')).filter(a => a.curp === curp)
      .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
    return { alumno, asistencias, origen };
  }

  /* ---------- Sincronización ---------- */
  let sincronizando = false, otraVez = false;
  async function sync() {
    if (!navigator.onLine) return;
    if (sincronizando) { otraVez = true; return; }
    sincronizando = true;
    try {
      for (const q of (await all('cola')).sort((a, b) => a.qid - b.qid)) {
        try {
          if (q.tipo === 'registro') {
            await api('/api/registro', { method: 'POST', body: { rol: q.rol, datos: q.datos } });
          } else if (q.tipo === 'cierre') {
            await api('/api/cierre', { method: 'POST', body: q.datos });
          } else if (q.tipo === 'asistencia') {
            await api('/api/asistencias', { method: 'POST', body: q.datos });
          }
        } catch (e) {
          if (!e.status || e.status === 401) break;   // sin red o sesión vencida: reintenta luego
          if (e.status !== 409) console.warn('Operación descartada:', e.message);
        }
        await del('cola', q.qid);
        if (q.tipo === 'registro') {
          const u = await get('usuarios', q.rol + ':' + q.id);
          if (u) { u.pendiente = false; await put('usuarios', u); }
          const a = await get('alumnos', q.id);
          if (a) { a.pendiente = false; await put('alumnos', a); }
        } else if (q.tipo === 'asistencia') {
          const a = await get('asistencias', q.uid);
          if (a) { a.pendiente = false; await put('asistencias', a); }
        }
      }
      const s = ses();
      if (s && s.token && s.rol === 'tutor') {         // avisos nuevos -> notificación del teléfono
        const antes = new Set((await all('avisos')).map(x => x.id));
        for (const av of await api('/api/avisos')) {
          await put('avisos', av);
          if (antes.size && !antes.has(av.id)) notificar(av.texto);
        }
      }
      if (s && s.token && s.rol !== 'admin') {         // avisos de la administración
        try {
          const an = await api('/api/anuncios'), antes = JSON.parse(localStorage.getItem('sd_an') || 'null');
          localStorage.setItem('sd_an', JSON.stringify(an.map(x => x.id)));
          if (antes) for (const x of an) if (!antes.includes(x.id)) notificar(x.titulo + ': ' + x.mensaje.slice(0, 80));
        } catch (e) {}
      }
      if (s && s.token) {                              // descarga lo que este rol puede ver
        for (const a of await api('/api/alumnos')) await put('alumnos', a);
        const lista = await api('/api/asistencias'), ids = new Set(lista.map(x => x.uid));
        for (const a of lista) await put('asistencias', { ...a, pendiente: false });
        for (const l of await all('asistencias')) if (!l.pendiente && !ids.has(l.uid)) await del('asistencias', l.uid);   // quitadas en el servidor
      }
    } catch (e) { console.warn('Sync:', e.message); }
    sincronizando = false;
    if (otraVez) { otraVez = false; return sync(); }
    refrescarBadge();
    document.dispatchEvent(new Event('sd-sync'));
  }

  function notificar(texto) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(r => r.showNotification('SHARK DARK', { body: texto, icon: '/icon-192.png', badge: '/icon-192.png' })).catch(() => {});
  }
  const permisoAvisos = () => 'Notification' in window ? Notification.requestPermission() : Promise.resolve('denied');

  /* ---------- Indicador de conexión ---------- */
  let badge;
  async function refrescarBadge() {
    if (!badge) return;
    const n = (await all('cola')).length, on = navigator.onLine;
    badge.textContent = (on ? '● En línea' : '○ Sin conexión') + (n ? ` · ${n} por sincronizar` : '');
    badge.style.borderColor = on ? 'var(--rojo)' : 'var(--cafe)';
  }
  document.addEventListener('DOMContentLoaded', () => {
    badge = document.createElement('div');
    badge.className = 'estado';
    badge.onclick = sync;
    document.body.appendChild(badge);
    refrescarBadge();
    sync();
  });
  addEventListener('online', sync);
  addEventListener('offline', refrescarBadge);
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  /* ---------- Lector de QR ---------- */
  async function scan(video, onText, onError) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; await video.play();
    const det = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    let on = true;
    (async () => {
      while (on) {
        await new Promise(r => setTimeout(r, 250));
        if (video.readyState < 2) continue;
        let txt = null;
        if (det) { const r = await det.detect(video).catch(() => []); if (r[0]) txt = r[0].rawValue; }
        else if (window.jsQR) {
          cv.width = video.videoWidth; cv.height = video.videoHeight; cx.drawImage(video, 0, 0);
          const im = cx.getImageData(0, 0, cv.width, cv.height), c = jsQR(im.data, im.width, im.height);
          if (c) txt = c.data;
        } else { on = false; onError && onError('Este navegador no lee QR. Escribe la CURP o agrega lib/jsQR.js.'); }
        if (txt) onText(txt);
      }
    })();
    return () => { on = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  }

  /* ---------- Generador de QR (v1–3, corrección M, modo byte) ---------- */
  function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)], caps = [0, 16, 28, 44];
    let v = 1; while (v <= 3 && bytes.length > caps[v] - 2) v++;
    if (v > 3) throw new Error('Texto demasiado largo para el QR');
    const dc = caps[v], ec = [0, 10, 16, 26][v], size = 17 + 4 * v;
    const bits = [], push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, 8); bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, dc * 8 - bits.length)); while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0xEC; data.length < dc; p ^= 0xFD) data.push(p);
    const exp = [], log = [];
    for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    const mul = (a, b) => a && b ? exp[(log[a] + log[b]) % 255] : 0;
    let g = [1];
    for (let i = 0; i < ec; i++) { const n = Array(g.length + 1).fill(0); g.forEach((c, j) => { n[j] ^= c; n[j + 1] ^= mul(c, exp[i]); }); g = n; }
    const rem = Array(ec).fill(0);
    for (const b of data) { const f = b ^ rem.shift(); rem.push(0); g.slice(1).forEach((c, i) => rem[i] ^= mul(c, f)); }
    const cw = data.concat(rem);

    const m = Array.from({ length: size }, () => Array(size).fill(false));
    const fn = Array.from({ length: size }, () => Array(size).fill(false));
    const setF = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 == 0); setF(i, 6, i % 2 == 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy)); setF(x, y, d != 2 && d != 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v >= 2) { const c = size - 7; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1); }
    const fmt = mask => {
      let r = mask; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((mask << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) != 0;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(i)); setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, true);
    };
    fmt(0);
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) == 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < cw.length * 8) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) != 0; i++; }
      }
    }
    const mk = [(x, y) => (x + y) % 2 == 0, (x, y) => y % 2 == 0, (x, y) => x % 3 == 0, (x, y) => (x + y) % 3 == 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0, (x, y) => x * y % 2 + x * y % 3 == 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 == 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 == 0];
    const apply = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && mk[k](x, y)) m[y][x] = !m[y][x]; };
    const pen = () => {
      let p = 0;
      for (let t = 0; t < 2; t++) for (let a = 0; a < size; a++) { let run = 1;
        for (let b = 1; b < size; b++) { const c = t ? m[b][a] : m[a][b], q = t ? m[b - 1][a] : m[a][b - 1];
          if (c == q) { run++; if (run == 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c == m[y][x + 1] && c == m[y + 1][x] && c == m[y + 1][x + 1]) p += 3; }
      let dark = 0; m.forEach(r => r.forEach(c => dark += c ? 1 : 0));
      return p + Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    };
    let best = 0, bp = 1e9;
    for (let k = 0; k < 8; k++) { apply(k); fmt(k); const p = pen(); if (p < bp) { bp = p; best = k; } apply(k); }
    apply(best); fmt(best);
    return m;
  }
  function qr(text) {
    const m = qrMatrix(text), n = m.length + 8; let d = '';
    m.forEach((r, y) => r.forEach((c, x) => { if (c) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#FFFFFF"/><path d="${d}"/></svg>`;
  }

  const datos = async () => ({ alumnos: await all('alumnos'), asistencias: await all('asistencias'), avisos: await all('avisos') });
  /* Alumnos vinculados (tutor) o tutores vinculados (alumno); el tutor elige a cuál alumno ver */
  async function vinculos() {
    try { const l = await api('/api/vinculos'); localStorage.setItem('sd_vinc', JSON.stringify(l)); return l; }
    catch (e) { return JSON.parse(localStorage.getItem('sd_vinc') || '[]'); }
  }
  async function alumnoActivo() {
    const l = (await vinculos()).filter(x => x.estado === 'vinculado'), c = localStorage.getItem('sd_alumno');
    return l.find(x => x.curp === c) || l[0] || null;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* Pide al servidor y guarda una copia para usarla sin internet */
  async function cached(key, path) {
    try { const r = await api(path); localStorage.setItem('sdc_' + key, JSON.stringify(r)); return r; }
    catch (e) { return JSON.parse(localStorage.getItem('sdc_' + key) || '[]'); }
  }
  const SD = { login, activarCuenta, activarAlumno, solicitarRecuperacion, cambiarPassword, logout, session: ses, asistencia, consultar, sync, scan, qr, datos, cierre, corregir, permisoAvisos, api, vinculos, alumnoActivo, notificar, cached };
  export default SD;
