import { useState, useEffect, useCallback } from 'react';
import SD from './sd.js';
import * as XL from './excel.js';
import { descargarPlantillaCuentas, leerCuentasExcel } from './importar-cuentas.js';
import { Card, Hero, Banner, useBanner, QR, DIAS, SEMESTRES, AREAS, hh, hoyISO, post, msgErr, nombreGrupo, conDescanso, descargar } from './ui.jsx';
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
  return <InicioBienvenida rol="admin" onTutorial={onTutorial} />;
}

const sumar50 = h => { const [a, b] = (h || '').split(':').map(Number); if (Number.isNaN(a) || Number.isNaN(b)) return ''; const m = a * 60 + b + 50; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export function Cuentas() {
  const { u, g, cargar, error } = useServicios(), [b, ban] = useBanner(), [q, setQ] = useState(''), [temp, setTemp] = useState(''), [solicitudes, setSolicitudes] = useState([]), [errorSolicitudes, setErrorSolicitudes] = useState('');
  const [importadas, setImportadas] = useState([]), [leyendoExcel, setLeyendoExcel] = useState(false), [creandoImportadas, setCreandoImportadas] = useState(false);
  const [crearAbierto, setCrearAbierto] = useState(false), [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtroRol, setFiltroRol] = useState('todos'), [filtroGrupo, setFiltroGrupo] = useState('todos'), [filtroEstado, setFiltroEstado] = useState('todos');
  const [f, setF] = useState({ rol: 'alumno', nombre: '', id: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A' });
  const cargarSolicitudes = async () => { try { setSolicitudes(await SD.cached('admin_recuperaciones', '/api/admin/recuperaciones')); setErrorSolicitudes(''); } catch (e) { setErrorSolicitudes(e.message || 'No se pudieron cargar las solicitudes.'); } };
  const borrarSolicitudes = async () => {
    if (!solicitudes.length || !confirm('¿Quieres borrar todas las solicitudes de restablecimiento pendientes? Esta acción no se puede deshacer.')) return;
    try { const r = await SD.api('/api/admin/recuperaciones', { method: 'DELETE' }); setSolicitudes([]); ban('ok', 'Solicitudes borradas', `Se borraron ${r.eliminadas} solicitudes pendientes.`); }
    catch (er) { ban('err', 'No se pudieron borrar las solicitudes', msgErr(er)); }
  };
  useEffect(() => { cargarSolicitudes(); }, []);
  const crear = async e => {
    e.preventDefault();
    try { await post('/api/admin/usuarios', f); ban('ok', 'Cuenta creada', 'La persona puede entrar con su CURP y crear su contraseña.'); setF({ ...f, nombre: '', id: '' }); cargar(); }
    catch (er) { ban('err', 'No se pudo crear la cuenta', msgErr(er)); }
  };
  const leerExcel = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setLeyendoExcel(true); setImportadas([]);
    try {
      const existentes = new Set(u.map(x => x.id || x.curp));
      const filas = await leerCuentasExcel(file);
      setImportadas(filas.map(c => existentes.has(c.id) ? { ...c, errores: [...c.errores, 'Ya existe una cuenta con esta CURP'] } : c));
      ban('ok', 'Excel leído', `Se encontraron ${filas.length} cuentas para revisar.`);
    } catch (er) { ban('err', 'No se pudo leer el Excel', er.message); }
    finally { setLeyendoExcel(false); }
  };
  const crearDesdeExcel = async () => {
    const errores = importadas.filter(x => x.errores.length);
    if (errores.length) return ban('err', 'Corrige el archivo', `Hay ${errores.length} filas con errores. No se creó ninguna cuenta.`);
    if (!importadas.length || !confirm(`¿Crear las ${importadas.length} cuentas del Excel?`)) return;
    setCreandoImportadas(true);
    try {
      const cuentas = importadas.map(({ rol, nombre, id, semestre, area, grupo }) => ({ rol, nombre, id, semestre, area, grupo }));
      const r = await post('/api/admin/usuarios/importar', { cuentas });
      ban('ok', 'Cuentas creadas', `Se crearon ${r.creadas} cuentas correctamente.`); setImportadas([]); cargar();
    } catch (er) { ban('err', 'No se crearon las cuentas', msgErr(er)); }
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
    return (!q || (x.nombre + ' ' + (x.curp || x.id)).toLowerCase().includes(q.toLowerCase()))
      && (filtroRol === 'todos' || x.rol === filtroRol)
      && (filtroGrupo === 'todos' || grupo === filtroGrupo)
      && (filtroEstado === 'todos' || (filtroEstado === 'primer-acceso' ? x.debeCambiarPassword : !x.debeCambiarPassword));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 100);
  return (<>
    <Hero titulo="Cuentas" sub="Administra altas, accesos, grupos y solicitudes de recuperación." /><Banner b={b} />
    {error && <p className="msg" role="alert">{error}</p>}
    <Card title="Importar cuentas desde Excel">
      <p className="sub">Sube un archivo .xlsx o .xls con encabezados <b>rol, nombre y CURP</b>; también se infiere el rol si el encabezado de nombres dice <b>Alumnos, Docentes o Tutores</b>. Para alumnos agrega <b>semestre, área y grupo</b>. Se revisan todas las filas antes de crear.</p>
      <button className="mini" type="button" onClick={descargarPlantillaCuentas}>Descargar plantilla Excel</button>
      <label htmlFor="cuentas-excel">Archivo Excel</label><input id="cuentas-excel" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={leerExcel} disabled={leyendoExcel || creandoImportadas} />
      {leyendoExcel && <p className="sub" role="status">Leyendo el archivo…</p>}
      {!!importadas.length && <>
        <p className="sub">{importadas.length} cuentas detectadas · {importadas.filter(x => !x.errores.length).length} listas · {importadas.filter(x => x.errores.length).length} con errores</p>
        <div className="import-cuentas-list">{importadas.map((x, i) => <div className="import-cuenta" key={`${x.fila}-${i}`}>
          <div><b>Fila {x.fila} · {x.nombre || 'Sin nombre'}</b><span className="tag">{x.rol}</span><p className="sub">{x.id || 'Sin CURP'}{x.rol === 'alumno' ? ` · ${x.semestre} · ${x.area} · Grupo ${x.grupo}` : ''}</p></div>
          {x.errores.length > 0 && <p className="msg" role="alert">{x.errores.join(' · ')}</p>}
        </div>)}</div>
        <button className="btn" type="button" onClick={crearDesdeExcel} disabled={creandoImportadas || importadas.some(x => x.errores.length)}>{creandoImportadas ? 'CREANDO CUENTAS…' : `CREAR CUENTAS (${importadas.length})`}</button>
      </>}
    </Card>
    <button className="btn desplegable-toggle" type="button" aria-expanded={crearAbierto} aria-controls="cuentas-crear" onClick={() => setCrearAbierto(v => !v)}><span>{crearAbierto ? 'CERRAR CREAR CUENTA' : 'CREAR CUENTA'}</span><span className={'desplegable-flecha' + (crearAbierto ? ' abierta' : '')} aria-hidden="true">⌄</span></button>
    <div id="cuentas-crear" className={'desplegable-contenido' + (crearAbierto ? ' abierto' : '')} aria-hidden={!crearAbierto} inert={!crearAbierto}><Card title="Datos para crear cuenta"><form onSubmit={crear}>
      <select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })}><option value="alumno">Alumno</option><option value="docente">Docente</option><option value="tutor">Tutor</option></select>
      <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre completo" required />
      <input value={f.id} onChange={e => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="CURP (18 caracteres)" maxLength="18" required />
      {f.rol === 'alumno' && <>
        <label>Semestre</label><select value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })}>{SEMESTRES.map(s => <option key={s}>{s}</option>)}</select>
        <label>Área</label><select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
        <label>Grupo</label><select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select></>}
      <button className="btn" type="submit">CREAR CUENTA</button></form></Card></div>
    <Card className="solicitudes-card" title={`Solicitudes de restablecimiento · ${solicitudes.length}`}>
      <button className="mini rojo solicitudes-borrar" type="button" onClick={borrarSolicitudes} disabled={!solicitudes.length}>Borrar solicitudes</button>
      <p className="sub">Revisa la identidad del usuario antes de autorizar. Al aceptar, se elimina la contraseña y la persona tendrá que crear una nueva al entrar con su CURP.</p>
      <button className="mini" onClick={cargarSolicitudes}>Actualizar solicitudes</button>
      {solicitudes.map(x => <div key={x.id} style={{ borderTop: '1px solid var(--linea)', paddingTop: 10, marginTop: 10 }}><b>{x.nombre || 'Cuenta'}</b><span className="tag">Pendiente</span><p className="sub">{x.rol} · {x.curp} · {new Date(x.creado).toLocaleString()}</p><button className="mini" onClick={async () => { if (!confirm('Confirma que verificaste la identidad del usuario.')) return; try { await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'restablecer' }); setSolicitudes(v => v.filter(s => s.id !== x.id)); ban('ok', 'Ya se eliminó la contraseña', 'La solicitud se eliminó. La persona puede entrar con su CURP y crear una contraseña nueva.'); } catch (er) { ban('err', 'No se pudo restablecer', msgErr(er)); } }}>Verificar y restablecer</button><button className="mini rojo" onClick={async () => { try { if (!confirm('¿Rechazar esta solicitud?')) return; await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'rechazar' }); setSolicitudes(v => v.filter(s => s.id !== x.id)); } catch (er) { ban('err', 'No se pudo rechazar', msgErr(er)); } }}>Rechazar</button></div>)}
      {errorSolicitudes && <p className="msg" role="alert">{errorSolicitudes}</p>}
      {!solicitudes.length && !errorSolicitudes && <p className="vacio">No hay solicitudes pendientes.</p>}
    </Card>
    <button className="btn rojo desplegable-toggle" type="button" aria-expanded={filtrosAbiertos} aria-controls="cuentas-filtros" onClick={() => setFiltrosAbiertos(v => !v)}><span>{filtrosAbiertos ? 'CERRAR FILTROS' : 'BUSCAR Y FILTRAR CUENTAS'}</span><span className={'desplegable-flecha' + (filtrosAbiertos ? ' abierta' : '')} aria-hidden="true">⌄</span></button>
    <div id="cuentas-filtros" className={'desplegable-contenido' + (filtrosAbiertos ? ' abierto' : '')} aria-hidden={!filtrosAbiertos} inert={!filtrosAbiertos}><div className="desplegable-inner"><Card title="Buscar y filtrar cuentas">
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
    {!l.length && <Card><p className="vacio">Sin resultados.</p></Card>}</div></div>
  </>);
}

