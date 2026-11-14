/* SHARK DARK · núcleo offline: IndexedDB + cola de sincronización + QR (generar y leer) */
import { cifrar, descifrar, derivarClave, nuevaSal, validarTicket, offlineDisponible } from './offline.js';
  /* ---------- Base de datos local ---------- */
  const CAMPOS_ID = { usuarios: '_id', alumnos: 'curp', asistencias: 'uid', cola: 'qid', avisos: 'id' };
  const PROTEGIDAS = Object.keys(CAMPOS_ID);
  let llaveDatos = null;
  const dbp = new Promise((ok, fail) => {
    const r = indexedDB.open('sharkdark', 5);
    r.onupgradeneeded = () => {
      const d = r.result;
      const mk = (n, o) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, o); };
      mk('usuarios', { keyPath: '_id' }); mk('alumnos', { keyPath: 'curp' }); mk('asistencias', { keyPath: 'uid' });
      mk('cola', { keyPath: 'qid', autoIncrement: true }); mk('avisos', { keyPath: 'id' });
      mk('credenciales', { keyPath: 'id' }); mk('cache', { keyPath: 'id' });
      if (d.objectStoreNames.contains('deviceKeys')) d.deleteObjectStore('deviceKeys');
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
  const rawPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
  const rawGet = (s, k) => tx(s, 'readonly', st => st.get(k));
  const rawAll = s => tx(s, 'readonly', st => st.getAll());
  const clearStore = s => tx(s, 'readwrite', st => st.clear());
  const put = async (s, v) => {
    if (!PROTEGIDAS.includes(s) || !llaveDatos) return rawPut(s, v);
    if (s === 'usuarios') { v = { ...v }; delete v.token; }
    const envoltura = await cifrar(v, llaveDatos);
    const campo = CAMPOS_ID[s], clave = v[campo];
    const id = await rawPut(s, { [campo]: clave, __sdenc: 1, ...envoltura });
    if (clave == null && id != null) await rawPut(s, { [campo]: id, __sdenc: 1, ...envoltura });
    return id;
  };
  const leerRegistro = async (s, v) => {
    if (!v || !v.__sdenc) return v;
    if (!llaveDatos) throw new Error('La bóveda local está bloqueada. Inicia sesión para consultar sus datos.');
    const dato = await descifrar(v, llaveDatos);
    if (dato[CAMPOS_ID[s]] == null) dato[CAMPOS_ID[s]] = v[CAMPOS_ID[s]];
    return dato;
  };
  const get = async (s, k) => leerRegistro(s, await rawGet(s, k));
  const all = async s => Promise.all((await rawAll(s)).map(v => leerRegistro(s, v)));
  const del = (s, k) => tx(s, 'readwrite', st => st.delete(k));
  const credencial = id => rawGet('credenciales', id);
  const guardarCredencial = c => rawPut('credenciales', c);

  /* ---------- Sesión y API ---------- */
  let sesionMemoria = null;
  const ses = () => sesionMemoria;
  const setSes = u => { sesionMemoria = {
    rol: u.rol, id: u.id, nombre: u.nombre, curp: u.curp, area: u.area, semestre: u.semestre,
    grupo: u.grupo, curpAlumno: u.curpAlumno, debeCambiarPassword: !!u.debeCambiarPassword,
    offline: !!u.offline, offlineExpiresAt: u.offlineExpiresAt || null, token: u.token || null
  }; return sesionMemoria; };
  const limpiarSesion = () => { sesionMemoria = null; };

  async function cacheGuardar(k, valor) {
    if (!llaveDatos) return;
    const e = await cifrar(valor, llaveDatos);
    await rawPut('cache', { id: k, __sdenc: 1, ...e });
  }
  async function cacheLeer(k, alterno = []) {
    const guardado = await rawGet('cache', k);
    if (guardado) {
      try {
        if (guardado.__sdenc) return llaveDatos ? await descifrar(guardado, llaveDatos) : alterno;
        if (llaveDatos) { await cacheGuardar(k, guardado.valor); return guardado.valor; }
        return alterno;
      } catch { return alterno; }
    }
    const texto = localStorage.getItem('sdc_' + k);
    if (!texto) return alterno;
    try {
      const v = JSON.parse(texto);
      if (v?.__sdenc) {
        if (!llaveDatos) return alterno;
        const plano = await descifrar(v, llaveDatos); await cacheGuardar(k, plano); localStorage.removeItem('sdc_' + k); return plano;
      }
      const plano = v;
      if (llaveDatos) { await cacheGuardar(k, plano); localStorage.removeItem('sdc_' + k); }
      return plano;
    } catch { return alterno; }
  }

  async function cifrarExistentes() {
    for (const st of PROTEGIDAS) {
      for (const registro of await rawAll(st)) {
        if (registro.__sdenc) continue;
        const dato = { ...registro };
        if (st === 'usuarios') delete dato.token;
        const enc = await cifrar(dato, llaveDatos);
        await rawPut(st, { [CAMPOS_ID[st]]: dato[CAMPOS_ID[st]], __sdenc: 1, ...enc });
      }
    }
    for (const registro of await rawAll('cache')) if (!registro.__sdenc) {
      await rawPut('cache', { id: registro.id, __sdenc: 1, ...await cifrar(registro.valor, llaveDatos) });
    }
    for (const k of Object.keys(localStorage).filter(x => x.startsWith('sdc_'))) {
      try {
        const v = JSON.parse(localStorage.getItem(k));
        const valor = v?.__sdenc ? await descifrar(v, llaveDatos) : v;
        await cacheGuardar(k.slice(4), valor);
      } catch { localStorage.removeItem(k); }
      localStorage.removeItem(k);
    }
    const vinculosAnteriores = localStorage.getItem('sd_vinc');
    if (vinculosAnteriores) {
      try { await cacheGuardar('vinc', JSON.parse(vinculosAnteriores)); } catch {}
      localStorage.removeItem('sd_vinc');
    }
  }

  async function reencifrarExistentes(nuevaLlave) {
    const anterior = llaveDatos;
    for (const st of PROTEGIDAS) {
      for (const registro of await rawAll(st)) {
        const dato = registro.__sdenc ? await descifrar(registro, anterior) : registro;
        if (st === 'usuarios') delete dato.token;
        const enc = await cifrar(dato, nuevaLlave);
        await rawPut(st, { [CAMPOS_ID[st]]: dato[CAMPOS_ID[st]], __sdenc: 1, ...enc });
      }
    }
    for (const registro of await rawAll('cache')) {
      const dato = registro.__sdenc ? await descifrar(registro, anterior) : registro.valor;
      await rawPut('cache', { id: registro.id, __sdenc: 1, ...await cifrar(dato, nuevaLlave) });
    }
    for (const k of Object.keys(localStorage).filter(x => x.startsWith('sdc_'))) {
      const v = JSON.parse(localStorage.getItem(k));
      const dato = v?.__sdenc ? await descifrar(v, anterior) : v;
      localStorage.setItem(k, JSON.stringify({ __sdenc: 1, ...await cifrar(dato, nuevaLlave) }));
    }
    llaveDatos = nuevaLlave;
  }

  async function api(path, opt = {}) {
    const s = ses(), h = { 'Content-Type': 'application/json' };
    if (s && s.token) h.Authorization = 'Bearer ' + s.token;
    if (s && s.offline) throw new Error('Sesión offline: esta acción necesita validación del servidor.');
    const r = await fetch(path, { method: opt.method || 'GET', headers: h, body: opt.body && JSON.stringify(opt.body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  /* ---------- Inicio de sesión con contraseña ---------- */
  async function login(rol, id, password) {
    id = String(id).trim().toUpperCase();
    if (!navigator.onLine) return loginOffline(rol, id, password);
    let r;
    try { r = await api('/api/login', { method: 'POST', body: { rol: rol || '', id, password } }); }
    catch (e) { if (!e.status) return loginOffline(rol, id, password); throw e; }
    rol = r.usuario.rol;
    const uid = r.usuario.id || id;
    const keyId = `${rol}:${uid}`;
    let claims = null;
    try {
      claims = await validarTicket(r.offlineTicket);
      if (claims.rol !== rol || claims.sub !== uid) throw new Error('El servidor devolvió una credencial offline inconsistente.');
    } catch (e) {
      if (!navigator.onLine) throw e;
      console.warn('Credencial offline no disponible en este build:', e.message);
    }
    const previa = await credencial(keyId);
    const salt = previa?.salt || nuevaSal(), key = await derivarClave(password, salt);
    let claveCorrecta = false;
    if (previa) {
      try { await descifrar(previa, key); claveCorrecta = true; } catch {}
    }
    await cambioDeUsuario(rol, uid);
    const datosCifrados = !previa && (await Promise.all([...PROTEGIDAS, 'cache'].map(st => rawAll(st)))).flat().some(x => x.__sdenc);
    if ((previa && !claveCorrecta) || datosCifrados) {
      for (const st of PROTEGIDAS) await clearStore(st);
      await clearStore('cache');
      Object.keys(localStorage).filter(x => x.startsWith('sdc_')).forEach(x => localStorage.removeItem(x));
    }
    llaveDatos = key;
    await cifrarExistentes();
    if (claims && !r.usuario.debeCambiarPassword) {
      const credCifrada = await cifrar({ ticket: r.offlineTicket }, key);
      await guardarCredencial({ id: keyId, salt, ...credCifrada, fallos: 0, bloqueadaHasta: 0 });
    } else await del('credenciales', keyId);
    const u = { ...r.usuario, _id: keyId, rol, id: uid, token: r.token, offline: false };
    const guardar = { ...u }; delete guardar.token; delete guardar.offline;
    await put('usuarios', guardar);
    setSes(u);
    sync();
    return u;
  }

  async function loginOffline(rol, id, password) {
    const keyId = `${rol}:${id}`;
    const c = await credencial(keyId);
    if (!c) throw new Error(offlineDisponible
      ? 'No hay credencial offline para esta cuenta. Conéctate una vez e inicia sesión para habilitarla.'
      : 'Esta instalación no está configurada para validar credenciales offline. Actualízala conectada a internet.');
    if (c.bloqueadaHasta > Date.now()) throw new Error('Demasiados intentos. Espera 15 minutos o conéctate para validar tu cuenta.');
    let key;
    try {
      key = await derivarClave(password, c.salt);
      const datos = await descifrar(c, key);
      const claims = await validarTicket(datos.ticket);
      if (claims.exp <= Date.now()) throw new Error('La credencial offline venció. Conéctate e inicia sesión para renovarla.');
      if (claims.sub !== id || claims.rol !== rol) throw new Error('La cuenta no coincide con esta credencial.');
      await cambioDeUsuario(rol, id);
      llaveDatos = key;
      c.fallos = 0; c.bloqueadaHasta = 0; await guardarCredencial(c);
      const u = { ...claims.usuario, offline: true, offlineExpiresAt: claims.exp, token: null };
      setSes(u);
      refrescarBadge();
      return u;
    } catch (e) {
      if (/venció|instalación todavía/.test(e.message)) throw e;
      if (/navegador no admite/.test(e.message)) throw e;
      c.fallos = (c.fallos || 0) + 1;
      if (c.fallos >= 5) { c.fallos = 0; c.bloqueadaHasta = Date.now() + 15 * 60e3; }
      await guardarCredencial(c);
      throw new Error(c.bloqueadaHasta ? 'Demasiados intentos. Espera 15 minutos antes de volver a probar.' : 'CURP o contraseña incorrectas.');
    }
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
    const u = ses(), c = u && await credencial(`${u.rol}:${u.id}`);
    if (u && r.offlineTicket && llaveDatos && process.env.OFFLINE_PUBLIC_KEY) {
      try {
        const salt = c?.salt || nuevaSal(), key = await derivarClave(nueva, salt), claims = await validarTicket(r.offlineTicket);
        await reencifrarExistentes(key);
        await guardarCredencial({ id: `${u.rol}:${u.id}`, salt, ...await cifrar({ ticket: r.offlineTicket }, key), fallos: 0, bloqueadaHasta: 0 });
        u.debeCambiarPassword = false; u.nombre = claims.usuario.nombre; setSes(u);
      } catch {
        for (const st of PROTEGIDAS) await clearStore(st);
        await clearStore('cache');
        Object.keys(localStorage).filter(x => x.startsWith('sdc_')).forEach(x => localStorage.removeItem(x));
        await del('credenciales', `${u.rol}:${u.id}`);
        u.debeCambiarPassword = false; setSes(u);
      }
    } else if (u) { u.debeCambiarPassword = false; setSes(u); }
    return r;
  }

  async function cambioDeUsuario(rol, id) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rol + ':' + id));
    const k = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
    const anterior = localStorage.getItem('sd_last');
    if (anterior !== k && anterior !== `${rol}:${id}`) {
      for (const st of PROTEGIDAS) await clearStore(st);
      await clearStore('cache');
      localStorage.setItem('sd_last', k);
      Object.keys(localStorage).filter(x => x.startsWith('sdc_')).forEach(x => localStorage.removeItem(x));
      localStorage.removeItem('sd_vinc');
      sessionStorage.removeItem('sd_alumno');
    } else if (anterior !== k) localStorage.setItem('sd_last', k);
  }
  const logout = () => { limpiarSesion(); llaveDatos = null; location.hash = ''; location.reload(); };

  async function invalidarCuenta(keyId) {
    await del('credenciales', keyId);
    for (const st of PROTEGIDAS) await clearStore(st);
    await clearStore('cache');
    Object.keys(localStorage).filter(x => x.startsWith('sdc_')).forEach(x => localStorage.removeItem(x));
    limpiarSesion(); llaveDatos = null;
  }

  async function validarSesionOnline() {
    const s = ses();
    if (!s?.token) return;
    try {
      const actual = await api('/api/yo'), keyId = `${s.rol}:${s.id}`;
      if (actual.id !== s.id || actual.rol !== s.rol) { await invalidarCuenta(keyId); location.reload(); return; }
      const c = await credencial(keyId);
      if (c && llaveDatos) {
        const local = await descifrar(c, llaveDatos), claims = await validarTicket(local.ticket);
        const pwdAt = actual.passwordActualizada ? new Date(actual.passwordActualizada).getTime() : 0;
        if (claims.sub !== actual.id || claims.rol !== actual.rol || pwdAt > (claims.pwdAt || 0)) {
          await invalidarCuenta(keyId); location.reload(); return;
        }
      }
      await sync();
    } catch (e) {
      if (e.status === 404) await invalidarCuenta(`${s.rol}:${s.id}`);
      else if (e.status === 401) { limpiarSesion(); llaveDatos = null; }
      else { errorSync = 'No se pudo validar la sesión con el servidor; los pendientes no se enviaron.'; refrescarBadge(); return; }
      location.reload();
    }
  }

  async function init() {
    // La bóveda solo se desbloquea después de volver a introducir la contraseña.
    limpiarSesion();
    localStorage.removeItem('sd_ses');
    sessionStorage.removeItem('sd_ses');
    llaveDatos = null;
    return null;
  }

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
  let sincronizando = false, otraVez = false, errorSync = '', infoSync = '';
  async function sync() {
    const sesionActual = ses();
    if (!navigator.onLine || !sesionActual?.token || sesionActual.offline) { refrescarBadge(); return; }
    if (sincronizando) { otraVez = true; return; }
    sincronizando = true;
    errorSync = '';
    infoSync = '';
    refrescarBadge();
    try {
      const pendientes = (await all('cola')).sort((a, b) => a.qid - b.qid);
      if (pendientes.some(q => q.estado === 'conflicto')) errorSync = 'Hay cambios que requieren revisión y no se enviaron.';
      for (const q of pendientes.filter(x => x.estado !== 'conflicto')) {
        try {
          if (q.tipo === 'registro') {
            await api('/api/registro', { method: 'POST', body: { rol: q.rol, datos: q.datos } });
          } else if (q.tipo === 'cierre') {
            await api('/api/cierre', { method: 'POST', body: q.datos });
          } else if (q.tipo === 'asistencia') {
            await api('/api/asistencias', { method: 'POST', body: q.datos });
          }
        } catch (e) {
          if (!e.status) errorSync = 'Sin conexión estable; los pendientes siguen guardados.';
          else if (e.status === 401 || e.status === 403) errorSync = 'El servidor requiere validar nuevamente la cuenta o sus permisos.';
          else {
            q.estado = 'conflicto'; q.error = e.message.slice(0, 180); await put('cola', q);
            errorSync = 'Un pendiente necesita revisión; no se eliminó ni se marcó como guardado.';
          }
          break;
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
        for (const [k, path] of [
          ['clases', '/api/clases'], ['horario', '/api/horarios'], ['calif', '/api/calificaciones'],
          ['permisos', '/api/permisos'], ['reportes_conducta', '/api/reportes-conducta'], ['anuncios', '/api/anuncios']
        ]) { try { await cacheGuardar(k, await api(path)); } catch (e) { if (e.status === 401 || e.status === 403) throw e; } }
        if (s.rol === 'docente' || s.rol === 'admin') {
          try { await cacheGuardar('reportes_alumnos', await api('/api/reportes-conducta/alumnos')); } catch (e) { if (e.status === 401 || e.status === 403) throw e; }
        }
        if (s.rol === 'admin') {
          for (const [k, path] of [
            ['admin_alumnos', '/api/alumnos'], ['admin_asistencias', '/api/asistencias'], ['admin_calificaciones', '/api/calificaciones'],
            ['admin_usuarios', '/api/admin/usuarios'], ['admin_grupos', '/api/grupos'], ['admin_clases', '/api/clases'], ['admin_clases_reportes', '/api/clases'],
            ['admin_horarios', '/api/horarios'], ['admin_historial', '/api/admin/historial'],
            ['admin_recuperaciones', '/api/admin/recuperaciones'], ['admin_permisos', '/api/permisos'], ['admin_anuncios', '/api/anuncios']
          ]) { try { await cacheGuardar(k, await api(path)); } catch (e) { if (e.status === 401 || e.status === 403) throw e; } }
        }
      }
    } catch (e) { errorSync = 'No se pudo completar la sincronización. Los datos pendientes se conservaron.'; console.warn('Sync:', e.message); }
    sincronizando = false;
    if (otraVez) { otraVez = false; return sync(); }
    if (!errorSync) {
      infoSync = 'Sincronización completada';
      setTimeout(() => { infoSync = ''; refrescarBadge(); }, 7000);
    }
    refrescarBadge();
    document.dispatchEvent(new Event('sd-sync'));
  }

  function notificar(texto) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const icono = document.documentElement.dataset.tema === 'oscuro' ? '/icon-192.png' : '/icon-192-claro.png';
    navigator.serviceWorker.ready.then(r => r.showNotification('SHARK DARK', { body: texto, icon: icono, badge: icono })).catch(() => {});
  }
  const permisoAvisos = () => 'Notification' in window ? Notification.requestPermission() : Promise.resolve('denied');

  /* ---------- Indicador de conexión ---------- */
  let badge;
  async function refrescarBadge() {
    if (!badge) return;
    const on = navigator.onLine, s = ses();
    let n = 0; try { n = (await all('cola')).length; } catch {}
    if (s && (!on || s.offline)) badge.textContent = (on ? '● Conexión recuperada · validando sesión' : '○ Sin conexión · sesión offline') + (n ? ` · ${n} pendientes` : '');
    else if (sincronizando) badge.textContent = '● Sincronizando…';
    else if (errorSync) badge.textContent = (on ? '● En línea' : '○ Sin conexión') + (n ? ` · ${n} pendientes` : ' · sincronización pendiente');
    else if (infoSync) badge.textContent = '● ' + infoSync + (n ? ` · ${n} pendientes` : '');
    else badge.textContent = (on ? '● En línea' : '○ Sin conexión') + (n ? ` · ${n} por sincronizar` : '');
    badge.title = s && (!on || s.offline) ? 'Los datos locales pueden estar desactualizados. Al volver internet se valida la cuenta antes de sincronizar.' : errorSync;
    badge.style.cursor = 'default';
    badge.style.borderColor = on ? 'var(--rojo)' : 'var(--cafe)';
  }
  document.addEventListener('DOMContentLoaded', () => {
    badge = document.createElement('div');
    badge.className = 'estado';
    badge.onclick = () => {
      const s = ses();
      if (s?.offline && navigator.onLine) { limpiarSesion(); location.reload(); return; }
      sync();
    };
    document.body.appendChild(badge);
    refrescarBadge();
    sync();
  });
  addEventListener('online', () => {
    if (ses()?.offline) { limpiarSesion(); llaveDatos = null; location.reload(); return; }
    validarSesionOnline();
  });
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
    try { const l = await api('/api/vinculos'); await cacheGuardar('vinc', l); return l; }
    catch (e) { return cacheLeer('vinc', []); }
  }
  async function alumnoActivo() {
    const l = (await vinculos()).filter(x => x.estado === 'vinculado'), c = sessionStorage.getItem('sd_alumno');
    return l.find(x => x.curp === c) || l[0] || null;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* Pide al servidor y guarda una copia para usarla sin internet */
  async function cached(key, path) {
    try { const r = await api(path); await cacheGuardar(key, r); return r; }
    catch (e) { return cacheLeer(key, []); }
  }
  const SD = { init, login, activarCuenta, activarAlumno, solicitarRecuperacion, cambiarPassword, logout, session: ses, asistencia, consultar, sync, scan, qr, datos, cierre, corregir, permisoAvisos, api, vinculos, alumnoActivo, notificar, cached, offlineHabilitado: offlineDisponible };
  export default SD;
