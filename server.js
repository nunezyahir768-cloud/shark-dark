const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
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

let usuarios, asistencias;

/* CURPs que cada rol puede ver: docente = todas, alumno = la suya, tutor = la de su alumno */
async function permitidas(u) {
    if (u.rol === 'docente') return null;
    if (u.rol === 'alumno') return [u.id];
    const t = await usuarios.findOne({ _id: 'tutor:' + u.id });
    return t && t.curpAlumno ? [t.curpAlumno] : [];
}

/* ---------- Registro y login ---------- */
app.post('/api/registro', h(async (req, res) => {
    const { rol, datos: d = {} } = req.body || {};
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Rol inválido');
    const id = s(rol === 'docente' ? d.rfc : d.curp).toUpperCase();
    if (!(rol === 'docente' ? RX.rfc : RX.curp).test(id)) return bad(res, rol === 'docente' ? 'RFC inválido' : 'CURP inválida');
    const pw = String(d.password ?? '');
    if (s(d.nombre).length < 3) return bad(res, 'Nombre inválido');
    if (!/^\S+@\S+\.\S+$/.test(s(d.correo))) return bad(res, 'Correo inválido');
    if (pw.length < (rol === 'alumno' ? 6 : 8)) return bad(res, 'Contraseña demasiado corta');

    const doc = { _id: `${rol}:${id}`, rol, id, nombre: s(d.nombre), correo: s(d.correo).toLowerCase(), ...hashPw(pw), creado: new Date() };
    if (rol === 'alumno') Object.assign(doc, { curp: id, area: s(d.area), semestre: s(d.semestre), grupo: s(d.grupo) });
    if (rol === 'tutor') {
        const ca = s(d.curpAlumno).toUpperCase();
        if (!RX.curp.test(ca)) return bad(res, 'CURP del alumno inválida');
        Object.assign(doc, { curp: id, curpAlumno: ca });
    }
    if (rol === 'docente') doc.rfc = id;

    try { await usuarios.insertOne(doc); }
    catch (e) { if (e.code === 11000) return bad(res, `Ya existe una cuenta con ese ${rol === 'docente' ? 'RFC' : 'CURP'}`, 409); throw e; }
    res.status(201).json({ ok: true });
}));

app.post('/api/login', h(async (req, res) => {
    const { rol, id, password } = req.body || {};
    const u = await usuarios.findOne({ _id: `${s(rol)}:${s(id).toUpperCase()}` });
    if (!u || !okPw(String(password ?? ''), u)) return bad(res, 'Datos incorrectos', 401);
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
    if (!RX.curp.test(curp) || !/^[\w-]{8,64}$/.test(s(a.uid)) || !/^\d{4}-\d{2}-\d{2}$/.test(s(a.fecha)) || !/^\d{2}:\d{2}$/.test(s(a.hora)))
        return bad(res, 'Datos de asistencia inválidos');
    if (!await usuarios.findOne({ _id: 'alumno:' + curp })) return bad(res, 'Alumno no encontrado', 404);
    try {
        await asistencias.insertOne({ _id: s(a.uid), curp, fecha: a.fecha, hora: a.hora, docente: req.u.id, docenteNombre: s(a.docenteNombre) });
    } catch (e) { if (e.code === 11000) return bad(res, 'Ya registrada', 409); throw e; }
    res.status(201).json({ ok: true });
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

    const cliente = new MongoClient(MONGODB_URI);
    try {
        await cliente.connect();
        const db = cliente.db('SharkDark');
        await db.command({ ping: 1 });
        usuarios = db.collection('usuarios');
        asistencias = db.collection('asistencias');
        await asistencias.createIndex({ curp: 1, fecha: -1 });

        console.log('✅ Conexión exitosa a MongoDB Atlas');
        console.log('🦈 Base de datos: SharkDark');
        app.listen(PORT, () => console.log(`🚀 Shark Dark está disponible en http://localhost:${PORT}`));
    } catch (error) {
        console.error('❌ Error al conectar con MongoDB Atlas:');
        console.error(error.message);
        await cliente.close().catch(() => {});
        process.exit(1);
    }
}

iniciarServidor();
