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
  const [cid, setCid] = useState(localStorage.getItem('sd_clase_id') || ''), [curp, setCurp] = useState(''), [qr, setQr] = useState(false), [panel, setPanel] = useState(''), [fechaRevision, setFechaRevision] = useState(hoyISO());
  const [instante, setInstante] = useState(() => fechaHoraMexico());
  const lc = clases || [], periodoPermiteAsistencia = periodo?.estado?.enCiclo === true;
  const horario = estadoAsistenciaHorario(periodoPermiteAsistencia ? bl || [] : [], instante);
  useEffect(() => { const t = setInterval(() => setInstante(fechaHoraMexico()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { document.addEventListener('sd-sync', cargarPendientes); return () => document.removeEventListener('sd-sync', cargarPendientes); }, [cargarPendientes]);
  const claseDeBloque = x => lc.find(k => k.id === x.claseId) || lc.find(k => k.area === x.area && k.semestre === x.semestre && k.grupo === x.grupo && k.materia.toLowerCase() === String(x.materia || '').toLowerCase()) || null;
  const claseEscaneo = horario.actual ? claseDeBloque(horario.actual) : null, claseSiguiente = horario.siguiente ? claseDeBloque(horario.siguiente) : null;
  const c = claseEscaneo || lc.find(x => x.id === cid) || null;
  useEffect(() => { if (claseEscaneo?.id) setCid(claseEscaneo.id); }, [claseEscaneo?.id]);
  useEffect(() => { if (cid) localStorage.setItem('sd_clase_id', cid); }, [cid]);
  const claseRevision = lc.find(x => x.id === cid) || lc[0] || null;
  const nombre = x => `${x.materia} · ${x.area} · ${x.semestre} ${x.grupo}`;
  const mismaClave = (a, k) => a.area === k.area && a.semestre === k.semestre && a.grupo === k.grupo;
  const fechaCorta = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
  const alumnosEnFecha = (k, fecha) => k ? d.alumnos.filter(a => {
    const actual = !a.egresado && mismaClave(a, k) && fechaCorta(a.inicioSemestre || a.creado) <= fecha;
    const anterior = (a.historialGrupos || []).some(g => mismaClave(g, k) && fechaCorta(g.desde) <= fecha && fechaCorta(g.hasta) >= fecha);
    return actual || anterior;
  }).sort((x, y) => x.nombre.localeCompare(y.nombre)) : [];
  const alumnosClase = k => alumnosEnFecha(k, hoyISO()).filter(a => !a.egresado);
  const reg = (al, clase, fecha = fechaRevision) => d.asistencias.find(r => r.curp === al.curp && r.fecha === fecha && (r.claseId === clase?.id || (!r.claseId && (r.materia || '').toLowerCase() === (clase?.materia || '').toLowerCase())));

  async function procesar(txt) {
    txt = txt.trim().toUpperCase(); setCurp(txt);
    if (txt.startsWith('CLASE:')) {
      const k = lc.find(x => x.id === txt.slice(6));
      if (!k) return ban('err', 'Clase no encontrada', 'Ese QR no corresponde a una clase asignada.');
      return claseEscaneo?.id === k.id ? ban('ok', 'Clase lista', nombre(k)) : ban('warn', 'QR de otra clase', 'El horario habilita el escaneo únicamente para la clase actual.');
    }
    if (!/^[A-Z0-9]{18}$/.test(txt)) return ban('err', 'QR no válido', 'No contiene una CURP.');
    if (!claseEscaneo) return ban('warn', 'Escaneo cerrado', claseSiguiente ? `Siguiente: ${nombre(claseSiguiente)} · ${horario.siguiente.inicio}` : 'Se habilita cinco minutos antes de la siguiente clase programada.');
    let r;
    try { r = await SD.consultar(txt); } catch (e) { return ban('err', 'No se pudo consultar', e.message); }
    if (!r.alumno) return ban('err', 'No encontrado', r.offline ? 'Sin conexión y el alumno no está guardado en este dispositivo.' : 'Esa CURP no está registrada.');
    const a = r.alumno;
    if (a.area !== claseEscaneo.area || a.semestre !== claseEscaneo.semestre || a.grupo !== claseEscaneo.grupo) return ban('warn', 'Grupo distinto', `${a.nombre} pertenece a ${a.semestre} ${a.area} ${a.grupo}.`);
    try {
      const x = await SD.asistencia(txt, claseEscaneo); await d.refresh();
      if (x.duplicada) return ban('warn', 'Ya registrado', `${a.nombre} ya tiene un registro para ${claseEscaneo.materia}.`);
      if (x.asistencia.revisionPendiente) return ban('warn', 'Pendiente de revisión', 'El servidor debe validar este registro antes de notificar al tutor.');
      if (x.asistencia.pendiente) return ban('warn', 'Sincronizando', `${a.nombre}: el registro se guardó y está esperando confirmación del servidor.`);
      ban('ok', x.asistencia.estado === 'retardo' ? 'RETARDO' : 'ASISTENCIA REGISTRADA', `${a.nombre} · ${claseEscaneo.materia} · ${x.asistencia.hora}`);
    } catch (e) { ban('err', 'No se registró', e.message); }
  }
  async function cerrar() {
    if (!claseEscaneo) return ban('err', 'No hay clase activa para cerrar');
    try {
      const r = await SD.cierre(claseEscaneo); d.refresh();
      if (r.revisionPendiente) return ban('warn', 'Cierre pendiente', 'Quedará en revisión hasta sincronizarse.');
      ban(r.faltas.length ? 'warn' : 'ok', r.faltas.length ? `Faltaron ${r.faltas.length}` : 'Lista cerrada', r.faltas.join(', ') || 'Se registraron asistencias y permisos.');
    } catch (e) { ban('err', 'No se pudo cerrar la lista', e.message); }
  }
  async function editar(al, estado) {
    const actual = reg(al, claseRevision);
    if (actual?.pendiente || actual?.revisionPendiente) return ban('warn', 'Registro pendiente', 'Espera a que se sincronice o revisa el registro pendiente antes de editarlo.');
    const motivo = estado === 'falta' ? (prompt(`Motivo de la falta de ${al.nombre} (opcional):`) || '') : '';
    try {
      await post('/api/asistencias/editar', { curp: al.curp, fecha: fechaRevision, materia: claseRevision.materia, estado, motivo });
      await SD.sync(); await d.refresh();
      ban('ok', 'Asistencia actualizada', `${al.nombre}: ${estado === 'falta' ? 'falta' : 'asistencia'}.`);
    } catch (e) { ban('err', 'No se pudo editar', e.message); }
  }
  async function corregir(uid) {
    const motivo = prompt('Motivo de la justificación (opcional):'); if (motivo === null) return;
    try { await SD.corregir(uid, 'justificar', motivo); d.refresh(); ban('ok', 'Falta justificada', 'Se guardó el cambio y se notificó al tutor.'); }
    catch (e) { ban('err', 'No se pudo justificar', e.message); }
  }
  async function resolver(p, accion) {
    const texto = p.tipo === 'cierre' ? `el cierre de ${p.materia} · ${p.semestre} ${p.area} ${p.grupo}` : `la asistencia de ${p.alumnoNombre} a ${p.materia}`;
    if (!confirm(`¿${accion === 'confirmar' ? 'Confirmar' : 'Rechazar'} ${texto}?`)) return;
    try {
      const ruta = p.tipo === 'cierre' ? '/api/cierres/pendientes/' : '/api/asistencias/pendientes/';
      const resultado = await post(`${ruta}${encodeURIComponent(p.uid)}/resolver`, { accion });
      await SD.sync(); await d.refresh(); await cargarPendientes();
      ban('ok', accion === 'confirmar' ? 'Registro confirmado' : 'Registro rechazado', p.tipo === 'cierre' && accion === 'confirmar' ? `Se registraron ${resultado.faltas} faltas.` : 'La revisión quedó guardada y auditada.');
    } catch (e) { ban('err', 'No se pudo revisar', e.message); }
  }
  const grupoEscaneo = alumnosClase(claseEscaneo), grupoRevision = alumnosEnFecha(claseRevision, fechaRevision);
  const asistieron = grupoRevision.filter(a => ['asistio', 'retardo'].includes(reg(a, claseRevision)?.estado)).length;
  const pendientesRevisar = (pendientes || []).length;
  return <>
    <Hero titulo="Asistencia" sub="Escaneo continuo por horario y revisión de tus grupos por materia." /><Banner b={b} />
    <div className="secciones-vista asistencia-menu">
      <button className="seccion-vista" type="button" aria-haspopup="dialog" onClick={() => setPanel('escanear')}><span className="seccion-vista__icono"><svg className="seccion-vista__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M4 12h16" /></svg></span><span className="seccion-vista__texto"><b>Escanear QR de clase</b><span>{claseEscaneo ? nombre(claseEscaneo) : 'Se activa cinco minutos antes según tu horario'}</span></span><span className="seccion-vista__flecha">›</span></button>
      <button className="seccion-vista dorado" type="button" aria-haspopup="dialog" onClick={() => setPanel('revisar')}><span className="seccion-vista__icono"><svg className="seccion-vista__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16M4 12h16M4 19h10M7 3v4m10-4v4m-10 3v4m10-4v4" /></svg></span><span className="seccion-vista__texto"><b>Revisar asistencias</b><span>{lc.length} materias asignadas · {pendientesRevisar} pendientes de revisión</span></span><span className="seccion-vista__flecha">›</span></button>
    </div>
    <PanelEmergente abierto={panel === 'escanear'} titulo="Escanear asistencia" onCerrar={() => setPanel('')}>
      <Banner b={b} />
      <Card title="Clase del horario">
        {claseEscaneo ? <><b>{nombre(claseEscaneo)}</b><p className="sub">{horario.actual.inicio}–{horario.actual.fin} · escaneo habilitado cinco minutos antes. Después de diez minutos desde el inicio, la llegada se marca con retardo.</p><button className="mini" type="button" onClick={() => setQr(v => !v)}>{qr ? 'Ocultar QR' : 'Mostrar QR de la clase'}</button>{qr && <div className="qr-clase-panel"><QR texto={'CLASE:' + claseEscaneo.id} /><p className="sub" style={{ textAlign: 'center' }}>El horario determina el grupo y materia para escanear.</p></div>}</>
          : <p className="sub">{!periodo?.configurado ? 'El calendario escolar no está configurado.' : !periodoPermiteAsistencia ? periodo.estado?.mensaje : <>No hay una clase habilitada ahora.{claseSiguiente && <> Próxima: {nombre(claseSiguiente)} · {horario.siguiente.inicio}.</>}</>}</p>}
        {!claseEscaneo && <label>Clase para consultar<select value={cid} onChange={e => setCid(e.target.value)}><option value="">Selecciona</option>{lc.map(x => <option key={x.id} value={x.id}>{nombre(x)}</option>)}</select></label>}
      </Card>
      <Card title="Lector continuo"><Camara disabled={!claseEscaneo} onTexto={procesar} onError={m => ban('err', 'Cámara', m)} /><p className="sub">Después de leer un código, el lector queda listo para el siguiente sin tocar botones.</p>
        <div className="fila2" style={{ marginTop: 12 }}><input disabled={!claseEscaneo} value={curp} maxLength="24" placeholder="O escribe la CURP" onChange={e => setCurp(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && procesar(curp)} style={{ marginTop: 0 }} /><button className="btn" disabled={!claseEscaneo} style={{ flex: 'none', width: 80, margin: 0 }} onClick={() => procesar(curp)}>OK</button></div>
        {claseEscaneo && <ul className="l">{grupoEscaneo.map(a => { const r = reg(a, claseEscaneo, instante.fecha); return <li key={a.curp}><span>{a.nombre}</span><span>{r?.revisionPendiente ? 'pendiente' : r?.estado === 'retardo' ? `retardo · ${r.hora}` : r?.estado === 'asistio' ? `asistió · ${r.hora}` : r?.estado === 'justificada' ? 'justificada' : r?.estado === 'falta' ? 'falta' : 'por registrar'}</span></li>; })}</ul>}
        {claseEscaneo && <button className="btn sec" type="button" disabled={!periodoPermiteAsistencia} onClick={cerrar}>Cerrar lista de la clase</button>}
      </Card>
      {pendientesRevisar > 0 && <Card title={`Pendientes de revisión · ${pendientesRevisar}`}><ul className="l">{pendientes.map(p => <li key={`${p.tipo}:${p.uid}`}><span><b>{p.tipo === 'cierre' ? 'Cierre de lista' : p.alumnoNombre}</b><br />{p.materia} · {p.semestre} {p.area} {p.grupo}<br />{fmtF(p.fecha)} · recibido {new Date(p.recibido).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span><span><button className="mini" disabled={!navigator.onLine || SD.session()?.offline} onClick={() => resolver(p, 'confirmar')}>Confirmar</button><button className="mini" disabled={!navigator.onLine || SD.session()?.offline} onClick={() => resolver(p, 'rechazar')}>Rechazar</button></span></li>)}</ul></Card>}
    </PanelEmergente>
    <PanelEmergente abierto={panel === 'revisar'} titulo="Revisar asistencias" onCerrar={() => setPanel('')}>
      <Banner b={b} />
      <Card title="Materia y grupo"><label>Asignatura<select value={claseRevision?.id || ''} onChange={e => setCid(e.target.value)}><option value="">Selecciona una materia</option>{[...new Set(lc.map(x => x.materia))].sort().map(m => <optgroup key={m} label={m}>{lc.filter(x => x.materia === m).sort((a, b) => `${a.semestre}${a.area}${a.grupo}`.localeCompare(`${b.semestre}${b.area}${b.grupo}`)).map(x => <option key={x.id} value={x.id}>{x.area} · {x.semestre} · Grupo {x.grupo}</option>)}</optgroup>)}</select></label><label>Fecha<input type="date" value={fechaRevision} onChange={e => setFechaRevision(e.target.value)} /></label>{claseRevision && <p className="sub">{nombre(claseRevision)} · asistencias registradas: {asistieron} de {grupoRevision.length}</p>}</Card>
      <Card title="Lista del grupo">{grupoRevision.length ? <ul className="l">{grupoRevision.map(a => { const r = reg(a, claseRevision); const estado = r?.estado === 'retardo' ? `Retardo · ${r.hora}` : r?.estado === 'asistio' ? `Asistió · ${r.hora}` : r?.estado === 'justificada' ? 'Justificada' : r?.estado === 'falta' ? 'Falta' : 'Sin registro'; return <li key={a.curp}><span><b>{a.nombre}</b><br /><small>{estado}{r?.revisionPendiente ? ' · pendiente' : ''}</small></span><span><button className="mini" disabled={!claseRevision || r?.pendiente || r?.revisionPendiente || !navigator.onLine} onClick={() => editar(a, 'asistio')}>Asistió</button><button className="mini" disabled={!claseRevision || r?.pendiente || r?.revisionPendiente || !navigator.onLine} onClick={() => editar(a, 'falta')}>Falta</button>{r?.estado === 'falta' && <button className="mini" disabled={!navigator.onLine} onClick={() => corregir(r.uid)}>Justificar</button>}</span></li>; })}</ul> : <p className="vacio">{claseRevision ? 'No hay alumnos en este grupo.' : 'No tienes materias asignadas.'}</p>}</Card>
    </PanelEmergente>
  </>;
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
