const dns = require('node:dns');
if (!process.env.RENDER) dns.setServers(['8.8.8.8', '1.1.1.1']);   // solo en tu computadora
dns.setDefaultResultOrder('ipv4first');                            // evita fallos TLS por IPv6

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');

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
app.get('/', (req, res) => res.redirect('/entrada.html'));

/* ---------- Utilidades ---------- */
const s = v => String(v ?? '').trim();
const RX = { curp: /^[A-Z0-9]{18}$/, rfc: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/ };
const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });
const limpiaMat = v => s(v).replace(/\s+/g, ' ').slice(0, 60);
/* Límite de intentos de login: 8 fallos por cuenta cada 15 minutos */
const fallos = new Map();
const bloqueado = k => { const f = fallos.get(k); return f && f.c >= 8 && Date.now() - f.t < 15 * 60e3; };
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
const publico = ({ salt, hash, _id, ...r }) => r;

let usuarios, asistencias, avisos, calificaciones, grupos, clases, permisos;

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
const esMiClase = async (doc, area, semestre, grupo, materia) => (await clases.find({ docente: doc }).toArray())
    .some(c => c.area === area && c.semestre === semestre && c.grupo === grupo && c.materia.toLowerCase() === String(materia).toLowerCase());

async function avisar(alumno, tipo, hora, fecha, clave, materia, extra) {
    const cand = [...await usuarios.find({ rol: 'tutor', hijos: alumno.curp }).toArray(), ...await usuarios.find({ rol: 'tutor', curpAlumno: alumno.curp }).toArray()];
    const tutores = cand.filter((x, i) => cand.findIndex(y => y.id === x.id) === i && vinculoOk(x, alumno));
    for (const tu of tutores) {
        const texto = extra || (tipo === 'falta' ? `${alumno.nombre} faltó a ${materia}` : `${alumno.nombre} asistió a ${materia} (${hora})`);
        try { await avisos.insertOne({ _id: `${tipo}:${clave}:${tu.id}`, para: tu.id, curp: alumno.curp, tipo, materia, texto, fecha, hora, creado: new Date() }); }
        catch (e) { if (e.code !== 11000) throw e; }
    }
}

/* ---------- Registro y login ---------- */
app.post('/api/registro', h(async (req, res) => {
    const { rol, datos: d = {} } = req.body || {};
    if (!['alumno', 'docente', 'tutor', 'admin'].includes(rol)) return bad(res, 'Rol inválido');
    const campo = { docente: 'rfc', admin: 'usuario' }[rol] || 'curp';
    const id = s(d[campo]).toUpperCase();
    if (!({ docente: RX.rfc, admin: /^[A-Z0-9_]{4,20}$/ }[rol] || RX.curp).test(id)) return bad(res, { docente: 'RFC inválido', admin: 'Usuario inválido (4 a 20 letras, números o _)' }[rol] || 'CURP inválida');
    const pw = String(d.password ?? '');
    if (s(d.nombre).length < 3) return bad(res, 'Nombre inválido');
    if (!/^\S+@\S+\.\S+$/.test(s(d.correo))) return bad(res, 'Correo inválido');
    if (pw.length < (rol === 'alumno' ? 6 : 8)) return bad(res, 'Contraseña demasiado corta');

    if (rol === 'docente' || rol === 'admin') {   // solo se registra quien tenga el código
        const env = rol === 'admin' ? 'CODIGO_ADMIN' : 'CODIGO_DOCENTE';
        if (!process.env[env]) return bad(res, `El registro aún no está habilitado (falta ${env} en el servidor)`, 403);
        if (s(d.codigo) !== process.env[env]) return bad(res, 'Código incorrecto', 403);
    }
    const doc = { _id: `${rol}:${id}`, rol, id, nombre: s(d.nombre), correo: s(d.correo).toLowerCase(), ...hashPw(pw), creado: new Date() };
    if (rol === 'alumno') {
        const tc = s(d.tutorCurp).toUpperCase();
        if (tc && !RX.curp.test(tc)) return bad(res, 'CURP del tutor inválida');
        Object.assign(doc, { curp: id, area: s(d.area), semestre: s(d.semestre), grupo: s(d.grupo), tutores: tc ? [tc] : [] });
    }
    if (rol === 'tutor') {
        const ca = s(d.curpAlumno).toUpperCase();
        if (ca && !RX.curp.test(ca)) return bad(res, 'CURP del alumno inválida');
        Object.assign(doc, { curp: id, hijos: ca ? [ca] : [] });
    }
    if (rol === 'docente') doc.rfc = id;

    try { await usuarios.insertOne(doc); }
    catch (e) { if (e.code === 11000) return bad(res, `Ya existe una cuenta con ese ${rol === 'docente' ? 'RFC' : 'CURP'}`, 409); throw e; }
    res.status(201).json({ ok: true });
}));

