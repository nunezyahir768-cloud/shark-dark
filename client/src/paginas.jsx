import { useState, useEffect, useContext } from 'react';
import SD from './sd.js';
import QRAlumno from './QRAlumno.jsx';
import { conDescanso, Card, Hero, Banner, useBanner, QR, useDatos, useCached, useAlumno, TutorCtx, DIAS, hh, fmtF, hoyISO, post, msgErr, delGrupo, estadoHorario, resumenAsistencia, ListaFaltas, nombreGrupo } from './ui.jsx';

const Sin = () => <Card><p className="vacio">No tienes un alumno vinculado. Pide a Servicios Escolares que vinculen a tu alumno con tu cuenta.</p></Card>;

function BotonAvisos() {
  const permisoActivo = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const [activo, setActivo] = useState(permisoActivo), [error, setError] = useState(''), [vinculado, setVinculado] = useState(false), [cargando, setCargando] = useState(false);
  useEffect(() => {
    const revisar = () => setActivo(permisoActivo());
    window.addEventListener('focus', revisar);
    document.addEventListener('visibilitychange', revisar);
    return () => {
      window.removeEventListener('focus', revisar);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, []);
  useEffect(() => {
    if (!permisoActivo()) return;
    SD.registrarPush().then(() => setVinculado(true)).catch(e => setError(e.message || 'No se pudo vincular este dispositivo con el servidor.'));
  }, []);
  async function activar() {
    setError(''); setCargando(true);
    try {
      const permiso = permisoActivo() ? 'granted' : await SD.permisoAvisos();
      setActivo(permiso === 'granted');
      if (permiso === 'granted') { await SD.registrarPush(); setVinculado(true); }
      else setError(permiso === 'denied'
        ? 'Las notificaciones están bloqueadas. Puedes permitirlas desde los ajustes de este sitio en tu navegador.'
        : 'No se activaron las notificaciones. Inténtalo de nuevo.');
    } catch (e) {
      setActivo(permisoActivo());
      setError(e.message || 'No se pudieron activar las notificaciones.');
    } finally { setCargando(false); }
  }
  return <>
    {activo && <p className="sub" role="status">{vinculado ? 'Las notificaciones están permitidas. Este dispositivo quedó vinculado para recibirlas con la app cerrada.' : 'Las notificaciones están permitidas; falta confirmar la conexión con el servidor.'}</p>}
    {(!activo || error) && <button className="btn sec" onClick={activar} disabled={cargando}>{cargando ? 'Conectando...' : activo ? 'Reintentar conexión' : 'Permitir notificaciones'}</button>}
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

export function InicioBienvenida({ rol, onTutorial, alumno, qrAbierto, onAbrirQr, onSalirQr }) {
  return (<>
    <div className="bienvenida">
      <Hero titulo="¡Bienvenido a TIBURONES!" />
      <div className="bienvenida-acciones">
        <button className="btn bienvenida-accion" type="button" onClick={onTutorial}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" /></svg>Ver tutorial</button>
        {rol === 'alumno' && alumno && <button className="btn bienvenida-accion qr-acceso" type="button" onClick={onAbrirQr}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h5v5H1zM10 1h5v5h-5zM1 10h5v5H1zM9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" /></svg>QR</button>}
      </div>
    </div>
    {qrAbierto && alumno && <QRAlumno alumno={alumno} onSalir={onSalirQr} />}
  </>);
}

function ResumenAlumno({ alumno, d }) {
  const mes = hoyISO().slice(0, 7), rs = (d.asistencias || []).filter(r => r.curp === alumno.curp && (r.fecha || '').startsWith(mes));
  const cuenta = e => rs.filter(r => r.estado === e).length;
  const avisos = [...(d.avisos || [])].filter(x => !x.curp || x.curp === alumno.curp).sort((x, y) => (y.fecha || '').localeCompare(x.fecha || '')).slice(0, 2);
  return (<>
    <Card title="Este mes"><div className="resumen">
      <a href="#/asistencia"><b>{cuenta('asistio')}</b><span>Asistencias</span></a>
      <a href="#/asistencia" className={cuenta('falta') ? 'alerta' : ''}><b>{cuenta('falta')}</b><span>Faltas</span></a>
      <a href="#/asistencia"><b>{cuenta('justificada')}</b><span>Justificadas</span></a>
    </div></Card>
    <Card title="Avisos recientes">
      {avisos.length ? <ul className="l">{avisos.map((x, i) => <li key={x.id || i}><span>{x.texto || x.titulo}</span></li>)}</ul> : <p className="vacio">No tienes avisos nuevos.</p>}
      <a className="enlace-card" href="#/avisos">Ver todos los avisos ›</a>
    </Card>
  </>);
}

function ResumenDocente({ bl }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(i); }, []);
  const { hoy, ahora } = estadoHorario(bl), clases = hoy.filter(b => b.tipo !== 'descanso');
  return (<>
    <ClaseAhora bl={bl} />
    {ahora && <a className="btn pasar-lista" href="#/asistencia">PASAR LISTA · {ahora.materia}</a>}
    <Card title="Tus clases de hoy">
      {clases.length ? <ul className="l">{clases.map(b => <li key={b.id}><span>{hh(b.inicio)} a {hh(b.fin)} · {b.materia}</span><span>{b.semestre} {b.grupo}</span></li>)}</ul> : <p className="vacio">Hoy no tienes clases.</p>}
      <a className="enlace-card" href="#/horario">Ver horario completo ›</a>
    </Card>
  </>);
}

export function Inicio({ onTutorial }) {
  const ses = SD.session() || {};
  const alumno = useAlumno(), [qrAbierto, setQrAbierto] = useState(false), d = useDatos();
  const [horario] = useCached('horario', '/api/horarios');
  const familia = (ses.rol === 'alumno' || ses.rol === 'tutor') && alumno;
  return <>
    <InicioBienvenida rol={ses.rol} onTutorial={onTutorial} alumno={alumno} qrAbierto={qrAbierto} onAbrirQr={() => setQrAbierto(true)} onSalirQr={() => setQrAbierto(false)} />
    {familia && <><ClaseAhora bl={conDescanso(delGrupo(horario, alumno))} /><ResumenAlumno alumno={alumno} d={d} /></>}
    {ses.rol === 'docente' && <ResumenDocente bl={conDescanso(horario)} />}
  </>;
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

export function PerfilDocente() {
  const [yo, setYo] = useState(null), [clases, setClases] = useState([]);
  useEffect(() => {
    SD.api('/api/yo').then(setYo).catch(() => setYo(SD.session()));
    SD.api('/api/clases').then(setClases).catch(() => setClases([]));
  }, []);
  return <>
    <Hero titulo="Mi perfil" sub="Tus datos y materias asignadas" />
    {yo && <Card title="Datos del docente"><dl><dt>Nombre</dt><dd>{yo.nombre}</dd><dt>CURP</dt><dd>{yo.curp || yo.id}</dd>{yo.correo && <><dt>Correo</dt><dd>{yo.correo}</dd></>}</dl></Card>}
    <Card title="Materias y grupos asignados"><ul className="l">{clases.map(c => <li key={c.id}><span>{c.materia} · {c.area}</span><span>{c.semestre} · Grupo {c.grupo}</span></li>)}{!clases.length && <li className="vacio">No tienes materias asignadas todavía.</li>}</ul></Card>
  </>;
}

export function AsistenciaVer() {
  const al = useAlumno(), d = useDatos();
  if (!al) return <Sin />;
  const rs = d.asistencias.filter(a => a.curp === al.curp), g = resumenAsistencia(rs);
  const materias = [...new Set(rs.map(a => a.materia).filter(Boolean))].sort();
  const diasEscuela = [...new Set(rs.map(a => a.fecha))].sort((a, b) => b.localeCompare(a)).map(fecha => ({
    fecha,
    asistio: rs.some(a => a.fecha === fecha && a.estado === 'asistio')
  }));
  const av = d.avisos.filter(a => a.curp === al.curp).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 8);
  return (<>
    <Hero titulo="Asistencia" sub={al.nombre} />
    <Card title="Asistencia a la escuela"><div className="tabla"><table className="tb"><thead><tr><th>Día</th><th>Mes</th><th>Año</th><th>¿Asistió?</th></tr></thead>
      <tbody>{diasEscuela.map(({ fecha, asistio }) => { const [anio, mes, dia] = fecha.split('-'); return <tr key={fecha}><td>{Number(dia)}</td><td>{Number(mes)}</td><td>{anio}</td><td aria-label={asistio ? 'Sí asistió' : 'No asistió'}>{asistio ? '☑' : '✕'}</td></tr>; })}
        {!diasEscuela.length && <tr><td colSpan="4">Sin registros todavía</td></tr>}</tbody></table></div></Card>
    <Card title="Por clase"><div className="tabla"><table className="tb"><thead><tr><th className="izq">Materia</th><th>Asistió</th><th>Faltas</th><th>Justif.</th><th>%</th></tr></thead>
      <tbody>{materias.map(m => { const r = resumenAsistencia(rs.filter(a => a.materia === m)); return <tr key={m}><td className="izq">{m}</td><td>{r.asist}</td><td>{r.falt}</td><td>{r.just}</td><td>{r.pct}%</td></tr>; })}
        {!materias.length && <tr><td className="izq" colSpan="5">Sin registros todavía</td></tr>}</tbody></table></div></Card>
    <Card title="Faltas (fecha, horario y materia)"><ListaFaltas rs={rs} /></Card>
    {SD.session().rol === 'tutor' && <Card title="Avisos de asistencia"><ul className="l">{av.map(a => <li key={a.id}><span>{a.texto}</span><span>{fmtF(a.fecha)}</span></li>)}{!av.length && <li className="vacio">Sin avisos</li>}</ul></Card>}
  </>);
}

function HorarioTabla({ bloques, rol, encabezado }) {
  const clases = bloques.filter(b => b.tipo !== 'descanso');
  const dias = [1, 2, 3, 4, 5, 6].filter(d => d <= 5 || clases.some(b => b.dia === d));
  const mapa = new Map();
  clases.forEach(b => {
    const grupo = [b.semestre, b.area, b.grupo && `Grupo ${b.grupo}`].filter(Boolean).join(' · ');
    const k = b.materia + '|' + (rol === 'docente' ? grupo : (b.docenteNombre || ''));
    if (!mapa.has(k)) mapa.set(k, { materia: b.materia, extra: rol === 'docente' ? grupo : (b.docenteNombre || 'Por configurar'), bl: [] });
    mapa.get(k).bl.push(b);
  });
  const filas = [...mapa.values()].sort((a, b) => a.materia.localeCompare(b.materia));
  const imprimir = () => {
    const st = document.createElement('style'); st.textContent = '@page{size:landscape;margin:10mm}';
    document.head.appendChild(st); document.body.classList.add('imprime-horario');
    const fin = () => { st.remove(); document.body.classList.remove('imprime-horario'); removeEventListener('afterprint', fin); };
    addEventListener('afterprint', fin); print();
  };
  return (
    <Card className="horario-tabla-card" title="Horario de grupo">
      <p className="sub horario-encabezado">{encabezado} · Clases de 50 minutos</p>
      <div className="tabla"><table className="tb ht">
        <thead><tr><th className="izq">Asignatura</th><th>H</th>{dias.map(d => <th key={d}>{DIAS[d]}</th>)}</tr></thead>
        <tbody>
          {filas.map(f => <tr key={f.materia + f.extra}>
            <td className="izq"><b>{f.materia}</b><br /><small>{f.extra}</small></td>
            <td>{f.bl.length}</td>
            {dias.map(d => <td key={d}>{f.bl.filter(b => b.dia === d).sort((a, b) => a.inicio.localeCompare(b.inicio)).map(b => <div key={b.id}>{hh(b.inicio)}–{hh(b.fin)}</div>)}</td>)}
          </tr>)}
          {!filas.length && <tr><td className="izq" colSpan={dias.length + 2}>Servicios Escolares aún no captura el horario.</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ margin: '8px 0 0' }}>H = clases por semana. Cada clase dura 50 minutos.</p>
      <button className="btn sec horario-imprimir" type="button" onClick={imprimir} disabled={!filas.length}>Descargar PDF / Imprimir</button>
    </Card>
  );
}

export function Horario() {
  const rol = SD.session().rol, al = useAlumno(), [bl] = useCached('horario', '/api/horarios');
  const base = rol === 'docente' ? (bl || []) : delGrupo(bl, al), lista = conDescanso(base);
  const dias = [1, 2, 3, 4, 5, 6].filter(d => d <= 5 || lista.some(b => b.dia === d));
  const hoy = new Date().getDay(), [dia, setDia] = useState(dias.includes(hoy) ? hoy : 1), [vista, setVista] = useState('dia');
  if (rol !== 'docente' && !al) return <Sin />;
  const clases = lista.filter(b => b.dia === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const abrevia = {1:'LUN',2:'MAR',3:'MIÉ',4:'JUE',5:'VIE',6:'SÁB'};
  return (<>
    <Hero titulo="Mi horario escolar" sub={rol === 'docente' ? 'CBTIS 170 · HORARIO DE CLASES' : `${al.semestre} · ${al.area} · Grupo ${al.grupo}`} />
    <div className="fila2 horario-vistas">
      <button className={vista === 'dia' ? 'btn' : 'btn sec'} type="button" aria-pressed={vista === 'dia'} onClick={() => setVista('dia')}>Por día</button>
      <button className={vista === 'tabla' ? 'btn' : 'btn sec'} type="button" aria-pressed={vista === 'tabla'} onClick={() => setVista('tabla')}>Horario completo</button>
    </div>
    {vista === 'tabla' && <HorarioTabla bloques={base} rol={rol} encabezado={rol === 'docente' ? 'CBTIS 170 · Horario del docente' : `${al.semestre} · ${al.area} · Grupo ${al.grupo}`} />}
    {vista === 'dia' && <>
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
    </>}
  </>);
}

export function CalifVer() {
  const al = useAlumno(), [notas] = useCached('calif', '/api/calificaciones');
  if (!al) return <Sin />;
  const m = {}; (notas || []).filter(n => n.curp === al.curp).forEach(n => { (m[n.materia] = m[n.materia] || {})[n.parcial] = n.nota; });
  const prom = v => { const x = Object.values(v); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
  const f1 = x => x === null || x === undefined ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1);
  const rep = x => typeof x === 'number' && x < 6 ? ' rep' : '';
  const materias = Object.keys(m).sort((x, y) => x.localeCompare(y));
  const ps = materias.map(k => prom(m[k])).filter(x => x !== null), gen = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  const imprimir = () => { document.body.classList.add('imprime-horario'); const fin = () => { document.body.classList.remove('imprime-horario'); removeEventListener('afterprint', fin); }; addEventListener('afterprint', fin); print(); };
  return (<>
    <Hero titulo="Calificaciones" sub={`${al.nombre} · solo consulta`} />
    <Card className="horario-tabla-card" title="Boleta">
      <p className="sub horario-encabezado">{al.nombre} · {al.semestre} · {al.area} · Grupo {al.grupo}</p>
      <div className="tabla"><table className="tb boleta">
        <thead>
          <tr><th rowSpan="2" className="izq">Asignaturas</th><th colSpan="3">Periodos de evaluación</th><th rowSpan="2">Promedio final</th></tr>
          <tr><th>1er</th><th>2º</th><th>3er</th></tr>
        </thead>
        <tbody>
          {materias.map(k => <tr key={k}>
            <td className="izq">{k}</td>
            {[1, 2, 3].map(p => <td key={p} className={'nota' + rep(m[k][p])}>{f1(m[k][p])}</td>)}
            <td className={'nota fin' + rep(prom(m[k]))}>{f1(prom(m[k]) === null ? null : Math.round(prom(m[k]) * 10) / 10)}</td>
          </tr>)}
          {!materias.length && <tr><td className="izq" colSpan="5">Aún no hay calificaciones</td></tr>}
        </tbody>
        {gen !== null && <tfoot><tr><td className="izq" colSpan="4"><b>Promedio general</b></td><td className={'nota fin' + rep(gen)}>{f1(Math.round(gen * 10) / 10)}</td></tr></tfoot>}
      </table></div>
      <p className="sub" style={{ margin: '8px 0 0' }}>Las calificaciones menores a 6 aparecen en rojo.</p>
      <button className="btn sec horario-imprimir" type="button" onClick={imprimir} disabled={!materias.length}>Descargar PDF / Imprimir</button>
    </Card>
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

const DESTINOS = [['tutor', 'Tutores'], ['docente', 'Docentes'], ['alumno', 'Alumnos'], ['alumno,docente', 'Alumnos y docentes'], ['tutor,alumno', 'Tutores y alumnos'], ['tutor,docente', 'Tutores y docentes'], ['todos', 'Toda la comunidad escolar']];
const NOM = { tutor: 'Tutores', docente: 'Docentes', alumno: 'Alumnos' };
export function Avisos() {
  const adm = SD.session().rol === 'admin', [lista, cargar] = useCached('anuncios', '/api/anuncios'), [avisosPersonales] = useCached('avisos-personales', '/api/avisos'), [b, ban] = useBanner();
  const [f, setF] = useState({ destino: 'todos', titulo: '', mensaje: '' });
  const enviar = async e => { e.preventDefault(); try { await post('/api/anuncios', f); setF({ ...f, titulo: '', mensaje: '' }); ban('ok', 'Aviso enviado', 'Ya lo pueden ver en Notificaciones.'); cargar(); } catch (er) { ban('err', 'No se pudo enviar', msgErr(er)); } };
  const borrar = async id => { if (!confirm('¿Borrar este aviso?')) return; try { await post(`/api/anuncios/${id}/borrar`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  const marcarLeido = async id => { try { await post(`/api/anuncios/${encodeURIComponent(id)}/leido`); await cargar(); } catch (er) { ban('err', 'No se pudo actualizar el aviso', msgErr(er)); } };
  return (<>
    <Hero titulo="Notificaciones" sub={adm ? 'Los avisos que envíes aparecerán en la sección Notificaciones de cada persona.' : 'Mensajes y avisos de Servicios Escolares.'} /><Banner b={b} />
    <Card title="Notificaciones en este dispositivo"><p className="sub">Permite las notificaciones para recibir avisos aunque la app esté cerrada.</p><BotonAvisos /></Card>
    {!adm && (avisosPersonales || []).map(a => <Card key={a.id} title={a.tipo === 'password' ? 'Restablecimiento de contraseña' : a.tipo === 'calif' ? 'Calificación subida' : 'Aviso escolar'}><p>{a.texto}</p><p className="sub">{a.fecha}</p></Card>)}
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
    {lista && !lista.length && <Card><p className="vacio">No hay notificaciones por ahora.</p></Card>}
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

function OpcionAcordeon({ id, titulo, resumen, abierta, onToggle, children }) {
  const expandida = abierta === id;
  return <Card className="opciones-item">
    <button className="opciones-campo" type="button" aria-expanded={expandida} aria-controls={'opciones-detalle-' + id} onClick={() => onToggle(id)}>
      <span className="opciones-campo-texto"><b>{titulo}</b><small>{resumen}</small></span>
      <svg className={expandida ? 'opciones-chevron abierto' : 'opciones-chevron'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div className={'desplegable-contenido' + (expandida ? ' abierto' : '')} id={'opciones-detalle-' + id} aria-hidden={!expandida} inert={!expandida}><div className="opciones-detalle">{children}</div></div>
  </Card>;
}

export function Opciones({ tema, setTema, tamanoFuente, setTamanoFuente, rol, onTutorial }) {
  const [abierta, setAbierta] = useState(null);
  const nombreTema = { claro: 'Claro', oscuro: 'Oscuro', predeterminado: 'Predeterminado' }[tema];
  const nombreFuente = { pequena: 'Pequeña', normal: 'Normal', grande: 'Grande' }[tamanoFuente];
  const temas = [['predeterminado', 'Predeterminado'], ['claro', 'Claro'], ['oscuro', 'Oscuro']];
  const tamanos = [['pequena', 'Pequeña'], ['normal', 'Normal'], ['grande', 'Grande']];
  const alternar = id => setAbierta(actual => actual === id ? null : id);
  const perfil = rol === 'tutor'
    ? { resumen: 'Consulta tu perfil y el de tus alumnos vinculados.', descripcion: 'Revisa la información de tus alumnos vinculados y cambia cuál estás consultando.', ruta: '#/perfil', accion: 'Abrir perfiles' }
    : rol === 'alumno'
      ? { resumen: 'Consulta tus datos escolares y código QR.', descripcion: 'Revisa tu información académica y muestra tu código QR para registrar asistencia.', ruta: '#/perfil', accion: 'Abrir mi perfil' }
      : rol === 'docente'
        ? { resumen: 'Consulta tus datos y materias asignadas.', descripcion: 'Revisa tu perfil y los grupos y materias que tienes asignados.', ruta: '#/perfil', accion: 'Abrir mi perfil' }
        : { resumen: 'Consulta los datos de tu cuenta.', descripcion: 'Revisa la información de tu cuenta de Control Escolar.', ruta: '#/perfil', accion: 'Abrir mi cuenta' };
  return <>
    <Hero titulo="Opciones" sub="Personaliza la apariencia de TIBURONES en este dispositivo." />
    <button className="btn sec tutorial-repetir" type="button" onClick={onTutorial}>Ver tutorial interactivo</button>
    <OpcionAcordeon id="tema" titulo="Tema" resumen={'Actual: ' + nombreTema} abierta={abierta} onToggle={alternar}>
      <p className="sub">Elige el aspecto de la aplicación. Predeterminado sigue el tema de tu dispositivo.</p>
      <div className="opciones-elecciones" role="group" aria-label="Tema de la aplicación">
        {temas.map(([valor, texto]) => <button key={valor} type="button" className="opciones-eleccion" aria-pressed={tema === valor} onClick={() => setTema(valor)}>{texto}</button>)}
      </div>
    </OpcionAcordeon>
    <OpcionAcordeon id="fuente" titulo="Tamaño de fuente" resumen={'Actual: ' + nombreFuente} abierta={abierta} onToggle={alternar}>
      <p className="sub">Ajusta el tamaño de las letras en todas las secciones.</p>
      <div className="opciones-elecciones" role="group" aria-label="Tamaño de fuente">
        {tamanos.map(([valor, texto]) => <button key={valor} type="button" className="opciones-eleccion" aria-pressed={tamanoFuente === valor} onClick={() => setTamanoFuente(valor)}>{texto}</button>)}
      </div>
    </OpcionAcordeon>
    <OpcionAcordeon id="perfiles" titulo="Perfiles" resumen={perfil.resumen} abierta={abierta} onToggle={alternar}>
      <p className="sub">{perfil.descripcion}</p>
      <a className="btn sec opciones-accion" href={perfil.ruta}>{perfil.accion}</a>
    </OpcionAcordeon>
  </>;
}
