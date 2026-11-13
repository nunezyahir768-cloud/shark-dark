import { useState, useEffect, useCallback } from 'react';
import SD from './sd.js';
import { Card, Hero, Banner, useBanner, post, msgErr } from './ui.jsx';

const grupoAlumno = a => [a.semestre, a.area, a.grupo && `Grupo ${a.grupo}`].filter(Boolean).join(' · ');

export default function ReportesConducta() {
  const ses = SD.session() || {}, rol = ses.rol;
  const puedeCrear = rol === 'docente' || rol === 'admin';
  const [alumnos, setAlumnos] = useState([]);
  const [reportes, setReportes] = useState(null);
  const [error, setError] = useState('');
  const [b, ban] = useBanner();
  const [form, setForm] = useState({ curp: '', lugar: '', descripcion: '', seguimiento: '' });
  const [formAbierto, setFormAbierto] = useState(rol !== 'admin');
  const [guardando, setGuardando] = useState(false);
  const formularioCompleto = Boolean(form.curp && form.lugar.trim() && form.descripcion.trim());

  const cargar = useCallback(async () => {
    setError('');
    try {
      const lista = await SD.api('/api/reportes-conducta');
      setReportes(lista);
      if (puedeCrear) setAlumnos(await SD.api('/api/reportes-conducta/alumnos'));
    } catch (e) {
      setError(e.message || 'No se pudieron cargar los reportes.');
    }
  }, [puedeCrear]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      await post('/api/reportes-conducta', form);
      setForm({ curp: '', lugar: '', descripcion: '', seguimiento: '' });
      if (rol === 'admin') setFormAbierto(false);
      ban('ok', 'Reporte guardado', rol === 'admin' ? 'Quedó confirmado.' : 'La solicitud se envió a administración para confirmar su recepción.');
      await cargar();
    } catch (er) {
      ban('err', 'No se pudo guardar el reporte', msgErr(er));
    } finally {
      setGuardando(false);
    }
  }

  async function aceptar(id) {
    try {
      await post(`/api/reportes-conducta/${encodeURIComponent(id)}/aceptar`);
      ban('ok', 'Reporte aceptado', 'Se confirmó la recepción del reporte.');
      await cargar();
    } catch (er) {
      ban('err', 'No se pudo aceptar el reporte', msgErr(er));
    }
  }

  const pendientes = (reportes || []).filter(r => r.estado === 'pendiente');
  const titulo = rol === 'alumno' ? 'Reportes sobre ti' : rol === 'tutor' ? 'Reportes de tus alumnos' : 'Reportes de conducta';
  const vacio = rol === 'alumno' ? 'No hay reportes sobre ti.' : rol === 'tutor' ? 'No hay reportes de tus alumnos vinculados.' : 'Aún no hay reportes de conducta.';

  return <>
    <Hero titulo={titulo} sub={rol === 'admin' ? 'Registra reportes y confirma las solicitudes recibidas.' : rol === 'docente' ? 'Registra un reporte de conducta de un alumno de tus grupos y revisa su estado.' : 'Aquí puedes consultar los reportes que te corresponden.'} />
    <Banner b={b} />
    {error && <p className="msg" role="alert">{error}</p>}

    {puedeCrear && <Card className="reporte-panel" title={rol === 'admin' ? 'Nuevo reporte' : 'Registrar reporte de conducta'}>
      {rol === 'admin' && !formAbierto && <button className="btn reporte-accion" type="button" onClick={() => setFormAbierto(true)}>HACER UN REPORTE</button>}
      {formAbierto && <form className="reporte-form" onSubmit={crear}>
        <label htmlFor="reporte-alumno">Alumno</label>
        <select id="reporte-alumno" value={form.curp} onChange={e => setForm({ ...form, curp: e.target.value })} required>
          <option value="">Selecciona un alumno</option>
          {alumnos.map(a => <option key={a.curp} value={a.curp}>{a.nombre} · {grupoAlumno(a)}</option>)}
        </select>
        <label htmlFor="reporte-lugar">Lugar donde ocurrió</label>
        <input id="reporte-lugar" value={form.lugar} onChange={e => setForm({ ...form, lugar: e.target.value })} maxLength="120" required />
        <label htmlFor="reporte-descripcion">Descripción de lo ocurrido</label>
        <textarea id="reporte-descripcion" rows="4" value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} maxLength="1500" required />
        <label htmlFor="reporte-seguimiento">Acción o seguimiento (opcional)</label>
        <textarea id="reporte-seguimiento" rows="3" value={form.seguimiento} onChange={e => setForm({ ...form, seguimiento: e.target.value })} maxLength="500" />
        <p className="sub">La fecha, hora y nombre de quien registra se guardan automáticamente.</p>
        <button className="btn reporte-accion" type="submit" disabled={guardando || (rol === 'admin' && !formularioCompleto)}>{guardando ? 'GUARDANDO…' : rol === 'admin' ? 'CONFIRMAR REPORTE' : 'GUARDAR REPORTE'}</button>
        {rol === 'admin' && <button className="btn sec reporte-accion" type="button" disabled={guardando} onClick={() => { setForm({ curp: '', lugar: '', descripcion: '', seguimiento: '' }); setFormAbierto(false); }}>CANCELAR</button>}
      </form>}
    </Card>}

    {rol === 'admin' && pendientes.length > 0 && (
      <div className="banner warn" role="status" aria-live="polite">
        <b>Solicitud de reporte</b>
        {pendientes.length === 1 ? 'Hay 1 reporte pendiente de confirmar.' : `Hay ${pendientes.length} reportes pendientes de confirmar.`}
      </div>
    )}

    {reportes && reportes.map(r => {
      const pendiente = r.estado === 'pendiente';
      return <Card className="reporte-item" key={r.id} title={rol === 'admin' && pendiente ? 'Solicitud de reporte' : `Reporte de conducta · ${r.alumno}`}>
        <p><b>Alumno:</b> {r.alumno} · {grupoAlumno(r)}</p>
        <p><b>Lugar:</b> {r.lugar}</p>
        <p><b>Descripción:</b> {r.descripcion}</p>
        {r.seguimiento && <p><b>Acción o seguimiento:</b> {r.seguimiento}</p>}
        <p className="sub">Registrado por {r.reportante} · {new Date(r.creado).toLocaleString('es-MX')}</p>
        <p><span className={'tag ' + (pendiente ? '' : 'ok')}>{pendiente ? 'Pendiente de confirmación' : 'Recepción confirmada'}</span></p>
        {r.confirmadoEn && <p className="sub">Recibido por {r.confirmadoNombre} · {new Date(r.confirmadoEn).toLocaleString('es-MX')}</p>}
        {rol === 'admin' && pendiente && <button className="btn reporte-accion" type="button" onClick={() => aceptar(r.id)}>ACEPTAR REPORTE</button>}
      </Card>;
    })}
    {reportes && !reportes.length && <Card><p className="vacio">{vacio}</p></Card>}
  </>;
}
