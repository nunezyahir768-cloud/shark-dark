const dns = require('node:dns');
if (!process.env.RENDER) dns.setServers(['8.8.8.8', '1.1.1.1']);   // solo en tu computadora
dns.setDefaultResultOrder('ipv4first');                            // evita fallos TLS por IPv6

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');
const { crearTicketOffline } = require('./offline-auth');
const { areasCoincidentes, areasDuplicadas } = require('./admin-auth');
const { tipoAccesoValido, esMismoAcceso, decidirAcceso, crearRegistroAcceso } = require('./acceso-escolar');
const { fechaHoraMexico, minutosDeHora, decidirRegistroAsistencia, validarAutorizacionCierre } = require('./client/src/asistencia-reglas');
const { validarPeriodo, fechaValida, estadoPeriodo, eventosAutomaticosPeriodo } = require('./periodos-reglas');
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
const SEMESTRES_VALIDOS = ['1 semestre', '2 semestre', '3 semestre', '4 semestre', '5 semestre', '6 semestre'];
const semestresDelPeriodo = periodo => periodo === 'pares' ? ['2 semestre', '4 semestre', '6 semestre'] : ['1 semestre', '3 semestre', '5 semestre'];
const RX = { curp: /^[A-Z0-9]{18}$/, rfc: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/ };
const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });
const limpiaMat = v => s(v).replace(/\s+/g, ' ').slice(0, 60);
/* Límite de intentos de login: 8 fallos por cuenta cada 15 minutos */
const fallos = new Map();
let intentosLogin;
const bloqueado = (k, max = 8) => { const f = fallos.get(k); return f && f.c >= max && Date.now() - f.t < 15 * 60e3; };
const fallo = k => { const f = fallos.get(k); fallos.set(k, f && Date.now() - f.t < 15 * 60e3 ? { c: f.c + 1, t: f.t } : { c: 1, t: Date.now() }); };
const loginBloqueado = async k => { const d = await intentosLogin.findOne({ _id: k }); return !!d && d.vence > new Date() && d.c >= 8; };
const loginFallido = async k => {
    const ahora = new Date(), vence = new Date(Date.now() + 15 * 60e3);
    await intentosLogin.updateOne({ _id: k }, [{ $set: { c: { $cond: [{ $gt: ['$vence', ahora] }, { $add: [{ $ifNull: ['$c', 0] }, 1] }, 1] }, vence: { $cond: [{ $gt: ['$vence', ahora] }, '$vence', vence] } } }], { upsert: true });
};
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
    ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const okPw = (pw, u) => {
    const a = Buffer.from(crypto.scryptSync(pw, u.salt, 64).toString('hex')), b = Buffer.from(u.hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const nuevoCodigoActivacion = () => crypto.randomBytes(9).toString('base64url').toUpperCase();
const hashCodigoActivacion = codigo => crypto.createHash('sha256').update(String(codigo || '').trim().toUpperCase()).digest('hex');
const codigoCoincide = (codigo, hash) => {
    if (!hash || !codigo) return false;
    const a = Buffer.from(hashCodigoActivacion(codigo)), b = Buffer.from(hash);
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
const publico = ({ salt, hash, _id, accessEnvHash, activationCodeHash, sessionId, sessionId_control, sessionId_sara, sessionId_gabriela, sessionId_portero, ...r }) => r;

let usuarios, asistencias, asistenciasPendientes, cierresPendientes, accesosEscuela, accesosEscuelaBloqueos, avisos, calificaciones, grupos, clases, permisos, anuncios, horarios, periodos, solicitudesRecuperacion, auditoria, avisosLeidos, reportesConducta, citatorios, suscripcionesPush;
let recordatoriosPush;
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
async function notificarAlumno(curp, id, titulo, texto, url, incluirTutores = true) {
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const destinatarios = [{ rol: 'alumno', id: curp }];
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
    if (!recordatoriosPush) return;
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dia = dias[partes.weekday], ahora = Number(partes.hour) * 60 + Number(partes.minute);
    if (!dia) return;
    const fecha = `${partes.year}-${partes.month}-${partes.day}`;
    const bloques = await horarios.find({ dia, tipo: 'clase' }).toArray();
    for (const b of bloques) {
        const [hi, mi] = b.inicio.split(':').map(Number), paraInicio = hi * 60 + mi - ahora;
        if (paraInicio === 5) {
            const evento = `escanear:${fecha}:${b._id}`;
            try {
                await recordatoriosPush.insertOne({ _id: evento, creado: new Date() });
                const clase = await clases.findOne({ _id: b.claseId });
                if (clase?.docente) {
                    const texto = `Ya puedes iniciar el escaneo de ${b.materia} · ${b.semestre} ${b.area} ${b.grupo}. La clase empieza a las ${b.inicio}.`;
                    await avisos.updateOne({ _id: evento }, { $setOnInsert: { para: clase.docente, tipo: 'asistencia', texto, fecha, hora: partes.hour + ':' + partes.minute, creado: new Date() } }, { upsert: true });
                    await enviarPush('docente', clase.docente, 'TIBURONES · Escaneo disponible', texto, '/#/asistencia');
                }
            } catch (e) { if (e.code !== 11000) throw e; }
        }
        const [hf, mf] = b.fin.split(':').map(Number), faltanFin = hf * 60 + mf - ahora;
        if (faltanFin === 5) {
            const evento = `${fecha}:${b._id}`;
            try { await recordatoriosPush.insertOne({ _id: evento, creado: new Date() }); }
            catch (e) { if (e.code === 11000) continue; throw e; }
            const alumnos = await usuarios.find({ rol: 'alumno', egresado: { $ne: true }, area: b.area, semestre: b.semestre, grupo: b.grupo }).toArray();
            const siguiente = await horarios.find({ dia, area: b.area, semestre: b.semestre, grupo: b.grupo, inicio: { $gte: b.fin }, tipo: 'clase' }).sort({ inicio: 1 }).limit(1).next();
            const texto = `Tu clase de ${b.materia} termina en 5 minutos.` + (siguiente ? ` Sigue ${siguiente.materia} a las ${siguiente.inicio}.` : ' Es la última clase del día.');
            await Promise.all(alumnos.map(a => enviarPush('alumno', a.id, 'TIBURONES · Próxima clase', texto, '/')));
        }
    }
    await registrarFaltasProgramadas(fecha, dia, ahora);
}
const intentosRecuperacion = new Map();
const validaPassword = pw => typeof pw === 'string' && pw.length >= 4 && pw.length <= 128;
const generaTemporal = () => crypto.randomBytes(9).toString('base64url');
const registrarCambio = (req, accion, detalle, id) => auditoria.insertOne({
    ...(id ? { _id: id } : {}),
    accion, detalle, actor: req.u.id, actorNombre: req.u.nombre || 'Servicios Escolares', creado: new Date()
});

async function periodoActivo() {
    const activo = await periodos.findOne({ _id: 'activo' });
    const fecha = fechaHoraMexico().fecha;
    const porFecha = await periodos.find({ _id: { $ne: 'activo' }, inicioClases: { $lte: fecha }, finClases: { $gte: fecha } }).sort({ inicioClases: -1 }).limit(1).next();
    if (porFecha) return porFecha;
    return activo?.cicloId ? periodos.findOne({ _id: activo.cicloId }) : null;
}

function vistaPeriodo(periodo, fecha = fechaHoraMexico().fecha) {
    const estado = periodo ? estadoPeriodo(periodo, fecha) : null;
    return periodo
        ? {
            ciclo: periodo.ciclo,
            inicioClases: periodo.inicioClases,
            finClases: periodo.finClases,
            diasSinClase: periodo.diasSinClase,
            configurado: true,
            estado,
            parciales: estado.parciales
        }
        : { configurado: false, estado: { configurado: false, enCiclo: false, mensaje: 'Servicios Escolares aún no configura el calendario escolar.', parciales: [] } };
}

async function notificarDocentesPeriodo(periodo, parcial, estado, eventoId, fecha = fechaHoraMexico().fecha) {
    const docentes = await usuarios.find({ rol: 'docente' }).project({ id: 1, nombre: 1 }).toArray();
    const accion = estado === 'abierto' ? 'se abrió' : 'se cerró';
    const texto = `El parcial ${parcial.n} del ciclo ${periodo.ciclo} ${accion}.`;
    for (const docente of docentes) {
        const id = `periodo:${eventoId}:${docente.id}`;
        const resultado = await avisos.updateOne(
            { _id: id },
            { $setOnInsert: { para: docente.id, tipo: 'periodo', texto, fecha, creado: new Date() } },
            { upsert: true }
        );
        if (resultado.upsertedCount) await enviarPush('docente', docente.id, 'TIBURONES · Periodo escolar', texto, '/#/calificaciones');
    }
}

async function revisarAvisosPeriodo() {
    const periodo = await periodoActivo();
    if (!periodo) return;
    for (const evento of eventosAutomaticosPeriodo(periodo, fechaHoraMexico().fecha))
        await notificarDocentesPeriodo(periodo, evento.parcial, evento.estado, evento.id);
}

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
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const b = (await horarios.find({ claseId: cl._id, dia }).toArray()).find(x => x.tipo !== 'descanso');
    return b ? { inicio: b.inicio, fin: b.fin } : { inicio: '', fin: '' };
};
const miClase = async (doc, area, semestre, grupo, materia) => (await clases.find({ docente: doc }).toArray())
    .find(c => c.area === area && c.semestre === semestre && c.grupo === grupo && c.materia.toLowerCase() === String(materia).toLowerCase());
const fechaClave = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
function grupoAlumnoEnFecha(alumno, fecha) {
    const anterior = (alumno.historialGrupos || []).find(g => fechaClave(g.desde) <= fecha && fechaClave(g.hasta) >= fecha);
    if (anterior) return anterior;
    const inicio = fechaClave(alumno.inicioSemestre || alumno.creado);
    return !alumno.egresado && (!inicio || inicio <= fecha) ? alumno : null;
}

async function avisar(alumno, tipo, hora, fecha, clave, materia, extra) {
    const cand = [...await usuarios.find({ rol: 'tutor', hijos: alumno.curp }).toArray(), ...await usuarios.find({ rol: 'tutor', curpAlumno: alumno.curp }).toArray()];
    const tutores = cand.filter((x, i) => cand.findIndex(y => y.id === x.id) === i && vinculoOk(x, alumno));
    for (const tu of tutores) {
        const texto = extra || (tipo === 'falta' ? `${alumno.nombre} faltó a ${materia}` : `${alumno.nombre} asistió a ${materia} (${hora})`);
        try { await avisos.insertOne({ _id: `${tipo}:${clave}:${tu.id}`, para: tu.id, curp: alumno.curp, tipo, materia, texto, fecha, hora, creado: new Date() }); await enviarPush('tutor', tu.id, 'TIBURONES · Aviso escolar', texto, '/'); }
        catch (e) { if (e.code !== 11000) throw e; }
    }
}

async function registrarFaltasProgramadas(fecha, dia, ahora) {
    const calendario = await periodoActivo();
    if (!calendario || !estadoPeriodo(calendario, fecha).enCiclo) return;
    const bloques = (await horarios.find({ dia, tipo: 'clase' }).toArray()).filter(b => b.claseId && b.inicio && b.fin);
    const porClase = new Map();
    for (const b of bloques) {
        const id = String(b.claseId);
        if (!porClase.has(id)) porClase.set(id, []);
        porClase.get(id).push(b);
    }
    for (const [claseId, agenda] of porClase) {
        const fin = Math.max(...agenda.map(b => { const [h, m] = b.fin.split(':').map(Number); return h * 60 + m; }));
        if (!Number.isFinite(fin) || ahora < fin) continue;
        const evento = `cierre-auto:${fecha}:${claseId}`;
        try { await recordatoriosPush.insertOne({ _id: evento, creado: new Date() }); }
        catch (e) { if (e.code === 11000) continue; throw e; }
        const clase = await clases.findOne({ _id: agenda[0].claseId });
        if (!clase) continue;
        const alumnos = await usuarios.find({ rol: 'alumno', egresado: { $ne: true }, area: clase.area, semestre: clase.semestre, grupo: clase.grupo }).toArray();
        const permisosAprobados = await permisos.find({ estado: 'aprobado', desde: { $lte: fecha }, hasta: { $gte: fecha } }).toArray();
        const registros = await asistencias.find({ fecha, claseId, estado: { $in: ['asistio', 'retardo', 'falta', 'justificada'] } }).toArray();
        const atendidos = new Set(registros.map(r => r.curp));
        const bloque = agenda.sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
        for (const alumno of alumnos.filter(a => !atendidos.has(a.curp))) {
            const permiso = permisosAprobados.find(p => p.curp === alumno.curp);
            const key = String(clase.materia || '').toLowerCase();
            try {
                await asistencias.insertOne({ _id: `F:${alumno.curp}:${fecha}:${key}:${claseId}`, curp: alumno.curp, alumnoNombre: alumno.nombre, area: clase.area, semestre: clase.semestre, grupo: clase.grupo, fecha, hora: bloque.fin, estado: permiso ? 'justificada' : 'falta', motivo: permiso ? 'Permiso: ' + permiso.motivo : undefined, materia: clase.materia, materiaKey: key, claseId, horaInicio: bloque.inicio, horaFin: bloque.fin, docente: clase.docente, docenteNombre: clase.docenteNombre });
            } catch (e) { if (e.code !== 11000) throw e; }
            if (!permiso) await avisar(alumno, 'falta', bloque.fin, fecha, `${alumno.curp}:${fecha}:${key}`, clase.materia, `${alumno.nombre} faltó a ${clase.materia} (${bloque.inicio} a ${bloque.fin}) el ${fecha.split('-').reverse().join('/')}`);
            else await avisar(alumno, 'justificada', bloque.fin, fecha, `${alumno.curp}:${fecha}:${key}`, clase.materia, `${alumno.nombre} no asistió a ${clase.materia}: justificado por permiso`);
        }
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
    const cuentas = await Promise.all(['alumno', 'docente', 'tutor'].map(rol => usuarios.findOne({ _id: `${rol}:${curp}`, rol }, { projection: { hash: 1, debeCambiarPassword: 1, requiereCodigoActivacion: 1 } }).then(cuenta => cuenta && ({ rol, cuenta }))));
    const encontradas = cuentas.filter(Boolean);
    if (encontradas.length !== 1) {
        fallo(llave);
        return bad(res, encontradas.length ? 'La CURP está asociada a más de un tipo de cuenta. Contacta a Servicios Escolares.' : 'No encontramos una cuenta con esa CURP. Revisa el dato con Servicios Escolares.', 404);
    }
    fallos.delete(llave);
    const { rol, cuenta } = encontradas[0];
    res.json({ rol, tienePassword: !!cuenta.hash && !cuenta.debeCambiarPassword, requiereCodigoActivacion: !!cuenta.requiereCodigoActivacion });
}));
app.post('/api/login', h(async (req, res) => {
    const id = s(req.body.id).toUpperCase(), rol = s(req.body.rol), password = String(req.body.password || '');
    const llave = crypto.createHash('sha256').update(`${req.ip}|${rol}|${rol === 'admin' ? ADMIN_ID : id}`).digest('hex');
    if (await loginBloqueado(llave)) return bad(res, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo', 429);
    if (rol === 'admin') {
        const configuradas = Object.values(ADMIN_ACCESS_PASSWORDS).some(acceso => acceso.length >= 4);
        const coincidencias = areasCoincidentes(password, ADMIN_ACCESS_PASSWORDS);
        if (!configuradas) return bad(res, 'El acceso administrativo no está configurado en el servidor.', 503);
        if (coincidencias.length > 1) return bad(res, 'Configuración inválida: la contraseña está asignada a más de un área administrativa.', 503);
        if (!coincidencias.length) { await loginFallido(llave); return bad(res, 'Contraseña incorrecta.', 401); }
        const adminArea = coincidencias[0];
        const admin = await usuarios.findOne({ _id: 'admin:' + ADMIN_ID, rol: 'admin' });
        if (!admin) {
            await loginFallido(llave);
            return bad(res, 'No se encontró la cuenta administrativa.', 401);
        }
        const sid = crypto.randomBytes(24).toString('base64url');
        await usuarios.updateOne({ _id: admin._id }, { $set: { [`sessionId_${adminArea}`]: sid } });
        const datos = publico(admin);
        const usuario = { ...datos, id: ADMIN_ID, curp: ADMIN_CURP, rol: 'admin', adminArea, debeCambiarPassword: false };
        return res.json({ token: firmar({ id: ADMIN_ID, rol: 'admin', adminArea, sid, nombre: admin.nombre, exp: Date.now() + 12 * 3600e3 }), usuario, offlineTicket: await firmarOffline(usuario) });
    }
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Elige cómo quieres entrar');
    if (!RX.curp.test(id)) return bad(res, 'Escribe una CURP v\u00e1lida');
    const u = await usuarios.findOne({ _id: `${rol}:${id}`, rol });
    if (!u) { await loginFallido(llave); return bad(res, 'No encontramos esa cuenta. Revisa la CURP con Servicios Escolares.', 401); }
    if (!u.hash || (!password || !okPw(password, u))) { await loginFallido(llave); return bad(res, 'CURP o contraseña incorrectas', 401); }
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
    const password = String(req.body.password || ''), confirmar = String(req.body.confirmar || ''), codigo = s(req.body.codigoActivacion);
    if (!['alumno', 'tutor', 'docente'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(curp)) return bad(res, 'Escribe una CURP válida de 18 caracteres');
    if (!validaPassword(password)) return bad(res, 'Usa una contrase\u00f1a de 4 a 128 caracteres');
    if (password !== confirmar) return bad(res, 'Las contraseñas no coinciden');
    const llave = 'activar:' + req.ip;
    if (bloqueado(llave, 8)) return bad(res, 'Demasiados intentos. Espera 15 minutos.', 429);
    const cuenta = await usuarios.findOne({ _id: `${rol}:${curp}`, rol });
    const codigoRequerido = cuenta?.requiereCodigoActivacion === true;
    if (!cuenta || !cuenta.debeCambiarPassword || (codigoRequerido && !codigoCoincide(codigo, cuenta.activationCodeHash))) {
        fallo(llave); return bad(res, 'No se pudo validar la cuenta. Revisa tu CURP o solicita ayuda a Servicios Escolares.', 401);
    }
    const hp = hashPw(password);
    const activada = await usuarios.updateOne({ _id: cuenta._id, debeCambiarPassword: true, requiereCodigoActivacion: codigoRequerido ? true : { $ne: true } }, { $set: { ...hp, debeCambiarPassword: false, passwordActualizada: new Date(), activadaPorUsuario: true }, $unset: { activationCodeHash: '', requiereCodigoActivacion: '' } });
    if (!activada.modifiedCount) return bad(res, 'El código ya fue utilizado o la cuenta ya se activó.', 409);
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

app.get('/api/accesos', auth, h(async (req, res) => {
    const curp = s(req.query.curp).toUpperCase();
    if (!RX.curp.test(curp)) return bad(res, 'CURP inválida.');
    const u = req.u;
    if (u.rol === 'alumno' && u.id !== curp) return bad(res, 'Sin permiso', 403);
    if (u.rol === 'tutor' && !(await permitidas(u)).includes(curp)) return bad(res, 'Sin permiso', 403);
    if (u.rol === 'admin' && !['control', 'portero'].includes(u.adminArea)) return bad(res, 'Sin permiso', 403);
    if (!['alumno', 'tutor', 'admin'].includes(u.rol)) return bad(res, 'Sin permiso', 403);
    const registros = await accesosEscuela.find({ curp }).sort({ creado: -1 }).limit(30).toArray();
    res.json(registros.map(({ _id, ...registro }) => registro));
}));

app.post('/api/portero/escanear', auth, adminDe('portero', 'control'), h(async (req, res) => {
    const curp = s(req.body.curp).toUpperCase(), tipo = s(req.body.tipo), automatico = tipo === 'auto', uid = s(req.body.uid).toLowerCase();
    if (!RX.curp.test(curp)) return bad(res, 'Escanea un QR de alumno válido.');
    if (!automatico && !tipoAccesoValido(tipo)) return bad(res, 'Elige entrada o salida.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uid))
        return bad(res, 'Identificador de evento inválido.');
    const alumno = await usuarios.findOne({ _id: `alumno:${curp}`, rol: 'alumno' });
    if (!alumno) return bad(res, 'No se encontró una cuenta de alumno para esta CURP.', 404);
    const anterior = await accesosEscuela.findOne({ _id: uid });
    if (anterior) {
        if (anterior.curp !== curp || (!automatico && !esMismoAcceso(anterior, { curp, tipo }))) return bad(res, 'El identificador ya pertenece a otro registro.', 409);
        const { _id, ...respuesta } = anterior;
        return res.json({ ...respuesta, duplicada: true });
    }

    const ahora = new Date(), fecha = fechaHoraMexico(ahora).fecha;
    let bloqueoAdquirido = false;
    try {
        try {
            const bloqueo = await accesosEscuelaBloqueos.updateOne(
                { _id: curp, liberadoHasta: { $lte: ahora } },
                { $set: { liberadoHasta: new Date(ahora.getTime() + 30000), uid } },
                { upsert: true }
            );
            bloqueoAdquirido = bloqueo.modifiedCount === 1 || bloqueo.upsertedCount === 1;
        } catch (e) {
            if (e.code !== 11000) throw e;
            const ultimo = await accesosEscuela.find({ curp, fecha }).sort({ creado: -1 }).limit(1).next();
            const esperado = ultimo ? (ultimo.tipo === 'entrada' ? 'salida' : 'entrada') : 'entrada';
            const decision = decidirAcceso(ultimo, ahora, automatico ? esperado : tipo);
            if (decision.estado === 'espera') {
                const mensaje = `Ya registró su ${decision.ultimo.tipo} a las ${decision.ultimo.hora}. Podrá registrar su ${decision.esperado} en ${decision.minutosRestantes} min.`;
                return bad(res, mensaje, 409);
            }
            return bad(res, 'Hay otra lectura de este alumno en proceso. Espera un momento e inténtalo de nuevo.', 409);
        }
        if (!bloqueoAdquirido) return bad(res, 'Hay otra lectura de este alumno en proceso. Espera un momento e inténtalo de nuevo.', 409);

        const ultimo = await accesosEscuela.find({ curp, fecha }).sort({ creado: -1 }).limit(1).next();
        const esperado = ultimo ? (ultimo.tipo === 'entrada' ? 'salida' : 'entrada') : 'entrada';
        const decision = decidirAcceso(ultimo, ahora, automatico ? esperado : tipo);
        if (decision.estado === 'espera') {
            const mensaje = `Ya registró su ${decision.ultimo.tipo} a las ${decision.ultimo.hora}. Podrá registrar su ${decision.esperado} en ${decision.minutosRestantes} min.`;
            return bad(res, mensaje, 409);
        }
        if (decision.estado !== 'registrar') {
            const esperado = decision.esperado || (ultimo ? (ultimo.tipo === 'entrada' ? 'salida' : 'entrada') : 'entrada');
            return bad(res, `El siguiente evento debe ser ${esperado}.`, 409);
        }

        const tipoRegistro = decision.tipo;
        const registro = crearRegistroAcceso({ uid, curp, alumno, tipo: tipoRegistro, actor: req.u, creado: ahora });
        try { await accesosEscuela.insertOne(registro); }
        catch (e) {
            if (e.code !== 11000) throw e;
            const duplicado = await accesosEscuela.findOne({ _id: uid });
            if (!duplicado || duplicado.curp !== curp || (!automatico && !esMismoAcceso(duplicado, { curp, tipo })))
                return bad(res, 'El identificador ya pertenece a otro registro.', 409);
            const { _id, ...respuesta } = duplicado;
            return res.json({ ...respuesta, duplicada: true });
        }
        const texto = `${alumno.nombre} ${tipoRegistro === 'entrada' ? 'entró' : 'salió'} de la escuela a las ${registro.hora}.`;
        await avisar(alumno, tipoRegistro, registro.hora, fecha, uid, '', texto);
        const { _id, ...respuesta } = registro;
        res.json({ ...respuesta, duplicada: false });
    } finally {
        if (bloqueoAdquirido) {
            try { await accesosEscuelaBloqueos.deleteOne({ _id: curp, uid }); }
            catch (e) { console.warn('No se pudo liberar el bloqueo de acceso; expirará automáticamente:', e.message); }
        }
    }
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
app.get('/api/asistencia/autorizaciones', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const momento = fechaHoraMexico();
    const calendario = await periodoActivo();
    if (!calendario || !estadoPeriodo(calendario, momento.fecha).enCiclo) return res.json([]);
    const idsClase = (await clases.find({ docente: req.u.id }).project({ _id: 1 }).toArray()).map(x => x._id);
    const bloques = idsClase.length ? await horarios.find({ claseId: { $in: idsClase }, dia: momento.dia }).toArray() : [];
    const porClase = new Map();
    for (const b of bloques) {
        if (b.tipo === 'descanso' || !b.claseId || !/^\d{2}:\d{2}$/.test(s(b.inicio)) || !/^\d{2}:\d{2}$/.test(s(b.fin))) continue;
        if (!porClase.has(String(b.claseId))) porClase.set(String(b.claseId), []);
        porClase.get(String(b.claseId)).push({ inicio: b.inicio, fin: b.fin });
    }
    res.json([...porClase].map(([claseId, autorizados]) => ({
        claseId,
        fecha: momento.fecha,
        autorizacion: firmar({
            tipo: 'asistencia-offline',
            docente: req.u.id,
            claseId,
            fecha: momento.fecha,
            bloques: autorizados,
            exp: Date.now() + 30 * 24 * 3600e3
        })
    })));
}));
app.post('/api/asistencias', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const a = req.body || {}, curp = s(a.curp).toUpperCase();
    if (!RX.curp.test(curp) || !/^[\w-]{8,64}$/.test(s(a.uid)) || !fechaValida(s(a.fecha)) || minutosDeHora(s(a.hora)) === null || !limpiaMat(a.materia))
        return bad(res, 'Datos de asistencia inválidos');
    const materia = limpiaMat(a.materia), key = materia.toLowerCase();
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    const grupoCaptura = grupoAlumnoEnFecha(alumno, s(a.fecha));
    if (!grupoCaptura) return bad(res, 'La cuenta no pertenecía a un grupo activo en la fecha de la asistencia.', 403);
    const cl = await miClase(req.u.id, grupoCaptura.area, grupoCaptura.semestre, grupoCaptura.grupo, materia);
    if (!cl) return bad(res, 'Esa materia no es tuya o el alumno no es de ese grupo', 403);
    if (a.claseId && String(a.claseId) !== String(cl._id)) return bad(res, 'La clase enviada no coincide con el grupo del alumno en esa fecha.', 403);
    const uid = s(a.uid), existente = await asistencias.findOne({ _id: uid });
    if (existente) {
        if (existente.curp !== curp || existente.docente !== req.u.id || existente.materiaKey !== key) return bad(res, 'El identificador ya pertenece a otro registro', 409);
        return res.json({ ok: true, revisionPendiente: false, fecha: existente.fecha, hora: existente.hora });
    }
    const pendienteExistente = await asistenciasPendientes.findOne({ _id: uid });
    if (pendienteExistente) {
        if (pendienteExistente.curp !== curp || pendienteExistente.docente !== req.u.id || pendienteExistente.materiaKey !== key) return bad(res, 'El identificador ya pertenece a otro registro', 409);
        if (pendienteExistente.estado !== 'pendiente' && pendienteExistente.estado !== 'revisando') return bad(res, 'El registro ya fue revisado', 409);
        return res.status(202).json({ ok: true, revisionPendiente: true, fecha: pendienteExistente.fecha, horaDeclarada: pendienteExistente.horaDeclarada });
    }
    const momento = fechaHoraMexico(), bloques = await horarios.find({ claseId: cl._id, dia: momento.dia }).toArray();
    const decision = decidirRegistroAsistencia({
        bloquesActuales: bloques,
        momento,
        autorizacion: leer(s(a.autorizacion)),
        docenteId: req.u.id,
        claseId: String(cl._id),
        fechaDeclarada: s(a.fecha),
        horaDeclarada: s(a.hora),
        ahoraMs: Date.now()
    });
    if (!decision) return bad(res, 'La asistencia está fuera del horario permitido y no tiene una autorización offline válida.', 403);
    const calendario = await periodoActivo();
    if (!calendario || !estadoPeriodo(calendario, decision.fecha).enCiclo)
        return bad(res, 'No se permite registrar asistencia fuera del ciclo escolar o en un día sin clases.', 403);
    if (decision.estado === 'revision') {
        const repetida = await asistenciasPendientes.findOne({
            curp,
            claseId: String(cl._id),
            fecha: decision.fecha,
            estado: { $in: ['pendiente', 'revisando', 'confirmada'] }
        });
        if (repetida) return bad(res, 'Ya existe un registro pendiente o revisado para este alumno, clase y fecha', 409);
        const registroPendiente = {
            _id: uid,
            curp,
            fecha: decision.fecha,
            hora: s(a.hora),
            horaDeclarada: s(a.hora),
            estado: 'pendiente',
            materia,
            materiaKey: key,
            horaInicio: decision.bloque.inicio,
            horaFin: decision.bloque.fin,
            docente: req.u.id,
            docenteNombre: s(req.u.nombre),
            alumnoNombre: s(alumno.nombre),
            area: grupoCaptura.area,
            semestre: grupoCaptura.semestre,
            grupo: grupoCaptura.grupo,
            claseId: String(cl._id),
            recibido: new Date()
        };
        try { await asistenciasPendientes.insertOne(registroPendiente); }
        catch (e) {
            if (e.code !== 11000) throw e;
            const existente = await asistenciasPendientes.findOne({ _id: registroPendiente._id });
            if (existente?.curp !== curp || existente?.docente !== req.u.id || existente?.materiaKey !== key) return bad(res, 'El identificador ya pertenece a otro registro', 409);
        }
        return res.status(202).json({ ok: true, revisionPendiente: true, fecha: decision.fecha, horaDeclarada: s(a.hora) });
    }
    const estadoRegistro = minutosDeHora(decision.hora) > minutosDeHora(decision.bloque.inicio) + 10 ? 'retardo' : 'asistio';
    try {
        await asistencias.insertOne({ _id: s(a.uid), curp, alumnoNombre: alumno.nombre, area: grupoCaptura.area, semestre: grupoCaptura.semestre, grupo: grupoCaptura.grupo, fecha: decision.fecha, hora: decision.hora, estado: estadoRegistro, materia, materiaKey: key, claseId: String(cl._id), horaInicio: decision.bloque.inicio, horaFin: decision.bloque.fin, docente: req.u.id, docenteNombre: s(req.u.nombre) });
    } catch (e) {
        if (e.code !== 11000) throw e;
        const duplicada = await asistencias.findOne({ _id: uid });
        if (duplicada?.curp === curp && duplicada?.docente === req.u.id && duplicada?.materiaKey === key)
            return res.json({ ok: true, revisionPendiente: false, fecha: duplicada.fecha, hora: duplicada.hora });
        return bad(res, 'Ya registrada', 409);
    }
    await asistencias.deleteOne({ _id: `F:${curp}:${decision.fecha}:${key}:${cl._id}` });
    await asistencias.deleteOne({ _id: `F:${curp}:${decision.fecha}:${key}` });
    if (estadoRegistro === 'retardo') await avisar(alumno, 'retardo', decision.hora, decision.fecha, s(a.uid), materia, `${alumno.nombre} llegó con retardo a ${materia} (${alumno.semestre} ${alumno.area} ${alumno.grupo}) a las ${decision.hora}.`);
    res.status(201).json({ ok: true, fecha: decision.fecha, hora: decision.hora, estado: estadoRegistro });
}));

app.get('/api/asistencias/pendientes', auth, h(async (req, res) => {
    const esControl = req.u.rol === 'admin' && req.u.adminArea === 'control';
    if (req.u.rol !== 'docente' && !esControl) return bad(res, 'No tienes permiso para revisar asistencias', 403);
    await asistenciasPendientes.updateMany(
        { estado: 'revisando', revisionIniciada: { $lt: new Date(Date.now() - 5 * 60e3) } },
        { $set: { estado: 'pendiente' }, $unset: { revisionIniciada: '' } }
    );
    await cierresPendientes.updateMany(
        { estado: 'revisando', revisionIniciada: { $lt: new Date(Date.now() - 5 * 60e3) } },
        { $set: { estado: 'pendiente' }, $unset: { revisionIniciada: '' } }
    );
    const q = { estado: 'pendiente' };
    if (req.u.rol === 'docente') q.docente = req.u.id;
    const [asistenciasPendientesLista, cierresPendientesLista] = await Promise.all([
        asistenciasPendientes.find(q).sort({ recibido: -1 }).limit(500).toArray(),
        cierresPendientes.find(q).sort({ recibido: -1 }).limit(500).toArray()
    ]);
    res.json([
        ...asistenciasPendientesLista.map(({ _id, ...r }) => ({ uid: _id, tipo: 'asistencia', ...r })),
        ...cierresPendientesLista.map(({ _id, ...r }) => ({ uid: _id, tipo: 'cierre', ...r }))
    ].sort((a, b) => new Date(b.recibido) - new Date(a.recibido)).slice(0, 500));
}));

app.post('/api/asistencias/pendientes/:uid/resolver', auth, h(async (req, res) => {
    const esControl = req.u.rol === 'admin' && req.u.adminArea === 'control';
    if (req.u.rol !== 'docente' && !esControl) return bad(res, 'No tienes permiso para revisar asistencias', 403);
    const uid = s(req.params.uid), accion = s(req.body.accion);
    if (!['confirmar', 'rechazar'].includes(accion)) return bad(res, 'Elige confirmar o rechazar');
    const pendiente = await asistenciasPendientes.findOne({ _id: uid });
    if (!pendiente) return bad(res, 'El registro pendiente no existe', 404);
    if (req.u.rol === 'docente' && pendiente.docente !== req.u.id) return bad(res, 'Solo puedes revisar tus propios registros', 403);
    if (pendiente.estado !== 'pendiente') return bad(res, 'El registro ya fue revisado o está en proceso', 409);

    const revisionIniciada = new Date();
    const reclamo = await asistenciasPendientes.updateOne(
        { _id: uid, estado: 'pendiente' },
        { $set: { estado: 'revisando', revisionIniciada, revisionAccion: accion, revisionPor: req.u.id } }
    );
    if (!reclamo.modifiedCount) return bad(res, 'El registro ya fue revisado o está en proceso', 409);
    try {
        if (accion === 'confirmar') {
            const calendario = await periodoActivo();
            if (!calendario || !estadoPeriodo(calendario, pendiente.fecha).enCiclo)
                throw Object.assign(new Error('No se puede confirmar la asistencia fuera del ciclo escolar o en un día sin clases.'), { status: 403 });
            const duplicada = await asistencias.findOne({
                curp: pendiente.curp,
                alumnoNombre: pendiente.alumnoNombre,
                area: pendiente.area,
                semestre: pendiente.semestre,
                grupo: pendiente.grupo,
                fecha: pendiente.fecha,
                materiaKey: pendiente.materiaKey,
                claseId: pendiente.claseId,
                estado: { $in: ['asistio', 'retardo'] }
            });
            if (duplicada && duplicada._id !== uid) throw Object.assign(new Error('Ya existe otra asistencia confirmada para este alumno, materia y fecha'), { status: 409 });
            if (!duplicada) await asistencias.insertOne({
                _id: uid,
                curp: pendiente.curp,
                fecha: pendiente.fecha,
                hora: pendiente.horaDeclarada,
                estado: Number(minutosDeHora(pendiente.horaDeclarada)) > Number(minutosDeHora(pendiente.horaInicio)) + 10 ? 'retardo' : 'asistio',
                materia: pendiente.materia,
                materiaKey: pendiente.materiaKey,
                claseId: pendiente.claseId,
                horaInicio: pendiente.horaInicio,
                horaFin: pendiente.horaFin,
                docente: pendiente.docente,
                docenteNombre: pendiente.docenteNombre,
                revisionOrigen: 'offline',
                revisadoEn: revisionIniciada,
                revisadoPor: req.u.id
            });
            const alumno = await usuarios.findOne({ _id: 'alumno:' + pendiente.curp, rol: 'alumno' });
            if (alumno && Number(minutosDeHora(pendiente.horaDeclarada)) > Number(minutosDeHora(pendiente.horaInicio)) + 10)
                await avisar(alumno, 'retardo', pendiente.horaDeclarada, pendiente.fecha, uid, pendiente.materia, `${alumno.nombre} llegó con retardo a ${pendiente.materia} (${pendiente.semestre} ${pendiente.area} ${pendiente.grupo}) a las ${pendiente.horaDeclarada}.`);
        }
        const estado = accion === 'confirmar' ? 'confirmada' : 'rechazada';
        const actualizacion = await asistenciasPendientes.updateOne(
            { _id: uid, estado: 'revisando', revisionIniciada },
            { $set: { estado, revisadoEn: new Date(), revisadoPor: req.u.id, motivoRevision: s(req.body.motivo).slice(0, 300) }, $unset: { revisionIniciada: '' } }
        );
        if (!actualizacion.modifiedCount) throw new Error('No se pudo guardar el resultado de la revisión');
        await registrarCambio(req, `Asistencia offline ${estado}`, `${pendiente.alumnoNombre} · ${pendiente.materia} · ${pendiente.fecha} ${pendiente.horaDeclarada}`);
        res.json({ ok: true, estado });
    } catch (e) {
        await asistenciasPendientes.updateOne(
            { _id: uid, estado: 'revisando', revisionIniciada },
            { $set: { estado: 'pendiente' }, $unset: { revisionIniciada: '', revisionAccion: '', revisionPor: '' } }
        );
        if (e.status) return bad(res, e.message, e.status);
        throw e;
    }
}));

app.post('/api/cierres/pendientes/:uid/resolver', auth, h(async (req, res) => {
    const esControl = req.u.rol === 'admin' && req.u.adminArea === 'control';
    if (req.u.rol !== 'docente' && !esControl) return bad(res, 'No tienes permiso para revisar cierres', 403);
    const uid = s(req.params.uid), accion = s(req.body.accion);
    if (!['confirmar', 'rechazar'].includes(accion)) return bad(res, 'Elige confirmar o rechazar');
    const pendiente = await cierresPendientes.findOne({ _id: uid });
    if (!pendiente) return bad(res, 'El cierre pendiente no existe', 404);
    if (req.u.rol === 'docente' && pendiente.docente !== req.u.id) return bad(res, 'Solo puedes revisar tus propios cierres', 403);
    if (pendiente.estado !== 'pendiente') return bad(res, 'El cierre ya fue revisado o está en proceso', 409);

    const revisionIniciada = new Date();
    const reclamo = await cierresPendientes.updateOne(
        { _id: uid, estado: 'pendiente' },
        { $set: { estado: 'revisando', revisionIniciada, revisionAccion: accion, revisionPor: req.u.id } }
    );
    if (!reclamo.modifiedCount) return bad(res, 'El cierre ya fue revisado o está en proceso', 409);
    try {
        let faltas = 0;
        if (accion === 'confirmar') {
            const clase = await clases.findOne({ _id: pendiente.claseId, docente: pendiente.docente });
            if (!clase || `${clase.area}|${clase.semestre}|${clase.grupo}` !== `${pendiente.area}|${pendiente.semestre}|${pendiente.grupo}`)
                throw Object.assign(new Error('La clase ya no coincide con los datos del cierre'), { status: 409 });
            const calendario = await periodoActivo();
            if (!calendario || !estadoPeriodo(calendario, pendiente.fecha).enCiclo)
                throw Object.assign(new Error('No se puede confirmar un cierre fuera del ciclo escolar o en un día sin clases.'), { status: 403 });
            const dia = new Date(`${pendiente.fecha}T12:00:00Z`).getUTCDay();
            const bloques = (await horarios.find({ claseId: clase._id, dia }).toArray()).filter(b => b.tipo !== 'descanso');
            if (!bloques.length) throw Object.assign(new Error('La clase ya no está programada para la fecha del cierre'), { status: 409 });
            const primero = bloques.slice().sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
            const ultimo = bloques.slice().sort((a, b) => b.fin.localeCompare(a.fin))[0];
            const hora = ultimo.fin;
            const aprobados = await permisos.find({ estado: 'aprobado' }).toArray();
            const alumnos = await usuarios.find({ rol: 'alumno', egresado: { $ne: true }, area: pendiente.area, semestre: pendiente.semestre, grupo: pendiente.grupo }).toArray();
            const presentes = new Set((await asistencias.find({ fecha: pendiente.fecha, estado: { $in: ['asistio', 'retardo'] }, $or: [{ claseId: String(clase._id) }, { claseId: { $exists: false }, docente: pendiente.docente, materiaKey: pendiente.materiaKey }] }).toArray()).map(a => a.curp));
            for (const alumno of alumnos.filter(x => !presentes.has(x.curp))) {
                const permiso = aprobados.find(x => x.curp === alumno.curp && x.desde <= pendiente.fecha && pendiente.fecha <= x.hasta);
                try {
                    await asistencias.insertOne({
                        _id: `F:${alumno.curp}:${pendiente.fecha}:${pendiente.materiaKey}:${pendiente.claseId}`,
                        curp: alumno.curp,
                        alumnoNombre: alumno.nombre,
                        area: pendiente.area,
                        semestre: pendiente.semestre,
                        grupo: pendiente.grupo,
                        fecha: pendiente.fecha,
                        hora,
                        estado: permiso ? 'justificada' : 'falta',
                        motivo: permiso ? 'Permiso: ' + permiso.motivo : undefined,
                        materia: pendiente.materia,
                        materiaKey: pendiente.materiaKey,
                        claseId: pendiente.claseId,
                        horaInicio: primero.inicio,
                        horaFin: ultimo.fin,
                        docente: pendiente.docente,
                        docenteNombre: pendiente.docenteNombre
                    });
                    if (!permiso) faltas++;
                } catch (e) { if (e.code !== 11000) throw e; }
                if (permiso) await avisar(alumno, 'justificada', hora, pendiente.fecha, `${alumno.curp}:${pendiente.fecha}:${pendiente.materiaKey}`, pendiente.materia, `${alumno.nombre} no asistió a ${pendiente.materia}: justificado por permiso`);
                else await avisar(alumno, 'falta', hora, pendiente.fecha, `${alumno.curp}:${pendiente.fecha}:${pendiente.materiaKey}`, pendiente.materia, `${alumno.nombre} faltó a ${pendiente.materia} (${primero.inicio} a ${ultimo.fin}) el ${pendiente.fecha.split('-').reverse().join('/')}`);
            }
        }
        const estado = accion === 'confirmar' ? 'confirmado' : 'rechazado';
        const actualizacion = await cierresPendientes.updateOne(
            { _id: uid, estado: 'revisando', revisionIniciada },
            { $set: { estado, faltasGeneradas: faltas, revisadoEn: new Date(), revisadoPor: req.u.id, motivoRevision: s(req.body.motivo).slice(0, 300) }, $unset: { revisionIniciada: '' } }
        );
        if (!actualizacion.modifiedCount) throw new Error('No se pudo guardar el resultado de la revisión');
        await registrarCambio(req, `Cierre offline ${estado}`, `${pendiente.materia} · ${pendiente.semestre} ${pendiente.area} ${pendiente.grupo} · ${pendiente.fecha}`);
        res.json({ ok: true, estado, faltas });
    } catch (e) {
        await cierresPendientes.updateOne(
            { _id: uid, estado: 'revisando', revisionIniciada },
            { $set: { estado: 'pendiente' }, $unset: { revisionIniciada: '', revisionAccion: '', revisionPor: '' } }
        );
        if (e.status) return bad(res, e.message, e.status);
        throw e;
    }
}));

/* Cierre de lista: quien no tenga asistencia ese día en ese grupo queda con falta y se avisa al tutor */
app.post('/api/cierre', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const b = req.body || {}, area = s(b.area), semestre = s(b.semestre), grupo = s(b.grupo);
    const materia = limpiaMat(b.materia), key = materia.toLowerCase(), fechaDeclarada = s(b.fecha), horaDeclarada = s(b.hora);
    if (!fechaValida(fechaDeclarada) || minutosDeHora(horaDeclarada) === null || !area || !semestre || !grupo || !materia) return bad(res, 'Datos inválidos');
    const cl = await miClase(req.u.id, area, semestre, grupo, materia);
    if (!cl) return bad(res, 'Esa clase no es tuya', 403);
    if (b.claseId && s(b.claseId) !== String(cl._id)) return bad(res, 'La clase del cierre no coincide con tu horario', 403);
    const momento = fechaHoraMexico(), autorizacion = leer(s(b.autorizacion));
    if (s(b.autorizacion)) {
        if (!validarAutorizacionCierre(autorizacion, {
            docenteId: req.u.id,
            claseId: String(cl._id),
            fechaDeclarada,
            fechaActual: momento.fecha,
            ahoraMs: Date.now()
        })) return bad(res, 'El cierre offline no tiene una autorización válida para esta clase y fecha', 403);
        const calendario = await periodoActivo();
        if (!calendario || !estadoPeriodo(calendario, autorizacion.fecha).enCiclo)
            return bad(res, 'No se permite cerrar listas fuera del ciclo escolar o en un día sin clases.', 403);
        const uid = s(b.uid);
        if (!/^[\w-]{8,64}$/.test(uid)) return bad(res, 'Identificador de cierre inválido');
        const cierrePrevio = await cierresPendientes.findOne({
            claseId: String(cl._id),
            fecha: autorizacion.fecha,
            estado: { $in: ['pendiente', 'revisando', 'confirmado'] }
        });
        if (cierrePrevio && cierrePrevio._id !== uid)
            return res.status(202).json({ ok: true, revisionPendiente: cierrePrevio.estado !== 'confirmado', fecha: autorizacion.fecha });
        const registro = {
            _id: uid,
            claseId: String(cl._id),
            docente: req.u.id,
            docenteNombre: s(req.u.nombre),
            area,
            semestre,
            grupo,
            materia,
            materiaKey: key,
            fecha: autorizacion.fecha,
            horaDeclarada,
            estado: 'pendiente',
            recibido: new Date()
        };
        try { await cierresPendientes.insertOne(registro); }
        catch (e) {
            if (e.code !== 11000) throw e;
            const existente = await cierresPendientes.findOne({ _id: uid });
            if (existente?.docente !== req.u.id || existente?.claseId !== String(cl._id) || existente?.fecha !== autorizacion.fecha
                || !['pendiente', 'revisando', 'confirmado'].includes(existente.estado))
                return bad(res, 'El identificador ya pertenece a otro cierre', 409);
            return res.status(202).json({ ok: true, revisionPendiente: existente.estado !== 'confirmado', fecha: existente.fecha });
        }
        return res.status(202).json({ ok: true, revisionPendiente: true, fecha: autorizacion.fecha });
    }

    if (fechaDeclarada !== momento.fecha) return bad(res, 'Solo puedes cerrar la lista del día escolar actual', 403);
    const calendario = await periodoActivo();
    if (!calendario || !estadoPeriodo(calendario, momento.fecha).enCiclo)
        return bad(res, 'No se permite cerrar listas fuera del ciclo escolar o en un día sin clases.', 403);
    const bloquesHoy = (await horarios.find({ claseId: cl._id, dia: momento.dia }).toArray()).filter(x => x.tipo !== 'descanso');
    if (!bloquesHoy.length) return bad(res, 'Esta clase no está programada para hoy', 403);
    const finUltimoBloque = Math.max(...bloquesHoy.map(x => minutosDeHora(x.fin)).filter(Number.isInteger));
    if (!Number.isFinite(finUltimoBloque) || momento.minuto < finUltimoBloque) return bad(res, 'La clase aún no termina según el horario escolar', 403);
    const fecha = momento.fecha, hora = momento.hora;
    const bl = bloquesHoy.sort((x, y) => x.inicio.localeCompare(y.inicio))[0], hr = bl.inicio ? ` (${bl.inicio} a ${bl.fin})` : '';
    const aprobados = await permisos.find({ estado: 'aprobado' }).toArray();
    const alumnos = await usuarios.find({ rol: 'alumno', egresado: { $ne: true }, area, semestre, grupo }).toArray();
    const presentes = new Set((await asistencias.find({ fecha, estado: { $in: ['asistio', 'retardo'] }, $or: [{ claseId: String(cl._id) }, { claseId: { $exists: false }, docente: req.u.id, materiaKey: key }] }).toArray()).map(a => a.curp));
    const faltas = [];
    for (const al of alumnos.filter(x => !presentes.has(x.curp))) {
        const p = aprobados.find(x => x.curp === al.curp && x.desde <= fecha && fecha <= x.hasta);
        try {
            await asistencias.insertOne({ _id: `F:${al.curp}:${fecha}:${key}:${cl._id}`, curp: al.curp, alumnoNombre: al.nombre, area, semestre, grupo, fecha, hora, estado: p ? 'justificada' : 'falta', motivo: p ? 'Permiso: ' + p.motivo : undefined, materia, materiaKey: key, claseId: String(cl._id), horaInicio: bl.inicio, horaFin: bl.fin, docente: req.u.id, docenteNombre: s(req.u.nombre) });
            if (!p) faltas.push(al.nombre);
        } catch (e) { if (e.code !== 11000) throw e; }
        if (p) await avisar(al, 'justificada', hora, fecha, `${al.curp}:${fecha}:${key}`, materia, `${al.nombre} no asistió a ${materia}: justificado por permiso`);
        else await avisar(al, 'falta', hora, fecha, `${al.curp}:${fecha}:${key}`, materia, `${al.nombre} faltó a ${materia}${hr} el ${fecha.split('-').reverse().join('/')}`);
    }
    res.json({ ok: true, faltas });
}));

/* Corregir: justificar una falta (avisa al tutor) o quitar un registro equivocado */
app.post('/api/asistencias/editar', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const b = req.body || {}, curp = s(b.curp).toUpperCase(), fecha = s(b.fecha), materia = limpiaMat(b.materia), estado = s(b.estado);
    if (!RX.curp.test(curp) || !fechaValida(fecha) || !materia || !['asistio', 'falta'].includes(estado)) return bad(res, 'Datos de asistencia inválidos');
    if (fecha > fechaHoraMexico().fecha) return bad(res, 'No puedes editar una asistencia de una fecha futura');
    const alumno = await usuarios.findOne({ _id: 'alumno:' + curp, rol: 'alumno' });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    const fechaDe = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
    const historial = (alumno.historialGrupos || []).find(g => fechaDe(g.desde) <= fecha && fechaDe(g.hasta) >= fecha);
    const grupoFecha = historial || (fechaDe(alumno.inicioSemestre || alumno.creado) <= fecha ? alumno : null);
    const anterior = await asistencias.findOne({ curp, fecha, materiaKey: materia.toLowerCase(), estado: { $ne: 'eliminada' } });
    const snapshot = anterior?.area && anterior?.semestre && anterior?.grupo ? anterior : grupoFecha;
    if (!snapshot) return bad(res, 'No hay un grupo registrado para el alumno en esa fecha.', 409);
    const cl = await miClase(req.u.id, snapshot.area, snapshot.semestre, snapshot.grupo, materia);
    if (!cl) return bad(res, 'Solo puedes editar asistencias de tus materias y grupos', 403);
    const key = materia.toLowerCase(), uid = `ED:${curp}:${fecha}:${key}:${cl._id}`;
    const actual = await asistencias.findOne({ curp, fecha, materiaKey: key, claseId: String(cl._id) });
    const cambio = { estado, motivo: s(b.motivo).slice(0, 200), docenteEdicion: req.u.id, editadoEn: new Date() };
    if (actual) await asistencias.updateOne({ _id: actual._id }, { $set: cambio });
    else await asistencias.insertOne({ _id: uid, curp, alumnoNombre: alumno.nombre, area: snapshot.area, semestre: snapshot.semestre, grupo: snapshot.grupo, fecha, hora: fecha === fechaHoraMexico().fecha ? fechaHoraMexico().hora : '00:00', estado, materia, materiaKey: key, claseId: String(cl._id), horaInicio: '', horaFin: '', docente: req.u.id, docenteNombre: s(req.u.nombre), ...cambio });
    if (estado === 'falta' && actual?.estado !== 'falta') await avisar(alumno, 'falta', fecha === fechaHoraMexico().fecha ? fechaHoraMexico().hora : '', fecha, `${curp}:${fecha}:${key}`, materia, `${alumno.nombre} fue registrado con falta en ${materia} (${snapshot.semestre} ${snapshot.area} ${snapshot.grupo}) el ${fecha.split('-').reverse().join('/')}.`);
    await registrarCambio(req, 'Asistencia editada', `${alumno.nombre} · ${materia} · ${fecha} · ${estado}`);
    res.json({ ok: true, estado, uid: actual?._id || uid });
}));

app.post('/api/asistencias/:uid/:accion', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente') return bad(res, 'Solo docentes', 403);
    const reg = await asistencias.findOne({ _id: req.params.uid });
    if (!reg) return bad(res, 'Registro no encontrado', 404);
    const al = await usuarios.findOne({ _id: 'alumno:' + reg.curp });
    const snapshot = reg.area && reg.semestre && reg.grupo ? reg : al && grupoAlumnoEnFecha(al, reg.fecha);
    const cl = al && snapshot && await miClase(req.u.id, snapshot.area, snapshot.semestre, snapshot.grupo, reg.materia);
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
    const codigoActivacion = nuevoCodigoActivacion();
    const cambioPassword = await usuarios.updateOne({ _id: cuenta._id }, { $set: { debeCambiarPassword: true, requiereCodigoActivacion: true, passwordActualizada: new Date(), sessionId: null, activationCodeHash: hashCodigoActivacion(codigoActivacion) }, $unset: { salt: '', hash: '' } });
    if (!cambioPassword.matchedCount) return bad(res, 'No se pudo restablecer la contraseña de esa cuenta', 409);
    await solicitudesRecuperacion.deleteOne({ _id: solicitud._id, estado: 'pendiente' });
    await registrarCambio(req, 'Restablecimiento de contraseña', `${solicitud.rol} · ${solicitud.curp}`);
    const mensajeAviso = 'Servicios Escolares restableció tu contraseña. Entra con tu CURP y crea una nueva.';
    await avisos.insertOne({ _id: 'password:' + solicitud.curp + ':' + Date.now(), para: solicitud.curp, curp: solicitud.curp, tipo: 'password', texto: mensajeAviso, fecha: new Date().toISOString().slice(0,10), creado: new Date() });
    await enviarPush(solicitud.rol, solicitud.curp, 'Contraseña restablecida', mensajeAviso, '/');
    res.json({ ok: true, codigoActivacion });
}));
const ROLES_CUENTA = { alumno: 'alumno', docente: 'docente', tutor: 'tutor' };
const MAX_ALUMNOS_TUTOR = 3;
/* Regla de CURP: en un mismo tipo de cuenta nunca se repite; un alumno no puede compartir CURP con nadie;
   un docente sí puede tener además su cuenta de tutor. Devuelve el choque o null. */
