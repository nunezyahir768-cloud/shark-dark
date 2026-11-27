import { useState, useEffect, useCallback, useRef } from 'react';
import SD from './sd.js';
import * as XL from './excel.js';
import { descargarPlantillaCuentas, leerCuentasExcel } from './importar-cuentas.js';
import { Card, Hero, Banner, useBanner, QR, DIAS, SEMESTRES, SEMESTRES_IMPARES, SEMESTRES_PARES, AREAS, hh, hoyISO, post, msgErr, nombreGrupo, etiquetaSemestre, conDescanso, descargar, PanelEmergente } from './ui.jsx';
import { Camara } from './docente.jsx';
import { InicioBienvenida } from './paginas.jsx';

function useServicios(cargarUsuarios = true) {
  const [u, setU] = useState([]), [g, setG] = useState([]), [c, setC] = useState([]), [h, setH] = useState([]);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    try { const [a, b, d, e] = await Promise.all([cargarUsuarios ? SD.cached('admin_usuarios', '/api/admin/usuarios') : Promise.resolve([]), SD.cached('admin_grupos', '/api/grupos'), SD.cached('admin_clases', '/api/clases'), SD.cached('admin_horarios', '/api/horarios')]); setU(a); setG(b.sort((x, y) => nombreGrupo(x).localeCompare(nombreGrupo(y)))); setC(d); setH(e); setError(''); }
    catch (e) { setError(e.message || 'No se pudieron cargar los datos de administración.'); }
  }, [cargarUsuarios]);
  useEffect(() => { cargar(); }, [cargar]);
  return { u, g, c, h, cargar, error };
}

export function InicioAdmin({ onTutorial }) {
  return <InicioBienvenida onTutorial={onTutorial} />;
}

