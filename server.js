const dns = require('node:dns');
if (!process.env.RENDER) dns.setServers(['8.8.8.8', '1.1.1.1']);   // solo en tu computadora
dns.setDefaultResultOrder('ipv4first');                            // evita fallos TLS por IPv6

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');
const { crearTicketOffline } = require('./offline-auth');

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
const auth = (req, res, next) => {
    const p = leer((req.headers.authorization || '').replace('Bearer ', ''));
    if (!p) return bad(res, 'Sesión expirada', 401);
    req.u = p; next();
};
const soloAdmin = (req, res, next) => req.u.rol === 'admin' ? next() : bad(res, 'Solo administración', 403);
const publico = ({ salt, hash, _id, ...r }) => r;

let usuarios, asistencias, avisos, calificaciones, grupos, clases, permisos, anuncios, horarios, solicitudesRecuperacion, auditoria, avisosLeidos, reportesConducta;
const intentosRecuperacion = new Map();
const validaPassword = pw => typeof pw === 'string' && pw.length >= 10 && pw.length <= 128;
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
        try { await avisos.insertOne({ _id: `${tipo}:${clave}:${tu.id}`, para: tu.id, curp: alumno.curp, tipo, materia, texto, fecha, hora, creado: new Date() }); }
        catch (e) { if (e.code !== 11000) throw e; }
    }
}

/* ---------- Registro y login con CURP + contraseña ---------- */
const ADMIN_CURP = (process.env.ADMIN_CURP || '').toUpperCase();
app.post('/api/login', h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), rol = s(req.body.rol), password = String(req.body.password || '');
    const llave = 'ip:' + req.ip;
    if (bloqueado(llave, 40)) return bad(res, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo', 429);
    if (rol === 'admin') {
        if (!RX.curp.test(ADMIN_CURP)) return bad(res, 'El acceso de Control Escolar no está configurado. Contacta al administrador del sistema.', 503);
        const admin = id === ADMIN_CURP ? await usuarios.findOne({ _id: 'admin:' + ADMIN_CURP, rol: 'admin' }) : null;
        if (!admin || !admin.salt || !admin.hash || !password || !okPw(password, admin)) {
            fallo(llave);
            return bad(res, 'CURP o contraseña incorrectas', 401);
        }
        fallos.delete(llave);
        const datos = publico(admin);
        const usuario = { ...datos, id: ADMIN_CURP, curp: ADMIN_CURP, rol: 'admin', debeCambiarPassword: !!admin.debeCambiarPassword };
        return res.json({ token: firmar({ id: ADMIN_CURP, rol: 'admin', nombre: admin.nombre, exp: Date.now() + 12 * 3600e3 }), usuario, offlineTicket: await firmarOffline(usuario) });
    }
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Elige cómo quieres entrar');
    if (!RX.curp.test(id) || !password) return bad(res, 'Escribe una CURP válida y tu contraseña');
    const u = await usuarios.findOne({ _id: `${rol}:${id}`, rol });
    if (!u || !u.salt || !u.hash) { fallo(llave); return bad(res, 'Cuenta sin contraseña configurada. Solicita a Servicios Escolares que la habilite.', 401); }
    if (!okPw(password, u)) { fallo(llave); return bad(res, 'CURP o contraseña incorrectas', 401); }
    fallos.delete(llave);
    const rolReal = u.rol === 'admin' ? 'admin' : rol;
    const datos = publico(u);
    const usuario = { ...datos, rol: rolReal, debeCambiarPassword: !!u.debeCambiarPassword };
    res.json({ token: firmar({ id: u.id, rol: rolReal, exp: Date.now() + 12 * 3600e3 }), usuario, offlineTicket: await firmarOffline(usuario) });
}));

