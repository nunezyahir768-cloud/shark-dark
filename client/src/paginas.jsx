import { useState, useEffect, useContext } from 'react';
import SD from './sd.js';
import { Card, Hero, Banner, useBanner, QR, useDatos, useCached, useAlumno, TutorCtx, DIAS, hh, fmtF, hoyISO, post, msgErr, delGrupo, estadoHorario, resumenAsistencia, ListaFaltas, nombreGrupo } from './ui.jsx';

const Sin = () => <Card><p className="vacio">No tienes un alumno vinculado. Pide a Servicios Escolares que vinculen a tu alumno con tu cuenta.</p></Card>;

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

export function Inicio() {
  const al = useAlumno(), ses = SD.session() || {}, d = useDatos(), [bl] = useCached('horario', '/api/horarios');
  if (!al || !ses.nombre) return <Sin />;
  const rs = d.asistencias.filter(a => a.curp === al.curp), mes = rs.filter(a => a.fecha.startsWith(hoyISO().slice(0, 7))), r = resumenAsistencia(mes);
  const av = d.avisos.filter(a => a.curp === al.curp).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 5);
  return (<>
    <Hero titulo={`Hola, ${ses.nombre.split(' ')[0]}`} sub={ses.rol === 'tutor' ? `Alumno: ${al.nombre} · ${al.semestre} ${al.area} ${al.grupo}` : `${al.area} · ${al.semestre} · Grupo ${al.grupo}`} />
    <ClaseAhora bl={delGrupo(bl, al)} />
    <Card title="Este mes"><div className="stats">
      <div><div className="num">{r.asist}</div><small className="vacio">Asistencias</small></div>
      <div><div className="num rojo">{r.falt}</div><small className="vacio">Faltas</small></div>
      <div><div className="num">{r.just}</div><small className="vacio">Justificadas</small></div></div></Card>
    <Card title="Mis faltas (fecha, horario y materia)"><ListaFaltas rs={rs} /></Card>
    {ses.rol === 'tutor' && <Card title="Avisos de asistencia"><ul className="l">{av.map(a => <li key={a.id}><span>{a.texto}</span><span>{fmtF(a.fecha)}</span></li>)}{!av.length && <li className="vacio">Sin avisos</li>}</ul></Card>}
    {ses.rol === 'alumno' && <button className="btn sec" onClick={() => SD.permisoAvisos()}>Activar avisos en este teléfono</button>}
  </>);
}

export function PerfilAlumno() {
  const al = useAlumno(), [tut, setTut] = useState([]);
  useEffect(() => { SD.vinculos().then(setTut); }, []);
  if (!al) return null;
  return (<>
    <Hero titulo="Perfil" sub="Tus datos escolares" />
    <Card title="Datos del alumno"><dl><dt>Nombre</dt><dd>{al.nombre}</dd><dt>CURP</dt><dd>{al.curp}</dd><dt>Carrera</dt><dd>{al.area}</dd><dt>Semestre</dt><dd>{al.semestre}</dd><dt>Grupo</dt><dd>{al.grupo}</dd><dt>Correo</dt><dd>{al.correo || '—'}</dd></dl></Card>
    <Card title="Mi código QR"><QR texto={al.curp} /><p className="sub" style={{ textAlign: 'center', margin: '8px 0 0' }}>Muéstralo al docente para registrar tu asistencia.</p></Card>
    <Card title="Mis tutores"><ul className="l">{tut.map(t => <li key={t.curp}><span>{t.nombre || t.curp}</span><span>{t.estado === 'vinculado' ? 'vinculado' : 'pendiente'}</span></li>)}{!tut.length && <li className="vacio">Sin tutores vinculados</li>}</ul></Card>
  </>);
}

