import { useState, useEffect, useContext } from 'react';
import SD from './sd.js';
import { conDescanso, Card, Hero, Banner, useBanner, QR, useDatos, useCached, useAlumno, TutorCtx, DIAS, hh, fmtF, hoyISO, post, msgErr, delGrupo, estadoHorario, resumenAsistencia, ListaFaltas, nombreGrupo } from './ui.jsx';

const Sin = () => <Card><p className="vacio">No tienes un alumno vinculado. Pide a Servicios Escolares que vinculen a tu alumno con tu cuenta.</p></Card>;

const TUTORIALES = {
  alumno: [
  { titulo: 'Inicio', texto: 'Consulta tu clase actual y la siguiente. Explora el menú para conocer las demás secciones.', imagen: 'inicio' },
  { titulo: 'Perfil', texto: 'Revisa tus datos escolares, muestra tu código QR y consulta tus tutores.', imagen: 'perfil' },
  { titulo: 'Asistencia', texto: 'Consulta tus asistencias, faltas y justificantes, también por materia.', imagen: 'asistencia' },
  { titulo: 'Horario', texto: 'Revisa tus clases por día, con sus horas y materias.', imagen: 'horario' },
  { titulo: 'Calificaciones', texto: 'Consulta las calificaciones registradas para tus materias.', imagen: 'calificaciones' },
  { titulo: 'Permisos', texto: 'Consulta los permisos registrados para ti. Tu tutor puede enviar solicitudes desde su cuenta.', imagen: 'permisos' },
  { titulo: 'Avisos', texto: 'Mantente al tanto de los avisos importantes de la escuela.', imagen: 'avisos' },
  { titulo: 'Reportes', texto: 'Consulta asistencia, faltas y promedio por materia; también puedes imprimir el reporte.', imagen: 'reportes' }
  ],
  tutor: [
    { titulo: 'Inicio', texto: 'Consulta la asistencia y las faltas del alumno que estás viendo, además de sus avisos.', imagen: 'inicio' },
    { titulo: 'Asistencia', texto: 'Revisa asistencias, faltas y justificantes del alumno vinculado.', imagen: 'asistencia' },
    { titulo: 'Permisos', texto: 'Envía solicitudes de permiso para el alumno y consulta su estado.', imagen: 'permisos' },
    { titulo: 'Horario', texto: 'Consulta las clases del alumno por día y horario.', imagen: 'horario' },
    { titulo: 'Calificaciones', texto: 'Consulta las calificaciones registradas por materia.', imagen: 'calificaciones' },
    { titulo: 'Avisos', texto: 'Lee los mensajes de Servicios Escolares.', imagen: 'avisos' },
    { titulo: 'Perfiles', texto: 'Consulta tus datos y los perfiles de tus alumnos vinculados.', imagen: 'perfil' },
    { titulo: 'Reportes', texto: 'Consulta un resumen de asistencia y calificaciones por materia.', imagen: 'reportes' }
  ],
  docente: [
    { titulo: 'Inicio', texto: 'Desde aquí puedes abrir la guía y entrar a las secciones de tu cuenta.', imagen: 'inicio' },
    { titulo: 'Horario', texto: 'Consulta el horario de clases por día.', imagen: 'horario' },
    { titulo: 'Asistencia', texto: 'Registra y consulta la asistencia de tus grupos.', imagen: 'asistencia' },
    { titulo: 'Reportes', texto: 'Revisa reportes de asistencia y desempeño de tus grupos.', imagen: 'reportes' },
    { titulo: 'Avisos', texto: 'Consulta los mensajes de Servicios Escolares.', imagen: 'avisos' },
    { titulo: 'Calificaciones', texto: 'Captura y consulta calificaciones de tus grupos.', imagen: 'calificaciones' },
    { titulo: 'Permisos', texto: 'Consulta los permisos aprobados de tus alumnos.', imagen: 'permisos' }
  ],
  admin: [
    { titulo: 'Inicio', texto: 'Usa el menú para entrar a las herramientas de Control Escolar.', imagen: 'inicio' },
    { titulo: 'Cuentas', texto: 'Da de alta y administra cuentas de alumnos, tutores y docentes.', imagen: 'cuentas' },
    { titulo: 'Grupos', texto: 'Consulta los grupos registrados y su información.', imagen: 'grupos' },
    { titulo: 'Clases', texto: 'Administra materias, grupos y docentes asignados.', imagen: 'clases' },
    { titulo: 'Horarios', texto: 'Captura y administra los horarios de clase.', imagen: 'horario' },
    { titulo: 'Permisos', texto: 'Revisa y resuelve solicitudes de permiso.', imagen: 'permisos' },
    { titulo: 'Avisos', texto: 'Envía avisos a alumnos, tutores y docentes.', imagen: 'avisos' },
    { titulo: 'Reportes', texto: 'Consulta y exporta reportes escolares.', imagen: 'reportes' },
    { titulo: 'Historial', texto: 'Revisa los cambios administrativos recientes y quién los realizó.', imagen: 'reportes' },
    { titulo: 'Escáner', texto: 'Escanea el código QR de un alumno para registrar asistencia.', imagen: 'escaner' }
  ]
};