const conflictoCurp = async (rol, curp, session) => {
    const c = String(curp).toUpperCase();
    const mismo = await usuarios.findOne({ _id: `${rol}:${c}` }, { projection: { rol: 1 }, session });
    if (mismo) return { rol, mismoRol: true };
    const otros = await usuarios.find({ curp: c }, { projection: { rol: 1 }, session }).toArray();
    const choque = otros.find(o => rol === 'alumno' || o.rol === 'alumno');
    return choque ? { rol: choque.rol } : null;
};
const textoConflicto = (rol, ch) => ch.mismoRol
    ? `Ya existe una cuenta de ${ROLES_CUENTA[rol] || rol} con esa CURP.`
    : `Esa CURP ya está registrada como ${ROLES_CUENTA[ch.rol] || ch.rol}. Un alumno no puede compartir su CURP con otra cuenta.`;
app.post('/api/admin/usuarios', auth, soloAdmin, h(async (req, res) => {
    const d = req.body || {}, rol = s(d.rol), id = s(d.id).toUpperCase();
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    if (!RX.curp.test(id)) return bad(res, 'CURP inválida (18 letras y números)');
    if (ADMIN_CURP && id === ADMIN_CURP) return bad(res, 'Esa CURP está reservada para Servicios Escolares');
    if (s(d.nombre).length < 3) return bad(res, 'Escribe el nombre completo');
    const previa = await conflictoCurp(rol, id);
    if (previa) return bad(res, textoConflicto(rol, previa), 409);
    const creado = new Date();
    const inicioSemestre = fechaHoraMexico().fecha;
    const doc = { _id: `${rol}:${id}`, rol, id, curp: id, nombre: s(d.nombre), debeCambiarPassword: true, creado };
    if (rol === 'alumno') {            // el grupo se crea solo la primera vez que se usa
        const semestre = s(d.semestre).slice(0, 20), area = s(d.area).slice(0, 40), grupo = s(d.grupo).toUpperCase().slice(0, 3);
        const configSemestres = await periodos.findOne({ _id: 'semestres-activos' }), activos = semestresDelPeriodo(configSemestres?.periodo || 'impares');
        if (!activos.includes(semestre) || !['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'].includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Elige uno de los semestres activos, el área y el grupo (A, B o C)');
        Object.assign(doc, { area, semestre, grupo, tutores: [], inicioSemestre });
    }
    let alumnoVinculo = null;
    if (rol === 'tutor') {
        const curpAlumno = s(d.curpAlumno).toUpperCase();
        if (!RX.curp.test(curpAlumno)) return bad(res, 'Escribe la CURP del alumno (18 letras y números).');
        if (curpAlumno === id) return bad(res, 'La CURP del alumno no puede ser la misma del tutor.');
        doc.curpAlumno = curpAlumno;
        doc.hijos = [curpAlumno];
        alumnoVinculo = await usuarios.findOne({ _id: `alumno:${curpAlumno}`, rol: 'alumno' });
    }
    let tutorId = '', tutorNuevo = null, tutorPrevio = null;
    if (rol === 'alumno' && s(d.tutorCurp)) {   // el tutor se crea (o se enlaza si ya existe) junto con el alumno
        tutorId = s(d.tutorCurp).toUpperCase();
        if (!RX.curp.test(tutorId)) return bad(res, 'La CURP del tutor es inválida (18 letras y números)');
        if (tutorId === id) return bad(res, 'La CURP del tutor no puede ser la del alumno');
        if (ADMIN_CURP && tutorId === ADMIN_CURP) return bad(res, 'Esa CURP está reservada para Servicios Escolares');
        tutorPrevio = await usuarios.findOne({ _id: `tutor:${tutorId}` });
        if (!tutorPrevio) {
            const choque = await conflictoCurp('tutor', tutorId);
            if (choque) return bad(res, textoConflicto('tutor', choque), 409);
            const docente = await usuarios.findOne({ _id: `docente:${tutorId}` }, { projection: { nombre: 1 } });
            const nombreTutor = s(d.tutorNombre) || docente?.nombre || '';
            if (nombreTutor.length < 3) return bad(res, 'Escribe el nombre completo del tutor');
            tutorNuevo = { _id: `tutor:${tutorId}`, rol: 'tutor', id: tutorId, curp: tutorId, nombre: nombreTutor, hijos: [id], curpAlumno: id, debeCambiarPassword: true, creado: new Date() };
        } else if (hijosDe(tutorPrevio).filter(x => x !== id).length >= MAX_ALUMNOS_TUTOR) {
            return bad(res, `Ese tutor ya tiene ${MAX_ALUMNOS_TUTOR} alumnos vinculados, que es el máximo.`, 409);
        }
        doc.tutores = [tutorId];
    }
    try { await usuarios.insertOne(doc); } catch (e) { if (e.code === 11000) return bad(res, 'Esa CURP ya está registrada. Una CURP no se puede repetir.', 409); throw e; }
    if (tutorId) {
        try {
            if (tutorNuevo) await usuarios.insertOne(tutorNuevo);
            else await usuarios.updateOne({ _id: `tutor:${tutorId}` }, { $addToSet: { hijos: id } });
        } catch (e) { await usuarios.deleteOne({ _id: doc._id }); if (e.code === 11000) return bad(res, 'La CURP del tutor ya está registrada. Una CURP no se puede repetir.', 409); throw e; }
        await registrarCambio(req, 'Vínculo tutor-alumno', `${tutorNuevo ? 'Tutor creado' : 'Tutor existente'} · ${tutorId} · ${id}`);
    }
    if (rol === 'tutor' && alumnoVinculo) {
        await usuarios.updateOne({ _id: alumnoVinculo._id }, { $addToSet: { tutores: id } });
        await registrarCambio(req, 'Vinculo tutor-alumno', `${id} · ${alumnoVinculo.curp}`);
    }
    if (rol === 'alumno') {
        const tutoresPendientes = await usuarios.find({ rol: 'tutor', curpAlumno: id }).toArray();
        for (const tutor of tutoresPendientes) {
            await usuarios.updateOne({ _id: doc._id }, { $addToSet: { tutores: tutor.curp } });
            await usuarios.updateOne({ _id: tutor._id }, { $addToSet: { hijos: id } });
            await registrarCambio(req, 'Vinculo tutor-alumno', `${tutor.curp} · ${id}`);
        }
    }
    if (rol === 'alumno') await grupos.updateOne({ _id: `${doc.semestre}|${doc.area}|${doc.grupo}` }, { $set: { semestre: doc.semestre, area: doc.area, grupo: doc.grupo, nombre: `${doc.semestre} ${doc.area} ${doc.grupo}` } }, { upsert: true });
    await registrarCambio(req, 'Cuenta creada', `${rol} · ${id}`);
    res.status(201).json({ ok: true, tutor: tutorId ? (tutorNuevo ? 'creado' : 'vinculado') : '', alumnoVinculo: rol === 'tutor' ? (alumnoVinculo ? 'vinculado' : 'pendiente') : undefined });
}));
app.post('/api/admin/usuarios/importar', auth, soloAdmin, h(async (req, res) => {
    const filas = req.body?.cuentas;
    if (!Array.isArray(filas) || !filas.length || filas.length > 500) return bad(res, 'Envía entre 1 y 500 cuentas para importar.');
    const configSemestres = await periodos.findOne({ _id: 'semestres-activos' }), semestresValidos = semestresDelPeriodo(configSemestres?.periodo || 'impares');
    const areasValidas = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
    const documentos = [], curps = new Set(), gruposNuevos = new Map(), rolesEnArchivo = new Map();
    for (let i = 0; i < filas.length; i++) {
        const d = filas[i] || {}, rol = s(d.rol), id = s(d.id).toUpperCase(), nombre = s(d.nombre).replace(/\s+/g, ' ');
        if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, `Fila ${i + 1}: rol inválido.`);
        if (!RX.curp.test(id)) return bad(res, `Fila ${i + 1}: CURP inválida.`);
        if (ADMIN_CURP && id === ADMIN_CURP) return bad(res, `Fila ${i + 1}: CURP reservada para Servicios Escolares.`);
        if (nombre.length < 3 || nombre.length > 120) return bad(res, `Fila ${i + 1}: escribe un nombre de 3 a 120 caracteres.`);
        const _id = `${rol}:${id}`;
        const previosArchivo = rolesEnArchivo.get(id) || new Set();
        if (previosArchivo.has(rol) || (rol === 'alumno' && previosArchivo.size) || previosArchivo.has('alumno')) return bad(res, `Fila ${i + 1}: CURP repetida en el archivo.`);
        previosArchivo.add(rol); rolesEnArchivo.set(id, previosArchivo);
        curps.add(id);
        const creado = new Date();
        const inicioSemestre = fechaHoraMexico().fecha;
        const doc = { _id, rol, id, curp: id, nombre, debeCambiarPassword: true, creado };
        if (rol === 'alumno') {
            const semestre = s(d.semestre), area = s(d.area), grupo = s(d.grupo).toUpperCase();
            if (!semestresValidos.includes(semestre) || !areasValidas.includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, `Fila ${i + 1}: semestre, área o grupo inválido.`);
            Object.assign(doc, { semestre, area, grupo, tutores: [], inicioSemestre });
            const key = `${semestre}|${area}|${grupo}`;
            gruposNuevos.set(key, { _id: key, semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` });
        }
        if (rol === 'tutor') {
            const curpAlumno = s(d.curpAlumno).toUpperCase();
            if (!RX.curp.test(curpAlumno)) return bad(res, `Fila ${i + 1}: agrega la CURP válida del alumno.`);
            if (curpAlumno === id) return bad(res, `Fila ${i + 1}: la CURP del alumno no puede ser la misma del tutor.`);
            Object.assign(doc, { curpAlumno, hijos: [curpAlumno] });
        }
        documentos.push(doc);
    }
    const session = usuarios.client.startSession();
    let conflictos = [];
    try {
        await session.withTransaction(async () => {
            const existentes = await usuarios.find({ curp: { $in: [...curps] } }, { projection: { curp: 1, rol: 1 }, session }).toArray();
            conflictos = existentes.filter(x => documentos.some(d => d.curp === x.curp && (d.rol === x.rol || d.rol === 'alumno' || x.rol === 'alumno'))).map(x => `${x.curp} (${x.rol})`);
            if (conflictos.length) return;
            await usuarios.insertMany(documentos, { ordered: true, session });
            for (const tutor of documentos.filter(x => x.rol === 'tutor')) {
                const alumno = await usuarios.findOne({ _id: `alumno:${tutor.curpAlumno}` }, { session });
                if (!alumno) continue;
                await usuarios.updateOne({ _id: tutor._id }, { $addToSet: { hijos: alumno.curp } }, { session });
                await usuarios.updateOne({ _id: alumno._id }, { $addToSet: { tutores: tutor.curp } }, { session });
            }
            for (const alumno of documentos.filter(x => x.rol === 'alumno')) {
                const tutoresPendientes = await usuarios.find({ rol: 'tutor', curpAlumno: alumno.curp }, { session }).toArray();
                for (const tutor of tutoresPendientes) {
                    await usuarios.updateOne({ _id: alumno._id }, { $addToSet: { tutores: tutor.curp } }, { session });
                    await usuarios.updateOne({ _id: tutor._id }, { $addToSet: { hijos: alumno.curp } }, { session });
                }
            }
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
app.post('/api/admin/usuarios/:rol/:id/codigo-activacion', auth, soloAdmin, h(async (req, res) => {
    const rol = s(req.params.rol), id = s(req.params.id).toUpperCase();
    if (!['alumno', 'docente', 'tutor'].includes(rol)) return bad(res, 'Tipo de cuenta inválido');
    const cuenta = await usuarios.findOne({ _id: `${rol}:${id}`, debeCambiarPassword: true });
    if (!cuenta) return bad(res, 'La cuenta no existe o ya fue activada', 404);
    const codigo = nuevoCodigoActivacion();
    await usuarios.updateOne({ _id: cuenta._id, debeCambiarPassword: true }, { $set: { requiereCodigoActivacion: true, activationCodeHash: hashCodigoActivacion(codigo) } });
    await registrarCambio(req, 'Código de activación emitido', `${rol} · ${id}`);
    res.json({ ok: true, codigo, curp: id });
}));
app.post('/api/admin/editar', auth, soloAdmin, h(async (req, res) => {
    const id = 'alumno:' + s(req.body.id).toUpperCase(), c = {};
    for (const k of ['area', 'semestre', 'grupo']) if (s(req.body[k])) c[k] = s(req.body[k]).slice(0, 40);
    const alumno = await usuarios.findOne({ _id: id });
    if (!alumno) return bad(res, 'Alumno no encontrado', 404);
    const nuevo = { semestre: c.semestre || alumno.semestre, area: c.area || alumno.area, grupo: c.grupo || alumno.grupo };
    if (!SEMESTRES_VALIDOS.includes(nuevo.semestre) || !['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'].includes(nuevo.area) || !['A', 'B', 'C'].includes(nuevo.grupo)) return bad(res, 'Semestre, área o grupo inválido.');
    if (`${nuevo.semestre}|${nuevo.area}|${nuevo.grupo}` !== `${alumno.semestre}|${alumno.area}|${alumno.grupo}`) {
        const hoy = fechaHoraMexico().fecha, inicioNuevo = new Date(`${hoy}T12:00:00.000Z`); inicioNuevo.setUTCDate(inicioNuevo.getUTCDate() + 1);
        c.inicioSemestre = inicioNuevo.toISOString().slice(0, 10);
        await usuarios.updateOne({ _id: id }, [{ $set: { ...c, historialGrupos: { $concatArrays: [{ $ifNull: ['$historialGrupos', []] }, [{ semestre: '$semestre', area: '$area', grupo: '$grupo', desde: { $ifNull: ['$inicioSemestre', '$creado'] }, hasta: hoy }]] } } }]);
        const gid = `${nuevo.semestre}|${nuevo.area}|${nuevo.grupo}`;
        await grupos.updateOne({ _id: gid }, { $setOnInsert: { semestre: nuevo.semestre, area: nuevo.area, grupo: nuevo.grupo, nombre: `${nuevo.semestre} ${nuevo.area} ${nuevo.grupo}` } }, { upsert: true });
    } else await usuarios.updateOne({ _id: id }, { $set: c });
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
app.get('/api/semestres', auth, h(async (_req, res) => {
    const config = await periodos.findOne({ _id: 'semestres-activos' });
    const periodo = config?.periodo === 'pares' ? 'pares' : 'impares';
    res.json({ periodo, activos: semestresDelPeriodo(periodo), siguientes: semestresDelPeriodo(periodo === 'pares' ? 'impares' : 'pares') });
}));
app.post('/api/admin/semestres', auth, soloAdmin, h(async (req, res) => {
    const periodo = s(req.body?.periodo);
    if (!['impares', 'pares'].includes(periodo)) return bad(res, 'Elige el periodo de semestres impares o pares.');
    await periodos.updateOne({ _id: 'semestres-activos' }, { $set: { periodo, actualizado: new Date(), actualizadoPor: req.u.id } }, { upsert: true });
    await registrarCambio(req, 'Periodo de semestres actualizado', `Semestres ${periodo} activos: ${semestresDelPeriodo(periodo).join(', ')}`);
    res.json({ periodo, activos: semestresDelPeriodo(periodo), siguientes: semestresDelPeriodo(periodo === 'pares' ? 'impares' : 'pares') });
}));
app.post('/api/admin/grupos', auth, soloAdmin, h(async (req, res) => {
    const semestre = s(req.body?.semestre), area = s(req.body?.area), grupo = s(req.body?.grupo).toUpperCase();
    const areasValidas = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
    if (!SEMESTRES_VALIDOS.includes(semestre) || !areasValidas.includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Elige semestre, área y grupo válidos.');
    const id = `${semestre}|${area}|${grupo}`;
    await grupos.updateOne({ _id: id }, { $setOnInsert: { semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}`, creado: new Date() } }, { upsert: true });
    await registrarCambio(req, 'Grupo preparado', `${semestre} ${area} ${grupo}`);
    res.status(201).json({ ok: true, id });
}));
app.post('/api/admin/grupos/avanzar', auth, soloAdmin, h(async (req, res) => {
    const semestre = s(req.body?.semestre), area = s(req.body?.area), grupo = s(req.body?.grupo).toUpperCase();
    const numero = Number(semestre.match(/^([1-6]) semestre$/)?.[1] || 0);
    if (!numero || !['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'].includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Grupo de origen inválido.');
    const configSemestres = await periodos.findOne({ _id: 'semestres-activos' });
    if (!semestresDelPeriodo(configSemestres?.periodo || 'impares').includes(semestre)) return bad(res, 'Ese semestre no forma parte del periodo activo.', 409);
    const calendario = await periodoActivo();
    const parcialTres = calendario && estadoPeriodo(calendario, fechaHoraMexico().fecha).parciales?.find(x => x.n === 3);
    if (parcialTres?.estado !== 'cerrado') return bad(res, 'Control Escolar puede confirmar el avance cuando el tercer parcial esté cerrado.', 409);
    const filtro = { rol: 'alumno', semestre, area, grupo, egresado: { $ne: true } };
    const alumnos = await usuarios.find(filtro).toArray();
    if (!alumnos.length) return bad(res, 'No hay alumnos activos en ese grupo.', 404);
    if (numero === 6) {
        const ahora = new Date(), hoy = fechaHoraMexico().fecha;
        await usuarios.updateMany(filtro, [{ $set: { egresado: true, egresadoEn: ahora, historialGrupos: { $concatArrays: [{ $ifNull: ['$historialGrupos', []] }, [{ semestre: '$semestre', area: '$area', grupo: '$grupo', desde: { $ifNull: ['$inicioSemestre', '$creado'] }, hasta: hoy, estado: 'egresado' }]] } } }]);
        await registrarCambio(req, 'Grupo egresado', `${alumnos.length} alumnos · 6 semestre ${area} ${grupo}`);
        return res.json({ ok: true, egresados: alumnos.length });
    }
    const siguiente = `${numero + 1} semestre`, idDestino = `${siguiente}|${area}|${grupo}`;
    if (!await grupos.findOne({ _id: idDestino })) return bad(res, `Prepara primero el grupo destino ${siguiente} ${area} ${grupo}, con sus materias y horario.`, 409);
    const filtroDestino = { semestre: siguiente, area, grupo };
    if (!await clases.findOne(filtroDestino) || !await horarios.findOne({ ...filtroDestino, tipo: 'clase' })) return bad(res, `Completa primero las materias y el horario de ${siguiente} ${area} ${grupo}.`, 409);
    const hoy = fechaHoraMexico().fecha, ahora = new Date(`${hoy}T12:00:00.000Z`); ahora.setUTCDate(ahora.getUTCDate() + 1);
    await usuarios.updateMany(filtro, [
        { $set: { historialGrupos: { $concatArrays: [{ $ifNull: ['$historialGrupos', []] }, [{ semestre: '$semestre', area: '$area', grupo: '$grupo', desde: { $ifNull: ['$inicioSemestre', '$creado'] }, hasta: hoy }]] }, semestre: siguiente, inicioSemestre: ahora.toISOString().slice(0, 10) } }
    ]);
    await grupos.updateOne({ _id: idDestino }, { $set: { semestre: siguiente, area, grupo, nombre: `${siguiente} ${area} ${grupo}` } }, { upsert: true });
    await registrarCambio(req, 'Alumnos avanzaron de semestre', `${alumnos.length} alumnos · ${semestre} ${area} ${grupo} → ${siguiente} ${area} ${grupo}`);
    res.json({ ok: true, avanzados: alumnos.length, semestre: siguiente });
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
        for (const c of await permitidas(req.u)) { const al = await usuarios.findOne({ _id: 'alumno:' + c }); if (al && !al.egresado) gs.add(`${al.area}|${al.semestre}|${al.grupo}`); }
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
    if (req.u.rol === 'docente') {
        const ids = new Set((await clases.find({ docente: req.u.id }).project({ _id: 1 }).toArray()).map(x => String(x._id)));
        l = l.filter(b => b.docente === req.u.id || ids.has(String(b.claseId)));
    }
    else if (req.u.rol !== 'admin') {
        const gs = new Set();
        for (const c of await permitidas(req.u)) { const al = await usuarios.findOne({ _id: 'alumno:' + c }); if (al && !al.egresado) gs.add(`${al.area}|${al.semestre}|${al.grupo}`); }
        l = l.filter(b => gs.has(`${b.area}|${b.semestre}|${b.grupo}`));
    }
    res.json(l.map(({ _id, ...r }) => ({ id: _id, ...r })));
}));
app.post('/api/admin/horarios', auth, adminDe('gabriela', 'control'), h(async (req, res) => {
    const b = req.body || {}, area = s(b.area), semestre = s(b.semestre), grupo = s(b.grupo).toUpperCase(), dia = Number(b.dia), tipo = b.tipo === 'descanso' ? 'descanso' : 'clase', HM = /^\d{2}:\d{2}$/;
    const SEM_OK = SEMESTRES_VALIDOS, AREAS_OK = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
    if (!SEM_OK.includes(semestre) || !AREAS_OK.includes(area) || !['A', 'B', 'C'].includes(grupo)) return bad(res, 'Grupo inválido');
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
        const traslape = await horarios.findOne({
            tipo: 'clase', dia, docente: cl.docente,
            inicio: { $lt: doc.fin }, fin: { $gt: doc.inicio }
        });
        if (traslape) return bad(res, `El docente ${cl.docenteNombre || cl.docente} ya tiene ${traslape.materia} de ${traslape.inicio} a ${traslape.fin} ese día. Elige otro horario.`, 409);
    }
    await grupos.updateOne({ _id: `${semestre}|${area}|${grupo}` }, { $setOnInsert: { semestre, area, grupo, nombre: `${semestre} ${area} ${grupo}` } }, { upsert: true });
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
    if (!RX.curp.test(t) || !RX.curp.test(a) || t === a) return bad(res, 'Revisa las CURP del tutor y del alumno.');
    const tu = await usuarios.findOne({ _id: 'tutor:' + t }), al = await usuarios.findOne({ _id: 'alumno:' + a });
    if (!tu || !al) return bad(res, 'No se encontró el tutor o el alumno', 404);
    if (!hijosDe(tu).includes(a) && hijosDe(tu).length >= MAX_ALUMNOS_TUTOR) return bad(res, `Un tutor puede tener máximo ${MAX_ALUMNOS_TUTOR} alumnos vinculados.`, 409);
    await usuarios.updateOne({ _id: tu._id }, { $addToSet: { hijos: a } });
    await usuarios.updateOne({ _id: al._id }, { $addToSet: { tutores: t } });
    await registrarCambio(req, 'Vínculo tutor-alumno', `${tu.nombre} · ${al.nombre}`);
    res.json({ ok: true });
}));

/* ---------- Avisos de la administración (anuncios) ---------- */
const DESTINOS = { tutor: ['tutor'], docente: ['docente'], alumno: ['alumno'], 'alumno,docente': ['alumno', 'docente'], 'tutor,alumno': ['tutor', 'alumno'], 'tutor,docente': ['tutor', 'docente'], todos: ['tutor', 'docente', 'alumno', 'admin'] };
app.post('/api/admin/suspensiones', auth, adminDe('sara'), h(async (req, res) => {
    const desde = s(req.body?.desde), hasta = s(req.body?.hasta), motivo = s(req.body?.motivo).slice(0, 120);
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || !motivo) return bad(res, 'Revisa las fechas y escribe el motivo.');
    const fechas = [];
    for (let d = new Date(`${desde}T12:00:00.000Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) fechas.push(d.toISOString().slice(0, 10));
    if (fechas.length > 31) return bad(res, 'El periodo sin clases puede durar hasta 31 días.');
    const periodo = await periodoActivo();
    if (!periodo) return bad(res, 'Control Escolar debe configurar primero el ciclo escolar.', 409);
    if (desde < periodo.inicioClases || hasta > periodo.finClases) return bad(res, 'Las fechas deben quedar dentro del ciclo escolar activo.');
    const existentes = new Set((periodo.diasSinClase || []).map(x => x.fecha));
    if (fechas.some(f => existentes.has(f))) return bad(res, 'Alguna fecha ya forma parte de otro periodo sin clases.');
    if (existentes.size + fechas.length > 150) return bad(res, 'El calendario ya contiene el máximo de fechas sin clases.');
    await periodos.updateOne({ _id: periodo._id }, { $push: { diasSinClase: { $each: fechas.map(fecha => ({ fecha, motivo })) } } });
    const titulo = desde === hasta ? 'Día sin clases' : 'Periodo sin clases';
    const rango = desde === hasta ? desde : `${desde} al ${hasta}`;
    const mensaje = `${titulo} programado del ${rango}: ${motivo}.`;
    const id = crypto.randomBytes(5).toString('hex'), para = DESTINOS.todos;
    await anuncios.insertOne({ _id: id, titulo, mensaje, para, creado: new Date(), por: req.u.id });
    await Promise.all(para.map(async rol => {
        const personas = await usuarios.find({ rol }).project({ id: 1 }).toArray();
        await Promise.all(personas.map(u => enviarPush(rol, u.id, titulo, mensaje, '/')));
    }));
    await registrarCambio(req, 'Periodo sin clases programado', `${rango} · ${motivo}`);
    res.status(201).json({ ok: true, id, fechas: fechas.length });
}));
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
        if (req.u.rol === 'tutor' && !hijosDe(yo).includes(curp) && hijosDe(yo).length >= MAX_ALUMNOS_TUTOR) return bad(res, `Un tutor puede tener máximo ${MAX_ALUMNOS_TUTOR} alumnos vinculados.`);
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

app.get('/api/periodos', auth, h(async (_req, res) => {
    res.json(vistaPeriodo(await periodoActivo()));
}));

app.post('/api/admin/periodos', auth, adminDe('control'), h(async (req, res) => {
    const body = req.body || {};
    const ciclo = s(body.ciclo);
    const config = {
        ciclo,
        inicioClases: s(body.inicioClases),
        finClases: s(body.finClases),
        parciales: Array.isArray(body.parciales) ? body.parciales.map(p => p && typeof p === 'object' ? ({
            n: Number(p.n),
            inicio: s(p.inicio),
            fin: s(p.fin),
            califAbre: s(p.califAbre),
            califCierra: s(p.califCierra)
        }) : null) : body.parciales,
        diasSinClase: []
    };
    const cicloId = `ciclo:${crypto.createHash('sha256').update(ciclo).digest('hex').slice(0, 24)}`;
    const anterior = await periodos.findOne({ _id: cicloId });
    config.diasSinClase = anterior?.diasSinClase || [];
    const error = validarPeriodo(config);
    if (error) return bad(res, error);

    const parciales = config.parciales.map(parcial => {
        const previo = anterior?.parciales?.find(x => Number(x.n) === parcial.n);
        return {
            ...parcial,
            ...(previo?.manualEstado ? {
                manualEstado: previo.manualEstado,
                manualEventoUid: previo.manualEventoUid,
                manualEventoEstado: previo.manualEventoEstado,
                manualActualizadoEn: previo.manualActualizadoEn,
                versionManual: Number(previo.versionManual) || 0
            } : { versionManual: 0 })
        };
    });
    const actualizado = new Date();
    await periodos.updateOne(
        { _id: cicloId },
        { $set: { ...config, parciales, actualizado, actualizadoPor: req.u.id } },
        { upsert: true }
    );
    await periodos.updateOne(
        { _id: 'activo' },
        { $set: { cicloId, actualizado, actualizadoPor: req.u.id } },
        { upsert: true }
    );
    const detalle = `Ciclo ${ciclo}: ${config.inicioClases} a ${config.finClases}; ${config.parciales.length} parciales y ${config.diasSinClase.length} días sin clases.`;
    await registrarCambio(req, 'Configuración de periodo escolar actualizada', detalle);
    const diasAnteriores = new Map((anterior?.diasSinClase || []).map(d => [d.fecha, d.motivo]));
    for (const dia of config.diasSinClase) {
        if (diasAnteriores.get(dia.fecha) === dia.motivo) continue;
        const texto = `Día sin clases programado para el ${dia.fecha}: ${dia.motivo}. Ciclo ${ciclo}.`;
        const idAviso = `dia-sin-clase:${cicloId}:${dia.fecha}`;
        await avisos.updateOne({ _id: idAviso }, { $set: { para: ADMIN_ID, tipo: 'calendario-sara', texto, fecha: dia.fecha, creado: new Date() } }, { upsert: true });
    }
    res.json(vistaPeriodo(await periodos.findOne({ _id: cicloId })));
}));

app.post('/api/admin/periodos/:n/estado', auth, adminDe('control'), h(async (req, res) => {
    const n = Number(req.params.n), estado = s(req.body?.estado), uid = s(req.body?.uid), versionEsperada = Number(req.body?.versionManual);
    if (![1, 2, 3].includes(n) || !['abierto', 'cerrado'].includes(estado) || !/^[\w-]{8,64}$/.test(uid)
        || !Number.isInteger(versionEsperada) || versionEsperada < 0)
        return bad(res, 'La acción del parcial no es válida.');
    const periodo = await periodoActivo();
    if (!periodo) return bad(res, 'Primero configura el ciclo escolar y sus parciales.', 409);
    const parcial = periodo.parciales.find(x => Number(x.n) === n);
    if (!parcial) return bad(res, 'El parcial no existe en el ciclo activo.', 404);
    const vistaActual = estadoPeriodo(periodo, fechaHoraMexico().fecha);
    if (!vistaActual.parciales.find(x => x.n === n)?.habilitado)
        return bad(res, 'Este parcial se habilita cuando termina el parcial anterior.', 409);
    const registrarEvento = async eventoUid => {
        const accion = estado === 'abierto' ? 'abierto manualmente' : 'cerrado manualmente';
        try {
            await registrarCambio(req, `Parcial ${accion}`, `${periodo.ciclo} · parcial ${n}`, `periodo:${eventoUid}`);
        } catch (e) {
            if (e.code !== 11000) throw e;
        }
        await notificarDocentesPeriodo(periodo, parcial, estado, `manual:${eventoUid}`);
    };

    if (parcial.manualEventoUid === uid && parcial.manualEventoEstado === estado) {
        await registrarEvento(uid);
        return res.json({ ok: true, duplicada: true, periodo: vistaPeriodo(periodo) });
    }
    if (parcial.manualEstado === estado) {
        if (parcial.manualEventoUid && parcial.manualEventoEstado === estado)
            await registrarEvento(parcial.manualEventoUid);
        return res.json({ ok: true, sinCambios: true, periodo: vistaPeriodo(periodo) });
    }

    const actualizado = new Date();
    const resultado = await periodos.updateOne(
        { _id: periodo._id },
        {
            $set: {
                'parciales.$[parcial].manualEstado': estado,
                'parciales.$[parcial].manualEventoUid': uid,
                'parciales.$[parcial].manualEventoEstado': estado,
                'parciales.$[parcial].manualActualizadoEn': actualizado,
                'parciales.$[parcial].versionManual': versionEsperada + 1,
                actualizado,
                actualizadoPor: req.u.id
            }
        },
        { arrayFilters: [{ 'parcial.n': n, 'parcial.manualEstado': { $ne: estado }, 'parcial.versionManual': versionEsperada }] }
    );
    const actualizadoPeriodo = await periodos.findOne({ _id: periodo._id });
    const actualizadoParcial = actualizadoPeriodo?.parciales?.find(x => Number(x.n) === n);
    if (!resultado.modifiedCount) {
        if (actualizadoParcial?.manualEventoUid === uid && actualizadoParcial.manualEventoEstado === estado) {
            await registrarEvento(uid);
            return res.json({ ok: true, duplicada: true, periodo: vistaPeriodo(actualizadoPeriodo) });
        }
        if (actualizadoParcial?.manualEstado === estado)
            return res.json({ ok: true, sinCambios: true, periodo: vistaPeriodo(actualizadoPeriodo) });
        return bad(res, 'El periodo cambió mientras se guardaba. Vuelve a intentarlo.', 409);
    }

    await registrarEvento(uid);
    res.json({ ok: true, periodo: vistaPeriodo(actualizadoPeriodo) });
}));

/* ---------- Calificaciones ---------- */
app.post('/api/calificaciones', auth, h(async (req, res) => {
    if (req.u.rol !== 'docente' && !(req.u.rol === 'admin' && req.u.adminArea === 'control')) return bad(res, 'No tienes permiso para subir calificaciones', 403);
    const m = limpiaMat(req.body.materia), key = m.toLowerCase(), p = Number(req.body.parcial), notas = req.body.notas;
    if (!m || ![1, 2, 3].includes(p) || !Array.isArray(notas)) return bad(res, 'Datos inválidos');
    const hoy = fechaHoraMexico().fecha, periodo = await periodoActivo(), estadoHoy = periodo ? estadoPeriodo(periodo, hoy) : null;
    const parcial = estadoHoy?.parciales.find(x => x.n === p);
    const advertencia = req.u.rol === 'docente' && !parcial?.califAbierta
        ? !periodo
            ? 'Aún no se configura el ciclo escolar. La calificación se guardó, pero revisa la ventana de captura.'
            : !parcial
                ? 'El parcial no está configurado. La calificación se guardó fuera de una ventana escolar definida.'
                : 'La calificación se guardó fuera de la ventana de captura configurada.'
        : '';
    const publicada = !!parcial?.califPublicada;
    let n = 0;
    for (const x of notas.slice(0, 200)) {
        const curp = s(x.curp).toUpperCase(), nota = Number(x.nota);
        if (!RX.curp.test(curp) || !(nota >= 0 && nota <= 10)) continue;
        const al = await usuarios.findOne({ _id: 'alumno:' + curp });
        if (!al) continue;
        if (req.u.rol === 'docente' && !await miClase(req.u.id, al.area, al.semestre, al.grupo, m)) continue;
        if (req.u.rol === 'admin' && (al.area !== req.body.area || al.semestre !== req.body.semestre || al.grupo !== req.body.grupo)) continue;
        await calificaciones.updateOne({ _id: `C:${curp}:${key}:${p}` }, { $set: { curp, materia: m, materiaKey: key, parcial: p, nota, docente: req.u.id } }, { upsert: true });
        if (publicada) {
            const texto = `Ya se publicó tu calificación de ${m}, parcial ${p}: ${nota}.`;
            const avisoId = `calif:${curp}:${key}:${p}:${nota}`;
            const aviso = await avisos.updateOne(
                { _id: avisoId },
                { $setOnInsert: { para: curp, curp, tipo: 'calif', texto, materia: m, fecha: hoy, creado: new Date() } },
                { upsert: true }
            );
            if (aviso.upsertedCount) await enviarPush('alumno', curp, 'Calificación publicada', texto, '/#/calificaciones');
            await avisar(al, 'calif', '', hoy, `C:${curp}:${key}:${p}:${nota}`, m, `${al.nombre}: ${m}, parcial ${p}: ${nota}`);
        }
        n++;
    }
    res.json({ ok: true, guardadas: n, advertencia, publicada });
}));
app.get('/api/calificaciones', auth, h(async (req, res) => {
    const c = await permitidas(req.u), q = c ? { curp: { $in: c } } : {};
    if (req.u.rol === 'alumno' || req.u.rol === 'tutor') {
        const periodo = await periodoActivo();
        const publicadas = periodo
            ? estadoPeriodo(periodo, fechaHoraMexico().fecha).parciales.filter(x => x.califPublicada).map(x => x.n)
            : [];
        if (!publicadas.length) return res.json([]);
        q.parcial = { $in: publicadas };
    }
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
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde || !motivo) return bad(res, 'Revisa las fechas y escribe el motivo');
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
    if (!RX.curp.test(curp) || !fechaValida(fecha) || !motivo) return bad(res, 'Elige alumno, fecha y motivo del citatorio');
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
    const filtro = { para: req.u.id };
    if (req.u.rol === 'admin' && req.u.adminArea !== 'sara') filtro.tipo = { $ne: 'calendario-sara' };
    const lista = await avisos.find(filtro).sort({ creado: -1 }).limit(100).toArray();
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
    for (const areas of areasDuplicadas(ADMIN_ACCESS_PASSWORDS)) {
        console.error(`Error de configuración: hay contraseñas iguales en las áreas administrativas ${areas.join(', ')}. Configura una contraseña distinta para cada área.`);
    }
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
        asistenciasPendientes = db.collection('asistenciasPendientes');
        cierresPendientes = db.collection('cierresPendientes');
        accesosEscuela = db.collection('accesosEscuela');
        accesosEscuelaBloqueos = db.collection('accesosEscuelaBloqueos');
        calificaciones = db.collection('calificaciones');
        grupos = db.collection('grupos');
        clases = db.collection('clases');
        permisos = db.collection('permisos');
        anuncios = db.collection('anuncios');
        horarios = db.collection('horarios');
        periodos = db.collection('periodos');
        avisos = db.collection('avisos');
        suscripcionesPush = db.collection('suscripcionesPush');
        recordatoriosPush = db.collection('recordatoriosPush');
        solicitudesRecuperacion = db.collection('solicitudesRecuperacion');
        intentosLogin = db.collection('intentosLogin');
        await intentosLogin.createIndex({ vence: 1 }, { expireAfterSeconds: 0 });
        auditoria = db.collection('auditoria');
        avisosLeidos = db.collection('avisosLeidos');
        reportesConducta = db.collection('reportesConducta');
        citatorios = db.collection('citatorios');
        await solicitudesRecuperacion.createIndex({ curp: 1, rol: 1, estado: 1 });
        await asistencias.createIndex({ curp: 1, fecha: -1 });
        await asistenciasPendientes.createIndex({ docente: 1, estado: 1, recibido: -1 });
        await cierresPendientes.createIndex({ docente: 1, estado: 1, recibido: -1 });
        await accesosEscuela.createIndex({ curp: 1, fecha: 1 });
        await reportesConducta.createIndex({ curp: 1, creado: -1 });
        await reportesConducta.createIndex({ reportanteId: 1, creado: -1 });
        await avisosLeidos.createIndex({ anuncioId: 1, rol: 1, para: 1 }, { unique: true });
        await auditoria.createIndex({ creado: -1 });
        try { await usuarios.dropIndex('curp_unica'); } catch { /* no existía */ }   // la regla de CURP ahora vive en conflictoCurp
        console.log('✅ Conexión exitosa a MongoDB Atlas');
        console.log('🦈 Base de datos: SHARK-DARK');
        app.listen(PORT, () => {
            console.log(`🚀 Shark Dark está disponible en http://localhost:${PORT}`);
            setInterval(() => revisarRecordatoriosClase().catch(e => console.warn('Recordatorios push:', e.message)), 20000);
            revisarAvisosPeriodo().catch(e => console.warn('Avisos de periodos:', e.message));
            setInterval(() => revisarAvisosPeriodo().catch(e => console.warn('Avisos de periodos:', e.message)), 60000);
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
