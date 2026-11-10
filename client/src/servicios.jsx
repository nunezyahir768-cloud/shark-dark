import { useState, useEffect, useCallback } from 'react';
import SD from './sd.js';
import { Card, Hero, Banner, useBanner, QR, DIAS, SEMESTRES, AREAS, hh, post, msgErr, nombreGrupo, conDescanso } from './ui.jsx';
import { Camara } from './docente.jsx';

function useServicios() {
  const [u, setU] = useState([]), [g, setG] = useState([]), [c, setC] = useState([]), [h, setH] = useState([]);
  const cargar = useCallback(async () => {
    try { const [a, b, d, e] = await Promise.all([SD.api('/api/admin/usuarios'), SD.api('/api/grupos'), SD.api('/api/clases'), SD.api('/api/horarios')]); setU(a); setG(b.sort((x, y) => nombreGrupo(x).localeCompare(nombreGrupo(y)))); setC(d); setH(e); } catch (e) {}
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  return { u, g, c, h, cargar };
}

export function Cuentas() {
  const { u, g, cargar } = useServicios(), [b, ban] = useBanner(), [q, setQ] = useState(''), [temp, setTemp] = useState(''), [solicitudes, setSolicitudes] = useState([]);
  const [f, setF] = useState({ rol: 'alumno', nombre: '', id: '', semestre: SEMESTRES[0], area: AREAS[0], grupo: 'A' });
  const cargarSolicitudes = async () => { try { setSolicitudes(await SD.api('/api/admin/recuperaciones')); } catch (e) {} };
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
  const l = u.filter(x => !q || (x.nombre + ' ' + (x.curp || x.id)).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 80);
  return (<>
    <Hero titulo="Cuentas" sub="Aquí se dan de alta docentes, alumnos y tutores. El acceso requiere CURP y contraseña." /><Banner b={b} />
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
    <Card title="Solicitudes de restablecimiento de contraseña"><p className="sub">Revisa la identidad del usuario antes de autorizar. La contraseña temporal se muestra una sola vez.</p><button className="mini" onClick={cargarSolicitudes}>Actualizar solicitudes</button>
      {solicitudes.map(x => <div key={x.id} style={{ borderTop: '1px solid var(--borde, #ddd)', paddingTop: 10, marginTop: 10 }}><b>{x.nombre || 'Cuenta'}</b><p className="sub">{x.rol} · {x.curp} · {new Date(x.creado).toLocaleString()}</p><button className="mini" onClick={async () => { if (!confirm('Confirma que verificaste la identidad del usuario.')) return; try { const r = await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'restablecer' }); setTemp(r.passwordTemporal); ban('ok', 'Contraseña restablecida', 'Entrega la contraseña temporal al usuario por un medio privado.'); cargarSolicitudes(); } catch (er) { ban('err', 'No se pudo restablecer', msgErr(er)); } }}>Verificar y restablecer</button><button className="mini rojo" onClick={async () => { try { await post('/api/admin/recuperaciones/' + x.id + '/resolver', { accion: 'rechazar' }); cargarSolicitudes(); } catch (er) { ban('err', 'No se pudo rechazar', msgErr(er)); } }}>Rechazar</button></div>)}
      {!solicitudes.length && <p className="vacio">No hay solicitudes pendientes.</p>}
    </Card>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o CURP" style={{ marginBottom: 12 }} />
    {l.map(x => (
      <Card key={x.rol + x.id}><b>{x.nombre}</b><span className="tag">{x.rol}</span>
        <p className="sub" style={{ margin: '4px 0 8px' }}>{x.curp || x.id}{x.rol === 'alumno' ? ` · ${x.semestre} ${x.area} ${x.grupo}` : ''}{x.hijos && x.hijos.length ? ` · alumnos: ${x.hijos.join(', ')}` : ''}{x.tutores && x.tutores.length ? ` · tutores: ${x.tutores.join(', ')}` : ''}</p>
        {x.rol === 'alumno' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('grupo', x)}>Cambiar grupo</button>}
        {x.rol === 'tutor' && <button className="mini" style={{ marginLeft: 0 }} onClick={() => acc('vincular', x)}>Vincular alumno</button>}
        <button className={'mini rojo'} style={x.rol === 'docente' ? { marginLeft: 0 } : {}} onClick={() => acc('borrar', x)}>Borrar</button></Card>))}
    {!l.length && <Card><p className="vacio">Sin resultados.</p></Card>}
  </>);
}