export function Grupos() {
  const { g, u, c, cargar, error } = useServicios(), [b, ban] = useBanner();
  const [ver, setVer] = useState('');
  const cuenta = k => u.filter(x => x.rol === 'alumno' && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length;
  const borrar = async k => {
    if (!confirm(`¿Eliminar las ${cuenta(k)} cuentas de alumnos de ${nombreGrupo(k)}? El grupo, sus materias y horarios se conservarán.`)) return;
    try { const r = await post('/api/admin/grupos/eliminar-cuentas', { id: k.id }); ban('ok', 'Cuentas eliminadas', `${r.alumnos} cuentas de alumnos borradas. El grupo se conservó.`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  return (<>
    <Hero titulo="Grupos" sub="Consulta las cuentas y administra alumnos sin eliminar la estructura del grupo." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    {g.map(k => { const alumnos = u.filter(x => x.rol === 'alumno' && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo); return <Card key={k.id}><b>{nombreGrupo(k)}</b><p className="sub" style={{ margin: '4px 0 8px' }}>{alumnos.length} alumnos · {c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length} materias</p>
      <button className="mini desplegable-toggle" style={{ marginLeft: 0 }} aria-expanded={ver === k.id} aria-controls={'grupo-cuentas-' + k.id} onClick={() => setVer(ver === k.id ? '' : k.id)}><span>{ver === k.id ? 'Ocultar cuentas' : 'Ver cuentas'}</span><span className={'desplegable-flecha' + (ver === k.id ? ' abierta' : '')} aria-hidden="true">⌄</span></button><button className="mini rojo" onClick={() => borrar(k)}>Eliminar cuentas</button>
      <div id={'grupo-cuentas-' + k.id} className={'desplegable-contenido' + (ver === k.id ? ' abierto' : '')} aria-hidden={ver !== k.id} inert={ver !== k.id}><div className="grupo-cuentas" aria-live="polite">{alumnos.length ? alumnos.sort((a,b) => a.nombre.localeCompare(b.nombre)).map(x => <div className="grupo-cuenta" key={x.id}><b>{x.nombre}</b><span>{x.curp || x.id}</span></div>) : <p className="vacio">Este grupo todavía no tiene cuentas.</p>}</div></div>
    </Card>; })}
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
    <div id="clases-qr" className={'desplegable-contenido' + (qr ? ' abierto' : '')} aria-hidden={!qr} inert={!qr}><Card title="QR de la clase" style={{ textAlign: 'center' }}>{qr && <><QR texto={'CLASE:' + qr.id} /><p><b>{qr.materia}</b><br />{qr.semestre} {qr.area} {qr.grupo}</p><p className="sub">Imprímelo: el docente lo escanea y se abre esta clase.</p></>}</Card></div>
    {c.slice().sort((a, b) => (a.semestre + a.area + a.grupo + a.materia).localeCompare(b.semestre + b.area + b.grupo + b.materia)).map(k => (
      <Card key={k.id}><b>{k.materia}</b><p className="sub" style={{ margin: '2px 0 8px' }}>{k.semestre} {k.area} {k.grupo} · Prof. {k.docenteNombre || k.docente}</p>
        <button className="mini desplegable-toggle" style={{ marginLeft: 0 }} aria-expanded={qr?.id === k.id} aria-controls="clases-qr" onClick={() => { setQr(qr?.id === k.id ? null : k); scrollTo(0, 0); }}><span>{qr?.id === k.id ? 'Ocultar QR' : 'Ver QR'}</span><span className={'desplegable-flecha' + (qr?.id === k.id ? ' abierta' : '')} aria-hidden="true">⌄</span></button><button className="mini rojo" onClick={() => borrar(k)}>Borrar</button></Card>))}
  </>);
}

export function Horarios() {
  const { c, h, cargar, error } = useServicios(false), [b, ban] = useBanner();
  const [docentes, setDocentes] = useState([]);
  const [f, setF] = useState({ docente: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A', materia: '', dia: 1, inicio: '07:00', fin: '07:50' });
  useEffect(() => { SD.api('/api/admin/docentes').then(setDocentes).catch(e => ban('err', 'No se pudieron cargar los docentes', msgErr(e))); }, []);
  const docs = [...docentes].sort((x, y) => x.nombre.localeCompare(y.nombre));
  const misMaterias = [...new Set(c.filter(x => x.docente === f.docente).map(x => x.materia))].sort();
  const del = h.filter(x => x.area === f.area && x.semestre === f.semestre && x.grupo === f.grupo);
  const bloques = conDescanso(del);
  const añadir = async e => {
    e.preventDefault();
    if (!f.docente) return ban('err', 'Elige al docente');
    try {
      await post('/api/admin/horarios', { area: f.area, semestre: f.semestre, grupo: f.grupo, dia: +f.dia, inicio: f.inicio, fin: f.fin, tipo: 'clase', docente: f.docente, materia: f.materia });
      ban('ok', 'Bloque añadido', `${f.materia} · ${DIAS[f.dia]} ${hh(f.inicio)} a ${hh(f.fin)}`);
      const sig = f.fin === '09:30' ? '10:00' : f.fin; setF({ ...f, inicio: sig, fin: sumar50(sig) }); cargar();
    } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  const borrar = async x => { if (!confirm(`¿Quitar ${x.materia} del horario del ${DIAS[x.dia]}?`)) return; try { await post('/api/admin/horarios/borrar', { id: x.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Horarios" sub="Elige docente, grupo y materia. La materia se crea sola. El descanso de 9:30 a 10:00 ya está fijo." /><Banner b={b} />{error && <p className="msg" role="alert">{error}</p>}
    <Card title="Añadir clase al horario"><form onSubmit={añadir}>
      <label>Docente</label><select value={f.docente} onChange={e => setF({ ...f, docente: e.target.value })} required><option value="">Selecciona un docente</option>{docs.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
      {!docs.length && <p className="sub">Primero crea la cuenta del docente en Cuentas.</p>}
      <label>Semestre</label><select value={f.semestre} onChange={e => setF({ ...f, semestre: e.target.value })}>{SEMESTRES.map(s => <option key={s}>{s}</option>)}</select>
      <label>Área</label><select value={f.area} onChange={e => setF({ ...f, area: e.target.value })}>{AREAS.map(s => <option key={s}>{s}</option>)}</select>
      <label>Grupo</label><select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}>{['A', 'B', 'C'].map(s => <option key={s}>{s}</option>)}</select>
      <label>Materia</label><input list="materias-docente" value={f.materia} onChange={e => setF({ ...f, materia: e.target.value })} placeholder="Nombre de la materia" maxLength="60" required />
      <datalist id="materias-docente">{misMaterias.map(m => <option key={m} value={m} />)}</datalist>
      <label>Día</label><select value={f.dia} onChange={e => setF({ ...f, dia: e.target.value })}>{[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DIAS[d]}</option>)}</select>
      <div className="fila2"><div><label>De las</label><input type="time" value={f.inicio} onChange={e => setF({ ...f, inicio: e.target.value, fin: sumar50(e.target.value) })} required /></div><div><label>A las</label><input type="time" value={f.fin} onChange={e => setF({ ...f, fin: e.target.value })} required /></div></div>
      <button className="btn" type="submit">AÑADIR AL HORARIO</button>
    </form></Card>
    <Card title={`Horario de ${f.semestre} · ${f.area} · Grupo ${f.grupo}`}><p className="sub" style={{ margin: 0 }}>Cambia semestre, área o grupo arriba para ver otro horario.</p></Card>
    {[1, 2, 3, 4, 5, 6].filter(d => bloques.some(x => x.dia === d)).map(d => (
      <Card key={d} title={DIAS[d]}><ul className="l">{bloques.filter(x => x.dia === d).sort((a, b) => a.inicio.localeCompare(b.inicio)).map(x => <li key={x.id}><span>{hh(x.inicio)} a {hh(x.fin)} - {x.materia}{x.docenteNombre ? ` · ${x.docenteNombre}` : ''}</span><span>{String(x.id).startsWith('desc') ? 'fijo' : <button className="mini rojo" onClick={() => borrar(x)}>Quitar</button>}</span></li>)}</ul></Card>))}
    {!del.length && <Card><p className="vacio">Este grupo aún no tiene clases en su horario.</p></Card>}
  </>);
}

export function CalificacionesAdmin() {
  const { u, g, c, cargar } = useServicios(), [grupoId, setGrupoId] = useState(''), [claseId, setClaseId] = useState(''), [parcial, setParcial] = useState('1'), [notas, setNotas] = useState({}), [b, ban] = useBanner(), [guardando, setGuardando] = useState(false);
  const grupo = g.find(x => x.id === grupoId) || g[0] || null;
  const clases = grupo ? c.filter(x => x.semestre === grupo.semestre && x.area === grupo.area && x.grupo === grupo.grupo) : [];
  const clase = clases.find(x => x.id === claseId) || clases[0] || null;
  const alumnos = grupo ? u.filter(x => x.rol === 'alumno' && x.semestre === grupo.semestre && x.area === grupo.area && x.grupo === grupo.grupo).sort((a, b) => a.nombre.localeCompare(b.nombre)) : [];
  const guardar = async () => {
    if (!grupo || !clase) return ban('err', 'Elige una materia');
    setGuardando(true);
    try {
      const r = await post('/api/calificaciones', { materia: clase.materia, parcial: Number(parcial), area: grupo.area, semestre: grupo.semestre, grupo: grupo.grupo, notas: alumnos.filter(a => notas[a.curp] !== undefined && notas[a.curp] !== '').map(a => ({ curp: a.curp, nota: Number(notas[a.curp]) })) });
      ban('ok', 'Calificaciones guardadas', `Se guardaron ${r.guardadas} calificaciones. Se avisó a cada alumno.`);
      SD.cached('admin_calificaciones', '/api/calificaciones');
    } catch (e) { ban('err', 'No se pudieron guardar', msgErr(e)); }
    finally { setGuardando(false); }
  };
  return <>
    <Hero titulo="Subir calificaciones" sub="Elige semestre, área, grupo, materia y parcial. Cada alumno recibirá un aviso al guardar su calificación." /><Banner b={b} />
    <Card title="Grupo y periodo">
      <label>Semestre, área y grupo</label><select value={grupo ? grupo.id : ''} onChange={e => { setGrupoId(e.target.value); setClaseId(''); setNotas({}); }}>{g.map(x => <option key={x.id} value={x.id}>{nombreGrupo(x)}</option>)}</select>
      <label>Materia</label><select value={clase ? clase.id : ''} onChange={e => setClaseId(e.target.value)}>{clases.map(x => <option key={x.id} value={x.id}>{x.materia}</option>)}</select>
      <label>Parcial</label><select value={parcial} onChange={e => setParcial(e.target.value)}><option value="1">Primer parcial</option><option value="2">Segundo parcial</option><option value="3">Tercer parcial</option></select>
    </Card>
    <Card title="Alumnos y calificaciones"><div className="tabla"><table className="tb"><thead><tr><th>No.</th><th className="izq">Alumno</th><th>Calificación (0–10)</th></tr></thead><tbody>
      {alumnos.map((a, i) => <tr key={a.id}><td>{i + 1}</td><td className="izq">{a.nombre}</td><td><input aria-label={`Calificación de ${a.nombre}`} type="number" min="0" max="10" step="0.1" value={notas[a.id] ?? ''} onChange={e => setNotas(v => ({ ...v, [a.id]: e.target.value }))} /></td></tr>)}
      {!alumnos.length && <tr><td colSpan={3}>No hay alumnos registrados en este grupo.</td></tr>}
    </tbody></table></div><button className="btn" disabled={guardando || !clase || !alumnos.length} onClick={guardar}>{guardando ? 'GUARDANDO…' : 'GUARDAR Y AVISAR A LOS ALUMNOS'}</button></Card>
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
      {!clase && <Card><p className="vacio">Elige un grupo con materias para generar un reporte.</p></Card>}
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
  const [curp, setCurp] = useState(''), [r, setR] = useState(null), [b, ban] = useBanner();
  const ver = async t => { t = t.trim().toUpperCase(); setCurp(t); if (!/^[A-Z0-9]{18}$/.test(t)) return ban('err', 'QR no válido', 'No contiene una CURP.'); const x = await SD.consultar(t); x.alumno ? (setR(x), ban('ok', 'Alumno encontrado', x.alumno.nombre)) : (setR(null), ban('err', 'No encontrado')); };
  return (<>
    <Hero titulo="Escáner" sub="Escanea el QR de un alumno, o escribe su CURP, para ver su ficha." /><Banner b={b} />
    <Card><Camara onTexto={ver} onError={m => ban('err', 'Cámara', m)} />
      <p className="sub" style={{ margin: '8px 0 0' }}>Después de cada lectura, apunta al siguiente código.</p>
      <div className="fila2" style={{ marginTop: 12 }}><input value={curp} maxLength="18" placeholder="CURP" onChange={e => setCurp(e.target.value.toUpperCase())} style={{ marginTop: 0 }} /><button className="btn" style={{ flex: 'none', width: 80, margin: 0 }} onClick={() => ver(curp)}>OK</button></div></Card>
    {r && <><Card title="Ficha"><dl><dt>Nombre</dt><dd>{r.alumno.nombre}</dd><dt>CURP</dt><dd>{r.alumno.curp}</dd><dt>Grupo</dt><dd>{r.alumno.semestre} {r.alumno.area} {r.alumno.grupo}</dd></dl></Card>
      <Card title="Historial"><ul className="l">{r.asistencias.slice(0, 20).map(a => <li key={a.uid}><span>{a.fecha} · {a.hora}</span><span>{a.estado === 'falta' ? 'falta · ' : ''}{a.materia}</span></li>)}{!r.asistencias.length && <li className="vacio">Sin registros</li>}</ul></Card></>}
  </>);
}

export function Citatorios() {
  const [alumnos, setAlumnos] = useState([]);
  const [lista, setLista] = useState([]), [error, setError] = useState(''), [b, ban] = useBanner();
  const [f, setF] = useState({ curp: '', fecha: hoyISO(), motivo: '' }), [formAbierto, setFormAbierto] = useState(false);
  const curp = f.curp.trim().toUpperCase();
  const alumno = alumnos.find(x => String(x.curp || x.id || '').trim().toUpperCase() === curp);
  const cargar = useCallback(() => SD.cached('admin_citatorios', '/api/admin/citatorios').then(setLista).catch(e => setError(e.message || 'No se pudieron cargar los citatorios.')), []);
  useEffect(() => {
    cargar();
    SD.cached('citatorios_alumnos', '/api/admin/citatorios/alumnos').then(setAlumnos).catch(e => setError(e.message || 'No se pudieron cargar los alumnos.'));
  }, [cargar]);
  const crear = async e => {
    e.preventDefault();
    try { await post('/api/admin/citatorios', { ...f, curp }); setF({ ...f, curp: '', motivo: '' }); setFormAbierto(false); ban('ok', 'Citatorio creado', 'Quedó registrado para el alumno.'); cargar(); }
    catch (e) { ban('err', 'No se pudo crear', msgErr(e)); }
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
      <button className="btn sec desplegable-toggle" type="button" aria-expanded={formAbierto} aria-controls="citatorio-form" onClick={() => setFormAbierto(v => !v)}><span>{formAbierto ? 'CERRAR FORMULARIO' : 'CREAR CITATORIO'}</span><span className={'desplegable-flecha' + (formAbierto ? ' abierta' : '')} aria-hidden="true">⌄</span></button>
      <div id="citatorio-form" className={'desplegable-contenido' + (formAbierto ? ' abierto' : '')} aria-hidden={!formAbierto} inert={!formAbierto}><form onSubmit={crear}>
      <label htmlFor="citatorio-curp">CURP del alumno</label><input id="citatorio-curp" value={f.curp} maxLength="18" autoCapitalize="characters" placeholder="Escribe la CURP (18 caracteres)" onChange={e => setF({ ...f, curp: e.target.value.toUpperCase() })} required />
      {curp.length === 18 && <p className={'sub citatorio-validacion' + (alumno ? ' valido' : ' invalido')}>{alumno ? `Cuenta encontrada: ${alumno.nombre} · ${alumno.semestre || ''} ${alumno.area || ''} ${alumno.grupo || ''}` : 'No encontramos una cuenta de alumno con esa CURP.'}</p>}
      <label htmlFor="citatorio-fecha">Fecha de cita</label><input id="citatorio-fecha" type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} required />
      <label htmlFor="citatorio-motivo">Motivo</label><textarea id="citatorio-motivo" rows="4" maxLength="1000" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} required />
      <button className="btn" disabled={!alumno}>REGISTRAR CITATORIO</button></form></div></Card>
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