const sumar50 = h => { const [a, b] = (h || '').split(':').map(Number); if (Number.isNaN(a) || Number.isNaN(b)) return ''; const m = a * 60 + b + 50; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export function Cuentas() {
  const { u, g, cargar, error } = useServicios(), [b, ban] = useBanner(), [solicitudes, setSolicitudes] = useState([]), [errorSolicitudes, setErrorSolicitudes] = useState('');
  const [importadas, setImportadas] = useState([]), [leyendoExcel, setLeyendoExcel] = useState(false), [creandoImportadas, setCreandoImportadas] = useState(false), [errorImportacion, setErrorImportacion] = useState('');
  const [mantenimientoAbierto, setMantenimientoAbierto] = useState(false), [mantenimientoVista, setMantenimientoVista] = useState(''), [rolAbierto, setRolAbierto] = useState('');
  const filtrosIniciales = { q: '', grupo: 'todos', estado: 'todos' };
  const [filtros, setFiltros] = useState(filtrosIniciales);
  const [errorCrear, setErrorCrear] = useState('');
  const [semConfig, setSemConfig] = useState({ periodo: 'impares', activos: SEMESTRES_IMPARES, siguientes: SEMESTRES_PARES });
  const [f, setF] = useState({ rol: 'alumno', nombre: '', id: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A', tutorNombre: '', tutorCurp: '', curpAlumno: '', sinTutor: false });
  const cargarSolicitudes = async () => { try { setSolicitudes(await SD.cached('admin_recuperaciones', '/api/admin/recuperaciones')); setErrorSolicitudes(''); } catch (e) { setErrorSolicitudes(e.message || 'No se pudieron cargar las solicitudes.'); } };
  const borrarSolicitudes = async () => {
    if (!solicitudes.length || !confirm('¿Quieres borrar todas las solicitudes de restablecimiento pendientes? Esta acción no se puede deshacer.')) return;
    try { const r = await SD.api('/api/admin/recuperaciones', { method: 'DELETE' }); setSolicitudes([]); setMantenimientoVista(''); ban('ok', 'Solicitudes borradas', `Se borraron ${r.eliminadas} solicitudes pendientes.`); }
    catch (er) { ban('err', 'No se pudieron borrar las solicitudes', msgErr(er)); }
  };
  useEffect(() => { cargarSolicitudes(); SD.api('/api/semestres').then(config => { setSemConfig(config); setF(actual => ({ ...actual, semestre: config.activos.includes(actual.semestre) ? actual.semestre : config.activos[0] })); }).catch(() => {}); }, []);
  const cambiarPeriodoSemestres = async periodo => {
    try {
      const nuevo = await post('/api/admin/semestres', { periodo }); setSemConfig(nuevo);
      setF(actual => ({ ...actual, semestre: nuevo.activos.includes(actual.semestre) ? actual.semestre : nuevo.activos[0] }));
      ban('ok', 'Periodo actualizado', `Ahora están activos ${nuevo.activos.join(', ')}.`);
    } catch (er) { ban('err', 'No se pudo cambiar el periodo', msgErr(er)); }
  };
  const tutorEncontrado = f.rol === 'alumno' && f.tutorCurp.length === 18 ? u.find(x => x.rol === 'tutor' && x.id === f.tutorCurp) : null;
  const docenteTutor = f.rol === 'alumno' && f.tutorCurp.length === 18 && !tutorEncontrado ? u.find(x => x.rol === 'docente' && x.id === f.tutorCurp) : null;
  const alumnoTutorEncontrado = f.rol === 'tutor' && f.curpAlumno.length === 18 ? u.find(x => x.rol === 'alumno' && x.id === f.curpAlumno) : null;
  const crear = async e => {
    e.preventDefault();
    setErrorCrear('');
    try {
      const { sinTutor, ...datos } = f;
      if (datos.rol !== 'alumno' || sinTutor) { delete datos.tutorCurp; delete datos.tutorNombre; }
      if (datos.rol !== 'tutor') delete datos.curpAlumno;
      const r = await post('/api/admin/usuarios', datos);
      ban(r.alumnoVinculo === 'pendiente' ? 'warn' : 'ok', 'Cuenta creada', r.alumnoVinculo === 'pendiente' ? 'El alumno no tiene cuenta, espere a que le añadan su cuenta. El vínculo se conectará al crearla.' : 'La persona podrá crear su contraseña al iniciar sesión por primera vez.');
      setF({ ...f, nombre: '', id: '', tutorNombre: '', tutorCurp: '', curpAlumno: '' }); setMantenimientoVista(''); setMantenimientoAbierto(false); cargar();
    }
    catch (er) { setErrorCrear(msgErr(er)); }
  };
  const leerExcel = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setLeyendoExcel(true); setImportadas([]); setErrorImportacion('');
    try {
      const existentes = new Set(u.map(x => `${x.rol}:${x.id || x.curp}`));
      const filas = await leerCuentasExcel(file, semConfig.activos);
      setImportadas(filas.map(c => existentes.has(`${c.rol}:${c.id}`) ? { ...c, errores: [...c.errores, 'Ya existe una cuenta con esta CURP'] } : c));
      ban('ok', 'Excel leído', `Se encontraron ${filas.length} cuentas para revisar.`);
    } catch (er) { setErrorImportacion(er.message || 'No se pudo leer el Excel.'); }
    finally { setLeyendoExcel(false); }
  };
  const crearDesdeExcel = async () => {
    const errores = importadas.filter(x => x.errores.length);
    if (errores.length) return ban('err', 'Corrige el archivo', `Hay ${errores.length} filas con errores. No se creó ninguna cuenta.`);
    if (!importadas.length || !confirm(`¿Crear las ${importadas.length} cuentas del Excel?`)) return;
    setCreandoImportadas(true);
    try {
      const cuentas = importadas.map(({ rol, nombre, id, semestre, area, grupo, curpAlumno }) => ({ rol, nombre, id, semestre, area, grupo, curpAlumno }));
      const r = await post('/api/admin/usuarios/importar', { cuentas });
      ban('ok', 'Cuentas creadas', `Se crearon ${r.creadas} cuentas. Los vínculos indicados en el Excel se conectarán al dar de alta cada alumno.`); setImportadas([]); setMantenimientoVista(''); setMantenimientoAbierto(false); cargar();
    } catch (er) { setErrorImportacion(msgErr(er)); }
    finally { setCreandoImportadas(false); }
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
    return (!filtros.q || (x.nombre + ' ' + (x.curp || x.id)).toLowerCase().includes(filtros.q.toLowerCase()))
      && x.rol === rolAbierto
      && (rolAbierto !== 'alumno' || ((!filtros.area || filtros.area === 'todas' || x.area === filtros.area) && (!filtros.semestre || filtros.semestre === 'todos' || x.semestre === filtros.semestre)))
      && (filtros.grupo === 'todos' || grupo === filtros.grupo)
      && (filtros.estado === 'todos' || (filtros.estado === 'egresado' ? !!x.egresado : !x.egresado && (filtros.estado === 'primer-acceso' ? x.debeCambiarPassword : !x.debeCambiarPassword)));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 100);
  return (<>
    <Hero titulo="Mantenimiento de cuentas" sub="Altas, importaciones Excel, vínculos y solicitudes de recuperación." /><Banner b={b} />
    {error && <p className="msg" role="alert">{error}</p>}
    <Card title="Semestres del periodo"><p className="sub">Alumnos activos: {semConfig.activos.map(etiquetaSemestre).join(', ')}. El siguiente periodo será: {semConfig.siguientes.map(etiquetaSemestre).join(', ')}. Cambia el periodo cuando Control Escolar confirme el avance.</p><label htmlFor="periodo-semestres">Periodo activo</label><select id="periodo-semestres" value={semConfig.periodo} onChange={e => cambiarPeriodoSemestres(e.target.value)}><option value="impares">Impares (1.º, 3.º y 5.º)</option><option value="pares">Pares (2.º, 4.º y 6.º)</option></select></Card>
    <div className="cuentas-acciones"><button className="btn" type="button" onClick={() => { setMantenimientoVista(''); setMantenimientoAbierto(true); }}>MANTENIMIENTO DE CUENTAS</button></div>
    <PanelEmergente abierto={mantenimientoAbierto && !mantenimientoVista} titulo="Mantenimiento de cuentas" onCerrar={() => setMantenimientoAbierto(false)}>
      <p className="sub">Administra altas, importaciones y solicitudes de recuperación desde aquí.</p>
      <div className="cuentas-secciones">
        <button className="cuenta-seccion" type="button" onClick={() => { setErrorCrear(''); setMantenimientoVista('crear'); }}><span className="cuenta-seccion-cab"><b>Crear cuenta</b></span><span className="cuenta-seccion-pie">Alta individual de alumno, tutor o docente</span></button>
        <button className="cuenta-seccion" type="button" onClick={() => setMantenimientoVista('importar')}><span className="cuenta-seccion-cab"><b>Importar Excel</b></span><span className="cuenta-seccion-pie">Carga varias cuentas y vínculos tutor-alumno</span></button>
        <button className="cuenta-seccion" type="button" onClick={() => { setMantenimientoVista('recuperaciones'); cargarSolicitudes(); }}><span className="cuenta-seccion-cab"><b>Recuperaciones</b><span className="tag">{solicitudes.length}</span></span><span className="cuenta-seccion-pie">Revisa solicitudes de acceso</span></button>
      </div>
    </PanelEmergente>
    <PanelEmergente abierto={mantenimientoAbierto && mantenimientoVista === 'importar'} titulo="Importar cuentas" onCerrar={() => setMantenimientoVista('')}>
      <button className="mini" type="button" onClick={() => setMantenimientoVista('')}>← Volver a Mantenimiento de cuentas</button>
      <p className="sub">Incluye la columna CURP alumno para las cuentas de tutor; si el alumno aún no existe, el vínculo se completará al crear su cuenta.</p>
      <button className="mini" type="button" onClick={descargarPlantillaCuentas}>Descargar plantilla Excel</button>
      <input id="cuentas-excel" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={leerExcel} disabled={leyendoExcel || creandoImportadas} /><label className="cuentas-archivo" htmlFor="cuentas-excel">Seleccionar archivo XLSX o XLS</label>
      {errorImportacion && <p className="msg" role="alert">{errorImportacion}</p>}
      {leyendoExcel && <p className="sub" role="status">Leyendo el archivo…</p>}
      {!!importadas.length && <>
        <p className="sub">{importadas.length} cuentas detectadas · {importadas.filter(x => !x.errores.length).length} listas · {importadas.filter(x => x.errores.length).length} con errores</p>
        <div className="import-cuentas-list">{importadas.map((x, i) => <div className="import-cuenta" key={`${x.fila}-${i}`}>
          <div><b>Fila {x.fila} · {x.nombre || 'Sin nombre'}</b><span className="tag">{x.rol}</span><p className="sub">{x.id || 'Sin CURP'}{x.rol === 'alumno' ? ` · ${x.semestre} · ${x.area} · Grupo ${x.grupo}` : ''}</p></div>
          {x.rol === 'tutor' && <p className="sub">CURP alumno: {x.curpAlumno} · {u.some(a => a.rol === 'alumno' && a.id === x.curpAlumno) || importadas.some(a => a.rol === 'alumno' && a.id === x.curpAlumno) ? 'cuenta encontrada, se vinculará' : 'pendiente de crear la cuenta'}</p>}{x.errores.length > 0 && <p className="msg" role="alert">{x.errores.join(' · ')}</p>}
        </div>)}</div>
        <button className="btn" type="button" onClick={crearDesdeExcel} disabled={creandoImportadas || importadas.some(x => x.errores.length)}>{creandoImportadas ? 'CREANDO CUENTAS…' : `CREAR CUENTAS (${importadas.length})`}</button>
      </>}
    </PanelEmergente>
    <PanelEmergente abierto={mantenimientoAbierto && mantenimientoVista === 'crear'} titulo="Nueva cuenta" onCerrar={() => setMantenimientoVista('')}>
      <button className="mini" type="button" onClick={() => setMantenimientoVista('')}>← Volver a Mantenimiento de cuentas</button>
      <form onSubmit={crear}>
      <select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })}><option value="alumno">Alumno</option><option value="docente">Docente</option><option value="tutor">Tutor</option></select>
      <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre completo" required />
      <input value={f.id} onChange={e => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="CURP (18 caracteres)" maxLength="18" required />
      {f.rol === 'alumno' && <>
        <label>Semestre</label><select value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })}>{semConfig.activos.map(s => <option key={s} value={s}>{etiquetaSemestre(s)}</option>)}</select>
        <label>Área</label><select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
        <label>Grupo</label><select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select>
        <label>Tutor del alumno</label>
        {!f.sinTutor && <>
          <input value={f.tutorCurp} onChange={e => setF({ ...f, tutorCurp: e.target.value.toUpperCase() })} placeholder="CURP del tutor (18 caracteres)" maxLength="18" required />
          {tutorEncontrado
            ? <p className="sub" role="status">Tutor ya registrado: <b>{tutorEncontrado.nombre}</b>. Se vinculará a este alumno (máximo 3 alumnos por tutor).</p>
            : docenteTutor
              ? <p className="sub" role="status">Docente registrado: <b>{docenteTutor.nombre}</b>. Se le creará además su cuenta de tutor.</p>
              : <input value={f.tutorNombre} onChange={e => setF({ ...f, tutorNombre: e.target.value })} placeholder="Nombre completo del tutor" required />}
        </>}
        <label className="check"><input type="checkbox" checked={f.sinTutor} onChange={e => setF({ ...f, sinTutor: e.target.checked })} /> Todavía no tengo los datos del tutor</label></>}
      {f.rol === 'tutor' && <>
        <label htmlFor="cuenta-curp-alumno">CURP del alumno</label>
        <input id="cuenta-curp-alumno" value={f.curpAlumno} onChange={e => setF({ ...f, curpAlumno: e.target.value.toUpperCase() })} placeholder="CURP del alumno (18 caracteres)" maxLength="18" required />
        {f.curpAlumno.length === 18 && (alumnoTutorEncontrado
          ? <p className="sub" role="status">Alumno encontrado: <b>{alumnoTutorEncontrado.nombre}</b>. Quedarán vinculados al crear la cuenta.</p>
          : <p className="sub" role="status">El alumno no tiene cuenta, espere a que le añadan su cuenta. El vínculo quedará pendiente y se conectará cuando creen la cuenta del alumno.</p>)}
      </>}
      {errorCrear && <p className="msg" role="alert">{errorCrear}</p>}
      <button className="btn" type="submit">CREAR CUENTA</button>
      </form>
    </PanelEmergente>
    <PanelEmergente abierto={mantenimientoAbierto && mantenimientoVista === 'recuperaciones'} titulo={`Recuperaciones · ${solicitudes.length}`} onCerrar={() => setMantenimientoVista('')}>
    <button className="mini" type="button" onClick={() => setMantenimientoVista('')}>← Volver a Mantenimiento de cuentas</button>
    <Card title="Solicitudes pendientes">
      <button className="mini rojo solicitudes-borrar" type="button" onClick={borrarSolicitudes} disabled={!solicitudes.length}>Borrar solicitudes</button>
      <p className="sub">Revisa la identidad antes de autorizar. Entrega personalmente el código de activación que aparece al confirmar el restablecimiento.</p>
      <button className="mini" onClick={cargarSolicitudes}>Actualizar solicitudes</button>
      {solicitudes.map(x => <div key={x.id} style={{ borderTop: '1px solid var(--linea)', paddingTop: 10, marginTop: 10 }}><b>{x.nombre || 'Cuenta'}</b><span className="tag">Pendiente</span><p className="sub">{x.rol} · {x.curp} · {new Date(x.creado).toLocaleString()}</p><button className="mini" onClick={async () => { if (!confirm('Confirma que verificaste la identidad del usuario.')) return; try { const r = await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'restablecer' }); alert(`Código de activación para ${x.curp}: ${r.codigoActivacion}`); setSolicitudes(v => v.filter(s => s.id !== x.id)); ban('ok', 'Contraseña restablecida', 'Entrega el código de activación a la persona.'); } catch (er) { ban('err', 'No se pudo restablecer', msgErr(er)); } }}>Verificar y restablecer</button><button className="mini rojo" onClick={async () => { try { if (!confirm('¿Rechazar esta solicitud?')) return; await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'rechazar' }); setSolicitudes(v => v.filter(s => s.id !== x.id)); } catch (er) { ban('err', 'No se pudo rechazar', msgErr(er)); } }}>Rechazar</button></div>)}
      {errorSolicitudes && <p className="msg" role="alert">{errorSolicitudes}</p>}
      {!solicitudes.length && !errorSolicitudes && <p className="vacio">No hay solicitudes pendientes.</p>}
    </Card>
    </PanelEmergente>
    <Card title="Cuentas registradas">
      <p className="sub">Administra las cuentas por tipo de usuario.</p>
      <div className="cuentas-secciones">{[['alumno','Alumnos','Lista de alumnos registrada'],['tutor','Tutores','Lista de tutores registrada'],['docente','Docentes','Lista de docentes registrada']].map(([rol,titulo,desc]) => <button className="cuenta-seccion" key={rol} type="button" aria-haspopup="dialog" onClick={() => { setRolAbierto(rol); setFiltros(filtrosIniciales); }}><span className="cuenta-seccion-cab"><b>{titulo}</b><span className="tag">{u.filter(x => x.rol === rol).length} cuentas</span></span><span className="cuenta-seccion-pie">{desc}<span aria-hidden="true">⌄</span></span></button>)}</div>
    </Card>
    <PanelEmergente abierto={Boolean(rolAbierto)} titulo={`${{alumno:'Alumnos',tutor:'Tutores',docente:'Docentes'}[rolAbierto] || 'Cuentas'} · ${u.filter(x => x.rol === rolAbierto).length}`} onCerrar={() => setRolAbierto('')}>
      <label htmlFor="cuentas-buscar">Buscar por nombre o CURP</label><input id="cuentas-buscar" value={filtros.q} onChange={e => setFiltros({ ...filtros, q: e.target.value })} placeholder="Escribe un nombre o CURP" />
      {rolAbierto === 'alumno' && <>
        <div className="fila2"><div><label htmlFor="cuentas-area">Área</label><select id="cuentas-area" value={filtros.area || 'todas'} onChange={e => setFiltros({ ...filtros, area: e.target.value })}><option value="todas">Todas las áreas</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select></div><div><label htmlFor="cuentas-semestre">Semestre</label><select id="cuentas-semestre" value={filtros.semestre || 'todos'} onChange={e => setFiltros({ ...filtros, semestre: e.target.value })}><option value="todos">Todos</option>{SEMESTRES.map(s => <option key={s}>{s}</option>)}</select></div></div>
        <label htmlFor="cuentas-grupo">Grupo</label><select id="cuentas-grupo" value={filtros.grupo} onChange={e => setFiltros({ ...filtros, grupo: e.target.value })}><option value="todos">Todos los grupos</option>{g.filter(k => (filtros.area === 'todas' || !filtros.area || k.area === filtros.area) && (filtros.semestre === 'todos' || !filtros.semestre || k.semestre === filtros.semestre)).map(k => <option key={k.id} value={`${k.semestre}|${k.area}|${k.grupo}`}>{nombreGrupo(k)}</option>)}</select>
      </>}
      <label htmlFor="cuentas-estado">Estado de cuenta</label><select id="cuentas-estado" value={filtros.estado} onChange={e => setFiltros({ ...filtros, estado: e.target.value })}><option value="todos">Todos</option><option value="primer-acceso">Primer acceso pendiente</option><option value="activa">Activa</option>{rolAbierto === 'alumno' && <option value="egresado">Egresado</option>}</select>
      <p className="sub">Se muestran hasta 100 resultados.</p>
      {l.map(x => (
      <Card key={x.rol + x.id}><b>{x.nombre}</b><span className="tag">{x.rol}</span><span className={'tag ' + (x.egresado ? 'ok' : x.debeCambiarPassword ? '' : 'ok')}>{x.egresado ? 'Egresado' : x.debeCambiarPassword ? 'Primer acceso pendiente' : 'Activa'}</span>
        <p className="sub" style={{ margin: '4px 0 8px' }}>{x.curp || x.id}{x.rol === 'alumno' ? ` · ${x.semestre} ${x.area} ${x.grupo}` : ''}{x.hijos && x.hijos.length ? ` · alumnos: ${x.hijos.join(', ')}` : ''}{x.tutores && x.tutores.length ? ` · tutores: ${x.tutores.join(', ')}` : ''}</p>
        {x.debeCambiarPassword && x.requiereCodigoActivacion && <button className="mini" style={{ marginLeft: 0 }} onClick={async () => { try { const r = await SD.api(`/api/admin/usuarios/${x.rol}/${x.id}/codigo-activacion`, { method: 'POST' }); alert(`Código de activación para ${r.curp}: ${r.codigo}`); } catch (er) { ban('err', 'No se pudo emitir el código', msgErr(er)); } }}>Emitir código de activación</button>}
        {x.rol === 'alumno' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('grupo', x)}>Cambiar grupo</button>}
        {x.rol === 'tutor' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('vincular', x)}>Vincular alumno</button>}
        <button className={'mini rojo'} style={x.rol === 'docente' ? { marginLeft: 0 } : {}} onClick={() => acc('borrar', x)}>Borrar</button></Card>))}
      {!l.length && <p className="vacio">Sin resultados.</p>}
    </PanelEmergente>
  </>);
}

