import { useState, useEffect, useRef } from 'react';
import SD from './sd.js';
import * as XL from './excel.js';
import asistenciaReglas from './asistencia-reglas.js';
import { Card, Hero, Banner, useBanner, QR, useDatos, useCached, hh, fmtF, hoyISO, post, msgErr, mesDatos, descargar, PanelEmergente } from './ui.jsx';
const { fechaHoraMexico, estadoAsistenciaHorario } = asistenciaReglas;

export function Camara({ onTexto, onError, disabled = false }) {
  const v = useRef(null), parar = useRef(null), [on, setOn] = useState(false), ultimo = useRef(''), procesando = useRef(false);
  useEffect(() => () => { parar.current && parar.current(); }, []);
  useEffect(() => {
    if (disabled && on) { parar.current && parar.current(); parar.current = null; setOn(false); }
  }, [disabled, on]);
  const alternar = async () => {
    if (disabled) return;
    if (on) { parar.current && parar.current(); parar.current = null; setOn(false); return; }
    setOn(true);
    try { parar.current = await SD.scan(v.current, async t => {
      t = t.trim().toUpperCase();
      if (procesando.current || t === ultimo.current) return;
      procesando.current = true; ultimo.current = t;
      try { await onTexto(t); }
      finally { setTimeout(() => { ultimo.current = ''; procesando.current = false; }, 1200); }
    }, onError); }
    catch (e) { setOn(false); onError('No se pudo abrir la cámara (permiso o HTTPS).'); }
  };
  return (<><button className="btn" type="button" disabled={disabled} aria-pressed={on} aria-controls="camara-preview" onClick={alternar}>{on ? 'DETENER CÁMARA' : 'ACTIVAR CÁMARA'}</button><div id="camara-preview" hidden={!on} aria-hidden={!on}><video ref={v} playsInline muted /></div></>);
}

