const dns = require('node:dns');
if (!process.env.RENDER) dns.setServers(['8.8.8.8', '1.1.1.1']);   // solo en tu computadora
dns.setDefaultResultOrder('ipv4first');                            // evita fallos TLS por IPv6

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');
const { crearTicketOffline } = require('./offline-auth');
const webpush = require('web-push');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECRET = process.env.TOKEN_SECRET;

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); }
}));

/* ---------- Utilidades ---------- */
const s = v => String(v ?? '').trim();
const RX = { curp: /^[A-Z0-9]{18}$/, rfc: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/ };
const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });
const limpiaMat = v => s(v).replace(/\s+/g, ' ').slice(0, 60);
/* Límite de intentos de login: 8 fallos por cuenta cada 15 minutos */
const fallos = new Map();
const bloqueado = (k, max = 8) => { const f = fallos.get(k); return f && f.c >= max && Date.now() - f.t < 15 * 60e3; };
const fallo = k => { const f = fallos.get(k); fallos.set(k, f && Date.now() - f.t < 15 * 60e3 ? { c: f.c + 1, t: f.t } : { c: 1, t: Date.now() }); };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
    ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const okPw = (pw, u) => {
    const a = Buffer.from(crypto.scryptSync(pw, u.salt, 64).toString('hex')), b = Buffer.from(u.hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const firmar = p => {
    const d = Buffer.from(JSON.stringify(p)).toString('base64url');
    return d + '.' + crypto.createHmac('sha256', SECRET).update(d).digest('base64url');
};
const firmarOffline = async usuario => {
    const cuenta = await usuarios.findOne({ _id: `${usuario.rol}:${usuario.id}` });
    const pwdAt = cuenta?.passwordActualizada ? new Date(cuenta.passwordActualizada).getTime() : 0;
    return crearTicketOffline(SECRET, usuario, pwdAt);
};
const leer = t => {
    try {
        const [d, f] = t.split('.');
        const ok = crypto.createHmac('sha256', SECRET).update(d).digest('base64url');
        if (f.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(ok))) return null;
        const p = JSON.parse(Buffer.from(d, 'base64url'));
        return p.exp > Date.now() ? p : null;
    } catch { return null; }
};
const auth = async (req, res, next) => {
    const p = leer((req.headers.authorization || '').replace('Bearer ', ''));
    if (!p) return bad(res, 'Sesion expirada', 401);
    try {
        const campoSesion = p.rol === 'admin' ? `sessionId_${p.adminArea}` : 'sessionId';
        const cuenta = await usuarios.findOne({ _id: `${p.rol}:${p.id}` }, { projection: { [campoSesion]: 1 } });
        if (!cuenta || !p.sid || cuenta[campoSesion] !== p.sid) return bad(res, 'Esta cuenta inicio sesion en otro dispositivo. Vuelve a entrar para continuar.', 401);
        req.u = p; next();
    } catch (e) { next(e); }
};
const adminDe = (...areas) => (req, res, next) => req.u.rol === 'admin' && areas.includes(req.u.adminArea) ? next() : bad(res, 'No tienes permiso para esta seccion', 403);
const soloAdmin = adminDe('control');
const publico = ({ salt, hash, _id, accessEnvHash, sessionId, sessionId_control, sessionId_sara, sessionId_gabriela, sessionId_portero, ...r }) => r;

let usuarios, asistencias, avisos, calificaciones, grupos, clases, permisos, anuncios, horarios, solicitudesRecuperacion, auditoria, avisosLeidos, reportesConducta, citatorios, suscripcionesPush;
let recordatoriosPush, accesos, diasEscolares;
const PUSH_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PUSH_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const PUSH_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@sharkdark.app';
if (PUSH_PUBLIC && PUSH_PRIVATE) webpush.setVapidDetails(PUSH_SUBJECT, PUSH_PUBLIC, PUSH_PRIVATE);
async function enviarPush(rol, id, titulo, body, url = '/') {
    if (!suscripcionesPush || !PUSH_PUBLIC || !PUSH_PRIVATE) return;
    const regs = await suscripcionesPush.find({ rol, usuarioId: id }).toArray();
    const payload = JSON.stringify({ title: titulo, body, url });
    await Promise.all(regs.map(async r => {
        try { await webpush.sendNotification(r.subscription, payload); }
        catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) await suscripcionesPush.deleteOne({ _id: r._id });
            else console.warn('No se pudo entregar push:', e.statusCode || e.message);
        }
    }));
}
async function notificarAlumno(curp, id, titulo, texto, url, incluirTutores = true, incluirAlumno = true) {
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const destinatarios = incluirAlumno ? [{ rol: 'alumno', id: curp }] : [];
    if (incluirTutores) {
        try {
            const alumno = await usuarios.findOne({ _id: `alumno:${curp}`, rol: 'alumno' });
            if (alumno) {
                const tutores = [
                    ...await usuarios.find({ rol: 'tutor', hijos: curp }).toArray(),
                    ...await usuarios.find({ rol: 'tutor', curpAlumno: curp }).toArray()
                ].filter((t, i, todos) => todos.findIndex(x => x.id === t.id) === i && vinculoOk(t, alumno));
                for (const tutor of tutores) destinatarios.push({ rol: 'tutor', id: tutor.id });
            }
        } catch (e) { console.warn('No se pudieron buscar tutores vinculados para el aviso:', e.message); }
    }
    for (const d of destinatarios) {
        const avisoId = d.rol === 'alumno' ? id : `${id}:tutor:${d.id}`;
        try { await avisos.updateOne({ _id: avisoId }, { $setOnInsert: { origenId: id, para: d.id, curp, tipo: 'escolar', texto, fecha, creado: new Date() } }, { upsert: true }); }
        catch (e) { console.warn('No se pudo guardar el aviso escolar:', e.message); }
        try {
            const destino = d.rol === 'tutor' && url.endsWith('#/citatorios') ? '/#/avisos' : url;
            await enviarPush(d.rol, d.id, `TIBURONES · ${titulo}`, texto, destino);
        } catch (e) { console.warn('No se pudo enviar push escolar:', e.message); }
    }
}
async function revisarRecordatoriosClase() {
    if (!recordatoriosPush || !PUSH_PUBLIC || !PUSH_PRIVATE) return;
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dia = dias[partes.weekday], ahora = Number(partes.hour) * 60 + Number(partes.minute);
    if (!dia) return;
    const fecha = `${partes.year}-${partes.month}-${partes.day}`;
    const bloques = await horarios.find({ dia, tipo: 'clase' }).toArray();
    for (const b of bloques) {
        const [h, m] = b.fin.split(':').map(Number), faltan = h * 60 + m - ahora;
        if (faltan !== 5) continue;
        const evento = `${fecha}:${b._id}`;
        try { await recordatoriosPush.insertOne({ _id: evento, creado: new Date() }); }
        catch (e) { if (e.code === 11000) continue; throw e; }
        const alumnos = await usuarios.find({ rol: 'alumno', area: b.area, semestre: b.semestre, grupo: b.grupo }).toArray();
        const siguiente = await horarios.find({ dia, area: b.area, semestre: b.semestre, grupo: b.grupo, inicio: { $gte: b.fin }, tipo: 'clase' }).sort({ inicio: 1 }).limit(1).next();
        const texto = `Tu clase de ${b.materia} termina en 5 minutos.` + (siguiente ? ` Sigue ${siguiente.materia} a las ${siguiente.inicio}.` : ' Es la última clase del día.');
        await Promise.all(alumnos.map(a => enviarPush('alumno', a.id, 'TIBURONES · Próxima clase', texto, '/')));
    }
}
const intentosRecuperacion = new Map();
const validaPassword = pw => typeof pw === 'string' && pw.length >= 4 && pw.length <= 128;
const generaTemporal = () => crypto.randomBytes(9).toString('base64url');
const registrarCambio = (req, accion, detalle) => auditoria.insertOne({
    accion, detalle, actor: req.u.id, actorNombre: req.u.nombre || 'Servicios Escolares', creado: new Date()
});

/* CURPs que cada rol puede ver: docente = todas, alumno = la suya, tutor = la de su alumno */
async function permitidas(u) {
    if (u.rol === 'docente' || u.rol === 'admin') return null;
    if (u.rol === 'alumno') return [u.id];
    const t = await usuarios.findOne({ _id: 'tutor:' + u.id });
    return t ? (await ligados(t)).map(a => a.curp) : [];
}

/* Un tutor y un alumno quedan vinculados cuando AMBOS se agregaron por CURP (o el administrador los unió) */
const hijosDe = t => [...new Set([...(t.hijos || []), ...(t.curpAlumno ? [t.curpAlumno] : [])])];
const vinculoOk = (t, al) => hijosDe(t).includes(al.curp) && ((al.tutores || []).includes(t.curp) || t.curpAlumno === al.curp);
async function ligados(t) {
    const l = [];
    for (const c of hijosDe(t)) { const al = await usuarios.findOne({ _id: 'alumno:' + c }); if (al && vinculoOk(t, al)) l.push(al); }
    return l;
}

/* Crea un aviso para cada tutor vinculado al alumno (idempotente) */
const bloqueDe = async (cl, fecha) => {
    const dia = new Date(fecha + 'T12:00:00').getDay();
    const b = (await horarios.find({ claseId: cl._id }).toArray()).find(x => x.dia === dia);
    return b ? { inicio: b.inicio, fin: b.fin } : { inicio: '', fin: '' };
};
const miClase = async (doc, area, semestre, grupo, materia) => (await clases.find({ docente: doc }).toArray())
    .find(c => c.area === area && c.semestre === semestre && c.grupo === grupo && c.materia.toLowerCase() === String(materia).toLowerCase());