export function Grupos() {
  const { g, u, c, cargar } = useServicios(), [b, ban] = useBanner();
  const cuenta = k => u.filter(x => x.rol === 'alumno' && x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length;
  const borrar = async k => {
    if (!confirm(`¿Eliminar el grupo ${nombreGrupo(k)}?\n\nSe borrarán sus ${cuenta(k)} cuentas de alumnos (con sus asistencias y calificaciones), sus clases y su horario. No se puede deshacer.`)) return;
    try { const r = await post('/api/admin/grupos/borrar', { id: k.id }); ban('ok', 'Grupo eliminado', `${r.alumnos} cuentas de alumnos borradas.`); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  return (<>
    <Hero titulo="Grupos" sub="Los grupos se crean solos al dar de alta al primer alumno de cada grupo." /><Banner b={b} />
    {g.map(k => <Card key={k.id}><b>{nombreGrupo(k)}</b><p className="sub" style={{ margin: '4px 0 8px' }}>{cuenta(k)} alumnos · {c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo).length} materias</p>
      <button className="mini rojo" style={{ marginLeft: 0 }} onClick={() => borrar(k)}>Eliminar grupo y sus cuentas</button></Card>)}
    {!g.length && <Card><p className="vacio">Todavía no hay grupos. Crea la cuenta de un alumno y su grupo aparecerá aquí.</p></Card>}
  </>);
}

export function Clases() {
  const { g, u, c, cargar } = useServicios(), [b, ban] = useBanner(), [f, setF] = useState({ gi: 0, materia: '', docente: '' }), [qr, setQr] = useState(null);
  const docs = u.filter(x => x.rol === 'docente');
  const crear = async e => { e.preventDefault(); const k = g[+f.gi]; if (!k) return ban('err', 'Primero crea un grupo'); try { await post('/api/admin/clases', { area: k.area, semestre: k.semestre, grupo: k.grupo, materia: f.materia, docente: f.docente || (docs[0] && docs[0].id) }); setF({ ...f, materia: '' }); ban('ok', 'Clase añadida', 'Se generó su QR: búscala abajo y toca Ver QR.'); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  const borrar = async k => { if (!confirm('¿Borrar esta clase?')) return; try { await post('/api/admin/clases/borrar', { id: k.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Clases" sub="Una materia de un grupo, con su docente." /><Banner b={b} />
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
  const { g, c, h, cargar } = useServicios(), [b, ban] = useBanner(), [gi, setGi] = useState(0);
  const [f, setF] = useState({ dia: 1, inicio: '07:00', fin: '07:50', claseId: '' });
  const k = g[+gi], cl = k ? c.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo) : [], bl = k ? h.filter(x => x.area === k.area && x.semestre === k.semestre && x.grupo === k.grupo) : [];
  const todo = conDescanso(bl);
  const añadir = async e => {
    e.preventDefault(); if (!k) return ban('err', 'Primero da de alta a un alumno de ese grupo');
    try { await post('/api/admin/horarios', { area: k.area, semestre: k.semestre, grupo: k.grupo, dia: +f.dia, inicio: f.inicio, fin: f.fin, tipo: 'clase', claseId: f.claseId || (cl[0] && cl[0].id) });
      ban('ok', 'Bloque añadido', `${DIAS[f.dia]} ${hh(f.inicio)} a ${hh(f.fin)}`); setF({ ...f, inicio: f.fin, fin: '' }); cargar(); }
    catch (er) { ban('err', 'No se pudo', msgErr(er)); }
  };
  const borrar = async x => { try { await post('/api/admin/horarios/borrar', { id: x.id }); cargar(); } catch (er) { ban('err', 'No se pudo', msgErr(er)); } };
  return (<>
    <Hero titulo="Horarios" sub="El descanso de 9:30 a 10:00 ya está fijo todos los días." /><Banner b={b} />
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
