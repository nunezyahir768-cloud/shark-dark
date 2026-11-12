import { useState, useEffect, useCallback } from 'react';
import SD from './sd.js';
import * as XL from './excel.js';
import { Card, Hero, Banner, useBanner, QR, DIAS, SEMESTRES, AREAS, hh, hoyISO, post, msgErr, nombreGrupo, conDescanso, descargar } from './ui.jsx';
import { Camara } from './docente.jsx';

function useServicios() {
  const [u, setU] = useState([]), [g, setG] = useState([]), [c, setC] = useState([]), [h, setH] = useState([]);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    try { const [a, b, d, e] = await Promise.all([SD.api('/api/admin/usuarios'), SD.api('/api/grupos'), SD.api('/api/clases'), SD.api('/api/horarios')]); setU(a); setG(b.sort((x, y) => nombreGrupo(x).localeCompare(nombreGrupo(y)))); setC(d); setH(e); setError(''); }
    catch (e) { setError(e.message || 'No se pudieron cargar los datos de administración.'); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  return { u, g, c, h, cargar, error };
}

export function InicioAdmin() {
  const [datos, setDatos] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      SD.api('/api/admin/usuarios'), SD.api('/api/grupos'), SD.api('/api/clases'),
      SD.api('/api/permisos'), SD.api('/api/admin/historial')
    ]).then(([usuarios, grupos, clases, permisos, historial]) => {
      setDatos({ usuarios, grupos, clases, pendientes: permisos.filter(x => x.estado === 'pendiente').length, historial });
    }).catch(e => setError(e.message || 'No se pudo cargar el resumen de Control Escolar.'));
  }, []);
  const accesos = [['cuentas', 'Cuentas'], ['grupos', 'Grupos'], ['clases', 'Materias'], ['horarios', 'Horarios'], ['permisos', 'Permisos'], ['avisos', 'Avisos'], ['reportes', 'Reportes'], ['historial', 'Historial']];
  const recientes = datos ? datos.historial.slice(0, 5) : [];
  return <>
    <Hero titulo="Control Escolar" sub="Resumen de la actividad y accesos administrativos." />
    {error && <p className="msg" role="alert">{error}</p>}
    <div className="admin-accesos">{accesos.map(([ruta, texto]) => <a className="admin-acceso" href={'#/' + ruta} key={ruta}>{texto}<span aria-hidden="true">→</span></a>)}</div>
    {datos && <>
      <Card title="Resumen"><div className="stats">
        <div><div className="num">{datos.usuarios.filter(x => x.rol === 'alumno').length}</div><small className="vacio">Alumnos</small></div>
        <div><div className="num">{datos.usuarios.filter(x => x.rol === 'docente').length}</div><small className="vacio">Docentes</small></div>
        <div><div className="num">{datos.usuarios.filter(x => x.rol === 'tutor').length}</div><small className="vacio">Tutores</small></div>
        <div><div className="num">{datos.grupos.length}</div><small className="vacio">Grupos</small></div>
        <div><div className="num">{datos.clases.length}</div><small className="vacio">Materias</small></div>
        <div><div className="num rojo">{datos.pendientes}</div><small className="vacio">Permisos pendientes</small></div>
      </div></Card>
      <Card title="Cambios recientes">
        <ul className="l">{recientes.map(x => <li key={x.id}><span>{x.accion} · {x.detalle}</span><small>{new Date(x.creado).toLocaleDateString('es-MX')}</small></li>)}
          {!recientes.length && <li className="vacio">Aún no hay cambios registrados.</li>}</ul>
        {recientes.length > 0 && <a className="admin-ver-mas" href="#/historial">Ver historial</a>}
      </Card>
    </>}
  </>;
}