export function Grupos() {
  const { g, u, c, cargar, error } = useServicios(), [b, ban] = useBanner();
  const [ver, setVer] = useState(''), [semConfig, setSemConfig] = useState({ periodo: 'impares', activos: SEMESTRES_IMPARES }), [nuevoGrupo, setNuevoGrupo] = useState({ semestre: SEMESTRES_PARES[0], area: AREAS[0], grupo: 'A' });
  useEffect(() => { SD.api('/api/semestres').then(setSemConfig).catch(() => {}); }, []);
  const cuenta = k => u.filter(x => x.rol === 'alumno' && !x.egresado && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length;
  const grupoAbierto = g.find(k => k.id === ver);
  const alumnosAbiertos = grupoAbierto ? u.filter(x => x.rol === 'alumno' && x.area === grupoAbierto.area && x.semestre === grupoAbierto.semestre && x.grupo === grupoAbierto.grupo).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  const borrar = async k => {
    if (!confirm(`¿Eliminar las ${cuenta(k)} cuentas de alumnos de ${nombreGrupo(k)}? El grupo, sus materias y horarios se conservarán.`)) return;
    try { const r = await post('/api/admin/grupos/eliminar-cuentas', { id: k.id }); ban('ok', 'Cuentas eliminadas', `${r.alumnos} cuentas de alumnos borradas. El grupo se conservó.`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  const crearGrupo = async e => {
    e.preventDefault();
    try { await post('/api/admin/grupos', nuevoGrupo); ban('ok', 'Grupo preparado', `${nuevoGrupo.semestre} · ${nuevoGrupo.area} · Grupo ${nuevoGrupo.grupo}. Ya puedes asignarle materias y horarios.`); cargar(); }
    catch (er) { ban('err', 'No se pudo crear el grupo', msgErr(er)); }
  };
  const avanzar = async k => {
    const destino = Number(k.semestre.match(/^([1-6])/ )?.[1] || 0) + 1;
    const graduar = destino === 7;
    const destinoNombre = `${destino} semestre ${k.area} ${k.grupo}`;
    const aviso = graduar
      ? `¿Confirmas el egreso de los ${cuenta(k)} alumnos de ${nombreGrupo(k)}? Sus registros e historial se conservarán.`
      : `¿Confirmas que cerró el tercer parcial y que la lista de ${nombreGrupo(k)} está revisada? Los ${cuenta(k)} alumnos pasarán a ${destinoNombre}. El grupo destino, sus materias y horarios deben estar preparados.`;
    if (!cuenta(k) || !confirm(aviso)) return;
    try { const r = await post('/api/admin/grupos/avanzar', { semestre: k.semestre, area: k.area, grupo: k.grupo }); ban('ok', graduar ? 'Alumnos egresados' : 'Avance confirmado', graduar ? `${r.egresados} registros quedaron como egresados.` : `${r.avanzados} alumnos pasaron a ${r.semestre}.`); cargar(); }
    catch (er) { ban('err', 'No se pudo confirmar el avance', msgErr(er)); }
  };
  return (<>
    <Hero titulo="Grupos" sub="Prepara grupos, materias y horarios antes de cargar cuentas; confirma el avance al cerrar el tercer parcial." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    <Card title="Preparar grupo"><form onSubmit={crearGrupo}><label>Semestre</label><select value={nuevoGrupo.semestre} onChange={e => setNuevoGrupo({ ...nuevoGrupo, semestre: e.target.value })}>{SEMESTRES.map(s => <option key={s} value={s}>{etiquetaSemestre(s)}</option>)}</select><label>Área</label><select value={nuevoGrupo.area} onChange={e => setNuevoGrupo({ ...nuevoGrupo, area: e.target.value })}>{AREAS.map(a => <option key={a}>{a}</option>)}</select><label>Grupo</label><select value={nuevoGrupo.grupo} onChange={e => setNuevoGrupo({ ...nuevoGrupo, grupo: e.target.value })}>{['A', 'B', 'C'].map(x => <option key={x}>{x}</option>)}</select><p className="sub">Puedes preparar los semestres del siguiente periodo aunque todavía no haya alumnos.</p><button className="btn" type="submit">PREPARAR GRUPO</button></form></Card>
    {g.map(k => { const alumnos = u.filter(x => x.rol === 'alumno' && !x.egresado && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo); const numero = Number(k.semestre.match(/^([1-6])/)?.[1] || 0), destino = `${numero + 1} semestre|${k.area}|${k.grupo}`, listoDestino = g.some(x => x.id === destino) && c.some(x => x.area === k.area && x.semestre === `${numero + 1} semestre` && x.grupo === k.grupo) && h.some(x => x.tipo === 'clase' && x.area === k.area && x.semestre === `${numero + 1} semestre` && x.grupo === k.grupo); return <Card key={k.id}><b>{nombreGrupo(k)}</b><p className="sub" style={{ margin: '4px 0 8px' }}>{alumnos.length} alumnos activos · {c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length} materias</p>
      <button className="mini" type="button" aria-haspopup="dialog" aria-expanded={ver === k.id} onClick={() => setVer(k.id)}>Ver cuentas</button>{semConfig.activos.includes(k.semestre) && alumnos.length > 0 && <><button className="mini" disabled={!listoDestino && numero < 6} title={!listoDestino && numero < 6 ? `Prepara materias y horarios de ${numero + 1} semestre primero` : ''} onClick={() => avanzar(k)}>{numero === 6 ? 'Egresar grupo' : 'Confirmar avance'}</button>{numero < 6 && !listoDestino && <small className="sub" style={{ display: 'block' }}>Prepara las materias y el horario del grupo destino para habilitar el avance.</small>}</>}<button className="mini rojo" onClick={() => borrar(k)}>Eliminar cuentas</button>
    </Card>; })}
    <PanelEmergente abierto={Boolean(grupoAbierto)} titulo={grupoAbierto ? `Cuentas · ${nombreGrupo(grupoAbierto)}` : 'Cuentas'} onCerrar={() => setVer('')}>
      <div className="grupo-cuentas" aria-live="polite">{alumnosAbiertos.length ? alumnosAbiertos.map(x => <div className="grupo-cuenta" key={x.id}><b>{x.nombre}</b><span>{x.curp || x.id}</span></div>) : <p className="vacio">Este grupo todavía no tiene cuentas.</p>}</div>
    </PanelEmergente>
    {!g.length && <Card><p className="vacio">Todavía no hay grupos. Prepáralos aquí, aunque aún no tengan alumnos.</p></Card>}
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
      {!g.length && <p className="vacio">Todavía no hay grupos. Crea una cuenta de alumno o un horario para crear el primero.</p>}
      <select value={f.gi} disabled={!g.length} onChange={e => setF({ ...f, gi: e.target.value })}>{g.map((k, i) => <option key={k.id} value={i}>{nombreGrupo(k)}</option>)}</select>
      <input value={f.materia} onChange={e => setF({ ...f, materia: e.target.value })} placeholder="Materia (ej. Matemáticas)" maxLength="60" required />
      <select value={f.docente} onChange={e => setF({ ...f, docente: e.target.value })}>{docs.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}{!docs.length && <option value="">Primero crea un docente</option>}</select>
      <button className="btn" type="submit">AÑADIR CLASE</button></form></Card>
    {c.slice().sort((a, b) => (a.semestre + a.area + a.grupo + a.materia).localeCompare(b.semestre + b.area + b.grupo + b.materia)).map(k => (
      <Card key={k.id}><b>{k.materia}</b><p className="sub" style={{ margin: '2px 0 8px' }}>{k.semestre} {k.area} {k.grupo} · Prof. {k.docenteNombre || k.docente}</p>
        <button className="mini" type="button" aria-haspopup="dialog" aria-expanded={qr?.id === k.id} style={{ marginLeft: 0 }} onClick={() => setQr(k)}>Ver QR</button><button className="mini rojo" onClick={() => borrar(k)}>Borrar</button></Card>))}
    <PanelEmergente abierto={Boolean(qr)} titulo="QR de la clase" onCerrar={() => setQr(null)}>
      {qr && <div className="qr-clase-panel"><QR texto={'CLASE:' + qr.id} /><p><b>{qr.materia}</b><br />{qr.semestre} {qr.area} {qr.grupo}</p><p className="sub">Imprímelo: el docente lo escanea y se abre esta clase.</p></div>}
    </PanelEmergente>
  </>);
}

export function Horarios() {
  const { c, h, cargar, error } = useServicios(false), [b, ban] = useBanner();
  const [docentes, setDocentes] = useState([]);
  const [f, setF] = useState({ docente: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A', materia: '', dia: 1, inicio: '07:00', fin: '07:50' });
  const [filtro, setFiltro] = useState({ semestre: '', area: '', grupo: '' });
  const [formAbierto, setFormAbierto] = useState(false), [errorFormulario, setErrorFormulario] = useState('');
  useEffect(() => { SD.api('/api/admin/docentes').then(setDocentes).catch(e => ban('err', 'No se pudieron cargar los docentes', msgErr(e))); }, []);
  const docs = [...docentes].sort((x, y) => x.nombre.localeCompare(y.nombre));
  const misMaterias = [...new Set(c.filter(x => x.docente === f.docente).map(x => x.materia))].sort();
  const filtroCompleto = Boolean(filtro.semestre && filtro.area && filtro.grupo);
  const del = filtroCompleto ? h.filter(x => x.area === filtro.area && x.semestre === filtro.semestre && x.grupo === filtro.grupo) : [];
  const tieneClases = del.some(x => x.tipo !== 'descanso');
  const bloques = tieneClases ? conDescanso(del) : [];
  const añadir = async e => {
    e.preventDefault();
    setErrorFormulario('');
    if (!f.docente) return setErrorFormulario('Elige al docente.');
    try {
      await post('/api/admin/horarios', { area: f.area, semestre: f.semestre, grupo: f.grupo, dia: +f.dia, inicio: f.inicio, fin: f.fin, tipo: 'clase', docente: f.docente, materia: f.materia });
      ban('ok', 'Bloque añadido', `${f.materia} · ${DIAS[f.dia]} ${hh(f.inicio)} a ${hh(f.fin)}`);
      setFiltro({ semestre: f.semestre, area: f.area, grupo: f.grupo });
      setFormAbierto(false);
      const sig = f.fin === '09:30' ? '10:00' : f.fin; setF({ ...f, inicio: sig, fin: sumar50(sig) }); cargar();
    } catch (er) { setErrorFormulario(msgErr(er)); }
  };
  const borrar = async x => { if (!confirm(`¿Quitar ${x.materia} del horario del ${DIAS[x.dia]}?`)) return; try { await post('/api/admin/horarios/borrar', { id: x.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Horarios" sub="Elige docente, grupo y materia. La materia se crea sola. El descanso de 9:30 a 10:00 ya está fijo." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    <button className="btn" type="button" aria-haspopup="dialog" onClick={() => { setErrorFormulario(''); setFormAbierto(true); }}>CREAR HORARIO</button>
    <PanelEmergente abierto={formAbierto} titulo="Crear horario" onCerrar={() => setFormAbierto(false)}>
      <form onSubmit={añadir}>
      <label>Docente</label><select value={f.docente} onChange={e => setF({ ...f, docente: e.target.value })} required><option value="">Selecciona un docente</option>{docs.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
      {!docs.length && <p className="sub">Primero crea la cuenta del docente en Cuentas.</p>}
      <label>Semestre</label><select value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })}>{SEMESTRES.map(s => <option key={s} value={s}>{etiquetaSemestre(s)}</option>)}</select>
      <label>Área</label><select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
      <label>Grupo</label><select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select>
      <p className="sub">Si este grupo todavía no existe, se creará al guardar el horario. Puedes añadir las cuentas de alumnos después; al registrarlas con este semestre, área y grupo quedarán dentro del grupo y su horario ya estará listo.</p>
      <label>Materia</label><input list="materias-docente" value={f.materia} onChange={e => setF({ ...f, materia: e.target.value })} placeholder="Nombre de la materia" maxLength="60" required />
      <datalist id="materias-docente">{misMaterias.map(m => <option key={m} value={m} />)}</datalist>
      <label>Día</label><select value={f.dia} onChange={e => setF({ ...f, dia: e.target.value })}>{[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DIAS[d]}</option>)}</select>
      <div className="fila2"><div><label>De las</label><input type="time" value={f.inicio} onChange={e => setF({ ...f, inicio: e.target.value, fin: sumar50(e.target.value) })} required /></div><div><label>A las</label><input type="time" value={f.fin} onChange={e => setF({ ...f, fin: e.target.value })} required /></div></div>
      {errorFormulario && <p className="msg" role="alert">{errorFormulario}</p>}
      <button className="btn" type="submit">AÑADIR AL HORARIO</button>
      </form>
    </PanelEmergente>
    <Card title="Ver horarios">
      <label htmlFor="horario-consulta-semestre">Semestre</label><select id="horario-consulta-semestre" value={filtro.semestre} onChange={e => setFiltro({ ...filtro, semestre: e.target.value })}><option value="">Elige semestre</option>{SEMESTRES.map(s => <option key={s} value={s}>{etiquetaSemestre(s)}</option>)}</select>
      <label htmlFor="horario-consulta-area">Área</label><select id="horario-consulta-area" value={filtro.area} onChange={e => setFiltro({ ...filtro, area: e.target.value })}><option value="">Elige área</option>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
      <label htmlFor="horario-consulta-grupo">Grupo</label><select id="horario-consulta-grupo" value={filtro.grupo} onChange={e => setFiltro({ ...filtro, grupo: e.target.value })}><option value="">Elige grupo</option>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select>
    </Card>
    {!filtroCompleto
      ? <Card><p className="vacio">Elige semestre, área y grupo para ver su horario.</p></Card>
      : tieneClases
        ? <>
          <Card title={`Horario de ${filtro.semestre} · ${filtro.area} · Grupo ${filtro.grupo}`} />
          {[1, 2, 3, 4, 5, 6].filter(d => bloques.some(x => x.dia === d)).map(d => (
            <Card key={d} title={DIAS[d]}><ul className="l">{bloques.filter(x => x.dia === d).sort((a, b) => a.inicio.localeCompare(b.inicio)).map(x => <li key={x.id}><span>{hh(x.inicio)} a {hh(x.fin)} - {x.materia}{x.docenteNombre ? ` · ${x.docenteNombre}` : ''}</span><span>{String(x.id).startsWith('desc') ? 'fijo' : <button className="mini rojo" onClick={() => borrar(x)}>Quitar</button>}</span></li>)}</ul></Card>))}
          </>
        : <Card><p className="vacio">Este grupo no existe o aún no tiene clases en su horario.</p></Card>}
  </>);
}

export function CalificacionesAdmin() {
  const { u, g, c } = useServicios(), [area, setArea] = useState(''), [semestre, setSemestre] = useState(''), [grupo, setGrupo] = useState(''), [parcial, setParcial] = useState('1');
  const [calificaciones, setCalificaciones] = useState([]), [error, setError] = useState('');
  useEffect(() => { SD.cached('admin_calificaciones', '/api/calificaciones').then(setCalificaciones).catch(e => setError(e.message || 'No se pudieron cargar las calificaciones.')); }, []);
  const grupos = g.filter(x => (!area || x.area === area) && (!semestre || x.semestre === semestre));
  const grupoActivo = grupos.find(x => x.id === grupo) || grupos[0] || null;
  const materias = grupoActivo ? c.filter(x => x.semestre === grupoActivo.semestre && x.area === grupoActivo.area && x.grupo === grupoActivo.grupo) : [];
  const alumnos = grupoActivo ? u.filter(x => x.rol === 'alumno' && x.semestre === grupoActivo.semestre && x.area === grupoActivo.area && x.grupo === grupoActivo.grupo).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  const notas = new Map(calificaciones.filter(n => n.parcial === Number(parcial)).map(n => [`${n.curp}|${(n.materia || '').toLowerCase()}`, n.nota]));
  return <>
    <Hero titulo="Calificaciones" sub="Consulta las calificaciones registradas por los docentes. Filtra por área, semestre y grupo." />
    {error && <p className="msg" role="alert">{error}</p>}
    <Card title="Filtros">
      <div className="fila2"><div><label htmlFor="cal-admin-area">Área</label><select id="cal-admin-area" value={area} onChange={e => { setArea(e.target.value); setGrupo(''); }}><option value="">Todas las áreas</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select></div><div><label htmlFor="cal-admin-semestre">Semestre</label><select id="cal-admin-semestre" value={semestre} onChange={e => { setSemestre(e.target.value); setGrupo(''); }}><option value="">Todos los semestres</option>{SEMESTRES.map(s => <option key={s}>{s}</option>)}</select></div></div>
      <label htmlFor="cal-admin-grupo">Grupo</label><select id="cal-admin-grupo" value={grupoActivo?.id || ''} onChange={e => setGrupo(e.target.value)}><option value="">Selecciona un grupo</option>{grupos.map(x => <option key={x.id} value={x.id}>{nombreGrupo(x)}</option>)}</select>
      <label htmlFor="cal-admin-parcial">Parcial</label><select id="cal-admin-parcial" value={parcial} onChange={e => setParcial(e.target.value)}><option value="1">Primer parcial</option><option value="2">Segundo parcial</option><option value="3">Tercer parcial</option></select>
    </Card>
    {grupoActivo && <Card title={`${nombreGrupo(grupoActivo)} · Parcial ${parcial}`}>
      {materias.length ? <div className="tabla"><table className="tb"><thead><tr><th>No.</th><th className="izq">Alumno</th>{materias.map(m => <th key={m.id}>{m.materia}</th>)}</tr></thead><tbody>
        {alumnos.map((a, i) => <tr key={a.curp}><td>{i + 1}</td><td className="izq">{a.nombre}</td>{materias.map(m => <td key={m.id}>{notas.has(`${a.curp}|${m.materia.toLowerCase()}`) ? notas.get(`${a.curp}|${m.materia.toLowerCase()}`) : '—'}</td>)}</tr>)}
        {!alumnos.length && <tr><td colSpan={materias.length + 2}>No hay alumnos registrados en este grupo.</td></tr>}
      </tbody></table></div> : <p className="vacio">Este grupo todavía no tiene materias.</p>}
    </Card>}
    {!grupoActivo && <Card><p className="vacio">No hay grupos para los filtros seleccionados.</p></Card>}
  </>;
}

export function ReportesAdmin() {
  const [datos, setDatos] = useState(null), [error, setError] = useState('');
  const [grupo, setGrupo] = useState(''), [claseId, setClaseId] = useState('');
  const [tipo, setTipo] = useState('asistencia'), [mes, setMes] = useState(hoyISO().slice(0, 7)), [parcial, setParcial] = useState('1');
  useEffect(() => {
    Promise.all([
      SD.cached('admin_alumnos', '/api/alumnos'), SD.cached('admin_clases_reportes', '/api/clases'), SD.cached('admin_asistencias', '/api/asistencias'), SD.cached('admin_calificaciones', '/api/calificaciones')
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
        titulo: 'CBTIS 170 · TIBURONES', subtitulo: `Asistencia · ${sub} · ${nombreMes}`,
        fechas: fechas.map(f => `${f.slice(8)}/${f.slice(5, 7)}`),
        filas: alumnos.map(a => [a.nombre, fechas.map(f => porFecha.get(`${a.curp}|${f}`) || '·')]), detalle
      }), `reporte-asistencia-${clase.semestre}${clase.area}${clase.grupo}-${mes}.xlsx`);
    } else {
      descargar(XL.calificaciones({
        titulo: 'CBTIS 170 · TIBURONES', subtitulo: `Calificaciones · ${sub} · Parcial ${parcial}`,
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
      {!clase && <Card><p className="vacio">{grupos.length ? 'Elige un grupo con materias para generar un reporte.' : 'No hay grupos con alumnos para generar reportes todavía.'}</p></Card>}
    </>}
  </>;
}

export function Historial() {
  const [lista, setLista] = useState(null), [filtro, setFiltro] = useState(''), [error, setError] = useState('');
  const cargar = useCallback(() => SD.cached('admin_historial', '/api/admin/historial').then(setLista).catch(e => setError(e.message || 'No se pudo cargar el historial.')), []);
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
  const [curp, setCurp] = useState(''), [r, setR] = useState(null), [b, ban] = useBanner(), [registrando, setRegistrando] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [colaPendiente, setColaPendiente] = useState(0);
  const reintentos = useRef(new Map()), colaQR = useRef([]), procesandoCola = useRef(false), recientes = useRef(new Map());
  const sesion = SD.session() || {}, tieneAccesoEscolar = sesion.rol === 'admin' && ['portero', 'control'].includes(sesion.adminArea);
  const enLinea = online && !sesion.offline;
  useEffect(() => {
    const revisar = () => { setOnline(navigator.onLine); if (navigator.onLine) procesarColaQR(); };
    addEventListener('online', revisar); addEventListener('offline', revisar);
    return () => { removeEventListener('online', revisar); removeEventListener('offline', revisar); };
  }, []);
  const ver = async t => {
    t = t.trim().toUpperCase(); setCurp(t);
    if (!/^[A-Z0-9]{18}$/.test(t)) { setR(null); return ban('err', 'QR no válido', 'No contiene una CURP.'); }
    if (tieneAccesoEscolar && !enLinea) { setR(null); return ban('err', 'Sin conexión', 'Para consultar y registrar accesos, vuelve a conectarte a internet.'); }
    try {
      const x = tieneAccesoEscolar
        ? { alumno: await SD.api('/api/alumno/' + encodeURIComponent(t)), accesos: await SD.api('/api/accesos?curp=' + encodeURIComponent(t)) }
        : await SD.consultar(t);
      x.alumno ? (setR(x), ban('ok', 'Alumno encontrado', x.alumno.nombre)) : (setR(null), ban('err', 'No encontrado'));
    } catch (e) { setR(null); ban('err', 'No se pudo consultar al alumno', msgErr(e)); }
  };
  const registrarAcceso = async tipo => {
    if (!tieneAccesoEscolar || !r?.alumno) return;
    if (!navigator.onLine || SD.session()?.offline) return ban('err', 'Sin conexión', 'No se registró el acceso. Vuelve a conectarte y reintenta.');
    const alumnoCurp = r.alumno.curp, clave = `${alumnoCurp}:${tipo}`;
    const uid = reintentos.current.get(clave) || crypto.randomUUID();
    reintentos.current.set(clave, uid);
    setRegistrando(tipo);
    try {
      const evento = await SD.api('/api/portero/escanear', { method: 'POST', body: { curp: alumnoCurp, tipo, uid } });
      reintentos.current.delete(clave);
      setR(actual => actual?.alumno?.curp === alumnoCurp ? { ...actual, accesos: [evento, ...(actual.accesos || []).filter(x => x.uid !== evento.uid)].slice(0, 20) } : actual);
      const grupo = [evento.semestre, evento.area, evento.grupo].filter(Boolean).join(' ');
      ban('ok', `${tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'} registrada · ${evento.hora}`, `${evento.alumno} · ${grupo}${evento.duplicada ? ' · ya estaba registrada' : ''}`);
    } catch (e) {
      if (e.status === 409) ban('warn', 'Espera para registrar el siguiente evento', msgErr(e));
      else ban('err', 'No se pudo registrar el acceso', msgErr(e));
    }
    finally { setRegistrando(''); }
  };
  const registrarQRAutomatico = async ({ curp: alumnoCurp, uid }) => {
    setCurp(alumnoCurp); setRegistrando(alumnoCurp);
    try {
      const evento = await SD.api('/api/portero/escanear', { method: 'POST', body: { curp: alumnoCurp, tipo: 'auto', uid } });
      reintentos.current.delete(`${alumnoCurp}:auto`);
      recientes.current.set(alumnoCurp, Date.now() + (evento.tipo === 'entrada' ? 30 : 10) * 60e3);
      setR({ automatico: true, alumno: { curp: alumnoCurp, nombre: evento.alumno, area: evento.area, semestre: evento.semestre, grupo: evento.grupo }, accesos: [evento] });
      const grupo = [evento.semestre, evento.area, evento.grupo].filter(Boolean).join(' ');
      ban(evento.duplicada ? 'warn' : 'ok', evento.duplicada ? 'Acceso ya registrado' : `${evento.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'} · ${evento.hora}`, `${evento.alumno} · ${grupo}${evento.duplicada ? ' · lectura repetida' : ' · acceso guardado'}`);
      return true;
    } catch (e) {
      if (e.status === 409) {
        const esperaCorta = /en proceso|espera un momento/i.test(e.message || '');
        const minutos = Number(e.message?.match(/en (\d+) min/i)?.[1] || 0);
        const espera = minutos ? minutos * 60e3 + 1000 : esperaCorta ? 2000 : 30 * 60e3;
        recientes.current.set(alumnoCurp, Date.now() + espera);
        ban('warn', 'Acceso no duplicado', msgErr(e));
      } else {
        recientes.current.delete(alumnoCurp);
        ban('err', 'No se pudo registrar el acceso', msgErr(e));
        if (!e.status) return 'red';
      }
      return false;
    } finally { setRegistrando(''); }
  };
  const procesarColaQR = async () => {
    if (procesandoCola.current || !navigator.onLine || SD.session()?.offline) return;
    procesandoCola.current = true;
    while (colaQR.current.length) {
      if (!navigator.onLine || SD.session()?.offline) break;
      const item = colaQR.current.shift();
      setColaPendiente(colaQR.current.length + 1);
      const resultado = await registrarQRAutomatico(item);
      if (resultado === 'red') { colaQR.current.unshift(item); break; }
    }
    procesandoCola.current = false;
    setColaPendiente(colaQR.current.length);
    if (colaQR.current.length && navigator.onLine && !SD.session()?.offline) setTimeout(procesarColaQR, 3000);
  };
  const encolarQR = valor => {
    const alumnoCurp = String(valor || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{18}$/.test(alumnoCurp)) return ban('err', 'QR no válido', 'El código no contiene una CURP de alumno.');
    if (!enLinea) return ban('err', 'Sin conexión', 'No se registró el acceso. Conéctate y vuelve a escanear el QR.');
    if ((recientes.current.get(alumnoCurp) || 0) > Date.now()) return;
    recientes.current.set(alumnoCurp, Date.now() + 30 * 60e3);
    const clave = `${alumnoCurp}:auto`, uid = reintentos.current.get(clave) || crypto.randomUUID();
    reintentos.current.set(clave, uid);
    colaQR.current.push({ curp: alumnoCurp, uid });
    setColaPendiente(colaQR.current.length + (procesandoCola.current ? 1 : 0));
    procesarColaQR();
  };
  return (<>
    <Hero titulo={tieneAccesoEscolar ? 'Entrada y salida escolar' : 'Escáner'} sub={tieneAccesoEscolar ? 'Escanea el QR: el sistema registra automáticamente entrada o salida.' : 'Escanea el QR de un alumno, o escribe su CURP, para ver su ficha.'} /><Banner b={b} />
    {tieneAccesoEscolar && !enLinea && <p className="msg" role="alert">Sin conexión: los accesos no se guardan sin validación del servidor.</p>}
    <Card><Camara disabled={tieneAccesoEscolar && !enLinea} onTexto={tieneAccesoEscolar ? encolarQR : ver} onError={m => ban('err', 'Cámara', m)} />
      <p className="sub" style={{ margin: '8px 0 0' }}>{tieneAccesoEscolar ? 'Mantén el lector abierto y muestra los QR uno tras otro; las lecturas se procesan en fila.' : 'Después de cada lectura, apunta al siguiente código.'}</p>
      {tieneAccesoEscolar && colaPendiente > 0 && <p className="sub" role="status">Guardando accesos… {colaPendiente} {colaPendiente === 1 ? 'lectura' : 'lecturas'} en proceso o en fila.</p>}
      <div className="fila2" style={{ marginTop: 12 }}><input value={curp} maxLength="18" placeholder="CURP" disabled={tieneAccesoEscolar && !!registrando} onChange={e => setCurp(e.target.value.toUpperCase())} style={{ marginTop: 0 }} /><button className="btn" style={{ flex: 'none', width: 80, margin: 0 }} disabled={tieneAccesoEscolar && (!enLinea || !!registrando)} onClick={() => ver(curp)}>OK</button></div></Card>
    {r && <><Card title="Ficha"><dl><dt>Nombre</dt><dd>{r.alumno.nombre}</dd><dt>CURP</dt><dd>{r.alumno.curp}</dd><dt>Grupo</dt><dd>{r.alumno.semestre} {r.alumno.area} {r.alumno.grupo}</dd></dl></Card>
      {tieneAccesoEscolar
        ? <>{r.automatico ? <Card title="Acceso registrado"><p className="sub">El servidor asignó la hora oficial y notificó a los tutores vinculados.</p></Card> : <Card title="Registrar acceso"><p className="sub">Al consultar una CURP manualmente, elige el evento. El servidor asigna la hora y notifica a los tutores.</p><div className="fila2"><button className="btn" type="button" disabled={!enLinea || !!registrando} onClick={() => registrarAcceso('entrada')}>{registrando === 'entrada' ? 'REGISTRANDO…' : 'REGISTRAR ENTRADA'}</button><button className="btn sec" type="button" disabled={!enLinea || !!registrando} onClick={() => registrarAcceso('salida')}>{registrando === 'salida' ? 'REGISTRANDO…' : 'REGISTRAR SALIDA'}</button></div></Card>}
          <Card title="Entradas y salidas recientes"><ul className="l">{(r.accesos || []).map(a => <li key={a.uid}><span>{a.fecha} · {a.hora}</span><span>{a.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span></li>)}{!r.accesos?.length && <li className="vacio">Sin registros de acceso.</li>}</ul></Card></>
        : <Card title="Historial"><ul className="l">{r.asistencias.slice(0, 20).map(a => <li key={a.uid}><span>{a.fecha} · {a.hora}</span><span>{a.estado === 'falta' ? 'falta · ' : ''}{a.materia}</span></li>)}{!r.asistencias.length && <li className="vacio">Sin registros</li>}</ul></Card>}
      </>}
  </>);
}

export function Citatorios() {
  const [alumnos, setAlumnos] = useState([]);
  const [lista, setLista] = useState([]), [error, setError] = useState(''), [b, ban] = useBanner();
  const [f, setF] = useState({ curp: '', fecha: hoyISO(), motivo: '' }), [formAbierto, setFormAbierto] = useState(false), [errorFormulario, setErrorFormulario] = useState('');
  const curp = f.curp.trim().toUpperCase();
  const alumno = alumnos.find(x => String(x.curp || x.id || '').trim().toUpperCase() === curp);
  const cargar = useCallback(() => SD.cached('admin_citatorios', '/api/admin/citatorios').then(setLista).catch(e => setError(e.message || 'No se pudieron cargar los citatorios.')), []);
  useEffect(() => {
    cargar();
    SD.cached('citatorios_alumnos', '/api/admin/citatorios/alumnos').then(setAlumnos).catch(e => setError(e.message || 'No se pudieron cargar los alumnos.'));
  }, [cargar]);
  const crear = async e => {
    e.preventDefault();
    setErrorFormulario('');
    try { await post('/api/admin/citatorios', { ...f, curp }); setF({ ...f, curp: '', motivo: '' }); setFormAbierto(false); ban('ok', 'Citatorio creado', 'Quedó registrado para el alumno.'); cargar(); }
    catch (e) { setErrorFormulario(msgErr(e)); }
  };
  const eliminar = async x => {
    if (!window.confirm(`¿Eliminar definitivamente el citatorio de ${x.alumno}? Esta acción no se puede deshacer.`)) return;
    try { await SD.api(`/api/admin/citatorios/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); ban('ok', 'Citatorio eliminado', 'Se eliminó del historial.'); cargar(); }
    catch (e) { ban('err', 'No se pudo eliminar el citatorio', msgErr(e)); }
  };
  return <>
    <Hero titulo="Citatorios" sub="Registra citatorios para alumnos y consulta los anteriores." /><Banner b={b} />
    {error && <p className="msg" role="alert">{error}</p>}
    <Card title="Nuevo citatorio">
      <button className="btn sec" type="button" aria-haspopup="dialog" onClick={() => { setErrorFormulario(''); setFormAbierto(true); }}>CREAR CITATORIO</button>
    </Card>
    <PanelEmergente abierto={formAbierto} titulo="Nuevo citatorio" onCerrar={() => setFormAbierto(false)}>
      <form onSubmit={crear}>
      <label htmlFor="citatorio-curp">CURP del alumno</label><input id="citatorio-curp" value={f.curp} maxLength="18" autoCapitalize="characters" placeholder="Escribe la CURP (18 caracteres)" onChange={e => setF({ ...f, curp: e.target.value.toUpperCase() })} required />
      {curp.length === 18 && <p className={'sub citatorio-validacion' + (alumno ? ' valido' : ' invalido')}>{alumno ? `Cuenta encontrada: ${alumno.nombre} · ${alumno.semestre || ''} ${alumno.area || ''} ${alumno.grupo || ''}` : 'No encontramos una cuenta de alumno con esa CURP.'}</p>}
      <label htmlFor="citatorio-fecha">Fecha de cita</label><input id="citatorio-fecha" type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} required />
      <label htmlFor="citatorio-motivo">Motivo</label><textarea id="citatorio-motivo" rows="4" maxLength="1000" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} required />
      {errorFormulario && <p className="msg" role="alert">{errorFormulario}</p>}
      <button className="btn" disabled={!alumno}>REGISTRAR CITATORIO</button>
      </form>
    </PanelEmergente>
    {lista.map(x => <Card key={x.id} title={`${x.alumno} · ${x.fecha}`}><p>{x.motivo}</p><p className="sub">{x.semestre} {x.area} {x.grupo} · Registrado por {x.creadoPor}</p>{x.estado === 'anulado' && <p><span className="tag">Anulado</span></p>}<button className="btn sec" type="button" onClick={() => eliminar(x)}>ELIMINAR CITATORIO</button></Card>)}
    {!lista.length && <Card><p className="vacio">Aún no hay citatorios registrados.</p></Card>}
  </>;
}

export function CitatoriosAlumno() {
  const [lista, setLista] = useState(null), [error, setError] = useState('');
  useEffect(() => { SD.cached('mis_citatorios', '/api/citatorios').then(setLista).catch(e => setError(e.message || 'No se pudieron cargar tus citatorios.')); }, []);
  return <><Hero titulo="Mis citatorios" sub="Consulta los citatorios registrados para ti." />{error && <p className="msg" role="alert">{error}</p>}
    {lista && lista.filter(x => x.estado !== 'anulado').map(x => <Card key={x.id} title={`Citatorio · ${x.fecha}`}><p>{x.motivo}</p><p className="sub">Registrado por {x.creadoPor}</p><p><span className="tag ok">Vigente</span></p></Card>)}
    {lista && !lista.some(x => x.estado !== 'anulado') && <Card><p className="vacio">No tienes citatorios registrados.</p></Card>}</>;
}