function Tutorial({ rol }) {
  const pasos = TUTORIALES[rol] || TUTORIALES.alumno;
  const [indice, setIndice] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const paso = pasos[indice];
  const cambiar = delta => setIndice(i => (i + delta + pasos.length) % pasos.length);

  return <>
    <button className="btn tutorial-btn" type="button" onClick={() => { setIndice(0); setAbierto(true); }}>
      Ver tutorial
    </button>

    {abierto && (
      <div className="tutorial-overlay" onClick={() => setAbierto(false)}>
        <div className="tutorial-modal" role="dialog" aria-modal="true" aria-label="Tutorial de la plataforma" onClick={e => e.stopPropagation()}>
          <div className="tutorial-header">
            <div>
              <p className="tutorial-kicker">Guía para {rol === 'admin' ? 'administrador' : rol}</p>
              <h3>{paso.titulo}</h3>
            </div>
            <button className="tutorial-close" type="button" aria-label="Cerrar tutorial" onClick={() => setAbierto(false)}>×</button>
          </div>

          <div className="tutorial-visual">
            <img className="tutorial-imagen" src={`/img/tutorial/${paso.imagen}.svg`} alt={`Pantalla ilustrativa de la sección ${paso.titulo}`} />
            <span className="tutorial-callout">{paso.titulo}</span>
          </div>

          <div className="tutorial-body">
            <p className="tutorial-counter">Paso {indice + 1} de {pasos.length}</p>
            <p className="sub">{paso.texto}</p>
          </div>

          <div className="tutorial-controles">
            <button className="btn sec tutorial-nav" type="button" onClick={() => cambiar(-1)} aria-label="Tutorial anterior">Anterior</button>
            <div className="tutorial-puntos" aria-label={`Imagen ${indice + 1} de ${pasos.length}`}>
              {pasos.map((x, i) => <button key={x.titulo} type="button" className={i === indice ? 'activo' : ''} onClick={() => setIndice(i)} aria-label={`Ver tutorial: ${x.titulo}`} aria-current={i === indice ? 'step' : undefined} />)}
            </div>
            <button className="btn tutorial-nav" type="button" onClick={() => {
              if (indice === pasos.length - 1) setAbierto(false);
              else cambiar(1);
            }} aria-label="Tutorial siguiente">
              {indice === pasos.length - 1 ? 'Cerrar' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>;
}

function BotonAvisos() {
  const permisoActivo = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const [activo, setActivo] = useState(permisoActivo), [error, setError] = useState('');
  useEffect(() => {
    const revisar = () => setActivo(permisoActivo());
    window.addEventListener('focus', revisar);
    document.addEventListener('visibilitychange', revisar);
    return () => {
      window.removeEventListener('focus', revisar);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, []);
  async function activar() {
    setError('');
    try {
      const permiso = await SD.permisoAvisos();
      setActivo(permiso === 'granted');
      if (permiso !== 'granted') setError(permiso === 'denied'
        ? 'Las notificaciones están bloqueadas. Puedes permitirlas desde los ajustes de este sitio en tu navegador.'
        : 'No se activaron las notificaciones. Inténtalo de nuevo.');
    } catch (e) {
      setActivo(permisoActivo());
      setError(e.message || 'No se pudieron activar las notificaciones.');
    }
  }
  if (activo) return null;
  return <>
    <button className="btn sec" onClick={activar}>Activar avisos en este teléfono</button>
    {error && <p className="msg" role="status">{error}</p>}
  </>;
}

export function ClaseAhora({ bl }) {
  const [, t] = useState(0);
  useEffect(() => { const i = setInterval(() => t(x => x + 1), 30000); return () => clearInterval(i); }, []);
  const { ahora, sig } = estadoHorario(bl);
  return (
    <Card title="Ahora" className="ahora">
      {ahora ? <p><b>{ahora.materia}</b> · {hh(ahora.inicio)} a {hh(ahora.fin)}</p> : <p className="vacio">No hay clase en este momento.</p>}
      {sig && <p className="sub" style={{ margin: '6px 0 0' }}>Sigue: {sig.materia} a las {hh(sig.inicio)}</p>}
    </Card>
  );
}

export function InicioBienvenida({ rol }) {
  return (<>
    <div className="bienvenida">
      <Hero titulo="¡Bienvenido a SHARK DARK!" />
    <img className="bienvenida-logo" src="/img/tiburon.png" alt="Logo de SHARK DARK CBTIS 170" />
      <Tutorial rol={rol} />
    </div>
  </>);
}

export function Inicio() {
  const ses = SD.session() || {};
  return <InicioBienvenida rol={ses.rol} />;
}

export function PerfilAlumno() {
  const al = useAlumno(), [tut, setTut] = useState([]);
  useEffect(() => { SD.vinculos().then(setTut); }, []);
  if (!al) return null;
  return (<>
    <Hero titulo="Perfil" sub="Tus datos escolares" />
    <Card title="Datos del alumno"><dl><dt>Nombre</dt><dd>{al.nombre}</dd><dt>CURP</dt><dd>{al.curp}</dd><dt>Carrera</dt><dd>{al.area}</dd><dt>Semestre</dt><dd>{al.semestre}</dd><dt>Grupo</dt><dd>{al.grupo}</dd></dl></Card>
    <Card title="Mi código QR"><QR texto={al.curp} /><p className="sub" style={{ textAlign: 'center', margin: '8px 0 0' }}>Muéstralo al docente para registrar tu asistencia.</p></Card>
    <Card title="Mis tutores"><ul className="l">{tut.map(t => <li key={t.curp}><span>{t.nombre || t.curp}</span><span>{t.estado === 'vinculado' ? 'vinculado' : 'pendiente'}</span></li>)}{!tut.length && <li className="vacio">Sin tutores vinculados</li>}</ul></Card>
  </>);
}

export function PerfilesTutor() {
  const { vinc, activo, setActivo } = useContext(TutorCtx), [yo, setYo] = useState(null);
  useEffect(() => { SD.api('/api/yo').then(setYo).catch(() => {}); }, []);
  return (<>
    <Hero titulo="Perfiles" sub="Tu perfil y el de tus alumnos" />
    {yo && <Card title="Mi perfil"><dl><dt>Nombre</dt><dd>{yo.nombre}</dd><dt>CURP</dt><dd>{yo.curp}</dd></dl></Card>}
    {vinc.filter(v => v.estado === 'vinculado').map(v => (
      <Card key={v.curp} title={'Alumno' + (v.curp === activo ? ' · en pantalla' : '')}>
        <dl><dt>Nombre</dt><dd>{v.nombre}</dd><dt>CURP</dt><dd>{v.curp}</dd><dt>Carrera</dt><dd>{v.area}</dd><dt>Semestre</dt><dd>{v.semestre}</dd><dt>Grupo</dt><dd>{v.grupo}</dd></dl>
        {v.curp !== activo && <button className="btn sec" onClick={() => setActivo(v.curp)}>Ver a este alumno</button>}
      </Card>))}
    {!vinc.some(v => v.estado === 'vinculado') && <Sin />}
  </>);
}

export function AsistenciaVer() {
  const al = useAlumno(), d = useDatos();
  if (!al) return <Sin />;
  const rs = d.asistencias.filter(a => a.curp === al.curp), g = resumenAsistencia(rs);
  const materias = [...new Set(rs.map(a => a.materia).filter(Boolean))].sort();
  const av = d.avisos.filter(a => a.curp === al.curp).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 8);
  return (<>
    <Hero titulo="Asistencia" sub={al.nombre} />
    <Card title="General"><div className="stats">
      <div><div className="num">{g.pct}<small>%</small></div><small className="vacio">Asistencia</small></div>
      <div><div className="num">{g.asist}</div><small className="vacio">Asistió</small></div>
      <div><div className="num rojo">{g.falt}</div><small className="vacio">Faltas</small></div>
      <div><div className="num">{g.just}</div><small className="vacio">Justificadas</small></div></div></Card>
    <Card title="Por clase"><div className="tabla"><table className="tb"><thead><tr><th className="izq">Materia</th><th>Asistió</th><th>Faltas</th><th>Justif.</th><th>%</th></tr></thead>
      <tbody>{materias.map(m => { const r = resumenAsistencia(rs.filter(a => a.materia === m)); return <tr key={m}><td className="izq">{m}</td><td>{r.asist}</td><td>{r.falt}</td><td>{r.just}</td><td>{r.pct}%</td></tr>; })}
        {!materias.length && <tr><td className="izq" colSpan="5">Sin registros todavía</td></tr>}</tbody></table></div></Card>
    <Card title="Faltas (fecha, horario y materia)"><ListaFaltas rs={rs} /></Card>
    {SD.session().rol === 'tutor' && <Card title="Avisos de asistencia"><ul className="l">{av.map(a => <li key={a.id}><span>{a.texto}</span><span>{fmtF(a.fecha)}</span></li>)}{!av.length && <li className="vacio">Sin avisos</li>}</ul></Card>}
  </>);
}

export function Horario() {
  const rol = SD.session().rol, al = useAlumno(), [bl] = useCached('horario', '/api/horarios');
  const base = rol === 'docente' ? (bl || []) : delGrupo(bl, al), lista = conDescanso(base);
  const dias = [1, 2, 3, 4, 5, 6].filter(d => d <= 5 || lista.some(b => b.dia === d));
  const hoy = new Date().getDay(), [dia, setDia] = useState(dias.includes(hoy) ? hoy : 1);
  if (rol !== 'docente' && !al) return <Sin />;
  const clases = lista.filter(b => b.dia === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const abrevia = {1:'LUN',2:'MAR',3:'MIÉ',4:'JUE',5:'VIE',6:'SÁB'};
  return (<>
    <Hero titulo="Mi horario escolar" sub={rol === 'docente' ? 'CBTIS 170 · HORARIO DE CLASES' : `${al.semestre} · ${al.area} · Grupo ${al.grupo}`} />
    <Card title="Selecciona el día">
      <div className="dias-selector">{dias.map(d => <button key={d} className={dia === d ? 'activo' : ''} onClick={() => setDia(d)}>{abrevia[d]}</button>)}</div>
    </Card>
    <Card title={`${DIAS[dia]} · Clases del día`}>
      {!base.length && <p className="vacio">Servicios Escolares aún no captura el horario.</p>}
      {clases.map(b => <div key={b.id} className={'clase-horario' + (b.tipo === 'descanso' ? ' descanso' : '')}>
        <div><div className="materia">{b.materia}</div><div className="detalle">{b.tipo === 'descanso' ? 'Tiempo de descanso' : rol === 'docente' ? `${b.semestre || ''} ${b.area || ''} ${b.grupo || ''}` : `Docente: ${b.docenteNombre || 'Por configurar'}`}</div>{b.tipo !== 'descanso' && <div className="detalle">Salón: {b.salon || 'Por asignar'}</div>}</div>
        <div className="hora">{hh(b.inicio)}–{hh(b.fin)}</div>
      </div>)}
      {base.length && !clases.length && <p className="vacio">No hay clases registradas para este día.</p>}
    </Card>
  </>);
}

export function CalifVer() {
  const al = useAlumno(), [notas] = useCached('calif', '/api/calificaciones');
  if (!al) return <Sin />;
  const m = {}; (notas || []).filter(n => n.curp === al.curp).forEach(n => { (m[n.materia] = m[n.materia] || {})[n.parcial] = n.nota; });
  const prom = v => { const x = Object.values(v); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
  const ps = Object.values(m).map(prom).filter(x => x !== null), gen = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  return (<>
    <Hero titulo="Calificaciones" sub={`${al.nombre} · solo consulta`} />
    <Card title="Por materia"><div className="tabla"><table className="tb"><thead><tr><th className="izq">Materia</th><th>Parcial 1</th><th>Parcial 2</th><th>Parcial 3</th><th>Promedio</th></tr></thead>
      <tbody>{Object.keys(m).sort().map(k => <tr key={k}><td className="izq">{k}</td>{[1, 2, 3].map(p => <td key={p}>{m[k][p] ?? '–'}</td>)}<td><b>{prom(m[k]).toFixed(1)}</b></td></tr>)}
        {!Object.keys(m).length && <tr><td className="izq" colSpan="5">Aún no hay calificaciones</td></tr>}</tbody></table></div></Card>
    {gen !== null && <Card title="Promedio general"><div className="num">{gen.toFixed(1)}</div></Card>}
  </>);
}

export function Permisos() {
  const rol = SD.session().rol, al = useAlumno(), [lista, cargar] = useCached('permisos', '/api/permisos'), [b, ban] = useBanner();
  const [f, setF] = useState({ desde: hoyISO(), hasta: hoyISO(), motivo: '' });
  const enviar = async e => { e.preventDefault(); try { await post('/api/permisos', { curp: al.curp, ...f }); setF({ ...f, motivo: '' }); ban('ok', 'Solicitud enviada', 'Servicios Escolares la revisará.'); cargar(); } catch (er) { ban('err', 'No se pudo enviar', msgErr(er)); } };
  const resolver = async (id, accion) => { if (!confirm(`¿${accion === 'aprobar' ? 'Aprobar' : 'Rechazar'} este permiso?`)) return; try { await post(`/api/permisos/${id}/resolver`, { accion }); ban('ok', accion === 'aprobar' ? 'Permiso aprobado' : 'Permiso rechazado', 'Se avisó al tutor.'); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  const sub = { admin: 'Solicitudes de los tutores. Tú decides si se aprueban.', docente: 'Permisos aprobados para los alumnos de tus grupos.', tutor: 'Pide un permiso: Servicios Escolares lo revisará y se te avisará.', alumno: 'Tus permisos (solo consulta).' }[rol];
  return (<>
    <Hero titulo="Permisos" sub={sub} /><Banner b={b} />
    {rol === 'tutor' && (al ? <Card title={`Pedir permiso para ${al.nombre}`}><form onSubmit={enviar}>
      <div className="fila2"><div><label>Desde</label><input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} required /></div>
        <div><label>Hasta</label><input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} required /></div></div>
      <label>Motivo</label><input value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} placeholder="Ej. cita médica" maxLength="200" required />
      <button className="btn" type="submit">ENVIAR SOLICITUD</button></form></Card> : <Sin />)}
    {(lista || []).map(p => (
      <Card key={p.id}><b>{p.alumno}</b><span className={'tag ' + (p.estado === 'aprobado' ? 'ok' : p.estado === 'rechazado' ? 'err' : '')}>{p.estado}</span>
        <p className="sub" style={{ margin: '4px 0 6px' }}>Del {fmtF(p.desde)} al {fmtF(p.hasta)} · {p.motivo}</p>
        {rol === 'admin' && p.estado === 'pendiente' && <><button className="mini" style={{ marginLeft: 0 }} onClick={() => resolver(p.id, 'aprobar')}>Aprobar</button><button className="mini rojo" onClick={() => resolver(p.id, 'rechazar')}>Rechazar</button></>}</Card>))}
    {lista && !lista.length && <Card><p className="vacio">No hay permisos.</p></Card>}
  </>);
}

const DESTINOS = [['tutor', 'Tutores'], ['docente', 'Docentes'], ['alumno', 'Alumnos'], ['alumno,docente', 'Alumnos y docentes'], ['tutor,alumno', 'Tutores y alumnos'], ['tutor,docente', 'Tutores y docentes'], ['todos', 'Todos (tutores, docentes y alumnos)']];
const NOM = { tutor: 'Tutores', docente: 'Docentes', alumno: 'Alumnos' };
export function Avisos() {
  const adm = SD.session().rol === 'admin', [lista, cargar] = useCached('anuncios', '/api/anuncios'), [b, ban] = useBanner();
  const [f, setF] = useState({ destino: 'todos', titulo: '', mensaje: '' });
  const enviar = async e => { e.preventDefault(); try { await post('/api/anuncios', f); setF({ ...f, titulo: '', mensaje: '' }); ban('ok', 'Aviso enviado', 'Ya lo pueden ver en su sección Avisos.'); cargar(); } catch (er) { ban('err', 'No se pudo enviar', msgErr(er)); } };
  const borrar = async id => { if (!confirm('¿Borrar este aviso?')) return; try { await post(`/api/anuncios/${id}/borrar`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  const marcarLeido = async id => { try { await post(`/api/anuncios/${encodeURIComponent(id)}/leido`); await cargar(); } catch (er) { ban('err', 'No se pudo actualizar el aviso', msgErr(er)); } };
  return (<>
    <Hero titulo="Avisos" sub={adm ? 'Los avisos que envíes aparecerán en la sección Avisos de cada persona.' : 'Mensajes de Servicios Escolares.'} /><Banner b={b} />
    {adm && <Card title="Enviar un aviso"><form onSubmit={enviar}>
      <label>¿A quién se lo mandas?</label><select value={f.destino} onChange={e => setF({ ...f, destino: e.target.value })}>{DESTINOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      <label>Título</label><input value={f.titulo} onChange={e => setF({ ...f, titulo: e.target.value })} maxLength="80" required />
      <label>Mensaje</label><textarea rows="4" value={f.mensaje} onChange={e => setF({ ...f, mensaje: e.target.value })} maxLength="1000" required />
      <button className="btn" type="submit">ENVIAR AVISO</button></form></Card>}
    {(lista || []).map(a => (
      <Card key={a.id} className={'anuncio' + (!adm && !a.leido ? ' aviso-nuevo' : '')}><b>{a.titulo}</b>{!adm && <span className={'tag ' + (a.leido ? 'ok' : '')}>{a.leido ? 'Revisado' : 'Nuevo'}</span>}<p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{a.mensaje}</p>
        <p className="sub" style={{ margin: 0 }}>{new Date(a.creado).toLocaleDateString('es-MX')}{adm ? ' · Para: ' + a.para.map(r => NOM[r]).join(', ') : ''}</p>
        {!adm && !a.leido && <button className="mini" style={{ marginLeft: 0, marginTop: 8 }} onClick={() => marcarLeido(a.id)}>Marcar como revisado</button>}
        {adm && <button className="mini rojo" style={{ marginLeft: 0, marginTop: 8 }} onClick={() => borrar(a.id)}>Borrar</button>}</Card>))}
    {lista && !lista.length && <Card><p className="vacio">No hay avisos por ahora.</p></Card>}
  </>);
}

export function ReporteVer() {
  const al = useAlumno(), d = useDatos(), [notas] = useCached('calif', '/api/calificaciones');
  if (!al) return <Sin />;
  const rs = d.asistencias.filter(a => a.curp === al.curp), califs = (notas || []).filter(n => n.curp === al.curp);
  const mats = [...new Set([...rs.map(a => a.materia), ...califs.map(n => n.materia)].filter(Boolean))].sort();
  if (!mats.length) return <Card><p className="vacio reporte-vacio">Aún no tienes reportes, ¡sigue así!</p></Card>;
  const g = resumenAsistencia(rs);
  return (<>
    <Card title="Reporte escolar">
      <div className="tabla"><table className="tb"><thead><tr><th className="izq">Materia</th><th>Asistencia</th><th>Faltas</th><th>Promedio</th></tr></thead>
        <tbody>{mats.map(m => {
          const asistencias = rs.filter(a => a.materia === m), r = resumenAsistencia(asistencias);
          const n = califs.filter(x => x.materia === m).map(x => x.nota), p = n.length ? (n.reduce((a, b) => a + b, 0) / n.length).toFixed(1) : '–';
          return <tr key={m}><td className="izq">{m}</td><td>{asistencias.length ? `${r.pct}%` : '–'}</td><td>{asistencias.length ? r.falt : '–'}</td><td>{p}</td></tr>;
        })}</tbody></table></div>
      {rs.length > 0 && <p className="reporte-general">Asistencia general: <b>{g.pct}%</b></p>}
      <button className="btn sec" onClick={() => window.print()}>Imprimir reporte</button>
    </Card>
  </>);
}

export function Cuenta() {
  const ses = SD.session(), [yo, setYo] = useState(null);
  useEffect(() => { SD.api('/api/yo').then(setYo).catch(() => setYo(ses)); }, []);
  return (<>
    <Hero titulo="Mi cuenta" sub={yo ? yo.nombre : ''} />
    {yo && <Card title="Datos"><dl><dt>Nombre</dt><dd>{yo.nombre}</dd><dt>CURP</dt><dd>{yo.curp || yo.id}</dd>{yo.semestre && <><dt>Grupo</dt><dd>{yo.semestre} {yo.area} {yo.grupo}</dd></>}</dl></Card>}
    <Card><p className="vacio">Esta cuenta entra solo con la CURP. Si algún dato está mal, acude con Servicios Escolares.</p></Card>
  </>);
}
