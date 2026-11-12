import { useState, useEffect, useRef } from 'react';
import SD from './sd.js';
import * as XL from './excel.js';
import { Card, Hero, Banner, useBanner, QR, useDatos, useCached, hh, fmtF, hoyISO, post, msgErr, estadoHorario, mesDatos, descargar } from './ui.jsx';

export function Camara({ onTexto, onError }) {
  const v = useRef(null), parar = useRef(null), [on, setOn] = useState(false), ultimo = useRef('');
  useEffect(() => () => { parar.current && parar.current(); }, []);
  const alternar = async () => {
    if (on) { parar.current && parar.current(); parar.current = null; setOn(false); return; }
    setOn(true);
    try { parar.current = await SD.scan(v.current, t => { t = t.trim().toUpperCase(); if (t !== ultimo.current) { ultimo.current = t; onTexto(t); setTimeout(() => (ultimo.current = ''), 4000); } }, onError); }
    catch (e) { setOn(false); onError('No se pudo abrir la cámara (permiso o HTTPS).'); }
  };
  return (<><button className="btn" type="button" onClick={alternar}>{on ? 'DETENER CÁMARA' : 'ACTIVAR CÁMARA'}</button><video ref={v} playsInline muted style={{ display: on ? 'block' : 'none' }} /></>);
}