app.post('/api/login', h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), password = String(req.body.password ?? ''), rol = s(req.body.rol);
    if (!['alumno', 'tutor', 'docente', 'admin'].includes(rol)) return bad(res, 'Elige cómo quieres entrar');
    const llave = `${req.ip}|${rol}:${id}`;
    if (bloqueado(llave)) return bad(res, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo', 429);
    const u = await usuarios.findOne({ _id: `${rol}:${id}` });
    if (!u || !okPw(password, u)) { fallo(llave); return bad(res, 'Usuario o contraseña incorrectos', 401); }
    fallos.delete(llave);
    res.json({ token: firmar({ id: u.id, rol: u.rol, exp: Date.now() + 30 * 864e5 }), usuario: publico(u) });
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

/* ---------- Asistencias (idempotentes por uid) ---------- */
app.post('/api/asistencias', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const a = req.body || {}, curp = s(a.curp).toUpperCase();
    if (!RX.curp.test(curp) || !/^[\w-]{8,64}$/.test(s(a.uid)) || !/^\d{4}-\d{2}-\d{2}$/.test(s(a.fecha)) || !/^\d{2}:\d{2}$/.test(s(a.hora)) || !limpiaMat(a.materia))
        return bad(res, 'Datos de asistencia inválidos');
    const materia = limpiaMat(a.materia), key = materia.toLowerCase();
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    if (!await esMiClase(req.u.id, alumno.area, alumno.semestre, alumno.grupo, materia)) return bad(res, 'Esa materia no es tuya o el alumno no es de ese grupo', 403);
    try {
        await asistencias.insertOne({ _id: s(a.uid), curp, fecha: a.fecha, hora: a.hora, estado: 'asistio', materia, materiaKey: key, docente: req.u.id, docenteNombre: s(a.docenteNombre) });
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
    if (!await esMiClase(req.u.id, s(area), s(semestre), s(grupo), materia)) return bad(res, 'Esa clase no es tuya', 403);
    const aprobados = await permisos.find({ estado: 'aprobado' }).toArray();
    const alumnos = await usuarios.find({ rol: 'alumno', area: s(area), semestre: s(semestre), grupo: s(grupo) }).toArray();
    const presentes = new Set((await asistencias.find({ fecha, estado: 'asistio', materiaKey: key }).toArray()).map(a => a.curp));
    let faltas = 0;
    for (const al of alumnos.filter(x => !presentes.has(x.curp))) {
        const p = aprobados.find(x => x.curp === al.curp && x.desde <= fecha && fecha <= x.hasta);
        try {
            await asistencias.insertOne({ _id: `F:${al.curp}:${fecha}:${key}`, curp: al.curp, fecha, hora, estado: p ? 'justificada' : 'falta', motivo: p ? 'Permiso: ' + p.motivo : undefined, materia, materiaKey: key, docente: req.u.id, docenteNombre: s(req.body.docenteNombre) });
            if (!p) faltas++;
        } catch (e) { if (e.code !== 11000) throw e; }
        if (p) await avisar(al, 'justificada', hora, fecha, `${al.curp}:${fecha}:${key}`, materia, `${al.nombre} no asistió a ${materia}: justificado por permiso`);
        else await avisar(al, 'falta', hora, fecha, `${al.curp}:${fecha}:${key}`, materia);
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
const soloAdmin = (req, res, next) => req.u.rol === 'admin' ? next() : bad(res, 'Solo administración', 403);
app.get('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const l = await usuarios.find({ rol: { $in: ['alumno', 'docente', 'tutor'] } }).limit(3000).toArray();
    res.json(l.map(publico));
}));
app.post('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const d = req.body || {}, rol = s(d.rol), id = s(d.id).toUpperCase(), pw = String(d.password ?? '');
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!(rol === 'docente' ? RX.rfc : RX.curp).test(id)) return bad(res, rol === 'docente' ? 'RFC inválido (13 caracteres)' : 'CURP inválida (18 caracteres)');
    if (s(d.nombre).length < 3 || pw.length < 6) return bad(res, 'Escribe el nombre y una contraseña de 6 o más caracteres');
    const doc = { _id: `${rol}:${id}`, rol, id, nombre: s(d.nombre), correo: (s(d.correo) || id.toLowerCase() + '@correo.local').toLowerCase(), ...hashPw(pw), creado: new Date() };
    if (rol === 'alumno') {
        const g = await grupos.findOne({ _id: `${s(d.semestre)}|${s(d.area)}|${s(d.grupo).toUpperCase()}` });
        if (!g) return bad(res, 'Elige un grupo válido');
        Object.assign(doc, { curp: id, area: g.area, semestre: g.semestre, grupo: g.grupo });
    }
    if (rol === 'tutor') {
        const ca = s(d.curpAlumno).toUpperCase();
        if (ca && !RX.curp.test(ca)) return bad(res, 'CURP del alumno inválida');
        Object.assign(doc, { curp: id, hijos: ca ? [ca] : [] });
    }
    if (rol === 'docente') doc.rfc = id;
    try { await usuarios.insertOne(doc); } catch (e) { if (e.code === 11000) return bad(res, 'Ya existe esa cuenta', 409); throw e; }
    if (rol === 'tutor' && doc.hijos.length) await usuarios.updateOne({ _id: 'alumno:' + doc.hijos[0] }, { $addToSet: { tutores: id } });
    res.status(201).json({ ok: true });
}));
app.post('/api/admin/reset', auth, soloAdmin, h(async (req, res) => {
    const u = await usuarios.findOne({ _id: `${s(req.body.rol)}:${s(req.body.id).toUpperCase()}` });
    if (!u || u.rol === 'admin') return bad(res, 'Usuario no encontrado', 404);
    const temporal = crypto.randomBytes(5).toString('hex');
    await usuarios.updateOne({ _id: u._id }, { $set: hashPw(temporal) });
    res.json({ temporal });
}));
app.post('/api/admin/editar', auth, soloAdmin, h(async (req, res) => {
    const id = 'alumno:' + s(req.body.id).toUpperCase(), c = {};
    for (const k of ['area', 'semestre', 'grupo']) if (s(req.body[k])) c[k] = s(req.body[k]).slice(0, 40);
    if (!await usuarios.findOne({ _id: id })) return bad(res, 'Alumno no encontrado', 404);
    await usuarios.updateOne({ _id: id }, { $set: c });
    res.json({ ok: true });
}));
app.post('/api/admin/borrar', auth, soloAdmin, h(async (req, res) => {
    const u = await usuarios.findOne({ _id: `${s(req.body.rol)}:${s(req.body.id).toUpperCase()}` });
    if (!u || u.rol === 'admin') return bad(res, 'Usuario no encontrado', 404);
    await usuarios.deleteOne({ _id: u._id });
    res.json({ ok: true });
}));