export function Cuentas() {
  const { u, g, cargar, error } = useServicios(), [b, ban] = useBanner(), [q, setQ] = useState(''), [temp, setTemp] = useState(''), [solicitudes, setSolicitudes] = useState([]), [errorSolicitudes, setErrorSolicitudes] = useState('');
  const [filtroRol, setFiltroRol] = useState('todos'), [filtroGrupo, setFiltroGrupo] = useState('todos'), [filtroEstado, setFiltroEstado] = useState('todos');
  const [f, setF] = useState({ rol: 'alumno', nombre: '', id: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A' });
  const cargarSolicitudes = async () => { try { setSolicitudes(await SD.api('/api/admin/recuperaciones')); setErrorSolicitudes(''); } catch (e) { setErrorSolicitudes(e.message || 'No se pudieron cargar las solicitudes.'); } };
  useEffect(() => { cargarSolicitudes(); }, []);
  const crear = async e => {
    e.preventDefault();
    try { const r = await post('/api/admin/usuarios', f); setTemp(r.passwordTemporal || ''); ban('ok', 'Cuenta creada', 'Entrega la contraseña temporal al titular por un medio seguro.'); setF({ ...f, nombre: '', id: '' }); cargar(); }
    catch (er) { ban('err', 'No se pudo crear la cuenta', msgErr(er)); }
  };
  const acc = async (a, x) => {
    try {
      if (a === 'borrar') { if (!confirm('¿Borrar esta cuenta? No se puede deshacer.')) return; await post('/api/admin/borrar', { rol: x.rol, id: x.id }); cargar(); }
      else if (a === 'grupo') { const n = prompt('Número del grupo nuevo:\n' + g.map((k, i) => `${i + 1}) ${nombreGrupo(k)}`).join('\n')), k = g[(+n) - 1]; if (!k) return; await post('/api/admin/editar', { id: x.id, area: k.area, semestre: k.semestre, grupo: k.grupo }); cargar(); }
      else if (a === 'vincular') { const ca = prompt('CURP del alumno que quieres vincular a este tutor:'); if (!ca) return; await post('/api/admin/vincular', { tutor: x.id, alumno: ca }); ban('ok', 'Vinculado', 'El tutor ya puede ver a ese alumno.'); cargar(); }
    } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  const l = u.filter(x => {
    const grupo = `${x.semestre}|${x.area}|${x.grupo}`;
    return (!q || (x.nombre + ' ' + (x.curp || x.id)).toLowerCase().includes(q.toLowerCase()))
      && (filtroRol === 'todos' || x.rol === filtroRol)
      && (filtroGrupo === 'todos' || grupo === filtroGrupo)
      && (filtroEstado === 'todos' || (filtroEstado === 'primer-acceso' ? x.debeCambiarPassword : !x.debeCambiarPassword));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 100);
  return (<>
    <Hero titulo="Cuentas" sub="Administra altas, accesos, grupos y solicitudes de recuperación." /><Banner b={b} />
    {error && <p className="msg" role="alert">{error}</p>}
    {temp && <Card title="Contraseña temporal · mostrar una sola vez"><p>Entrégala al titular por un medio privado. Al iniciar sesión tendrá que crear una contraseña nueva.</p><p style={{ fontWeight: 800, letterSpacing: 1, overflowWrap: "anywhere" }}>{temp}</p><button className="mini" onClick={() => { navigator.clipboard?.writeText(temp); }}>Copiar</button><button className="mini" onClick={() => setTemp('')}>Ocultar</button></Card>}
    <Card title="Crear una cuenta"><form onSubmit={crear}>
      <select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })}><option value="alumno">Alumno</option><option value="docente">Docente</option><option value="tutor">Tutor</option></select>
      <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre completo" required />
      <input value={f.id} onChange={e => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="CURP (18 caracteres)" maxLength="18" required />
      {f.rol === 'alumno' && <>
        <label>Semestre</label><select value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })}>{SEMESTRES.map(s => <option key={s}>{s}</option>)}</select>
        <label>Área</label><select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
        <label>Grupo</label><select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select></>}
      <button className="btn" type="submit">CREAR CUENTA</button></form></Card>
    <Card title={`Solicitudes de restablecimiento · ${solicitudes.length}`}>
      <p className="sub">Revisa la identidad del usuario antes de autorizar. La contraseña temporal se muestra una sola vez.</p>
      <button className="mini" onClick={cargarSolicitudes}>Actualizar solicitudes</button>
      {solicitudes.map(x => <div key={x.id} style={{ borderTop: '1px solid var(--borde, #ddd)', paddingTop: 10, marginTop: 10 }}><b>{x.nombre || 'Cuenta'}</b><span className="tag">Pendiente</span><p className="sub">{x.rol} · {x.curp} · {new Date(x.creado).toLocaleString()}</p><button className="mini" onClick={async () => { if (!confirm('Confirma que verificaste la identidad del usuario.')) return; try { const r = await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'restablecer' }); setTemp(r.passwordTemporal); ban('ok', 'Contraseña restablecida', 'Entrega la contraseña temporal al usuario por un medio privado.'); cargarSolicitudes(); } catch (er) { ban('err', 'No se pudo restablecer', msgErr(er)); } }}>Verificar y restablecer</button><button className="mini rojo" onClick={async () => { try { if (!confirm('¿Rechazar esta solicitud?')) return; await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'rechazar' }); cargarSolicitudes(); } catch (er) { ban('err', 'No se pudo rechazar', msgErr(er)); } }}>Rechazar</button></div>)}
      {errorSolicitudes && <p className="msg" role="alert">{errorSolicitudes}</p>}
      {!solicitudes.length && !errorSolicitudes && <p className="vacio">No hay solicitudes pendientes.</p>}
    </Card>
    <Card title="Buscar y filtrar cuentas">
      <label htmlFor="cuentas-buscar">Nombre o CURP</label><input id="cuentas-buscar" value={q} onChange={e => setQ(e.target.value)} placeholder="Escribe nombre o CURP" />
      <div className="fila2">
        <div><label htmlFor="cuentas-rol">Perfil</label><select id="cuentas-rol" value={filtroRol} onChange={e => setFiltroRol(e.target.value)}><option value="todos">Todos</option><option value="alumno">Alumno</option><option value="docente">Docente</option><option value="tutor">Tutor</option></select></div>
        <div><label htmlFor="cuentas-estado">Estado de acceso</label><select id="cuentas-estado" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}><option value="todos">Todos</option><option value="primer-acceso">Primer acceso pendiente</option><option value="activa">Activa</option></select></div>
      </div>
      <label htmlFor="cuentas-grupo">Grupo</label><select id="cuentas-grupo" value={filtroGrupo} onChange={e => setFiltroGrupo(e.target.value)}><option value="todos">Todos los grupos</option>{g.map(k => <option key={k.id} value={`${k.semestre}|${k.area}|${k.grupo}`}>{nombreGrupo(k)}</option>)}</select>
      <p className="sub" style={{ marginBottom: 0 }}>Se muestran hasta 100 resultados.</p>
    </Card>
    {l.map(x => (
      <Card key={x.rol + x.id}><b>{x.nombre}</b><span className="tag">{x.rol}</span><span className={'tag ' + (x.debeCambiarPassword ? '' : 'ok')}>{x.debeCambiarPassword ? 'Primer acceso pendiente' : 'Activa'}</span>
        <p className="sub" style={{ margin: '4px 0 8px' }}>{x.curp || x.id}{x.rol === 'alumno' ? ` · ${x.semestre} ${x.area} ${x.grupo}` : ''}{x.hijos && x.hijos.length ? ` · alumnos: ${x.hijos.join(', ')}` : ''}{x.tutores && x.tutores.length ? ` · tutores: ${x.tutores.join(', ')}` : ''}</p>
        {x.rol === 'alumno' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('grupo', x)}>Cambiar grupo</button>}
        {x.rol === 'tutor' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('vincular', x)}>Vincular alumno</button>}
        <button className={'mini rojo'} style={x.rol === 'docente' ? { marginLeft: 0 } : {}} onClick={() => acc('borrar', x)}>Borrar</button></Card>))}
    {!l.length && <Card><p className="vacio">Sin resultados.</p></Card>}
  </>);
}