/* Alumnos, tutores y docentes activan cuentas previamente dadas de alta. */
const activarCuenta = h(async (req, res) => {
    const rol = s(req.body.rol);
    const curp = s(req.body.curp).toUpperCase(), nombre = s(req.body.nombre).replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
    const password = String(req.body.password || ''), confirmar = String(req.body.confirmar || '');
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(curp)) return bad(res, 'Escribe una CURP válida de 18 caracteres');
    if (!validaPassword(password)) return bad(res, 'La contraseña debe tener entre 10 y 128 caracteres');
    if (password !== confirmar) return bad(res, 'Las contraseñas no coinciden');
    const llave = 'activar:' + req.ip;
    if (bloqueado(llave, 8)) return bad(res, 'Demasiados intentos. Espera 15 minutos.', 429);
    const cuenta = await usuarios.findOne({ _id: `${rol}:${curp}`, rol });
    const nombreGuardado = s(cuenta?.nombre).replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
    if (!cuenta || !cuenta.debeCambiarPassword || !nombre || nombre !== nombreGuardado) {
        fallo(llave); return bad(res, 'No se pudo validar la cuenta. Revisa tu CURP y nombre o solicita ayuda a Servicios Escolares.', 401);
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
        if (!pendiente) await solicitudesRecuperacion.insertOne({ curp: id, rol, nombre: cuenta.nombre, estado: 'pendiente', creado: new Date(), ipHash: crypto.createHash('sha256').update(req.ip || '').digest('hex') });
    }
    res.json({ ok: true, mensaje: 'Si los datos corresponden a una cuenta, la solicitud fue enviada a Servicios Escolares.' });
}));

app.post('/api/cambiar-password', auth, h(async (req, res) => {
    const actual = String(req.body.actual || ''), nueva = String(req.body.nueva || '');
    if (!validaPassword(nueva)) return bad(res, 'La nueva contraseña debe tener entre 10 y 128 caracteres');
    const rol = req.u.rol === 'admin' ? 'admin' : req.u.rol;
    const u = await usuarios.findOne({ _id: `${rol}:${req.u.id}` });
    if (!u || !u.salt || !okPw(actual, u)) return bad(res, 'La contraseña actual no es correcta', 401);
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
    if (!['docente', 'admin'].includes(req.u.rol)) return bad(res, 'Solo docentes y administración pueden crear reportes', 403);
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
    if (confirmado) await registrarCambio(req, 'Reporte de conducta confirmado', `${alumno.nombre} · ${lugar}`);
    res.status(201).json({ ok: true, id, estado: reporte.estado });
}));
app.get('/api/reportes-conducta', auth, h(async (req, res) => {
    let filtro;
    if (req.u.rol === 'admin') filtro = {};
    else if (req.u.rol === 'docente') filtro = { reportanteId: req.u.id };
    else if (req.u.rol === 'alumno') filtro = { curp: req.u.id };
    else if (req.u.rol === 'tutor') filtro = { curp: { $in: await permitidas(req.u) } };
    else return bad(res, 'No tienes permiso para ver reportes', 403);
    const lista = await reportesConducta.find(filtro).sort({ creado: -1 }).limit(500).toArray();
    res.json(lista.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/reportes-conducta/:id/aceptar', auth, soloAdmin, h(async (req, res) => {
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
    res.json({ ok: true });
}));

/* ---------- Asistencias (idempotentes por uid) ---------- */
app.post('/api/asistencias', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const a = req.body || {}, curp = s(a.curp).toUpperCase();
    if (!RX.curp.test(curp) || !/^[\w-]{8,64}$/.test(s(a.uid)) || !/^\d{4}-\d{2}-\d{2}$/.test(s(a.fecha)) || !/^\d{2}:\d{2}$/.test(s(a.hora)) || !limpiaMat(a.materia))
        return bad(res, 'Datos de asistencia inválidos');
    const materia = limpiaMat(a.materia), key = materia.toLowerCase();
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp });
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
    if (req.params.accion === 'quitar') {
        await asistencias.deleteOne({ _id: reg._id });
    } else if (req.params.accion === 'justificar' && reg.estado === 'falta') {
        const motivo = s((req.body || {}).motivo).slice(0, 200);
        await asistencias.updateOne({ _id: reg._id }, { $set: { estado: 'justificada', motivo } });
        const al = await usuarios.findOne({ _id: 'alumno:' + reg.curp });
        if (al) await avisar(al, 'justificada', reg.hora, reg.fecha, `${reg._id}`, reg.materia, `Falta de ${al.nombre} en ${reg.materia} justificada${motivo ? ' (' + motivo + ')' : ''}`);
    } else return bad(res, 'Acción inválida');
    res.json({ ok: true });
}));