/* ---------- Grupos y clases (materia + grupo + docente) ---------- */
app.get('/api/grupos', h(async (req, res) => {
    res.json((await grupos.find({}).limit(500).toArray()).map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/grupos', auth, soloAdmin, h(async (req, res) => {
    const semestre = s(req.body.semestre).slice(0, 12), area = s(req.body.area).slice(0, 40), grupo = s(req.body.grupo).toUpperCase().slice(0, 3);
    if (!semestre || !area || !grupo) return bad(res, 'Datos inválidos');
    try { await grupos.insertOne({ _id: `${semestre}|${area}|${grupo}`, semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` }); }
    catch (e) { if (e.code === 11000) return bad(res, 'Ese grupo ya existe', 409); throw e; }
    res.status(201).json({ ok: true });
}));
app.post('/api/admin/grupos/borrar', auth, soloAdmin, h(async (req, res) => {
    const g = await grupos.findOne({ _id: s(req.body.id) });
    if (!g) return bad(res, 'Grupo no encontrado', 404);
    await grupos.deleteOne({ _id: g._id });
    await clases.deleteMany({ area: g.area, semestre: g.semestre, grupo: g.grupo });
    res.json({ ok: true });
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
    await clases.insertOne({ _id: id, materia, area, semestre, grupo, docente: doc, docenteNombre: d.nombre });
    res.status(201).json({ ok: true, id });
}));
app.post('/api/admin/clases/borrar', auth, soloAdmin, h(async (req, res) => {
    await clases.deleteOne({ _id: s(req.body.id).toUpperCase() });
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
app.post('/api/cuenta/password', auth, h(async (req, res) => {
    const u = await usuarios.findOne({ _id: `${req.u.rol}:${req.u.id}` });
    if (!u || !okPw(String(req.body.actual ?? ''), u)) return bad(res, 'La contraseña actual no es correcta', 401);
    if (String(req.body.nueva ?? '').length < 6) return bad(res, 'La nueva contraseña debe tener al menos 6 caracteres');
    await usuarios.updateOne({ _id: u._id }, { $set: hashPw(String(req.body.nueva)) });
    res.json({ ok: true });
}));
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
        l = (await permisos.find({}).limit(1000).toArray()).filter(p => gs.has(claveG(p)));
    } else if (req.u.rol === 'admin') l = await permisos.find({}).limit(500).toArray();
    else l = await permisos.find({ curp: req.u.id }).limit(200).toArray();
    res.json(l.sort((a, b) => new Date(b.creado) - new Date(a.creado)).slice(0, 100).map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/permisos/:id/resolver', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const p = await permisos.findOne({ _id: s(req.params.id) });
    if (!p) return bad(res, 'Permiso no encontrado', 404);
    if (p.estado !== 'pendiente') return bad(res, 'Ese permiso ya fue resuelto', 409);
    if (!(await clases.find({ docente: req.u.id }).toArray()).some(c => claveG(c) === claveG(p))) return bad(res, 'Ese alumno no es de tus grupos', 403);
    const aprobar = req.body.accion === 'aprobar', estado = aprobar ? 'aprobado' : 'rechazado';
    await permisos.updateOne({ _id: p._id }, { $set: { estado, resueltoPor: req.u.id } });
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

/* ---------- Arranque ---------- */
async function iniciarServidor() {
    if (!MONGODB_URI) { console.error('Error: No se encontró MONGODB_URI en el archivo .env'); process.exit(1); }
    if (!SECRET || SECRET.length < 16) { console.error('Error: define TOKEN_SECRET (mínimo 16 caracteres) en .env'); process.exit(1); }

    const limpia = MONGODB_URI.trim().replace(/^["']|["']$/g, '');
    const host = (limpia.split('@')[1] || '(sin @: revisa el texto)').split('/')[0];
    console.log('Conectando a:', host);
    const cliente = new MongoClient(limpia, { family: 4, serverSelectionTimeoutMS: 20000, tls: true });
    try {
        await cliente.connect();
        const db = cliente.db('SharkDark');
        await db.command({ ping: 1 });
        usuarios = db.collection('usuarios');
        asistencias = db.collection('asistencias');
        calificaciones = db.collection('calificaciones');
        grupos = db.collection('grupos');
        clases = db.collection('clases');
        permisos = db.collection('permisos');
        avisos = db.collection('avisos');
        await asistencias.createIndex({ curp: 1, fecha: -1 });

        console.log('✅ Conexión exitosa a MongoDB Atlas');
        console.log('🦈 Base de datos: SharkDark');
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