async function avisar(alumno, tipo, hora, fecha, clave, materia, extra) {
    const cand = [...await usuarios.find({ rol: 'tutor', hijos: alumno.curp }).toArray(), ...await usuarios.find({ rol: 'tutor', curpAlumno: alumno.curp }).toArray()];
    const tutores = cand.filter((x, i) => cand.findIndex(y => y.id === x.id) === i && vinculoOk(x, alumno));
    for (const tu of tutores) {
        const texto = extra || (tipo === 'falta' ? `${alumno.nombre} faltó a ${materia}` : `${alumno.nombre} asistió a ${materia} (${hora})`);
        try { await avisos.insertOne({ _id: `${tipo}:${clave}:${tu.id}`, para: tu.id, curp: alumno.curp, tipo, materia, texto, fecha, hora, creado: new Date() }); await enviarPush('tutor', tu.id, 'TIBURONES · Aviso escolar', texto, '/'); }
        catch (e) { if (e.code !== 11000) throw e; }
    }
}

/* ---------- Registro y login con CURP + contraseña ---------- */
const ADMIN_CURP = (process.env.ADMIN_CURP || '').toUpperCase();
const ADMIN_ID = ADMIN_CURP || 'CONTROL_ESCOLAR';
const ADMIN_ACCESS_PASSWORDS = {
    control: process.env.ADMIN_ACCESS_PASSWORD || '',
    sara: process.env.ADMIN_ACCESS_PASSWORD_SARA || '',
    gabriela: process.env.ADMIN_ACCESS_PASSWORD_GABRIELA || '',
    portero: process.env.ADMIN_ACCESS_PASSWORD_PORTERO || ''
};
app.post('/api/cuenta/identificar', h(async (req, res) => {
    const curp = s(req.body.curp).toUpperCase(), llave = 'ip:' + req.ip;
    if (bloqueado(llave, 40)) return bad(res, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.', 429);
    if (!RX.curp.test(curp)) { fallo(llave); return bad(res, 'Escribe una CURP válida de 18 caracteres.', 400); }
    const cuentas = await Promise.all(['alumno', 'docente', 'tutor'].map(rol => usuarios.findOne({ _id: `${rol}:${curp}`, rol }, { projection: { hash: 1, debeCambiarPassword: 1 } }).then(cuenta => cuenta && ({ rol, cuenta }))));
    const encontradas = cuentas.filter(Boolean);
    if (encontradas.length !== 1) {
        fallo(llave);
        return bad(res, encontradas.length ? 'La CURP está asociada a más de un tipo de cuenta. Contacta a Servicios Escolares.' : 'No encontramos una cuenta con esa CURP. Revisa el dato con Servicios Escolares.', 404);
    }
    fallos.delete(llave);
    const { rol, cuenta } = encontradas[0];
    res.json({ rol, tienePassword: !!cuenta.hash && !cuenta.debeCambiarPassword });
}));
app.post('/api/login', h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), rol = s(req.body.rol), password = String(req.body.password || '');
    const llave = 'ip:' + req.ip;
    if (bloqueado(llave, 40)) return bad(res, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo', 429);
    if (rol === 'admin') {
        const adminArea = s(req.body.adminArea).toLowerCase();
        const acceso = ADMIN_ACCESS_PASSWORDS[adminArea];
        if (typeof acceso !== 'string' || acceso.length < 4) return bad(res, 'La password de este perfil no esta configurada en Render.', 503);
        const esperado = Buffer.from(acceso), recibido = Buffer.from(password);
        const admin = await usuarios.findOne({ _id: 'admin:' + ADMIN_ID, rol: 'admin' });
        if (!admin || esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) {
            fallo(llave);
            return bad(res, 'Password incorrecto', 401);
        }
        fallos.delete(llave);
        const sid = crypto.randomBytes(24).toString('base64url');
        await usuarios.updateOne({ _id: admin._id }, { $set: { [`sessionId_${adminArea}`]: sid } });
        const datos = publico(admin);
        const usuario = { ...datos, id: ADMIN_ID, curp: ADMIN_CURP, rol: 'admin', adminArea, debeCambiarPassword: false };
        return res.json({ token: firmar({ id: ADMIN_ID, rol: 'admin', adminArea, sid, nombre: admin.nombre, exp: Date.now() + 12 * 3600e3 }), usuario, offlineTicket: await firmarOffline(usuario) });
    }
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Elige cómo quieres entrar');
    if (!RX.curp.test(id)) return bad(res, 'Escribe una CURP v\u00e1lida');
    const u = await usuarios.findOne({ _id: `${rol}:${id}`, rol });
    if (!u) { fallo(llave); return bad(res, 'No encontramos esa cuenta. Revisa la CURP con Servicios Escolares.', 401); }
    if (u.hash && (!password || !okPw(password, u))) { fallo(llave); return bad(res, 'CURP o contraseña incorrectas', 401); }
    fallos.delete(llave);
    const sid = crypto.randomBytes(24).toString('base64url');
    await usuarios.updateOne({ _id: u._id }, { $set: { sessionId: sid } });
    const rolReal = u.rol === 'admin' ? 'admin' : rol;
    const datos = publico(u);
    const usuario = { ...datos, rol: rolReal, debeCambiarPassword: !!u.debeCambiarPassword };
    res.json({ token: firmar({ id: u.id, rol: rolReal, sid, exp: Date.now() + 12 * 3600e3 }), usuario, offlineTicket: u.hash ? await firmarOffline(usuario) : null });
}));

app.get('/api/push/clave-publica', (req, res) => res.json({ clave: PUSH_PUBLIC || null }));
app.post('/api/push/suscripcion', auth, h(async (req, res) => {
    if (!PUSH_PUBLIC || !PUSH_PRIVATE) return bad(res, 'Las notificaciones push aún no están configuradas en el servidor.', 503);
    const sub = req.body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return bad(res, 'Suscripción push inválida.');
    await suscripcionesPush.updateOne(
        { endpoint: sub.endpoint },
        { $set: { endpoint: sub.endpoint, subscription: sub, usuarioId: req.u.id, rol: req.u.rol, actualizado: new Date() } },
        { upsert: true }
    );
    res.json({ ok: true });
}));
app.delete('/api/push/suscripcion', auth, h(async (req, res) => {
    const endpoint = s(req.body.endpoint);
    if (endpoint) await suscripcionesPush.deleteOne({ endpoint, usuarioId: req.u.id, rol: req.u.rol });
    res.json({ ok: true });
}));

/* Alumnos, tutores y docentes activan cuentas previamente dadas de alta. */
const activarCuenta = h(async (req, res) => {
    const rol = s(req.body.rol);
    const curp = s(req.body.curp).toUpperCase();
    const password = String(req.body.password || ''), confirmar = String(req.body.confirmar || '');
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(curp)) return bad(res, 'Escribe una CURP válida de 18 caracteres');
    if (!validaPassword(password)) return bad(res, 'Usa una contrase\u00f1a de 4 a 128 caracteres');
    if (password !== confirmar) return bad(res, 'Las contraseñas no coinciden');
    const llave = 'activar:' + req.ip;
    if (bloqueado(llave, 8)) return bad(res, 'Demasiados intentos. Espera 15 minutos.', 429);
    const cuenta = await usuarios.findOne({ _id: `${rol}:${curp}`, rol });
    if (!cuenta || !cuenta.debeCambiarPassword) {
        fallo(llave); return bad(res, 'No se pudo validar la cuenta. Revisa tu CURP o solicita ayuda a Servicios Escolares.', 401);
    }
    const hp = hashPw(password);
    await usuarios.updateOne({ _id: cuenta._id, debeCambiarPassword: true }, { $set: { ...hp, debeCambiarPassword: false, passwordActualizada: new Date(), activadaPorUsuario: true } });
    fallos.delete(llave);
    res.json({ ok: true, mensaje: 'Contraseña creada. Ya puedes iniciar sesión desde cualquier dispositivo con tu CURP.' });
});
app.post('/api/cuenta/activar', activarCuenta);
app.post('/api/alumno/activar', (req, res, next) => {
    req.body = { ...req.body, rol: 'alumno' };
    activarCuenta(req, res, next);
});

/* Solicitud pública: respuesta genérica para no revelar si una CURP está registrada. */
app.post('/api/recuperacion', h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), rol = s(req.body.rol), llave = 'rec:' + req.ip;
    if (!RX.curp.test(id) || !['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Revisa el tipo de cuenta y la CURP');
    const ahora = Date.now(), previo = intentosRecuperacion.get(llave);
    if (previo && ahora - previo < 60 * 60e3) return bad(res, 'Ya se envió una solicitud recientemente. Inténtalo más tarde.', 429);
    intentosRecuperacion.set(llave, ahora);
    const cuenta = await usuarios.findOne({ _id: `${rol}:${id}` });
    if (cuenta) {
        const pendiente = await solicitudesRecuperacion.findOne({ curp: id, rol, estado: 'pendiente' });
        if (!pendiente) {
            await solicitudesRecuperacion.insertOne({ curp: id, rol, nombre: cuenta.nombre, estado: 'pendiente', creado: new Date(), ipHash: crypto.createHash('sha256').update(req.ip || '').digest('hex') });
            await enviarPush('admin', ADMIN_ID, 'Solicitud para restablecer contraseña', `${rol}: ${cuenta.nombre} · ${id}`, '/control-escolar#/cuentas');
        }
    }
    res.json({ ok: true, mensaje: 'Si los datos corresponden a una cuenta, la solicitud fue enviada a Servicios Escolares.' });
}));

app.post('/api/cambiar-password', auth, h(async (req, res) => {
    const actual = String(req.body.actual || ''), nueva = String(req.body.nueva || '');
    if (!validaPassword(nueva)) return bad(res, 'La contrase\u00f1a debe tener entre 4 y 128 caracteres');
    const rol = req.u.rol === 'admin' ? 'admin' : req.u.rol;
    const u = await usuarios.findOne({ _id: `${rol}:${req.u.id}` });
    if (!u || (u.hash ? !okPw(actual, u) : !u.debeCambiarPassword)) return bad(res, 'La contraseña actual no es correcta', 401);
    const hp = hashPw(nueva);
    await usuarios.updateOne({ _id: u._id }, { $set: { ...hp, debeCambiarPassword: false, passwordActualizada: new Date() } });
    const usuario = { ...publico(u), id: req.u.id, rol, debeCambiarPassword: false };
    res.json({ ok: true, offlineTicket: await firmarOffline(usuario) });
}));