export function AsistenciaDocente() {
  const d = useDatos(), [clases] = useCached('clases', '/api/clases'), [bl] = useCached('horario', '/api/horarios'), [b, ban] = useBanner();
  const [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [curp, setCurp] = useState(''), [qr, setQr] = useState(false), [ficha, setFicha] = useState(null);
  const lc = clases || [], c = lc.find(x => x.id === cid) || null;
  useEffect(() => {   // elige sola la clase que toca ahora según el horario
    if (!clases || !bl) return;
    const e = estadoHorario(bl);
    if (e.ahora && e.ahora.claseId && clases.some(x => x.id === e.ahora.claseId)) setCid(e.ahora.claseId);
    else if (!clases.some(x => x.id === cid) && clases[0]) setCid(clases[0].id);
  }, [clases, bl]);
  useEffect(() => { if (cid) localStorage.setItem('sd_clase_id', cid); }, [cid]);
  const nombre = x => `${x.materia} · ${x.semestre} ${x.area} ${x.grupo}`;

  async function procesar(txt) {
    txt = txt.trim().toUpperCase(); setCurp(txt);
    if (txt.startsWith('CLASE:')) {
      const k = lc.find(x => x.id === txt.slice(6));
      return k ? (setCid(k.id), ban('ok', 'Clase lista', nombre(k))) : ban('err', 'Clase no encontrada', 'Ese QR no es de una de tus clases.');
    }
    if (!/^[A-Z0-9]{18}$/.test(txt)) return ban('err', 'QR no válido', 'No contiene una CURP.');
    const r = await SD.consultar(txt); setFicha(r.alumno ? r : null);
    if (!r.alumno) return ban('err', 'No encontrado', r.offline ? 'Sin conexión y ese alumno no está en este dispositivo.' : 'Esa CURP no está registrada.');
    if (!c) return ban('err', 'Elige una clase', 'Selecciona tu clase o escanea su QR.');
    const a = r.alumno;
    if (a.area !== c.area || a.semestre !== c.semestre || a.grupo !== c.grupo) return ban('warn', 'No es de este grupo', `${a.nombre} es de ${a.semestre} ${a.area} ${a.grupo}`);
    const x = await SD.asistencia(txt, c); d.refresh(); setFicha(await SD.consultar(txt));
    x.duplicada ? ban('warn', 'Ya registrado', `${a.nombre} ya tenía asistencia en ${c.materia} (${x.asistencia.hora})`)
      : ban('ok', 'ASISTIÓ', `${a.nombre} · ${c.materia} · ${x.asistencia.hora}${navigator.onLine ? '' : ' (se enviará al tutor al volver internet)'}`);
  }
  async function cerrar() {
    if (!c) return ban('err', 'Elige una clase');
    if (!confirm(`¿Cerrar lista de ${c.materia}?\n${c.semestre} ${c.area} ${c.grupo}\nQuien no haya asistido quedará con falta.`)) return;
    const f = await SD.cierre(c); d.refresh();
    f.length ? ban('warn', `Faltaron ${f.length} a ${c.materia}`, f.join(', ')) : ban('ok', 'Sin faltas', `Nadie faltó sin permiso en ${c.materia}.`);
  }
  async function corregir(uid, acc) {
    let motivo = '';
    if (acc === 'justificar') { motivo = prompt('Motivo de la justificación (opcional):'); if (motivo === null) return; }
    else if (!confirm('¿Quitar este registro de asistencia?')) return;
    try { await SD.corregir(uid, acc, motivo || ''); d.refresh(); ban('ok', 'Listo', acc === 'quitar' ? 'Registro quitado.' : 'Falta justificada; se avisó al tutor.'); } catch (e) { ban('err', 'No se pudo', e.message); }
  }
  const hoy = hoyISO(), grupo = c ? d.alumnos.filter(a => a.area === c.area && a.semestre === c.semestre && a.grupo === c.grupo).sort((x, y) => x.nombre.localeCompare(y.nombre)) : [];
  const reg = a => d.asistencias.find(r => r.curp === a.curp && r.fecha === hoy && c && (r.materia || '').toLowerCase() === c.materia.toLowerCase());
  const llegaron = grupo.filter(a => (reg(a) || {}).estado === 'asistio').length;
  return (<>
    <Hero titulo="Asistencia" sub="Elige tu clase y escanea el QR de cada alumno." /><Banner b={b} />
    <Card title="Clase de ahora">
      <select value={cid} onChange={e => { setCid(e.target.value); setQr(false); }}>{lc.map(x => <option key={x.id} value={x.id}>{nombre(x)}</option>)}{!lc.length && <option value="">No tienes clases asignadas</option>}</select>
      {c && <button className="mini" style={{ marginLeft: 0, marginTop: 10 }} onClick={() => setQr(!qr)}>{qr ? 'Ocultar QR de la clase' : 'Ver QR de esta clase'}</button>}
      {qr && c && <><QR texto={'CLASE:' + c.id} /><p className="sub" style={{ textAlign: 'center' }}>Al escanearlo se abre esta clase.</p></>}
    </Card>
    <Card title="Escanear"><Camara onTexto={procesar} onError={m => ban('err', 'Cámara', m)} />
      <div className="fila2" style={{ marginTop: 12 }}><input value={curp} maxLength="24" placeholder="o escribe la CURP" onChange={e => setCurp(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && procesar(curp)} style={{ marginTop: 0 }} />
        <button className="btn" style={{ flex: 'none', width: 80, margin: 0 }} onClick={() => procesar(curp)}>OK</button></div></Card>
    {ficha && ficha.alumno && <Card title="Alumno"><dl><dt>Nombre</dt><dd>{ficha.alumno.nombre}</dd><dt>CURP</dt><dd>{ficha.alumno.curp}</dd><dt>Grupo</dt><dd>{ficha.alumno.semestre} {ficha.alumno.area} {ficha.alumno.grupo}</dd></dl></Card>}
    <Card title={`Lista de la clase${c ? ` · llegaron ${llegaron} de ${grupo.length}` : ''}`}>
      <ul className="l">{grupo.map(a => { const r = reg(a), est = !r ? 'falta por llegar' : r.estado === 'asistio' ? 'llegó' : r.estado === 'justificada' ? 'justificada' : 'falta';
        return <li key={a.curp}><span>{a.nombre}</span><span>{est}{r && !r.pendiente && r.estado === 'falta' && <button className="mini" onClick={() => corregir(r.uid, 'justificar')}>Justificar</button>}{r && !r.pendiente && r.estado === 'asistio' && <button className="mini" onClick={() => corregir(r.uid, 'quitar')}>Quitar</button>}</span></li>; })}
        {!grupo.length && <li className="vacio">No hay alumnos en este grupo.</li>}</ul>
      <button className="btn" onClick={cerrar}>CERRAR LISTA DE ESTA CLASE</button></Card>
  </>);
}

export function CalifDocente() {
  const d = useDatos(), [clases] = useCached('clases', '/api/clases'), [notas, cargarNotas] = useCached('calif', '/api/calificaciones'), [b, ban] = useBanner();
  const [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [p, setP] = useState(1), [mats, setMats] = useState(null), [vals, setVals] = useState({});
  const lc = clases || [], c = lc.find(x => x.id === cid) || lc[0] || null;
  const grupo = c ? d.alumnos.filter(a => a.area === c.area && a.semestre === c.semestre && a.grupo === c.grupo).sort((x, y) => x.nombre.localeCompare(y.nombre)) : [];
  const nota = (a, m) => { const n = (notas || []).find(x => x.curp === a.curp && x.materia.toLowerCase() === m.toLowerCase() && x.parcial === p); return n ? n.nota : ''; };
  async function cargar() {
    if (!c) return ban('err', 'Elige una clase'); await cargarNotas();
    let gr = [c]; try { gr = await SD.api(`/api/clases?area=${encodeURIComponent(c.area)}&semestre=${encodeURIComponent(c.semestre)}&grupo=${encodeURIComponent(c.grupo)}`); } catch (e) {}
    setMats([...new Map(gr.map(x => [x.materia.toLowerCase(), x.materia])).values()].sort((a, b) => a.localeCompare(b)));
    setVals(Object.fromEntries(grupo.map(a => [a.curp, String(nota(a, c.materia))])));
    ban('ok', `Tu columna es ${c.materia}`, 'Las demás asignaturas las captura cada profesor.');
  }
  const mia = m => c && m.toLowerCase() === c.materia.toLowerCase();
  const val = (a, m) => mia(m) ? vals[a.curp] : String(nota(a, m));
  const prom = a => { const v = (mats || []).map(m => val(a, m)).filter(x => x !== '' && x !== undefined).map(Number); return v.length ? (v.reduce((x, y) => x + y, 0) / v.length).toFixed(2) : '–'; };
  async function guardar() {
    try { const r = await post('/api/calificaciones', { materia: c.materia, parcial: p, notas: Object.entries(vals).filter(([, v]) => v !== '').map(([curp, v]) => ({ curp, nota: +v })) }); ban('ok', 'Guardadas', `${r.guardadas} calificaciones. Los tutores recibieron el aviso.`); cargarNotas(); } catch (e) { ban('err', 'No se pudo guardar', msgErr(e)); }
  }
  function excel() {
    const filas = grupo.map(a => [a.nombre, mats.map(m => { const v = val(a, m); return v === '' || v === undefined ? '' : +v; })]);
    descargar(XL.calificaciones({ titulo: 'CBTIS 170 · SHARK DARK', subtitulo: `Calificaciones · ${c.semestre} ${c.area} ${c.grupo} · Parcial ${p}`, materias: mats, filas }), `calificaciones-${c.semestre}${c.area}${c.grupo}-P${p}.xlsx`);
  }
  return (<>
    <Hero titulo="Calificaciones" sub="Captura tu asignatura; las demás las ves en la tabla." /><Banner b={b} />
    <Card title="Clase y parcial">
      <select value={c ? c.id : ''} onChange={e => { setCid(e.target.value); setMats(null); }}>{lc.map(x => <option key={x.id} value={x.id}>{x.materia} · {x.semestre} {x.area} {x.grupo}</option>)}{!lc.length && <option value="">No tienes clases asignadas</option>}</select>
      <select value={p} onChange={e => { setP(+e.target.value); setMats(null); }}><option value="1">Parcial 1</option><option value="2">Parcial 2</option><option value="3">Parcial 3</option></select>
      <button className="btn" onClick={cargar}>CARGAR ALUMNOS</button></Card>
    {mats && <Card><div className="tabla"><table className="tb"><thead><tr><th>No.</th><th>Nombre</th>{mats.map(m => <th key={m}>{m}{mia(m) ? ' (tú)' : ''}</th>)}<th>Promedio</th></tr></thead>
      <tbody>{grupo.map((a, i) => <tr key={a.curp}><td>{i + 1}</td><td>{a.nombre}</td>{mats.map(m => <td key={m}>{mia(m) ? <input type="number" min="0" max="10" step="0.1" value={vals[a.curp] ?? ''} onChange={e => setVals({ ...vals, [a.curp]: e.target.value })} /> : (val(a, m) === '' ? '–' : val(a, m))}</td>)}<td><b>{prom(a)}</b></td></tr>)}</tbody></table></div>
      <button className="btn" onClick={guardar}>GUARDAR MIS CALIFICACIONES</button><button className="btn sec" onClick={excel}>Descargar en Excel</button></Card>}
  </>);
}

export function ReporteDocente() {
  const d = useDatos(), [clases] = useCached('clases', '/api/clases'), [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [mes, setMes] = useState(hoyISO().slice(0, 7)), [b, ban] = useBanner();
  const lc = clases || [], c = lc.find(x => x.id === cid) || lc[0] || null;
  const m = c ? mesDatos(c, d, mes) : null;
  function excel() {
    const nom = new Map(m.g.map(a => [a.curp, a.nombre])), est = { asistio: 'Asistió', falta: 'Falta', justificada: 'Justificada' };
    const detalle = m.rs.slice().sort((x, y) => nom.get(x.curp).localeCompare(nom.get(y.curp)) || x.fecha.localeCompare(y.fecha)).map(r => [nom.get(r.curp), r.curp, r.fecha, r.hora || '', r.materia || '', est[r.estado] || r.estado, r.motivo || '']);
    const mesTxt = new Date(mes + '-15').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    descargar(XL.asistencias({ titulo: 'CBTIS 170 · SHARK DARK', subtitulo: `Asistencias · ${c.materia} · ${c.semestre} ${c.area} ${c.grupo} · ${mesTxt}`, fechas: m.fechas.map(f => f.slice(8) + '/' + f.slice(5, 7)), filas: m.filas, detalle }), `asistencias-${c.materia}-${c.semestre}${c.area}${c.grupo}-${mes}.xlsx`);
    ban('ok', 'Reporte listo', `${m.g.length} alumnos y ${m.fechas.length} días. Ábrelo con Excel.`);
  }
  const col = { '✓': 'var(--ok)', '✗': 'var(--err)', J: 'var(--caramelo)' };
  return (<>
    <Hero titulo="Reportes" sub="Consulta la asistencia de tus clases." /><Banner b={b} />
    <Card title="Clase y mes"><select value={c ? c.id : ''} onChange={e => { setCid(e.target.value); localStorage.setItem('sd_clase_id', e.target.value); }}>{lc.map(x => <option key={x.id} value={x.id}>{x.materia} · {x.semestre} {x.area} {x.grupo}</option>)}{!lc.length && <option value="">No tienes clases asignadas</option>}</select>
      <input type="month" value={mes} onChange={e => setMes(e.target.value)} /></Card>
    {m && <Card title="Asistencia del mes"><div className="tabla"><table className="tb"><thead><tr><th>No.</th><th>Nombre</th>{m.fechas.map(f => <th key={f}>{f.slice(8)}/{f.slice(5, 7)}</th>)}</tr></thead>
      <tbody>{m.filas.map((f, i) => <tr key={i}><td>{i + 1}</td><td>{f[0]}</td>{f[1].map((v, j) => <td key={j} style={{ color: col[v] || 'var(--muted)', fontWeight: 700 }}>{v === '·' ? '–' : v}</td>)}</tr>)}</tbody></table></div>
      <p className="sub" style={{ margin: '8px 0 0' }}>✓ asistió · ✗ faltó · J justificada · – sin registro</p>
      <button className="btn" onClick={excel}>Descargar en Excel</button><button className="btn sec" onClick={() => window.print()}>Imprimir reporte</button></Card>}
  </>);
}