export function Grupos() {
  const { g, u, c, cargar, error } = useServicios(), [b, ban] = useBanner();
  const cuenta = k => u.filter(x => x.rol === 'alumno' && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length;
  const borrar = async k => {
    if (!confirm(`¿Eliminar el grupo ${nombreGrupo(k)}?\n\nSe borrarán sus ${cuenta(k)} cuentas de alumnos (con sus asistencias y calificaciones), sus clases y su horario. No se puede deshacer.`)) return;
    try { const r = await post('/api/admin/grupos/borrar', { id: k.id }); ban('ok', 'Grupo eliminado', `${r.alumnos} cuentas de alumnos borradas.`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  return (<>
    <Hero titulo="Grupos" sub="Los grupos se crean solos al dar de alta al primer alumno de cada grupo." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    {g.map(k => <Card key={k.id}><b>{nombreGrupo(k)}</b><p className="sub" style={{ margin: '4px 0 8px' }}>{cuenta(k)} alumnos · {c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length} materias</p>
      <button className="mini rojo" style={{ marginLeft: 0 }} onClick={() => borrar(k)}>Eliminar grupo y sus cuentas</button></Card>)}
    {!g.length && <Card><p className="vacio">Todavía no hay grupos. Crea la cuenta de un alumno y su grupo aparecerá aquí.</p></Card>}
  </>);
}

export function Clases() {
  const { g, u, c, cargar, error } = useServicios(), [b, ban] = useBanner(), [f, setF] = useState({ gi: 0, materia: '', docente: '' }), [qr, setQr] = useState(null);
  const docs = u.filter(x => x.rol === 'docente');
  const crear = async e => { e.preventDefault(); const k = g[+f.gi]; if (!k) return ban('err', 'Primero crea un grupo'); try { await post('/api/admin/clases', { area: k.area, semestre: k.semestre, grupo: k.grupo, materia: f.materia, docente: f.docente || (docs[0] && docs[0].id) }); setF({ ...f, materia: '' }); ban('ok', 'Clase añadida', 'Se generó su QR: búscala abajo y toca Ver QR.'); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  const borrar = async k => { if (!confirm('¿Borrar esta clase?')) return; try { await post('/api/admin/clases/borrar', { id: k.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Materias" sub="Asigna cada materia a un grupo y a su docente." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    <Card title="Nueva clase"><form onSubmit={crear}>
      <select value={f.gi} onChange={e => setF({ ...f, gi: e.target.value })}>{g.map((k, i) => <option key={k.id} value={i}>{nombreGrupo(k)}</option>)}</select>
      <input value={f.materia} onChange={e => setF({ ...f, materia: e.target.value })} placeholder="Materia (ej. Matemáticas)" maxLength="60" required />
      <select value={f.docente} onChange={e => setF({ ...f, docente: e.target.value })}>{docs.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}{!docs.length && <option value="">Primero crea un docente</option>}</select>
      <button className="btn" type="submit">AÑADIR CLASE</button></form></Card>
    {qr && <Card title="QR de la clase" style={{ textAlign: 'center' }}><QR texto={'CLASE:' + qr.id} /><p><b>{qr.materia}</b><br />{qr.semestre} {qr.area} {qr.grupo}</p><p className="sub">Imprímelo: el docente lo escanea y se abre esta clase.</p></Card>}
    {c.slice().sort((a, b) => (a.semestre + a.area + a.grupo + a.materia).localeCompare(b.semestre + b.area + b.grupo + b.materia)).map(k => (
      <Card key={k.id}><b>{k.materia}</b><p className="sub" style={{ margin: '2px 0 8px' }}>{k.semestre} {k.area} {k.grupo} · Prof. {k.docenteNombre || k.docente}</p>
        <button className="mini" style={{ marginLeft: 0 }} onClick={() => { setQr(k); scrollTo(0, 0); }}>Ver QR</button><button className="mini rojo" onClick={() => borrar(k)}>Borrar</button></Card>))}
  </>);
}

export function Horarios() {
  const { g, c, h, cargar, error } = useServicios(), [b, ban] = useBanner(), [gi, setGi] = useState(0);
  const [f, setF] = useState({ dia: 1, inicio: '07:00', fin: '07:50', claseId: '' });
  const k = g[+gi], cl = k ? c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo) : [], bl = k ? h.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo) : [];
  const todo = conDescanso(bl);
  const añadir = async e => {
    e.preventDefault(); if (!k) return ban('err', 'Primero da de alta a un alumno de ese grupo');
    try { await post('/api/admin/horarios', { area: k.area, semestre: k.semestre, grupo: k.grupo, dia: +f.dia, inicio: f.inicio, fin: f.fin, tipo: 'clase', claseId: f.claseId || (cl[0] && cl[0].id) });
      ban('ok', 'Bloque añadido', `${DIAS[f.dia]} ${hh(f.inicio)} a ${hh(f.fin)}`); setF({ ...f, inicio: f.fin, fin: '' }); cargar(); }
    catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  const borrar = async x => { if (!confirm(`¿Quitar ${x.materia} del horario del ${DIAS[x.dia]}?`)) return; try { await post('/api/admin/horarios/borrar', { id: x.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Horarios" sub="El descanso de 9:30 a 10:00 ya está fijo todos los días." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    <Card title="Grupo"><select value={gi} onChange={e => setGi(e.target.value)}>{g.map((x, i) => <option key={x.id} value={i}>{nombreGrupo(x)}</option>)}{!g.length && <option>Aún no hay grupos</option>}</select></Card>
    <Card title="Añadir una clase al horario"><form onSubmit={añadir}>
      <select value={f.dia} onChange={e => setF({ ...f, dia: e.target.value })}>{[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DIAS[d]}</option>)}</select>
      <div className="fila2"><div><label>De las</label><input type="time" value={f.inicio} onChange={e => setF({ ...f, inicio: e.target.value })} required /></div><div><label>A las</label><input type="time" value={f.fin} onChange={e => setF({ ...f, fin: e.target.value })} required /></div></div>
      <select value={f.claseId} onChange={e => setF({ ...f, claseId: e.target.value })}>{cl.map(x => <option key={x.id} value={x.id}>{x.materia} · {x.docenteNombre}</option>)}{!cl.length && <option value="">Primero crea las clases de este grupo</option>}</select>
      <button className="btn" type="submit">AÑADIR AL HORARIO</button></form></Card>
    {[1, 2, 3, 4, 5, 6].filter(d => todo.some(x => x.dia === d)).map(d => (
      <Card key={d} title={DIAS[d]}><ul className="l">{todo.filter(x => x.dia === d).sort((a, b) => a.inicio.localeCompare(b.inicio)).map(x => <li key={x.id}><span>{hh(x.inicio)} a {hh(x.fin)} - {x.materia}</span><span>{String(x.id).startsWith('desc') ? 'fijo' : <button className="mini rojo" onClick={() => borrar(x)}>Quitar</button>}</span></li>)}</ul></Card>))}
  </>);
}

export function ReportesAdmin() {
  const [datos, setDatos] = useState(null), [error, setError] = useState('');
  const [grupo, setGrupo] = useState(''), [claseId, setClaseId] = useState('');
  const [tipo, setTipo] = useState('asistencia'), [mes, setMes] = useState(hoyISO().slice(0, 7)), [parcial, setParcial] = useState('1');
  useEffect(() => {
    Promise.all([
      SD.api('/api/alumnos'), SD.api('/api/clases'), SD.api('/api/asistencias'), SD.api('/api/calificaciones')
    ]).then(([alumnos, clases, asistencias, calificaciones]) => setDatos({ alumnos, clases, asistencias, calificaciones }))
      .catch(e => setError(e.message || 'No se pudieron cargar los datos para el reporte.'));
  }, []);
  const grupos = datos ? [...new Map(datos.alumnos.map(a => {
    const id = `${a.semestre}|${a.area}|${a.grupo}`;
    return [id, { id, semestre: a.semestre, area: a.area, grupo: a.grupo }];
  })).values()].sort((a, b) => nombreGrupo(a).localeCompare(nombreGrupo(b))) : [];
  const grupoActivo = grupo || (grupos[0] && grupos[0].id) || '';
  const alumnos = datos ? datos.alumnos.filter(a => `${a.semestre}|${a.area}|${a.grupo}` === grupoActivo).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  const clases = datos ? datos.clases.filter(c => `${c.semestre}|${c.area}|${c.grupo}` === grupoActivo).sort((a, b) => a.materia.localeCompare(b.materia)) : [];
  const clase = clases.find(c => c.id === claseId) || clases[0] || null;
  const curps = new Set(alumnos.map(a => a.curp));
  const registros = datos && clase ? datos.asistencias.filter(a => curps.has(a.curp) && (a.materia || '').toLowerCase() === clase.materia.toLowerCase() && a.fecha.startsWith(mes)) : [];
  const [anio, mesNumero] = mes.split('-').map(Number);
  const fechas = clase && anio && mesNumero ? Array.from({ length: new Date(anio, mesNumero, 0).getDate() }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`) : [];
  const marca = { asistio: '✓', falta: '✗', justificada: 'J' };
  const porFecha = new Map(registros.map(a => [`${a.curp}|${a.fecha}`, marca[a.estado] || '·']));
  const notas = datos && clase ? datos.calificaciones.filter(n => curps.has(n.curp) && (n.materia || '').toLowerCase() === clase.materia.toLowerCase() && n.parcial === Number(parcial)) : [];
  const notaAlumno = new Map(notas.map(n => [n.curp, n.nota]));
  const nombreMes = new Date(mes + '-15T12:00:00').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const exportar = () => {
    if (!clase) return;
    const sub = `${nombreGrupo({ semestre: clase.semestre, area: clase.area, grupo: clase.grupo })} · ${clase.materia}`;
    if (tipo === 'asistencia') {
      const nom = new Map(alumnos.map(a => [a.curp, a.nombre]));
      const detalle = registros.map(a => [nom.get(a.curp) || 'Alumno', a.curp, a.fecha, a.hora || '', a.materia, a.estado, a.motivo || '']);
      descargar(XL.asistencias({
        titulo: 'CBTIS 170 · SHARK DARK', subtitulo: `Asistencia · ${sub} · ${nombreMes}`,
        fechas: fechas.map(f => `${f.slice(8)}/${f.slice(5, 7)}`),
        filas: alumnos.map(a => [a.nombre, fechas.map(f => porFecha.get(`${a.curp}|${f}`) || '·')]), detalle
      }), `reporte-asistencia-${clase.semestre}${clase.area}${clase.grupo}-${mes}.xlsx`);
    } else {
      descargar(XL.calificaciones({
        titulo: 'CBTIS 170 · SHARK DARK', subtitulo: `Calificaciones · ${sub} · Parcial ${parcial}`,
        materias: [clase.materia],
        filas: alumnos.map(a => [a.nombre, [notaAlumno.has(a.curp) ? notaAlumno.get(a.curp) : '']])
      }), `reporte-calificaciones-${clase.semestre}${clase.area}${clase.grupo}-P${parcial}.xlsx`);
    }
  };
  return <>
    <Hero titulo="Reportes" sub="Consulta y exporta asistencia o calificaciones por grupo, materia y periodo." />
    {error && <p className="msg" role="alert">{error}</p>}
    {datos && <>
      <Card title="Filtros del reporte">
        <label htmlFor="reporte-grupo">Grupo</label><select id="reporte-grupo" value={grupoActivo} onChange={e => { setGrupo(e.target.value); setClaseId(''); }}>
          {grupos.map(g => <option key={g.id} value={g.id}>{nombreGrupo(g)}</option>)}
          {!grupos.length && <option value="">Sin grupos registrados</option>}
        </select>
        <label htmlFor="reporte-materia">Materia</label><select id="reporte-materia" value={clase ? clase.id : ''} onChange={e => setClaseId(e.target.value)}>
          {clases.map(c => <option key={c.id} value={c.id}>{c.materia}</option>)}
          {!clases.length && <option value="">Sin materias registradas</option>}
        </select>
        <label htmlFor="reporte-tipo">Tipo de reporte</label><select id="reporte-tipo" value={tipo} onChange={e => setTipo(e.target.value)}><option value="asistencia">Asistencia mensual</option><option value="calificaciones">Calificaciones por parcial</option></select>
        {tipo === 'asistencia'
          ? <><label htmlFor="reporte-mes">Periodo</label><input id="reporte-mes" type="month" value={mes} onChange={e => setMes(e.target.value)} /></>
          : <><label htmlFor="reporte-parcial">Periodo</label><select id="reporte-parcial" value={parcial} onChange={e => setParcial(e.target.value)}><option value="1">Parcial 1</option><option value="2">Parcial 2</option><option value="3">Parcial 3</option></select></>}
      </Card>
      {clase && tipo === 'asistencia' && <Card title={`Asistencia · ${nombreMes}`}>
        <div className="tabla"><table className="tb"><thead><tr><th>No.</th><th>Nombre</th>{fechas.map(f => <th key={f}>{f.slice(8)}/{f.slice(5, 7)}</th>)}</tr></thead>
          <tbody>{alumnos.map((a, i) => <tr key={a.curp}><td>{i + 1}</td><td>{a.nombre}</td>{fechas.map(f => { const v = porFecha.get(`${a.curp}|${f}`) || '·'; return <td key={f}>{v === '·' ? '–' : v}</td>; })}</tr>)}
            {!alumnos.length && <tr><td colSpan={2}>No hay alumnos en este grupo.</td></tr>}
          </tbody></table></div>
        <p className="sub">✓ asistió · ✗ faltó · J justificada · – sin registro</p>
        <button className="btn" onClick={exportar}>EXPORTAR A EXCEL</button><button className="btn sec" onClick={() => window.print()}>IMPRIMIR</button>
      </Card>}
      {clase && tipo === 'calificaciones' && <Card title={`Parcial ${parcial} · ${clase.materia}`}>
        <div className="tabla"><table className="tb"><thead><tr><th>No.</th><th>Nombre</th><th>Calificación</th></tr></thead>
          <tbody>{alumnos.map((a, i) => <tr key={a.curp}><td>{i + 1}</td><td>{a.nombre}</td><td>{notaAlumno.get(a.curp) ?? '–'}</td></tr>)}
            {!alumnos.length && <tr><td colSpan={3}>No hay alumnos en este grupo.</td></tr>}
          </tbody></table></div>
        <button className="btn" onClick={exportar}>EXPORTAR A EXCEL</button><button className="btn sec" onClick={() => window.print()}>IMPRIMIR</button>
      </Card>}
      {!clase && <Card><p className="vacio">Elige un grupo con materias para generar un reporte.</p></Card>}
    </>}
  </>;
}

export function Historial() {
  const [lista, setLista] = useState(null), [filtro, setFiltro] = useState(''), [error, setError] = useState('');
  const cargar = useCallback(() => SD.api('/api/admin/historial').then(setLista).catch(e => setError(e.message || 'No se pudo cargar el historial.')), []);
  useEffect(() => { cargar(); }, [cargar]);
  const q = filtro.trim().toLowerCase();
  const visible = (lista || []).filter(x => !q || `${x.accion} ${x.detalle} ${x.actorNombre} ${x.actor}`.toLowerCase().includes(q));
  return <>
    <Hero titulo="Historial de cambios" sub="Últimos 300 cambios administrativos relevantes, con responsable y fecha." />
    {error && <p className="msg" role="alert">{error}</p>}
    <Card title="Buscar en el historial"><label htmlFor="historial-buscar">Acción, detalle o responsable</label><input id="historial-buscar" value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar cambios" /><button className="mini" onClick={cargar}>Actualizar</button></Card>
    {visible.map(x => <Card key={x.id}><b>{x.accion}</b><p style={{ margin: '6px 0' }}>{x.detalle}</p><p className="sub" style={{ margin: 0 }}>{x.actorNombre} · {new Date(x.creado).toLocaleString('es-MX')}</p></Card>)}
    {lista && !visible.length && <Card><p className="vacio">No hay cambios que coincidan con la búsqueda.</p></Card>}
  </>;
}

export function Escaner() {
  const [curp, setCurp] = useState(''), [r, setR] = useState(null), [b, ban] = useBanner();
  const ver = async t => { t = t.trim().toUpperCase(); setCurp(t); if (!/^[A-Z0-9]{18}$/.test(t)) return ban('err', 'QR no válido', 'No contiene una CURP.'); const x = await SD.consultar(t); x.alumno ? (setR(x), ban('ok', 'Alumno encontrado', x.alumno.nombre)) : (setR(null), ban('err', 'No encontrado')); };
  return (<>
    <Hero titulo="Escáner" sub="Escanea el QR de un alumno, o escribe su CURP, para ver su ficha." /><Banner b={b} />
    <Card><Camara onTexto={ver} onError={m => ban('err', 'Cámara', m)} />
      <div className="fila2" style={{ marginTop: 12 }}><input value={curp} maxLength="18" placeholder="CURP" onChange={e => setCurp(e.target.value.toUpperCase())} style={{ marginTop: 0 }} /><button className="btn" style={{ flex: 'none', width: 80, margin: 0 }} onClick={() => ver(curp)}>OK</button></div></Card>
    {r && <><Card title="Ficha"><dl><dt>Nombre</dt><dd>{r.alumno.nombre}</dd><dt>CURP</dt><dd>{r.alumno.curp}</dd><dt>Grupo</dt><dd>{r.alumno.semestre} {r.alumno.area} {r.alumno.grupo}</dd></dl></Card>
      <Card title="Historial"><ul className="l">{r.asistencias.slice(0, 20).map(a => <li key={a.uid}><span>{a.fecha} · {a.hora}</span><span>{a.estado === 'falta' ? 'falta · ' : ''}{a.materia}</span></li>)}{!r.asistencias.length && <li className="vacio">Sin registros</li>}</ul></Card></>}
  </>);
}