app.get('/api/yo', auth, h(async (req, res) => {
    const u = await usuarios.findOne({ _id: `${req.u.rol}:${req.u.id}` });
    u ? res.json(publico(u)) : bad(res, 'No encontrado', 404);
}));

/* ---------- Alumnos ---------- */
app.get('/api/alumnos', auth, h(async (req, res) => {
    const c = await permitidas(req.u), q = { rol: 'alumno' };
    if (c) q.curp = { $in: c };
    const lista = await usuarios.find(q).limit(5000).toArray();
    res.json(lista.map(publico));
}));

app.get('/api/alumno/:curp', auth, h(async (req, res) => {
    const curp = s(req.params.curp).toUpperCase(), c = await permitidas(req.u);
    if (c && !c.includes(curp)) return bad(res, 'Sin permiso', 403);
    const a = await usuarios.findOne({ _id: 'alumno:' + curp });
    if (!a) return bad(res, 'Alumno no encontrado', 404);
    res.json(publico(a));
}));

/* ---------- Reportes de conducta ---------- */
app.get('/api/reportes-conducta/alumnos', auth, h(async (req, res) => {
    let lista;
    if (req.u.rol === 'admin') {
        lista = await usuarios.find({ rol: 'alumno' }).project({ curp: 1, nombre: 1, area: 1, semestre: 1, grupo: 1 }).limit(5000).toArray();
    } else if (req.u.rol === 'docente') {
        const clasesDocente = await clases.find({ docente: req.u.id }).project({ area: 1, semestre: 1, grupo: 1 }).toArray();
        const filtros = clasesDocente.map(c => ({ area: c.area, semestre: c.semestre, grupo: c.grupo }));
        lista = filtros.length
            ? await usuarios.find({ rol: 'alumno', $or: filtros }).project({ curp: 1, nombre: 1, area: 1, semestre: 1, grupo: 1 }).limit(5000).toArray()
            : [];
    } else return bad(res, 'Solo docentes y administración pueden crear reportes', 403);
    res.json(lista.map(({ _id, ...a }) => a));
}));
app.post('/api/reportes-conducta', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente' && !(req.u.rol === 'admin' && ['sara', 'control'].includes(req.u.adminArea))) return bad(res, 'No tienes permiso para crear reportes', 403);
    const curp = s(req.body.curp).toUpperCase();
    const lugar = s(req.body.lugar).replace(/\s+/g, ' ').slice(0, 120);
    const descripcion = s(req.body.descripcion).slice(0, 1500);
    const seguimiento = s(req.body.seguimiento).slice(0, 500);
    if (!RX.curp.test(curp) || !lugar || !descripcion) return bad(res, 'Elige al alumno e indica el lugar y lo ocurrido');
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    if (req.u.rol === 'docente' && !await clases.findOne({ docente: req.u.id, area: alumno.area, semestre: alumno.semestre, grupo: alumno.grupo }))
        return bad(res, 'Solo puedes reportar alumnos de tus grupos', 403);
    const reportante = await usuarios.findOne({ _id: `${req.u.rol}:${req.u.id}` }, { projection: { nombre: 1 } });
    const id = crypto.randomBytes(12).toString('hex');
    const confirmado = req.u.rol === 'admin';
    const reporte = {
        _id: id, curp, alumno: alumno.nombre, area: alumno.area, semestre: alumno.semestre, grupo: alumno.grupo,
        lugar, descripcion, seguimiento, reportante: reportante?.nombre || req.u.nombre || 'Usuario', reportanteId: req.u.id,
        estado: confirmado ? 'confirmado' : 'pendiente', creado: new Date(),
        ...(confirmado ? { confirmadoPor: req.u.id, confirmadoNombre: req.u.nombre || 'Servicios Escolares', confirmadoEn: new Date() } : {})
    };
    await reportesConducta.insertOne(reporte);
    if (confirmado) {
        await registrarCambio(req, 'Reporte de conducta confirmado', `${alumno.nombre} · ${lugar}`);
    }
    await notificarAlumno(alumno.curp, `reporte:${id}`, 'Reporte de conducta', confirmado
        ? 'Se registró un nuevo reporte escolar. Consulta la sección Reportes.'
        : 'Se registró una solicitud de reporte escolar, pendiente de confirmación. Consulta la sección Reportes.', '/#/reportes');
    res.status(201).json({ ok: true, id, estado: reporte.estado });
}));
app.get('/api/reportes-conducta', auth, h(async (req, res) => {
    let filtro;
    if (req.u.rol === 'admin') filtro = {};
    else if (req.u.rol === 'docente') filtro = { reportanteId: req.u.id };
    else if (req.u.rol === 'alumno') filtro = { curp: req.u.id, estado: { $ne: 'anulado' } };
    else if (req.u.rol === 'tutor') filtro = { curp: { $in: await permitidas(req.u) }, estado: { $ne: 'anulado' } };
    else return bad(res, 'No tienes permiso para ver reportes', 403);
    const lista = await reportesConducta.find(filtro).sort({ creado: -1 }).limit(500).toArray();
    res.json(lista.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/reportes-conducta/:id/aceptar', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const id = s(req.params.id);
    const reporte = await reportesConducta.findOne({ _id: id, estado: 'pendiente' });
    if (!reporte) return bad(res, 'La solicitud ya fue atendida o no existe', 404);
    const confirmadoEn = new Date();
    const actualizacion = await reportesConducta.updateOne(
        { _id: id, estado: 'pendiente' },
        { $set: { estado: 'confirmado', confirmadoPor: req.u.id, confirmadoNombre: req.u.nombre || 'Servicios Escolares', confirmadoEn } }
    );
    if (!actualizacion.modifiedCount) return bad(res, 'La solicitud ya fue atendida', 409);
    await registrarCambio(req, 'Reporte de conducta confirmado', `${reporte.alumno} · ${reporte.lugar}`);
    await notificarAlumno(reporte.curp, `reporte-confirmado:${id}`, 'Reporte confirmado', 'Servicios Escolares confirmó la recepción de tu reporte. Consulta la sección Reportes.', '/#/reportes');
    res.json({ ok: true });
}));
app.delete('/api/reportes-conducta/:id', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const id = s(req.params.id);
    const reporte = await reportesConducta.findOneAndDelete({ _id: id });
    if (!reporte) return bad(res, 'El reporte no existe', 404);
    const origenesAvisos = [`reporte:${id}`, `reporte-confirmado:${id}`];
    await avisos.deleteMany({ $or: [{ origenId: { $in: origenesAvisos } }, { _id: { $in: origenesAvisos } }] });
    await registrarCambio(req, 'Reporte de conducta eliminado', `${reporte.alumno} · ${reporte.lugar}`);
    res.json({ ok: true });
}));

/* ---------- Asistencias (idempotentes por uid) ---------- */
app.post('/api/asistencias', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const a = req.body || {}, curp = s(a.curp).toUpperCase();
    if (!RX.curp.test(curp) || !/^[\w-]{8,64}$/.test(s(a.uid)) || !/^\d{4}-\d{2}-\d{2}$/.test(s(a.fecha)) || !/^\d{2}:\d{2}$/.test(s(a.hora)) || !limpiaMat(a.materia))
        return bad(res, 'Datos de asistencia inválidos');
    const materia = limpiaMat(a.materia), key = materia.toLowerCase();
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    const cl = await miClase(req.u.id, alumno.area, alumno.semestre, alumno.grupo, materia);
    if (!cl) return bad(res, 'Esa materia no es tuya o el alumno no es de ese grupo', 403);
    const bl = await bloqueDe(cl, s(a.fecha));
    try {
        await asistencias.insertOne({ _id: s(a.uid), curp, fecha: a.fecha, hora: a.hora, estado: 'asistio', materia, materiaKey: key, horaInicio: bl.inicio, horaFin: bl.fin, docente: req.u.id, docenteNombre: s(a.docenteNombre) });
    } catch (e) { if (e.code === 11000) return bad(res, 'Ya registrada', 409); throw e; }
    await asistencias.deleteOne({ _id: `F:${curp}:${a.fecha}:${key}` });   // si estaba marcada falta, ya no
    await avisar(alumno, 'asistio', a.hora, a.fecha, s(a.uid), materia);
    res.status(201).json({ ok: true });
}));

/* Cierre de lista: quien no tenga asistencia ese día en ese grupo queda con falta y se avisa al tutor */
app.post('/api/cierre', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const { area, semestre, grupo, fecha, hora } = req.body || {};
    const materia = limpiaMat((req.body || {}).materia), key = materia.toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s(fecha)) || !/^\d{2}:\d{2}$/.test(s(hora)) || !area || !semestre || !grupo || !materia) return bad(res, 'Datos inválidos');
    const cl = await miClase(req.u.id, s(area), s(semestre), s(grupo), materia);
    if (!cl) return bad(res, 'Esa clase no es tuya', 403);
    const bl = await bloqueDe(cl, s(fecha)), hr = bl.inicio ? ` (${bl.inicio} a ${bl.fin})` : '';
    const aprobados = await permisos.find({ estado: 'aprobado' }).toArray();
    const alumnos = await usuarios.find({ rol: 'alumno', area: s(area), semestre: s(semestre), grupo: s(grupo) }).toArray();
    const presentes = new Set((await asistencias.find({ fecha, estado: 'asistio', materiaKey: key }).toArray()).map(a => a.curp));
    let faltas = 0;
    for (const al of alumnos.filter(x => !presentes.has(x.curp))) {
        const p = aprobados.find(x => x.curp === al.curp && x.desde <= fecha && fecha <= x.hasta);
        try {
            await asistencias.insertOne({ _id: `F:${al.curp}:${fecha}:${key}`, curp: al.curp, fecha, hora, estado: p ? 'justificada' : 'falta', motivo: p ? 'Permiso: ' + p.motivo : undefined, materia, materiaKey: key, horaInicio: bl.inicio, horaFin: bl.fin, docente: req.u.id, docenteNombre: s(req.body.docenteNombre) });
            if (!p) faltas++;
        } catch (e) { if (e.code !== 11000) throw e; }
        if (p) await avisar(al, 'justificada', hora, fecha, `${al.curp}:${fecha}:${key}`, materia, `${al.nombre} no asistió a ${materia}: justificado por permiso`);
        else await avisar(al, 'falta', hora, fecha, `${al.curp}:${fecha}:${key}`, materia, `${al.nombre} faltó a ${materia}${hr} el ${fecha.split('-').reverse().join('/')}`);
    }
    res.json({ ok: true, faltas });
}));