export function PerfilesTutor() {
  const { vinc, activo, setActivo } = useContext(TutorCtx), [yo, setYo] = useState(null);
  useEffect(() => { SD.api('/api/yo').then(setYo).catch(() => {}); }, []);
  return (<>
    <Hero titulo="Perfiles" sub="Tu perfil y el de tus alumnos" />
    {yo && <Card title="Mi perfil"><dl><dt>Nombre</dt><dd>{yo.nombre}</dd><dt>CURP</dt><dd>{yo.curp}</dd><dt>Correo</dt><dd>{yo.correo || '—'}</dd></dl></Card>}
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
  const lista = rol === 'docente' ? (bl || []) : delGrupo(bl, al);
  if (rol !== 'docente' && !al) return <Sin />;
  const dias = [1, 2, 3, 4, 5, 6].filter(d => d <= 5 || lista.some(b => b.dia === d));
  return (<>
    <Hero titulo="Horario" sub={rol === 'docente' ? 'Tus clases de la semana' : `${al.semestre} ${al.area} ${al.grupo}`} />
    {!lista.length && <Card><p className="vacio">Servicios Escolares aún no captura el horario.</p></Card>}
    {lista.length > 0 && dias.map(d => (
      <Card key={d} title={DIAS[d]} className="dia"><ul className="l">
        {lista.filter(b => b.dia === d).sort((a, b) => a.inicio.localeCompare(b.inicio)).map(b => (
          <li key={b.id} className={b.tipo === 'descanso' ? 'desc' : ''}><span>{hh(b.inicio)} a {hh(b.fin)} - {b.materia}</span><span>{rol === 'docente' ? `${b.semestre} ${b.area} ${b.grupo}` : (b.docenteNombre || '')}</span></li>))}
        {!lista.some(b => b.dia === d) && <li className="vacio">Sin clases</li>}</ul></Card>))}
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
  const resolver = async (id, accion) => { try { await post(`/api/permisos/${id}/resolver`, { accion }); ban('ok', accion === 'aprobar' ? 'Permiso aprobado' : 'Permiso rechazado', 'Se avisó al tutor.'); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
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
  return (<>
    <Hero titulo="Avisos" sub={adm ? 'Los avisos que envíes aparecerán en la sección Avisos de cada persona.' : 'Mensajes de Servicios Escolares.'} /><Banner b={b} />
    {adm && <Card title="Enviar un aviso"><form onSubmit={enviar}>
      <label>¿A quién se lo mandas?</label><select value={f.destino} onChange={e => setF({ ...f, destino: e.target.value })}>{DESTINOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      <label>Título</label><input value={f.titulo} onChange={e => setF({ ...f, titulo: e.target.value })} maxLength="80" required />
      <label>Mensaje</label><textarea rows="4" value={f.mensaje} onChange={e => setF({ ...f, mensaje: e.target.value })} maxLength="1000" required />
      <button className="btn" type="submit">ENVIAR AVISO</button></form></Card>}
    {(lista || []).map(a => (
      <Card key={a.id} className="anuncio"><b>{a.titulo}</b><p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{a.mensaje}</p>
        <p className="sub" style={{ margin: 0 }}>{new Date(a.creado).toLocaleDateString('es-MX')}{adm ? ' · Para: ' + a.para.map(r => NOM[r]).join(', ') : ''}</p>
        {adm && <button className="mini rojo" style={{ marginLeft: 0, marginTop: 8 }} onClick={() => borrar(a.id)}>Borrar</button>}</Card>))}
    {lista && !lista.length && <Card><p className="vacio">No hay avisos por ahora.</p></Card>}
  </>);
}

export function ReporteVer() {
  const al = useAlumno(), d = useDatos(), [notas] = useCached('calif', '/api/calificaciones');
  if (!al) return <Sin />;
  const rs = d.asistencias.filter(a => a.curp === al.curp), mats = [...new Set([...rs.map(a => a.materia), ...(notas || []).filter(n => n.curp === al.curp).map(n => n.materia)].filter(Boolean))].sort();
  const g = resumenAsistencia(rs);
  return (<>
    <Hero titulo="Reportes" sub={`${al.nombre} · solo consulta`} />
    <Card title="Resumen por materia"><div className="tabla"><table className="tb"><thead><tr><th className="izq">Materia</th><th>Asistencia</th><th>Faltas</th><th>Promedio</th></tr></thead>
      <tbody>{mats.map(m => { const r = resumenAsistencia(rs.filter(a => a.materia === m)), n = (notas || []).filter(x => x.curp === al.curp && x.materia === m).map(x => x.nota), p = n.length ? (n.reduce((a, b) => a + b, 0) / n.length).toFixed(1) : '–';
        return <tr key={m}><td className="izq">{m}</td><td>{r.pct}%</td><td>{r.falt}</td><td>{p}</td></tr>; })}
        {!mats.length && <tr><td className="izq" colSpan="4">Aún no hay información</td></tr>}</tbody></table></div></Card>
    <Card title="Asistencia general"><div className="num">{g.pct}<small>%</small></div></Card>
    <button className="btn sec" onClick={() => window.print()}>Imprimir reporte</button>
  </>);
}

export function Cuenta() {
  const ses = SD.session(), [yo, setYo] = useState(null), [b, ban] = useBanner(), [f, setF] = useState({ actual: '', nueva: '' });
  useEffect(() => { SD.api('/api/yo').then(setYo).catch(() => setYo(ses)); }, []);
  const cambiar = async e => { e.preventDefault(); try { await post('/api/cuenta/password', f); await SD.login(ses.rol === 'admin' ? 'docente' : ses.rol, ses.id, f.nueva); setF({ actual: '', nueva: '' }); ban('ok', 'Contraseña cambiada'); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Mi cuenta" sub={yo ? yo.nombre : ''} /><Banner b={b} />
    {yo && <Card title="Datos"><dl><dt>Usuario</dt><dd>{yo.curp || yo.rfc || yo.id}</dd><dt>Correo</dt><dd>{yo.correo || '—'}</dd></dl></Card>}
    {ses.rol !== 'admin' ? <Card title="Cambiar contraseña"><form onSubmit={cambiar}>
      <label>Contraseña actual</label><input type="password" value={f.actual} onChange={e => setF({ ...f, actual: e.target.value })} required />
      <label>Nueva contraseña (mínimo 6)</label><input type="password" value={f.nueva} onChange={e => setF({ ...f, nueva: e.target.value })} minLength="6" required />
      <button className="btn" type="submit">GUARDAR CONTRASEÑA</button></form></Card>
      : <Card><p className="vacio">La contraseña de Servicios Escolares se cambia en Render (variable ADMIN_PASSWORD).</p></Card>}
  </>);
}