/* ---------- Administración ---------- */
app.get('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const l = await usuarios.find({ rol: { $in: ['alumno', 'docente', 'tutor'] } }).limit(3000).toArray();
    res.json(l.map(publico));
}));
app.get('/api/admin/historial', auth, soloAdmin, h(async (req, res) => {
    const l = await auditoria.find({}).sort({ creado: -1 }).limit(300).toArray();
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.get('/api/admin/recuperaciones', auth, soloAdmin, h(async (req, res) => {
    const l = await solicitudesRecuperacion.find({ estado: 'pendiente' }).sort({ creado: 1 }).limit(200).toArray();
    res.json(l.map(({ _id, ipHash, ...r }) => ({ id: _id, ...r })));
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
    const temporal = generaTemporal(), hp = hashPw(temporal);
    const cuenta = await usuarios.findOne({ _id: `${solicitud.rol}:${solicitud.curp}` });
    if (!cuenta) return bad(res, 'La cuenta ya no existe', 404);
    await usuarios.updateOne({ _id: cuenta._id }, { $set: { ...hp, debeCambiarPassword: true, passwordActualizada: new Date() } });
    await solicitudesRecuperacion.updateOne({ _id: solicitud._id }, { $set: { estado: 'restablecida', resuelta: new Date(), resueltaPor: req.u.id } });
    await registrarCambio(req, 'Restablecimiento de contraseña', `${solicitud.rol} · ${solicitud.curp}`);
    res.json({ ok: true, passwordTemporal: temporal });
}));
app.post('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const d = req.body || {}, rol = s(d.rol), id = s(d.id).toUpperCase();
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(id)) return bad(res, 'CURP inválida (18 letras y números)');
    if (ADMIN_CURP && id === ADMIN_CURP) return bad(res, 'Esa CURP está reservada para Servicios Escolares');
    if (s(d.nombre).length < 3) return bad(res, 'Escribe el nombre completo');
    const temporal = generaTemporal();
    const hp = hashPw(temporal);
    const doc = { _id: `${rol}:${id}`, rol, id, curp: id, nombre: s(d.nombre), ...hp, debeCambiarPassword: true, creado: new Date() };
    if (rol === 'alumno') {            // el grupo se crea solo la primera vez que se usa
        const semestre = s(d.semestre).slice(0, 20), area = s(d.area).slice(0, 40), grupo = s(d.grupo).toUpperCase().slice(0, 3);
        if (!semestre || !area || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Elige el semestre, el área y el grupo (A, B o C)');
        Object.assign(doc, { area, semestre, grupo, tutores: [] });
    }
    if (rol === 'tutor') doc.hijos = [];
    try { await usuarios.insertOne(doc); } catch (e) { if (e.code === 11000) return bad(res, 'Ya existe esa cuenta', 409); throw e; }
    if (rol === 'alumno') await grupos.updateOne({ _id: `${doc.semestre}|${doc.area}|${doc.grupo}` }, { $set: { semestre: doc.semestre, area: doc.area, grupo: doc.grupo, nombre: `${doc.semestre} ${doc.area} ${doc.grupo}` } }, { upsert: true });
    await registrarCambio(req, 'Cuenta creada', `${rol} · ${id}`);
    res.status(201).json({ ok: true, passwordTemporal: temporal });
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
app.post('/api/admin/grupos/borrar', auth, soloAdmin, h(async (req, res) => {
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
    await clases.deleteMany(filtro); await horarios.deleteMany(filtro); await grupos.deleteOne({ _id: g._id });
    await registrarCambio(req, 'Grupo eliminado', `${g.semestre} ${g.area} ${g.grupo} · ${curps.length} alumnos`);
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
app.post('/api/admin/horarios', auth, soloAdmin, h(async (req, res) => {
    const b = req.body || {}, area = s(b.area), semestre = s(b.semestre), grupo = s(b.grupo).toUpperCase(), dia = Number(b.dia), tipo = b.tipo === 'descanso' ? 'descanso' : 'clase', HM = /^\d{2}:\d{2}$/;
    if (!await grupos.findOne({ _id: `${semestre}|${area}|${grupo}` })) return bad(res, 'Grupo inválido');
    if (tipo === 'clase' && s(b.inicio) < '10:00' && s(b.fin) > '09:30') return bad(res, 'Ese horario choca con el descanso fijo (9:30 a 10:00)');
    if (!(dia >= 1 && dia <= 6) || !HM.test(s(b.inicio)) || !HM.test(s(b.fin)) || s(b.fin) <= s(b.inicio)) return bad(res, 'Revisa el día y las horas');
    const doc = { _id: crypto.randomBytes(5).toString('hex'), area, semestre, grupo, dia, inicio: s(b.inicio), fin: s(b.fin), tipo, materia: 'Descanso', claseId: '', docente: '', docenteNombre: '' };
    if (tipo === 'clase') {
        const cl = await clases.findOne({ _id: s(b.claseId).toUpperCase() });
        if (!cl || `${cl.area}|${cl.semestre}|${cl.grupo}` !== `${area}|${semestre}|${grupo}`) return bad(res, 'Elige una clase de ese grupo');
        Object.assign(doc, { materia: cl.materia, claseId: cl._id, docente: cl.docente, docenteNombre: cl.docenteNombre });
    }
    await horarios.insertOne(doc);
    const diaNombre = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dia];
    await registrarCambio(req, 'Horario añadido', `${diaNombre} · ${doc.materia} · ${semestre} ${area} ${grupo} · ${doc.inicio}-${doc.fin}`);
    res.status(201).json({ ok: true });
}));
app.post('/api/admin/horarios/borrar', auth, soloAdmin, h(async (req, res) => {
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
const DESTINOS = { tutor: ['tutor'], docente: ['docente'], alumno: ['alumno'], 'alumno,docente': ['alumno', 'docente'], 'tutor,alumno': ['tutor', 'alumno'], 'tutor,docente': ['tutor', 'docente'], todos: ['tutor', 'docente', 'alumno'] };
app.post('/api/anuncios', auth, soloAdmin, h(async (req, res) => {
    const titulo = s(req.body.titulo).slice(0, 80), mensaje = s(req.body.mensaje).slice(0, 1000), para = DESTINOS[s(req.body.destino)];
    if (!titulo || !mensaje || !para) return bad(res, 'Escribe el título, el mensaje y elige a quién va');
    const id = crypto.randomBytes(5).toString('hex');
    await anuncios.insertOne({ _id: id, titulo, mensaje, para, creado: new Date(), por: req.u.id });
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
app.post('/api/anuncios/:id/borrar', auth, soloAdmin, h(async (req, res) => {
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
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const m = limpiaMat(req.body.materia), key = m.toLowerCase(), p = Number(req.body.parcial), notas = req.body.notas;
    if (!m || ![1, 2, 3].includes(p) || !Array.isArray(notas)) return bad(res, 'Datos inválidos');
    const hoy = new Date().toISOString().slice(0, 10); let n = 0;
    for (const x of notas.slice(0, 200)) {
        const curp = s(x.curp).toUpperCase(), nota = Number(x.nota);
        if (!RX.curp.test(curp) || !(nota >= 0 && nota <= 10)) continue;
        const al = await usuarios.findOne({ _id: 'alumno:' + curp }); if (!al) continue;
        await calificaciones.updateOne({ _id: `C:${curp}:${key}:${p}` }, { $set: { curp, materia: m, materiaKey: key, parcial: p, nota, docente: req.u.id } }, { upsert: true });
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
app.post('/api/permisos/:id/resolver', auth, soloAdmin, h(async (req, res) => {
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

app.get('/api/avisos', auth, h(async (req, res) => {
    if (req.u.rol !== 'tutor') return res.json([]);
    const lista = await avisos.find({ para: req.u.id }).sort({ creado: -1 }).limit(100).toArray();
    res.json(lista.map(({ _id, para, ...r }) => ({ id: _id, ...r })));
}));

app.get('/api/asistencias', auth, h(async (req, res) => {
    const c = await permitidas(req.u), q = c ? { curp: { $in: c } } : {};
    const lista = await asistencias.find(q).sort({ fecha: -1, hora: -1 }).limit(5000).toArray();
    res.json(lista.map(({ _id, ...r }) => ({ uid: _id, ...r })));
}));

app.get('/control-escolar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------- Arranque ---------- */
async function iniciarServidor() {
    if (!MONGODB_URI) { console.error('Error: No se encontró MONGODB_URI en el archivo .env'); process.exit(1); }
    if (!RX.curp.test(ADMIN_CURP)) console.warn('Aviso: define ADMIN_CURP con una CURP válida de 18 caracteres para habilitar Control Escolar.');
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
        if (ADMIN_CURP) {
            const adminId = 'admin:' + ADMIN_CURP;
            const adminActual = await usuarios.findOne({ _id: adminId });
            const inicial = process.env.ADMIN_INITIAL_PASSWORD || '';
            if ((!adminActual || !adminActual.hash || !adminActual.salt) && validaPassword(inicial)) {
                const cred = { rol: 'admin', id: ADMIN_CURP, curp: ADMIN_CURP, nombre: 'Servicios Escolares', ...hashPw(inicial), debeCambiarPassword: true, creado: adminActual?.creado || new Date() };
                await usuarios.updateOne({ _id: adminId }, { $set: cred }, { upsert: true });
                console.log('Credenciales iniciales de Servicios Escolares configuradas; cambia la contraseña al entrar.');
            } else if (!adminActual || !adminActual.hash) console.warn('Define ADMIN_INITIAL_PASSWORD (10+ caracteres) para habilitar la cuenta de Servicios Escolares.');
        }
        asistencias = db.collection('asistencias');
        calificaciones = db.collection('calificaciones');
        grupos = db.collection('grupos');
        clases = db.collection('clases');
        permisos = db.collection('permisos');
        anuncios = db.collection('anuncios');
        horarios = db.collection('horarios');
        avisos = db.collection('avisos');
        solicitudesRecuperacion = db.collection('solicitudesRecuperacion');
        auditoria = db.collection('auditoria');
        avisosLeidos = db.collection('avisosLeidos');
        reportesConducta = db.collection('reportesConducta');
        await solicitudesRecuperacion.createIndex({ curp: 1, rol: 1, estado: 1 });
        await asistencias.createIndex({ curp: 1, fecha: -1 });
        await reportesConducta.createIndex({ curp: 1, creado: -1 });
        await reportesConducta.createIndex({ reportanteId: 1, creado: -1 });
        await avisosLeidos.createIndex({ anuncioId: 1, rol: 1, para: 1 }, { unique: true });
        await auditoria.createIndex({ creado: -1 });

        console.log('✅ Conexión exitosa a MongoDB Atlas');
        console.log('🦈 Base de datos: SHARK-DARK');
        app.listen(PORT, () => console.log(`🚀 Shark Dark está disponible en http://localhost:${PORT}`));
    } catch (error) {
        console.error('❌ Error al conectar con MongoDB Atlas:');
        console.error(error.message);
        console.error('Pista: si dice SSL/alert 80, revisa Network Access (0.0.0.0/0) y que el host de arriba sea el de tu cluster actual.');
        await cliente.close().catch(() => {});
        process.exit(1);
    }
}

iniciarServidor();