/* Corregir: justificar una falta (avisa al tutor) o quitar un registro equivocado */
app.post('/api/asistencias/:uid/:accion', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const reg = await asistencias.findOne({ _id: req.params.uid });
    if (!reg) return bad(res, 'Registro no encontrado', 404);
    const al = await usuarios.findOne({ _id: 'alumno:' + reg.curp });
    const cl = al && await miClase(req.u.id, al.area, al.semestre, al.grupo, reg.materia);
    if (!al || !cl) return bad(res, 'Solo puedes modificar asistencias de tus materias y grupos', 403);
    if (req.params.accion === 'quitar') {
        await asistencias.deleteOne({ _id: reg._id });
    } else if (req.params.accion === 'justificar' && reg.estado === 'falta') {
        const motivo = s((req.body || {}).motivo).slice(0, 200);
        await asistencias.updateOne({ _id: reg._id }, { $set: { estado: 'justificada', motivo } });
        await avisar(al, 'justificada', reg.hora, reg.fecha, `${reg._id}`, reg.materia, `Falta de ${al.nombre} en ${reg.materia} justificada${motivo ? ' (' + motivo + ')' : ''}`);
    } else return bad(res, 'Acción inválida');
    res.json({ ok: true });
}));

/* ---------- Administración ---------- */
app.get('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const l = await usuarios.find({ rol: { $in: ['alumno', 'docente', 'tutor'] } }).limit(3000).toArray();
    res.json(l.map(publico));
}));
app.get('/api/admin/docentes', auth, adminDe('gabriela', 'control'), h(async (_req, res) => {
    const docentes = await usuarios.find({ rol: 'docente' }).project({ _id: 0, id: 1, nombre: 1 }).limit(1000).toArray();
    res.json(docentes);
}));
app.get('/api/admin/historial', auth, soloAdmin, h(async (req, res) => {
    const l = await auditoria.find({}).sort({ creado: -1 }).limit(300).toArray();
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.get('/api/admin/recuperaciones', auth, soloAdmin, h(async (req, res) => {
    const l = await solicitudesRecuperacion.find({ estado: 'pendiente' }).sort({ creado: 1 }).limit(200).toArray();
    res.json(l.map(({ _id, ipHash, ...r }) => ({ id: _id, ...r })));
}));
app.delete('/api/admin/recuperaciones', auth, soloAdmin, h(async (req, res) => {
    const resultado = await solicitudesRecuperacion.deleteMany({ estado: 'pendiente' });
    await registrarCambio(req, 'Solicitudes de recuperación eliminadas', `${resultado.deletedCount} solicitudes`);
    res.json({ ok: true, eliminadas: resultado.deletedCount });
}));
app.post('/api/admin/recuperaciones/:id/resolver', auth, soloAdmin, h(async (req, res) => {
    const solicitud = await solicitudesRecuperacion.findOne({ _id: s(req.params.id), estado: 'pendiente' });
    if (!solicitud) return bad(res, 'La solicitud ya fue atendida o no existe', 404);
    const accion = s(req.body.accion);
    if (accion === 'rechazar') {
        await solicitudesRecuperacion.updateOne({ _id: solicitud._id }, { $set: { estado: 'rechazada', resuelta: new Date(), resueltaPor: req.u.id } });
        await registrarCambio(req, 'Recuperación rechazada', `${solicitud.rol} · ${solicitud.curp}`);
        return res.json({ ok: true });
    }
    if (accion !== 'restablecer') return bad(res, 'Acción inválida');
    const cuenta = await usuarios.findOne({ _id: `${solicitud.rol}:${solicitud.curp}` });
    if (!cuenta) return bad(res, 'La cuenta ya no existe', 404);
    const cambioPassword = await usuarios.updateOne({ _id: cuenta._id }, { $set: { debeCambiarPassword: true, passwordActualizada: new Date(), sessionId: null }, $unset: { salt: '', hash: '' } });
    if (!cambioPassword.matchedCount) return bad(res, 'No se pudo restablecer la contraseña de esa cuenta', 409);
    await solicitudesRecuperacion.deleteOne({ _id: solicitud._id, estado: 'pendiente' });
    await registrarCambio(req, 'Restablecimiento de contraseña', `${solicitud.rol} · ${solicitud.curp}`);
    const mensajeAviso = 'Servicios Escolares restableció tu contraseña. Entra con tu CURP y crea una nueva.';
    await avisos.insertOne({ _id: 'password:' + solicitud.curp + ':' + Date.now(), para: solicitud.curp, curp: solicitud.curp, tipo: 'password', texto: mensajeAviso, fecha: new Date().toISOString().slice(0,10), creado: new Date() });
    await enviarPush(solicitud.rol, solicitud.curp, 'Contraseña restablecida', mensajeAviso, '/');
    res.json({ ok: true });
}));
const ROLES_CUENTA = { alumno: 'alumno', docente: 'docente', tutor: 'tutor' };
const curpYaRegistrada = async (curp, session) => usuarios.findOne({ curp: String(curp).toUpperCase() }, { projection: { rol: 1 }, session });
app.post('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const d = req.body || {}, rol = s(d.rol), id = s(d.id).toUpperCase();
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(id)) return bad(res, 'CURP inválida (18 letras y números)');
    if (ADMIN_CURP && id === ADMIN_CURP) return bad(res, 'Esa CURP está reservada para Servicios Escolares');
    if (s(d.nombre).length < 3) return bad(res, 'Escribe el nombre completo');
    const previa = await curpYaRegistrada(id);
    if (previa) return bad(res, `Esa CURP ya está registrada como ${ROLES_CUENTA[previa.rol] || previa.rol}. Una CURP no se puede repetir.`, 409);
    const doc = { _id: `${rol}:${id}`, rol, id, curp: id, nombre: s(d.nombre), debeCambiarPassword: true, creado: new Date() };
    if (rol === 'alumno') {            // el grupo se crea solo la primera vez que se usa
        const semestre = s(d.semestre).slice(0, 20), area = s(d.area).slice(0, 40), grupo = s(d.grupo).toUpperCase().slice(0, 3);
        if (!semestre || !area || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Elige el semestre, el área y el grupo (A, B o C)');
        Object.assign(doc, { area, semestre, grupo, tutores: [] });
    }
    if (rol === 'tutor') doc.hijos = [];
    try { await usuarios.insertOne(doc); } catch (e) { if (e.code === 11000) return bad(res, 'Esa CURP ya está registrada. Una CURP no se puede repetir.', 409); throw e; }
    if (rol === 'alumno') await grupos.updateOne({ _id: `${doc.semestre}|${doc.area}|${doc.grupo}` }, { $set: { semestre: doc.semestre, area: doc.area, grupo: doc.grupo, nombre: `${doc.semestre} ${doc.area} ${doc.grupo}` } }, { upsert: true });
    await registrarCambio(req, 'Cuenta creada', `${rol} · ${id}`);
    res.status(201).json({ ok: true });
}));
app.post('/api/admin/usuarios/importar', auth, soloAdmin, h(async (req, res) => {
    const filas = req.body?.cuentas;
    if (!Array.isArray(filas) || !filas.length || filas.length > 500) return bad(res, 'Envía entre 1 y 500 cuentas para importar.');
    const semestresValidos = ['1-2 semestre', '3-4 semestre', '5-6 semestre'];
    const areasValidas = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
    const documentos = [], curps = new Set(), gruposNuevos = new Map();
    for (let i = 0; i < filas.length; i++) {
        const d = filas[i] || {}, rol = s(d.rol), id = s(d.id).toUpperCase(), nombre = s(d.nombre).replace(/\s+/g, ' ');
        if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, `Fila ${i + 1}: rol inválido.`);
        if (!RX.curp.test(id)) return bad(res, `Fila ${i + 1}: CURP inválida.`);
        if (ADMIN_CURP && id === ADMIN_CURP) return bad(res, `Fila ${i + 1}: CURP reservada para Servicios Escolares.`);
        if (nombre.length < 3 || nombre.length > 120) return bad(res, `Fila ${i + 1}: escribe un nombre de 3 a 120 caracteres.`);
        const _id = `${rol}:${id}`;
        if (curps.has(id)) return bad(res, `Fila ${i + 1}: CURP repetida en el archivo.`);
        curps.add(id);
        const doc = { _id, rol, id, curp: id, nombre, debeCambiarPassword: true, creado: new Date() };
        if (rol === 'alumno') {
            const semestre = s(d.semestre), area = s(d.area), grupo = s(d.grupo).toUpperCase();
            if (!semestresValidos.includes(semestre) || !areasValidas.includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, `Fila ${i + 1}: semestre, área o grupo inválido.`);
            Object.assign(doc, { semestre, area, grupo, tutores: [] });
            const key = `${semestre}|${area}|${grupo}`;
            gruposNuevos.set(key, { _id: key, semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` });
        }
        if (rol === 'tutor') doc.hijos = [];
        documentos.push(doc);
    }
    const session = usuarios.client.startSession();
    let conflictos = [];
    try {
        await session.withTransaction(async () => {
            conflictos = (await usuarios.find({ curp: { $in: [...curps] } }, { projection: { curp: 1, rol: 1 }, session }).toArray()).map(x => `${x.curp} (${x.rol})`);
            if (conflictos.length) return;
            await usuarios.insertMany(documentos, { ordered: true, session });
            for (const grupo of gruposNuevos.values()) await grupos.updateOne({ _id: grupo._id }, { $setOnInsert: grupo }, { upsert: true, session });
            await auditoria.insertOne({ accion: 'Cuentas importadas desde Excel', detalle: `${documentos.length} cuentas`, actor: req.u.id, actorNombre: req.u.nombre || 'Servicios Escolares', creado: new Date() }, { session });
        });
    } catch (e) {
        if (e.code === 11000) return bad(res, 'Hay CURP repetidas. No se creó ninguna cuenta; actualiza la lista e intenta de nuevo.', 409);
        throw e;
    } finally { await session.endSession(); }
    if (conflictos.length) return bad(res, `No se creó ninguna cuenta. Estas CURP ya están registradas: ${conflictos.join(', ')}.`, 409);
    res.status(201).json({ ok: true, creadas: documentos.length });
}));
app.post('/api/admin/editar', auth, soloAdmin, h(async (req, res) => {
    const id = 'alumno:' + s(req.body.id).toUpperCase(), c = {};
    for (const k of ['area', 'semestre', 'grupo']) if (s(req.body[k])) c[k] = s(req.body[k]).slice(0, 40);
    if (!await usuarios.findOne({ _id: id })) return bad(res, 'Alumno no encontrado', 404);
    await usuarios.updateOne({ _id: id }, { $set: c });
    await registrarCambio(req, 'Cambio de grupo', `${id.slice(7)} · ${c.semestre || ''} ${c.area || ''} ${c.grupo || ''}`.trim());
    res.json({ ok: true });
}));
app.post('/api/admin/borrar', auth, soloAdmin, h(async (req, res) => {
    const u = await usuarios.findOne({ _id: `${s(req.body.rol)}:${s(req.body.id).toUpperCase()}` });
    if (!u || u.rol === 'admin') return bad(res, 'Usuario no encontrado', 404);
    await usuarios.deleteOne({ _id: u._id });
    await registrarCambio(req, 'Cuenta eliminada', `${u.rol} · ${u.id}`);
    res.json({ ok: true });
}));

/* ---------- Grupos y clases (materia + grupo + docente) ---------- */
app.get('/api/grupos', auth, h(async (req, res) => {
    res.json((await grupos.find({}).limit(500).toArray()).map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/grupos/eliminar-cuentas', auth, soloAdmin, h(async (req, res) => {
    const g = await grupos.findOne({ _id: s(req.body.id) });
    if (!g) return bad(res, 'Grupo no encontrado', 404);
    const filtro = { area: g.area, semestre: g.semestre, grupo: g.grupo };
    const curps = (await usuarios.find({ rol: 'alumno', ...filtro }).toArray()).map(a => a.curp);
    for (const c of curps) {
        await usuarios.deleteOne({ _id: 'alumno:' + c });
        for (const col of [asistencias, calificaciones, permisos, avisos]) await col.deleteMany({ curp: c });
    }
    for (const tu of await usuarios.find({ rol: 'tutor' }).toArray())
        for (const c of (tu.hijos || []).filter(x => curps.includes(x))) await usuarios.updateOne({ _id: tu._id }, { $pull: { hijos: c } });
    // El grupo, sus clases y horarios se conservan.
    await registrarCambio(req, 'Cuentas de grupo eliminadas', `${g.semestre} ${g.area} ${g.grupo} · ${curps.length} alumnos`);
    res.json({ ok: true, alumnos: curps.length });
}));
app.get('/api/clases', auth, h(async (req, res) => {
    let q = {};
    if (req.u.rol === 'docente') q = req.query.area ? { area: s(req.query.area), semestre: s(req.query.semestre), grupo: s(req.query.grupo) } : { docente: req.u.id };
    else if (req.u.rol !== 'admin') {
        const gs = new Set();
        for (const c of await permitidas(req.u)) { const al = await usuarios.findOne({ _id: 'alumno:' + c }); if (al) gs.add(`${al.area}|${al.semestre}|${al.grupo}`); }
        return res.json((await clases.find({}).limit(2000).toArray()).filter(x => gs.has(`${x.area}|${x.semestre}|${x.grupo}`)).map(({ _id, ...r }) => ({ id: _id, ...r })));
    }
    res.json((await clases.find(q).limit(1000).toArray()).map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/clases', auth, soloAdmin, h(async (req, res) => {
    const materia = limpiaMat(req.body.materia), area = s(req.body.area), semestre = s(req.body.semestre), grupo = s(req.body.grupo).toUpperCase(), doc = s(req.body.docente).toUpperCase();
    if (!materia || !await grupos.findOne({ _id: `${semestre}|${area}|${grupo}` })) return bad(res, 'Materia o grupo inválido');
    const d = await usuarios.findOne({ _id: 'docente:' + doc });
    if (!d) return bad(res, 'Docente no encontrado', 404);
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const HH = v => /^\d{2}:\d{2}$/.test(s(v)) ? s(v) : '';
    await clases.insertOne({ _id: id, materia, area, semestre, grupo, docente: doc, docenteNombre: d.nombre, horaInicio: HH(req.body.horaInicio), horaFin: HH(req.body.horaFin) });
    await registrarCambio(req, 'Materia creada', `${materia} · ${semestre} ${area} ${grupo} · ${d.nombre}`);
    res.status(201).json({ ok: true, id });
}));
app.post('/api/admin/clases/borrar', auth, soloAdmin, h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), clase = await clases.findOne({ _id: id });
    await clases.deleteOne({ _id: id });
    if (clase) await registrarCambio(req, 'Materia eliminada', `${clase.materia} · ${clase.semestre} ${clase.area} ${clase.grupo}`);
    res.json({ ok: true });
}));

/* ---------- Horarios (los captura Servicios Escolares) ---------- */
app.get('/api/horarios', auth, h(async (req, res) => {
    let l = await horarios.find({}).limit(5000).toArray();
    if (req.u.rol === 'docente') l = l.filter(b => b.docente === req.u.id);
    else if (req.u.rol !== 'admin') {
        const gs = new Set();
        for (const c of await permitidas(req.u)) { const al = await usuarios.findOne({ _id: 'alumno:' + c }); if (al) gs.add(`${al.area}|${al.semestre}|${al.grupo}`); }
        l = l.filter(b => gs.has(`${b.area}|${b.semestre}|${b.grupo}`));
    }
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/horarios', auth, adminDe('gabriela', 'control'), h(async (req, res) => {
    const b = req.body || {}, area = s(b.area), semestre = s(b.semestre), grupo = s(b.grupo).toUpperCase(), dia = Number(b.dia), tipo = b.tipo === 'descanso' ? 'descanso' : 'clase', HM = /^\d{2}:\d{2}$/;
    const SEM_OK = ['1-2 semestre', '3-4 semestre', '5-6 semestre'], AREAS_OK = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
    if (!SEM_OK.includes(semestre) || !AREAS_OK.includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Grupo inválido');
    await grupos.updateOne({ _id: `${semestre}|${area}|${grupo}` }, { $setOnInsert: { semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` } }, { upsert: true });
    if (tipo === 'clase' && s(b.inicio) < '10:00' && s(b.fin) > '09:30') return bad(res, 'Ese horario choca con el descanso fijo (9:30 a 10:00)');
    if (!(dia >= 1 && dia <= 6) || !HM.test(s(b.inicio)) || !HM.test(s(b.fin)) || s(b.fin) <= s(b.inicio)) return bad(res, 'Revisa el día y las horas');
    const doc = { _id: crypto.randomBytes(5).toString('hex'), area, semestre, grupo, dia, inicio: s(b.inicio), fin: s(b.fin), tipo, materia: 'Descanso', claseId: '', docente: '', docenteNombre: '' };
    if (tipo === 'clase') {
        let cl = null;
        if (s(b.claseId)) cl = await clases.findOne({ _id: s(b.claseId).toUpperCase() });
        else {   // la materia se crea sola con docente + nombre + grupo
            const materia = limpiaMat(b.materia), docId = s(b.docente).toUpperCase();
            if (materia.length < 2) return bad(res, 'Escribe el nombre de la materia');
            const dc = await usuarios.findOne({ _id: 'docente:' + docId });
            if (!dc) return bad(res, 'Docente no encontrado', 404);
            cl = await clases.findOne({ area, semestre, grupo, docente: docId, materia: { $regex: `^${materia.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
            if (!cl) {
                cl = { _id: crypto.randomBytes(4).toString('hex').toUpperCase(), materia, area, semestre, grupo, docente: docId, docenteNombre: dc.nombre, horaInicio: '', horaFin: '' };
                await clases.insertOne(cl);
                await registrarCambio(req, 'Materia creada', `${materia} · ${semestre} ${area} ${grupo} · ${dc.nombre}`);
            }
        }
        if (!cl || `${cl.area}|${cl.semestre}|${cl.grupo}` !== `${area}|${semestre}|${grupo}`) return bad(res, 'Elige una clase de ese grupo');
        Object.assign(doc, { materia: cl.materia, claseId: cl._id, docente: cl.docente, docenteNombre: cl.docenteNombre });
    }
    await horarios.insertOne(doc);
    const diaNombre = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dia];
    await registrarCambio(req, 'Horario añadido', `${diaNombre} · ${doc.materia} · ${semestre} ${area} ${grupo} · ${doc.inicio}-${doc.fin}`);
    res.status(201).json({ ok: true });
}));
app.post('/api/admin/horarios/borrar', auth, adminDe('gabriela', 'control'), h(async (req, res) => {
    const id = s(req.body.id), bloque = await horarios.findOne({ _id: id });
    await horarios.deleteOne({ _id: id });
    if (bloque) await registrarCambio(req, 'Horario eliminado', `${bloque.materia} · ${bloque.semestre} ${bloque.area} ${bloque.grupo} · ${bloque.inicio}-${bloque.fin}`);
    res.json({ ok: true });
}));
app.post('/api/admin/vincular', auth, soloAdmin, h(async (req, res) => {
    const t = s(req.body.tutor).toUpperCase(), a = s(req.body.alumno).toUpperCase();
    const tu = await usuarios.findOne({ _id: 'tutor:' + t }), al = await usuarios.findOne({ _id: 'alumno:' + a });
    if (!tu || !al) return bad(res, 'No se encontró el tutor o el alumno', 404);
    await usuarios.updateOne({ _id: tu._id }, { $addToSet: { hijos: a } });
    await usuarios.updateOne({ _id: al._id }, { $addToSet: { tutores: t } });
    await registrarCambio(req, 'Vínculo tutor-alumno', `${tu.nombre} · ${al.nombre}`);
    res.json({ ok: true });
}));

/* ---------- Avisos de la administración (anuncios) ---------- */
const DESTINOS = { tutor: ['tutor'], docente: ['docente'], alumno: ['alumno'], 'alumno,docente': ['alumno', 'docente'], 'tutor,alumno': ['tutor', 'alumno'], 'tutor,docente': ['tutor', 'docente'], todos: ['tutor', 'docente', 'alumno', 'admin'] };
app.post('/api/anuncios', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const titulo = s(req.body.titulo).slice(0, 80), mensaje = s(req.body.mensaje).slice(0, 1000), para = DESTINOS[s(req.body.destino)];
    if (!titulo || !mensaje || !para) return bad(res, 'Escribe el título, el mensaje y elige a quién va');
    const id = crypto.randomBytes(5).toString('hex');
    await anuncios.insertOne({ _id: id, titulo, mensaje, para, creado: new Date(), por: req.u.id });
    await Promise.all(para.map(async rol => {
        const us = await usuarios.find({ rol }).project({ id: 1 }).toArray();
        await Promise.all(us.map(u => enviarPush(rol, u.id, titulo, mensaje, '/')));
    }));
    await registrarCambio(req, 'Aviso publicado', `${titulo} · ${para.join(', ')}`);
    res.status(201).json({ ok: true, id });
}));
app.get('/api/anuncios', auth, h(async (req, res) => {
    const l = await anuncios.find({}).limit(500).toArray();
    const visibles = l.filter(a => req.u.rol === 'admin' || a.para.includes(req.u.rol)).sort((a, b) => new Date(b.creado) - new Date(a.creado)).slice(0, 50);
    const leidos = req.u.rol === 'admin' || !visibles.length ? new Set() : new Set((await avisosLeidos.find({
        rol: req.u.rol, para: req.u.id, anuncioId: { $in: visibles.map(a => a._id) }
    }).toArray()).map(x => x.anuncioId));
    res.json(visibles.map(({ _id, ...r }) => ({ id: _id, ...r, leido: leidos.has(_id) })));
}));
app.post('/api/anuncios/:id/leido', auth, h(async (req, res) => {
    if (!['alumno', 'tutor', 'docente'].includes(req.u.rol)) return bad(res, 'Acción no disponible', 403);
    const anuncioId = s(req.params.id), anuncio = await anuncios.findOne({ _id: anuncioId });
    if (!anuncio || !anuncio.para.includes(req.u.rol)) return bad(res, 'Aviso no encontrado', 404);
    try {
        await avisosLeidos.updateOne(
            { anuncioId, rol: req.u.rol, para: req.u.id },
            { $setOnInsert: { anuncioId, rol: req.u.rol, para: req.u.id, leidoEn: new Date() } },
            { upsert: true }
        );
    } catch (e) { if (e.code !== 11000) throw e; }
    res.json({ ok: true });
}));
app.post('/api/anuncios/:id/borrar', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const id = s(req.params.id), anuncio = await anuncios.findOne({ _id: id });
    await anuncios.deleteOne({ _id: id });
    await avisosLeidos.deleteMany({ anuncioId: id });
    if (anuncio) await registrarCambio(req, 'Aviso eliminado', anuncio.titulo);
    res.json({ ok: true });
}));

/* ---------- Vínculos tutor ↔ alumno ---------- */
app.get('/api/vinculos', auth, h(async (req, res) => {
    const lista = [];
    if (req.u.rol === 'tutor') {
        const tu = await usuarios.findOne({ _id: 'tutor:' + req.u.id }); if (!tu) return res.json([]);
        for (const c of hijosDe(tu)) {
            const al = await usuarios.findOne({ _id: 'alumno:' + c });
            lista.push(al && vinculoOk(tu, al) ? { curp: c, estado: 'vinculado', nombre: al.nombre, area: al.area, semestre: al.semestre, grupo: al.grupo } : { curp: c, estado: 'pendiente' });
        }
    } else if (req.u.rol === 'alumno') {
        const al = await usuarios.findOne({ _id: 'alumno:' + req.u.id }); if (!al) return res.json([]);
        for (const c of al.tutores || []) {
            const tu = await usuarios.findOne({ _id: 'tutor:' + c });
            lista.push(tu && vinculoOk(tu, al) ? { curp: c, estado: 'vinculado', nombre: tu.nombre } : { curp: c, estado: 'pendiente' });
        }
    }
    res.json(lista);
}));
app.post('/api/vinculos/:accion', auth, h(async (req, res) => {
    const curp = s(req.body.curp).toUpperCase(), campo = req.u.rol === 'tutor' ? 'hijos' : req.u.rol === 'alumno' ? 'tutores' : '';
    if (!campo || !RX.curp.test(curp)) return bad(res, 'CURP inválida (18 caracteres)');
    const yo = await usuarios.findOne({ _id: `${req.u.rol}:${req.u.id}` });
    if (!yo || curp === yo.curp) return bad(res, 'Esa CURP no es válida para vincular');
    if (req.params.accion === 'agregar') {
        if ((yo[campo] || []).length >= 6) return bad(res, 'Ya llegaste al máximo de vínculos (6)');
        await usuarios.updateOne({ _id: yo._id }, { $addToSet: { [campo]: curp } });
    } else if (req.params.accion === 'quitar') {
        await usuarios.updateOne({ _id: yo._id }, { $pull: { [campo]: curp }, ...(yo.curpAlumno === curp ? { $set: { curpAlumno: '' } } : {}) });
    } else return bad(res, 'Acción inválida');
    res.json({ ok: true });
}));

/* ---------- Mi cuenta ---------- */
app.post('/api/cuenta/datos', auth, h(async (req, res) => {
    if (req.u.rol !== 'alumno') return bad(res, 'Solo alumnos', 403);
    const c = {}; for (const k of ['area', 'semestre', 'grupo']) if (s(req.body[k])) c[k] = s(req.body[k]).slice(0, 40);
    await usuarios.updateOne({ _id: 'alumno:' + req.u.id }, { $set: c });
    res.json({ ok: true });
}));

/* ---------- Calificaciones ---------- */
app.post('/api/calificaciones', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente' && !(req.u.rol === 'admin' && req.u.adminArea === 'control')) return bad(res, 'No tienes permiso para subir calificaciones', 403);
    const m = limpiaMat(req.body.materia), key = m.toLowerCase(), p = Number(req.body.parcial), notas = req.body.notas;
    if (!m || ![1, 2, 3].includes(p) || !Array.isArray(notas)) return bad(res, 'Datos inválidos');
    const hoy = new Date().toISOString().slice(0, 10); let n = 0;
    for (const x of notas.slice(0, 200)) {
        const curp = s(x.curp).toUpperCase(), nota = Number(x.nota);
        if (!RX.curp.test(curp) || !(nota >= 0 && nota <= 10)) continue;
        const al = await usuarios.findOne({ _id: 'alumno:' + curp });
        if (!al) continue;
        if (req.u.rol === 'docente' && !await miClase(req.u.id, al.area, al.semestre, al.grupo, m)) continue;
        if (req.u.rol === 'admin' && (al.area !== req.body.area || al.semestre !== req.body.semestre || al.grupo !== req.body.grupo)) continue;
        await calificaciones.updateOne({ _id: `C:${curp}:${key}:${p}` }, { $set: { curp, materia: m, materiaKey: key, parcial: p, nota, docente: req.u.id } }, { upsert: true });
        const texto = `Ya subieron tu calificaci?n de ${m}, parcial ${p}: ${nota}.`;
        await avisos.insertOne({ _id: `calif:${curp}:${key}:${p}:${Date.now()}`, para: curp, curp, tipo: 'calif', texto, materia: m, fecha: hoy, creado: new Date() });
        await enviarPush('alumno', curp, 'Calificaci?n subida', texto, '/');
        await avisar(al, 'calif', '', hoy, `C:${curp}:${key}:${p}:${nota}`, m, `${al.nombre}: ${m}, parcial ${p}: ${nota}`); n++;
    }
    res.json({ ok: true, guardadas: n });
}));
app.get('/api/calificaciones', auth, h(async (req, res) => {
    const c = await permitidas(req.u), q = c ? { curp: { $in: c } } : {};
    res.json((await calificaciones.find(q).limit(5000).toArray()).map(({ _id, ...r }) => r));
}));

/* ---------- Permisos: el tutor pide, un docente del grupo aprueba ---------- */
const FECHA = /^\d{4}-\d{2}-\d{2}$/, claveG = x => `${x.area}|${x.semestre}|${x.grupo}`;
app.post('/api/permisos', auth, h(async (req, res) => {
    if (req.u.rol !== 'tutor') return bad(res, 'Solo tutores', 403);
    const curp = s(req.body.curp).toUpperCase(), c = await permitidas(req.u);
    const al = c.includes(curp) ? await usuarios.findOne({ _id: 'alumno:' + curp }) : null;
    if (!al) return bad(res, 'Elige un alumno vinculado a tu cuenta', 404);
    const desde = s(req.body.desde), hasta = s(req.body.hasta), motivo = s(req.body.motivo).slice(0, 200);
    if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde || !motivo) return bad(res, 'Revisa las fechas y escribe el motivo');
    if ((new Date(hasta) - new Date(desde)) / 864e5 > 30) return bad(res, 'El permiso no puede durar más de 30 días');
    const id = crypto.randomBytes(5).toString('hex').toUpperCase();
    await permisos.insertOne({ _id: id, curp: al.curp, alumno: al.nombre, area: al.area, semestre: al.semestre, grupo: al.grupo, tutor: req.u.id, desde, hasta, motivo, estado: 'pendiente', creado: new Date() });
    await notificarAlumno(al.curp, `permiso:${id}:solicitado`, 'Solicitud de permiso', `Tu tutor solicitó un permiso para ${al.nombre}, del ${desde} al ${hasta}. Consulta la sección Permisos.`, '/#/permisos', false);
    res.status(201).json({ ok: true, id });
}));
app.get('/api/permisos', auth, h(async (req, res) => {
    let l;
    if (req.u.rol === 'tutor') l = await permisos.find({ tutor: req.u.id }).limit(200).toArray();
    else if (req.u.rol === 'docente') {
        const gs = new Set((await clases.find({ docente: req.u.id }).toArray()).map(claveG));
        l = (await permisos.find({}).limit(1000).toArray()).filter(p => p.estado === 'aprobado' && gs.has(claveG(p)));
    } else if (req.u.rol === 'admin') l = await permisos.find({}).limit(500).toArray();
    else l = await permisos.find({ curp: req.u.id }).limit(200).toArray();
    res.json(l.sort((a, b) => new Date(b.creado) - new Date(a.creado)).slice(0, 100).map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/permisos/:id/resolver', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const p = await permisos.findOne({ _id: s(req.params.id) });
    if (!p) return bad(res, 'Permiso no encontrado', 404);
    if (p.estado !== 'pendiente') return bad(res, 'Ese permiso ya fue resuelto', 409);
    const aprobar = req.body.accion === 'aprobar', estado = aprobar ? 'aprobado' : 'rechazado';
    await permisos.updateOne({ _id: p._id }, { $set: { estado, resueltoPor: req.u.id } });
    await registrarCambio(req, `Permiso ${estado}`, `${p.alumno} · ${p.desde} a ${p.hasta}`);
    if (aprobar) for (const f of (await asistencias.find({ curp: p.curp, estado: 'falta' }).toArray()).filter(f => f.fecha >= p.desde && f.fecha <= p.hasta))
        await asistencias.updateOne({ _id: f._id }, { $set: { estado: 'justificada', motivo: 'Permiso: ' + p.motivo } });
    const al = await usuarios.findOne({ _id: 'alumno:' + p.curp });
    if (al) await avisar(al, 'permiso', '', p.desde, `${p._id}:${estado}`, '', `Permiso ${estado}: ${p.alumno}, del ${p.desde} al ${p.hasta}`);
    res.json({ ok: true });
}));

/* ---------- Entradas y salidas (portero) y fin de clases ---------- */
const ahoraMx = () => { const d = new Date(), z = { timeZone: 'America/Mexico_City' }; return { fecha: d.toLocaleDateString('sv-SE', z), hora: d.toLocaleTimeString('es-MX', { ...z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }; };
const hora12 = hm => { const [hh, mm] = hm.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
app.get('/api/dia', auth, h(async (req, res) => {
    const { fecha } = ahoraMx(), d = await diasEscolares.findOne({ _id: fecha });
    res.json({ fecha, clasesTerminadas: !!(d && d.clasesTerminadas), hora: (d && d.hora) || '', por: (d && d.porNombre) || '' });
}));
app.post('/api/admin/fin-clases', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const { fecha, hora } = ahoraMx(), terminar = req.body.accion !== 'reabrir';
    if (terminar && req.body.confirmar !== true) return bad(res, 'Confirma que las clases de hoy ya terminaron');
    const antes = await diasEscolares.findOne({ _id: fecha }), yaTerminadas = !!(antes && antes.clasesTerminadas);
    await diasEscolares.updateOne({ _id: fecha }, { $set: { clasesTerminadas: terminar, hora: terminar ? hora : '', por: req.u.id, porNombre: req.u.nombre || 'Servicios Escolares' } }, { upsert: true });
    await registrarCambio(req, terminar ? 'Clases terminadas' : 'Clases reabiertas', `${fecha} · ${hora}`);
    if (terminar && !yaTerminadas) {   // un solo aviso general a todos los tutores: así los alumnos salen sin tener que escanear
        const titulo = 'Las clases terminaron', mensaje = `Las clases de hoy terminaron a las ${hora12(hora)}. Los alumnos ya pueden salir de la escuela.`;
        await anuncios.insertOne({ _id: crypto.randomBytes(5).toString('hex'), titulo, mensaje, para: ['tutor'], creado: new Date(), por: req.u.id });
        usuarios.find({ rol: 'tutor' }).project({ id: 1 }).toArray()
            .then(us => Promise.all(us.map(u => enviarPush('tutor', u.id, titulo, mensaje, '/').catch(() => {}))))
            .catch(e => console.warn('No se pudo avisar el fin de clases:', e.message));
    }
    res.json({ ok: true, clasesTerminadas: terminar, hora: terminar ? hora : '' });
}));
/* El portero escanea el QR: el primer escaneo del día es entrada, el siguiente salida, y así. La salida exige permiso aprobado o fin de clases. */
app.post('/api/portero/escaneo', auth, adminDe('portero', 'control'), h(async (req, res) => {
    const curp = s(req.body.curp).toUpperCase();
    if (!RX.curp.test(curp)) return bad(res, 'QR no válido: no contiene una CURP');
    const al = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!al) return bad(res, 'Alumno no encontrado', 404);
    const { fecha, hora } = ahoraMx(), alumno = { nombre: al.nombre, curp, area: al.area, semestre: al.semestre, grupo: al.grupo };
    const ultimo = (await accesos.find({ curp, fecha }).sort({ creado: -1 }).limit(1).toArray())[0];
    if (ultimo && Date.now() - new Date(ultimo.creado).getTime() < 15000)   // el mismo QR leído dos veces seguidas no cambia entrada por salida
        return res.json({ ok: true, duplicado: true, autorizado: true, id: ultimo._id, tipo: ultimo.tipo, hora: ultimo.hora, motivo: ultimo.motivo || '', alumno });
    const tipo = ultimo && ultimo.tipo === 'entrada' ? 'salida' : 'entrada';
    let motivo = '';
    if (tipo === 'salida') {
        const dia = await diasEscolares.findOne({ _id: fecha });
        if (dia && dia.clasesTerminadas) motivo = 'clases terminadas';
        else { const p = await permisos.findOne({ curp, estado: 'aprobado', desde: { $lte: fecha }, hasta: { $gte: fecha } }); if (p) motivo = 'permiso aprobado'; }
        if (!motivo) return res.json({ ok: true, autorizado: false, tipo, alumno, mensaje: 'Sin permiso aprobado y las clases aún no terminan. No lo dejes salir.' });
    }
    const id = crypto.randomBytes(5).toString('hex');
    await accesos.insertOne({ _id: id, curp, alumno: al.nombre, area: al.area, semestre: al.semestre, grupo: al.grupo, fecha, hora, tipo, motivo, por: req.u.id, creado: new Date() });
    const texto = tipo === 'entrada' ? `${al.nombre} entró a la escuela a las ${hora12(hora)}.` : `${al.nombre} salió de la escuela a las ${hora12(hora)} (${motivo}).`;
    if (motivo !== 'clases terminadas') notificarAlumno(curp, `acceso:${id}`, tipo === 'entrada' ? 'Entrada' : 'Salida', texto, '/#/avisos', true, false).catch(e => console.warn('No se pudo avisar la entrada/salida:', e.message));
    res.status(201).json({ ok: true, autorizado: true, id, tipo, hora, motivo, alumno });
}));
app.post('/api/portero/acceso/:id/deshacer', auth, adminDe('portero', 'control'), h(async (req, res) => {
    const id = s(req.params.id), { fecha } = ahoraMx();
    const r = await accesos.deleteOne({ _id: id, fecha });
    if (!r.deletedCount) return bad(res, 'Solo se puede deshacer un registro de hoy', 404);
    await avisos.deleteMany({ origenId: `acceso:${id}` });
    res.json({ ok: true });
}));
/* Estado de cada alumno hoy según su último movimiento */
async function estadoHoy(fecha) {
    const movs = await accesos.find({ fecha }).sort({ creado: -1 }).limit(20000).toArray(), ultimo = new Map();
    for (const m of movs) if (!ultimo.has(m.curp)) ultimo.set(m.curp, m);
    return { movs, ultimo };
}
app.get('/api/portero/resumen', auth, adminDe('portero', 'control', 'sara'), h(async (req, res) => {
    const { fecha } = ahoraMx(), { movs, ultimo } = await estadoHoy(fecha), total = await usuarios.countDocuments({ rol: 'alumno' });
    let dentro = 0, salieron = 0;
    for (const m of ultimo.values()) m.tipo === 'entrada' ? dentro++ : salieron++;
    res.json({ total, dentro, salieron, sinLlegar: Math.max(0, total - dentro - salieron), ultimos: movs.slice(0, 5).map(({ _id, ...r }) => ({ id: _id, curp: r.curp, alumno: r.alumno, tipo: r.tipo, hora: r.hora })) });
}));
app.get('/api/portero/buscar', auth, adminDe('portero', 'control', 'sara'), h(async (req, res) => {
    const norm = x => s(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), q = norm(req.query.q);
    if (q.length < 2) return res.json([]);
    const { fecha } = ahoraMx(), { ultimo } = await estadoHoy(fecha);
    const als = (await usuarios.find({ rol: 'alumno' }).project({ nombre: 1, curp: 1, id: 1, area: 1, semestre: 1, grupo: 1 }).limit(10000).toArray())
        .filter(a => norm(`${a.nombre} ${a.curp || a.id} ${a.semestre} ${a.area} ${a.grupo}`).includes(q)).slice(0, 15);
    res.json(als.map(a => { const c = a.curp || a.id, m = ultimo.get(c); return { curp: c, nombre: a.nombre, area: a.area, semestre: a.semestre, grupo: a.grupo, estado: !m ? 'sin llegar' : m.tipo === 'entrada' ? 'dentro' : 'salió', hora: m ? m.hora : '' }; }));
}));

/* ---------- Citatorios de Servicios Escolares ---------- */
app.get('/api/admin/citatorios', auth, adminDe('sara', 'control'), h(async (_req, res) => {
    const l = await citatorios.find({}).sort({ creado: -1 }).limit(500).toArray();
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.get('/api/admin/citatorios/alumnos', auth, adminDe('sara', 'control'), h(async (_req, res) => {
    const lista = await usuarios.find({ rol: 'alumno' }).project({ _id: 1, id: 1, curp: 1, nombre: 1, area: 1, semestre: 1, grupo: 1 }).limit(5000).toArray();
    res.json(lista.map(a => ({ curp: a.curp || a.id || String(a._id).replace(/^alumno:/, ''), nombre: a.nombre, area: a.area, semestre: a.semestre, grupo: a.grupo })));
}));
app.get('/api/citatorios', auth, h(async (req, res) => {
    if (req.u.rol !== 'alumno') return bad(res, 'Solo alumnos pueden consultar sus citatorios', 403);
    const l = await citatorios.find({ curp: req.u.id, estado: { $ne: 'anulado' } }).sort({ creado: -1 }).limit(100).toArray();
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/citatorios', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const curp = s(req.body.curp).toUpperCase(), fecha = s(req.body.fecha), motivo = s(req.body.motivo).trim().slice(0, 1000);
    if (!RX.curp.test(curp) || !FECHA.test(fecha) || !motivo) return bad(res, 'Elige alumno, fecha y motivo del citatorio');
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!alumno) return bad(res, 'No se encontró ese alumno', 404);
    const id = crypto.randomBytes(6).toString('hex').toUpperCase();
    const doc = { _id: id, curp, alumno: alumno.nombre, area: alumno.area, semestre: alumno.semestre, grupo: alumno.grupo, fecha, motivo, creado: new Date(), creadoPor: req.u.nombre || req.u.id };
    await citatorios.insertOne(doc);
    await registrarCambio(req, 'Citatorio creado', `${alumno.nombre} · ${fecha}`);
    await notificarAlumno(curp, `citatorio:${id}`, 'Nuevo citatorio', `Tienes un citatorio para el ${fecha}. Consulta la sección Citatorios.`, '/#/citatorios');
    res.status(201).json({ ok: true, id });
}));
app.delete('/api/admin/citatorios/:id', auth, adminDe('sara', 'control'), h(async (req, res) => {
    const id = s(req.params.id);
    const citatorio = await citatorios.findOneAndDelete({ _id: id });
    if (!citatorio) return bad(res, 'El citatorio no existe', 404);
    await avisos.deleteMany({ $or: [{ origenId: `citatorio:${id}` }, { _id: `citatorio:${id}` }] });
    await registrarCambio(req, 'Citatorio eliminado', `${citatorio.alumno} · ${citatorio.fecha}`);
    res.json({ ok: true });
}));

app.get('/api/avisos', auth, h(async (req, res) => {
    const lista = await avisos.find({ para: req.u.id }).sort({ creado: -1 }).limit(100).toArray();
    res.json(lista.map(({ _id, para, ...r }) => ({ id: _id, ...r })));
}));

app.get('/api/asistencias', auth, h(async (req, res) => {
    const c = await permitidas(req.u), q = c ? { curp: { $in: c } } : {};
    const lista = await asistencias.find(q).sort({ fecha: -1, hora: -1 }).limit(5000).toArray();
    res.json(lista.map(({ _id, ...r }) => ({ uid: _id, ...r })));
}));

app.get('/control-escolar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- Arranque ---------- */
async function iniciarServidor() {
    if (!MONGODB_URI) { console.error('Error: No se encontró MONGODB_URI en el archivo .env'); process.exit(1); }
    if (!Object.values(ADMIN_ACCESS_PASSWORDS).some(password => password.length >= 4)) console.warn('Aviso: define ADMIN_ACCESS_PASSWORD en Render para habilitar Control Escolar.');
    if (!SECRET || SECRET.length < 16) { console.error('Error: define TOKEN_SECRET (mínimo 16 caracteres) en .env'); process.exit(1); }

    const limpia = MONGODB_URI.trim().replace(/^["']|["']$/g, '');
    const host = (limpia.split('@')[1] || '(sin @: revisa el texto)').split('/')[0];
    console.log('Conectando a:', host);
    const cliente = new MongoClient(limpia, { family: 4, serverSelectionTimeoutMS: 20000, tls: true });
    try {
        await cliente.connect();
        const db = cliente.db('SHARK-DARK');
        await db.command({ ping: 1 });
        usuarios = db.collection('usuarios');
        {
            const adminId = 'admin:' + ADMIN_ID;
            const adminActual = await usuarios.findOne({ _id: adminId });
            const envHash = Object.values(ADMIN_ACCESS_PASSWORDS).some(Boolean) ? crypto.createHash('sha256').update(JSON.stringify(ADMIN_ACCESS_PASSWORDS)).digest('hex') : '';
            if (!adminActual) {
                await usuarios.insertOne({ _id: adminId, rol: 'admin', id: ADMIN_ID, curp: ADMIN_CURP, nombre: 'Servicios Escolares', accessEnvHash: envHash, passwordActualizada: new Date(), creado: new Date() });
            } else if (envHash && envHash !== adminActual.accessEnvHash) {
                await usuarios.updateOne({ _id: adminId }, { $set: { id: ADMIN_ID, curp: ADMIN_CURP, nombre: 'Servicios Escolares', accessEnvHash: envHash, passwordActualizada: new Date() } });
            }
        }
        asistencias = db.collection('asistencias');
        calificaciones = db.collection('calificaciones');
        grupos = db.collection('grupos');
        clases = db.collection('clases');
        permisos = db.collection('permisos');
        accesos = db.collection('accesos');
        diasEscolares = db.collection('diasEscolares');
        anuncios = db.collection('anuncios');
        horarios = db.collection('horarios');
        avisos = db.collection('avisos');
        const areasBase = ['Programaci\u00f3n', 'Ofim\u00e1tica', 'Enfermer\u00eda', 'Electricidad', 'Laboratorios Qu\u00edmicos', 'Administraci\u00f3n'];
        for (const semestre of ['1-2 semestre', '3-4 semestre', '5-6 semestre']) for (const area of areasBase) for (const grupo of ['A', 'B', 'C']) {
            const id = `${semestre}|${area}|${grupo}`;
            await grupos.updateOne({ _id: id }, { $setOnInsert: { semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` } }, { upsert: true });
        }
        suscripcionesPush = db.collection('suscripcionesPush');
        recordatoriosPush = db.collection('recordatoriosPush');
        solicitudesRecuperacion = db.collection('solicitudesRecuperacion');
        auditoria = db.collection('auditoria');
        avisosLeidos = db.collection('avisosLeidos');
        reportesConducta = db.collection('reportesConducta');
        citatorios = db.collection('citatorios');
        const [reportesAnulados, citatoriosAnulados] = await Promise.all([
            reportesConducta.find({ estado: 'anulado' }).project({ _id: 1 }).toArray(),
            citatorios.find({ estado: 'anulado' }).project({ _id: 1 }).toArray()
        ]);
        if (reportesAnulados.length || citatoriosAnulados.length) {
            await Promise.all([
                reportesConducta.deleteMany({ estado: 'anulado' }),
                citatorios.deleteMany({ estado: 'anulado' })
            ]);
            const origenes = [
                ...reportesAnulados.flatMap(x => [`reporte:${x._id}`, `reporte-confirmado:${x._id}`]),
                ...citatoriosAnulados.map(x => `citatorio:${x._id}`)
            ];
            if (origenes.length) await avisos.deleteMany({ $or: [{ origenId: { $in: origenes } }, { _id: { $in: origenes } }] });
            console.log(`Se eliminaron ${reportesAnulados.length} reportes y ${citatoriosAnulados.length} citatorios anulados antiguos.`);
        }
        await solicitudesRecuperacion.createIndex({ curp: 1, rol: 1, estado: 1 });
        await asistencias.createIndex({ curp: 1, fecha: -1 });
        await reportesConducta.createIndex({ curp: 1, creado: -1 });
        await reportesConducta.createIndex({ reportanteId: 1, creado: -1 });
        await avisosLeidos.createIndex({ anuncioId: 1, rol: 1, para: 1 }, { unique: true });
        await auditoria.createIndex({ creado: -1 });
        try {   // una CURP solo puede existir una vez, sin importar el tipo de cuenta
            await usuarios.createIndex({ curp: 1 }, { unique: true, name: 'curp_unica', partialFilterExpression: { curp: { $type: 'string' } } });
        } catch (e) {
            const repetidas = await usuarios.aggregate([{ $match: { curp: { $type: 'string' } } }, { $group: { _id: '$curp', n: { $sum: 1 }, roles: { $push: '$rol' } } }, { $match: { n: { $gt: 1 } } }]).toArray();
            console.error('⚠️ No se pudo crear el índice curp_unica. Hay CURP repetidas; bórralas desde Cuentas:', repetidas.map(r => `${r._id} (${r.roles.join(', ')})`).join('; ') || e.message);
        }

        console.log('✅ Conexión exitosa a MongoDB Atlas');
        console.log('🦈 Base de datos: SHARK-DARK');
        app.listen(PORT, () => {
            console.log(`🚀 Shark Dark está disponible en http://localhost:${PORT}`);
            setInterval(() => revisarRecordatoriosClase().catch(e => console.warn('Recordatorios push:', e.message)), 20000);
        });
    } catch (error) {
        console.error('❌ Error al conectar con MongoDB Atlas:');
        console.error(error.message);
        console.error('Pista: si dice SSL/alert 80, revisa Network Access (0.0.0.0/0) y que el host de arriba sea el de tu cluster actual.');
        await cliente.close().catch(() => {});
        process.exit(1);
    }
}

iniciarServidor();