export function AsistenciaDocente() {
  const d = useDatos(), [clases] = useCached('clases', '/api/clases'), [bl] = useCached('horario', '/api/horarios');
  const [periodo] = useCached('periodo', '/api/periodos');
  const [pendientes, cargarPendientes] = useCached('asistencias_pendientes', '/api/asistencias/pendientes'), [b, ban] = useBanner();
  const [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [curp, setCurp] = useState(''), [qr, setQr] = useState(false), [ficha, setFicha] = useState(null);
  const [instante, setInstante] = useState(() => fechaHoraMexico());
  const lc = clases || [], periodoPermiteAsistencia = periodo?.estado?.enCiclo === true;
  const horario = estadoAsistenciaHorario(periodoPermiteAsistencia ? bl || [] : [], instante);
  useEffect(() => { const t = setInterval(() => setInstante(fechaHoraMexico()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    document.addEventListener('sd-sync', cargarPendientes);
    return () => document.removeEventListener('sd-sync', cargarPendientes);
  }, [cargarPendientes]);
  const claseDeBloque = x => lc.find(k => k.id === x.claseId) || lc.find(k => k.area === x.area && k.semestre === x.semestre && k.grupo === x.grupo && k.materia.toLowerCase() === String(x.materia || '').toLowerCase()) || null;
  const claseEscaneo = horario.actual ? claseDeBloque(horario.actual) : null;
  const claseSiguiente = horario.siguiente ? claseDeBloque(horario.siguiente) : null;
  const c = claseEscaneo || lc.find(x => x.id === cid) || null;
  useEffect(() => { if (claseEscaneo?.id) setCid(claseEscaneo.id); }, [claseEscaneo?.id]);
  useEffect(() => { if (cid) localStorage.setItem('sd_clase_id', cid); }, [cid]);
  const nombre = x => `${x.materia} · ${x.semestre} ${x.area} ${x.grupo}`;

  async function procesar(txt) {
    txt = txt.trim().toUpperCase(); setCurp(txt);
    if (txt.startsWith('CLASE:')) {
      const k = lc.find(x => x.id === txt.slice(6));
      if (!k) return ban('err', 'Clase no encontrada', 'Ese QR no es de una de tus clases.');
      return claseEscaneo?.id === k.id
        ? ban('ok', 'Clase actual', nombre(k))
        : ban('warn', 'QR de otra clase', 'Solo puedes registrar asistencia en la clase que corresponde al horario actual.');
    }
    if (!/^[A-Z0-9]{18}$/.test(txt)) return ban('err', 'QR no válido', 'No contiene una CURP.');
    if (!claseEscaneo) return ban('warn', 'No hay clase habilitada', claseSiguiente ? `Siguiente: ${nombre(claseSiguiente)} · ${claseSiguiente.inicio || horario.siguiente.inicio}` : 'El escáner solo se habilita durante una clase programada.');
    let r;
    try { r = await SD.consultar(txt); } catch (e) { return ban('err', 'No se pudo consultar', e.message); }
    setFicha(r.alumno ? r : null);
    if (!r.alumno) return ban('err', 'No encontrado', r.offline ? 'Sin conexión y ese alumno no está en este dispositivo.' : 'Esa CURP no está registrada.');
    const a = r.alumno;
    if (a.area !== claseEscaneo.area || a.semestre !== claseEscaneo.semestre || a.grupo !== claseEscaneo.grupo) return ban('warn', 'No es de este grupo', `${a.nombre} es de ${a.semestre} ${a.area} ${a.grupo}`);
    try {
      const x = await SD.asistencia(txt, claseEscaneo); d.refresh(); setFicha(await SD.consultar(txt));
      if (x.duplicada) return ban('warn', 'Ya registrado', `${a.nombre} ya tenía asistencia en ${claseEscaneo.materia} (${x.asistencia.hora})`);
      if (x.asistencia.revisionPendiente) return ban('warn', 'Pendiente de revisión', `${a.nombre} · ${claseEscaneo.materia}. No se avisará al tutor hasta que se confirme.`);
      if (x.asistencia.pendiente) return ban('warn', x.asistencia.capturaOffline ? 'Guardada sin conexión' : 'Pendiente de sincronización', `${a.nombre} · ${claseEscaneo.materia}. No se considera confirmada hasta que el servidor la valide.`);
      ban('ok', 'ASISTIÓ', `${a.nombre} · ${claseEscaneo.materia} · ${x.asistencia.hora}`);
    } catch (e) { ban('err', 'No se registró', e.message); }
  }
  async function cerrar() {
    if (!c) return ban('err', 'Elige una clase');
    if (!periodoPermiteAsistencia) return ban('err', 'No se puede cerrar la lista', periodo?.estado?.mensaje || 'El calendario escolar no está configurado.');
    if (!confirm(`¿Cerrar lista de ${c.materia}?\n${c.semestre} ${c.area} ${c.grupo}\nQuien no haya asistido quedará con falta.`)) return;
    try {
      const r = await SD.cierre(c); d.refresh();
      if (r.revisionPendiente) return ban('warn', 'Cierre pendiente de revisión', 'Se sincronizará con autorización. No se generarán faltas ni avisos hasta que lo confirmes.');
      r.faltas.length ? ban('warn', `Faltaron ${r.faltas.length} a ${c.materia}`, r.faltas.join(', ')) : ban('ok', 'Sin faltas', `Nadie faltó sin permiso en ${c.materia}.`);
    } catch (e) { ban('err', 'No se pudo cerrar la lista', e.message); }
  }
  async function resolver(p, accion) {
    const texto = p.tipo === 'cierre' ? `el cierre de ${p.materia} · ${p.semestre} ${p.area} ${p.grupo}` : `la asistencia de ${p.alumnoNombre} a ${p.materia}`;
    if (!confirm(`¿${accion === 'confirmar' ? 'Confirmar' : 'Rechazar'} ${texto}?`)) return;
    try {
      const ruta = p.tipo === 'cierre' ? '/api/cierres/pendientes/' : '/api/asistencias/pendientes/';
      const resultado = await post(`${ruta}${encodeURIComponent(p.uid)}/resolver`, { accion });
      await SD.sync(); await d.refresh(); await cargarPendientes();
      ban('ok', accion === 'confirmar' ? 'Registro confirmado' : 'Registro rechazado', p.tipo === 'cierre' && accion === 'confirmar'
        ? `Se registraron ${resultado.faltas} faltas según los datos vigentes del servidor.`
        : 'La revisión quedó guardada y auditada.');
    } catch (e) { ban('err', 'No se pudo revisar', e.message); }
  }
  async function corregir(uid, acc) {
    let motivo = '';
    if (acc === 'justificar') { motivo = prompt('Motivo de la justificación (opcional):'); if (motivo === null) return; }
    else if (!confirm('¿Quitar este registro de asistencia?')) return;
    try { await SD.corregir(uid, acc, motivo || ''); d.refresh(); ban('ok', 'Listo', acc === 'quitar' ? 'Registro quitado.' : 'Falta justificada; se avisó al tutor.'); } catch (e) { ban('err', 'No se pudo', e.message); }
  }
  const hoy = instante.fecha, grupo = c ? d.alumnos.filter(a => a.area === c.area && a.semestre === c.semestre && a.grupo === c.grupo).sort((x, y) => x.nombre.localeCompare(y.nombre)) : [];
  const reg = a => d.asistencias.find(r => r.curp === a.curp && r.fecha === hoy && c && (r.materia || '').toLowerCase() === c.materia.toLowerCase());
  const llegaron = grupo.filter(a => { const r = reg(a); return r?.estado === 'asistio' && !r.revisionPendiente; }).length;
  return (<>
    <Hero titulo="Asistencia" sub="El escáner se habilita solo durante el ciclo escolar y para la clase que corresponde al horario actual." /><Banner b={b} />
    <Card title="Clase de ahora">
      {claseEscaneo ? <><b>{nombre(claseEscaneo)}</b><p className="sub">{horario.actual.inicio}–{horario.actual.fin} · tolerancia de 10 minutos antes</p>
        <button className="mini" type="button" style={{ marginLeft: 0, marginTop: 10 }} aria-haspopup="dialog" aria-expanded={qr} onClick={() => setQr(true)}>Ver QR de esta clase</button></>
        : <><p className="sub">{!periodo?.configurado ? 'El calendario escolar no está configurado. La asistencia permanece bloqueada.' : !periodoPermiteAsistencia ? periodo.estado?.mensaje : <>No tienes clase en este momento.{claseSiguiente && <> Siguiente: {nombre(claseSiguiente)} · {horario.siguiente.inicio}.</>}</>}</p>
          {c && <button className="mini" type="button" style={{ marginLeft: 0, marginTop: 10 }} aria-haspopup="dialog" aria-expanded={qr} onClick={() => setQr(true)}>Ver QR de {nombre(c)}</button>}</>}
      {!claseEscaneo && <label>Clase para consultar o cerrar lista<select value={c ? c.id : ''} onChange={e => { setCid(e.target.value); setQr(false); }}>
        <option value="">Elige una clase</option>{lc.map(x => <option key={x.id} value={x.id}>{nombre(x)}</option>)}
      </select></label>}
    </Card>
    <PanelEmergente abierto={qr && Boolean(c)} titulo={c ? `QR de ${nombre(c)}` : 'QR de la clase'} onCerrar={() => setQr(false)}>
      {c && <div className="qr-clase-panel"><QR texto={'CLASE:' + c.id} /><p className="sub" style={{ textAlign: 'center' }}>El registro solo se habilita si corresponde con la clase del horario actual.</p></div>}
    </PanelEmergente>
    <Card title="Escanear"><Camara disabled={!claseEscaneo} onTexto={procesar} onError={m => ban('err', 'Cámara', m)} />
      <div className="fila2" style={{ marginTop: 12 }}><input disabled={!claseEscaneo} value={curp} maxLength="24" placeholder="o escribe la CURP" onChange={e => setCurp(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && procesar(curp)} style={{ marginTop: 0 }} />
        <button className="btn" disabled={!claseEscaneo} style={{ flex: 'none', width: 80, margin: 0 }} onClick={() => procesar(curp)}>OK</button></div></Card>
    {ficha && ficha.alumno && <Card title="Alumno"><dl><dt>Nombre</dt><dd>{ficha.alumno.nombre}</dd><dt>CURP</dt><dd>{ficha.alumno.curp}</dd><dt>Grupo</dt><dd>{ficha.alumno.semestre} {ficha.alumno.area} {ficha.alumno.grupo}</dd></dl></Card>}
    <Card title={`Lista de la clase${c ? ` · llegaron ${llegaron} de ${grupo.length}` : ''}`}>
      <ul className="l">{grupo.map(a => { const r = reg(a), est = !r ? 'falta por llegar' : r.estado === 'asistio' ? 'llegó' : r.estado === 'justificada' ? 'justificada' : 'falta';
        return <li key={a.curp}><span>{a.nombre}</span><span>{r?.revisionPendiente ? 'pendiente de revisión' : est}{r && !r.pendiente && !r.revisionPendiente && r.estado === 'falta' && <button className="mini" onClick={() => corregir(r.uid, 'justificar')}>Justificar</button>}{r && !r.pendiente && !r.revisionPendiente && r.estado === 'asistio' && <button className="mini" onClick={() => corregir(r.uid, 'quitar')}>Quitar</button>}</span></li>; })}
        {!grupo.length && <li className="vacio">No hay alumnos en este grupo.</li>}</ul>
      <button className="btn" disabled={!c || !periodoPermiteAsistencia} onClick={cerrar}>CERRAR LISTA DE ESTA CLASE</button></Card>
    {pendientes?.length > 0 && <Card title={`Pendientes de revisión · ${pendientes.length}`}>
      <ul className="l">{pendientes.map(p => <li key={`${p.tipo}:${p.uid}`}>
        <span><b>{p.tipo === 'cierre' ? 'Cierre de lista' : p.alumnoNombre}</b><br />{p.materia} · {p.semestre} {p.area} {p.grupo}<br />
          {fmtF(p.fecha)} · {p.tipo === 'cierre' ? 'cierre offline' : `hora declarada ${p.horaDeclarada}`} · recibido {new Date(p.recibido).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span>
        <span><button className="mini" disabled={!navigator.onLine || SD.session()?.offline} onClick={() => resolver(p, 'confirmar')}>Confirmar</button>
          <button className="mini" disabled={!navigator.onLine || SD.session()?.offline} onClick={() => resolver(p, 'rechazar')}>Rechazar</button></span>
      </li>)}</ul>
    </Card>}
  </>);
}

export function CalifDocente() {
  const d = useDatos(), [clases] = useCached('clases', '/api/clases'), [notas, cargarNotas] = useCached('calif', '/api/calificaciones'), [b, ban] = useBanner();
  const [periodo] = useCached('periodo', '/api/periodos');
  const [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [p, setP] = useState(1), [mats, setMats] = useState(null), [vals, setVals] = useState({});
  const lc = clases || [], c = lc.find(x => x.id === cid) || lc[0] || null;
  const parcialPeriodo = periodo?.estado?.parciales?.find(x => Number(x.n) === p);
  const advertenciaCaptura = !parcialPeriodo?.califAbierta;
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
    try {
      const r = await post('/api/calificaciones', { materia: c.materia, parcial: p, notas: Object.entries(vals).filter(([, v]) => v !== '').map(([curp, v]) => ({ curp, nota: +v })) });
      ban(r.advertencia ? 'warn' : 'ok', r.advertencia ? 'Guardadas fuera de ventana' : 'Guardadas',
        `${r.guardadas} calificaciones. ${r.publicada ? 'Se notificó a los alumnos.' : 'Las notas se publicarán al cerrar la ventana de captura.'}${r.advertencia ? ` ${r.advertencia}` : ''}`);
      cargarNotas();
    } catch (e) { ban('err', 'No se pudo guardar', msgErr(e)); }
  }
  function excel() {
    const filas = grupo.map(a => [a.nombre, mats.map(m => { const v = val(a, m); return v === '' || v === undefined ? '' : +v; })]);
    descargar(XL.calificaciones({ titulo: 'CBTIS 170 · TIBURONES', subtitulo: `Calificaciones · ${c.semestre} ${c.area} ${c.grupo} · Parcial ${p}`, materias: mats, filas }), `calificaciones-${c.semestre}${c.area}${c.grupo}-P${p}.xlsx`);
  }
  return (<>
    <Hero titulo="Calificaciones" sub="Captura tu asignatura; las notas se publican al cerrar la ventana de captura." /><Banner b={b} />
    <Card title="Clase y parcial">
      <select value={c ? c.id : ''} onChange={e => { setCid(e.target.value); setMats(null); }}>{lc.map(x => <option key={x.id} value={x.id}>{x.materia} · {x.semestre} {x.area} {x.grupo}</option>)}{!lc.length && <option value="">No tienes clases asignadas</option>}</select>
      <select value={p} onChange={e => { setP(+e.target.value); setMats(null); }}><option value="1">Parcial 1</option><option value="2">Parcial 2</option><option value="3">Parcial 3</option></select>
      {advertenciaCaptura && <p className="sub" role="status">La fecha está fuera de la ventana configurada para este parcial. Puedes guardar; se mostrará una advertencia, pero no se bloqueará la captura.</p>}
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
    descargar(XL.asistencias({ titulo: 'CBTIS 170 · TIBURONES', subtitulo: `Asistencias · ${c.materia} · ${c.semestre} ${c.area} ${c.grupo} · ${mesTxt}`, fechas: m.fechas.map(f => f.slice(8) + '/' + f.slice(5, 7)), filas: m.filas, detalle }), `asistencias-${c.materia}-${c.semestre}${c.area}${c.grupo}-${mes}.xlsx`);
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
