import { useEffect, useState } from 'react';
import SD from './sd.js';
import { Card, Hero, Banner, useBanner, post, msgErr } from './ui.jsx';

const vacio = () => ({
  ciclo: '',
  inicioClases: '',
  finClases: '',
  parciales: [1, 2, 3].map(n => ({ n, inicio: '', fin: '', califAbre: '', califCierra: '' })),
  diasSinClase: []
});

const aFormulario = periodo => ({
  ciclo: periodo.ciclo || '',
  inicioClases: periodo.inicioClases || '',
  finClases: periodo.finClases || '',
  parciales: [1, 2, 3].map(n => {
    const p = (periodo.parciales || []).find(x => Number(x.n) === n) || {};
    return { n, inicio: p.inicio || '', fin: p.fin || '', califAbre: p.califAbre || '', califCierra: p.califCierra || '' };
  }),
  diasSinClase: (periodo.diasSinClase || []).map(d => ({ fecha: d.fecha, motivo: d.motivo }))
});

const etiquetaEstado = estado => ({ proximo: 'Próximo', 'en-curso': 'En curso', cerrado: 'Cerrado' }[estado] || 'Sin configurar');

export default function Periodos() {
  const [periodo, setPeriodo] = useState(null);
  const [form, setForm] = useState(vacio), [modificado, setModificado] = useState(false);
  const [guardando, setGuardando] = useState(false), [accionando, setAccionando] = useState(''), [b, ban] = useBanner();
  const [idsAccion, setIdsAccion] = useState({});

  async function cargar() {
    const resultado = await SD.cached('periodo', '/api/periodos');
    setPeriodo(resultado);
    return resultado;
  }

  useEffect(() => {
    if (periodo && !modificado) setForm(periodo.configurado ? aFormulario(periodo) : vacio());
  }, [periodo, modificado]);

  useEffect(() => {
    cargar().catch(e => ban('err', 'No se pudo cargar el calendario', msgErr(e)));
  }, []);

  const cambiar = actualizacion => {
    setForm(actual => ({ ...actual, ...actualizacion }));
    setModificado(true);
  };
  const cambiarParcial = (n, campo, valor) => cambiar({
    parciales: form.parciales.map(p => p.n === n ? { ...p, [campo]: valor } : p)
  });
  const cambiarDia = (i, campo, valor) => cambiar({
    diasSinClase: form.diasSinClase.map((d, indice) => indice === i ? { ...d, [campo]: valor } : d)
  });

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      await post('/api/admin/periodos', form);
      setModificado(false);
      ban('ok', 'Calendario guardado', 'La configuración queda persistida sin borrar otros ciclos escolares.');
      await cargar();
    } catch (error) {
      ban('err', 'No se pudo guardar el calendario', msgErr(error));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(parcial, estado) {
    const accion = estado === 'abierto' ? 'Abrir' : 'Cerrar';
    const texto = `${accion} ahora el parcial ${parcial.n} del ciclo ${periodo.ciclo}?`;
    if (!confirm(texto)) return;
    const clave = `${parcial.n}:${estado}`;
    const uid = idsAccion[clave] || crypto.randomUUID();
    setIdsAccion(actuales => ({ ...actuales, [clave]: uid }));
    setAccionando(clave);
    try {
      const resultado = await post(`/api/admin/periodos/${parcial.n}/estado`, {
        estado,
        uid,
        versionManual: Number(parcial.versionManual) || 0
      });
      setIdsAccion(actuales => {
        const siguientes = { ...actuales };
        delete siguientes[clave];
        return siguientes;
      });
      ban('ok', resultado.sinCambios ? 'Sin cambios' : `${accion} ahora`, resultado.sinCambios
        ? `El parcial ${parcial.n} ya tenía ese estado.`
        : 'Se guardó el cambio manual y quedó registrado en auditoría.');
      await cargar();
    } catch (error) {
      ban('err', `No se pudo ${accion.toLowerCase()} el parcial`, msgErr(error));
    } finally {
      setAccionando('');
    }
  }

  const parcialesActuales = periodo?.estado?.parciales || [];
  return <>
    <Hero titulo="Periodos escolares" sub="Configura el ciclo, los parciales y los días sin clases. Las fechas deben corresponder al calendario oficial." />
    <Banner b={b} />
    {periodo?.configurado && <Card title={`Estado actual · ${periodo.ciclo}`}>
      {!periodo.estado.enCiclo && <p className="sub" role="status">{periodo.estado.mensaje}</p>}
      {parcialesActuales.map(parcial => <div className="clase-horario" key={parcial.n}>
        <div>
          <div className="materia">Parcial {parcial.n} · {etiquetaEstado(parcial.estado)}</div>
          <div className="detalle">Periodo: {parcial.inicio} a {parcial.fin}</div>
          <div className="detalle">Captura: {parcial.califAbre} a {parcial.califCierra}</div>
          {parcial.estadoManual && <div className="detalle">Estado manual persistente: {parcial.manualEstado === 'abierto' ? 'Abierto' : 'Cerrado'}</div>}
        </div>
        <div className="fila2" style={{ maxWidth: 300, marginTop: 8 }}>
          <button className="btn sec" type="button" disabled={Boolean(accionando)} onClick={() => cambiarEstado(parcial, 'abierto')}>
            {accionando === `${parcial.n}:abierto` ? 'GUARDANDO…' : 'ABRIR AHORA'}
          </button>
          <button className="btn sec" type="button" disabled={Boolean(accionando)} onClick={() => cambiarEstado(parcial, 'cerrado')}>
            {accionando === `${parcial.n}:cerrado` ? 'GUARDANDO…' : 'CERRAR AHORA'}
          </button>
        </div>
      </div>)}
      <p className="sub">Cada cambio manual se conserva en el ciclo activo, se audita y genera un aviso idempotente para docentes.</p>
    </Card>}
    {!periodo?.configurado && periodo && <Card title="Calendario sin configurar">
      <p className="sub">{periodo.estado?.mensaje || 'El calendario no está disponible en este dispositivo.'} La asistencia permanecerá bloqueada hasta que Control Escolar registre las fechas oficiales.</p>
    </Card>}
    <form onSubmit={guardar}>
      <Card title="Ciclo escolar">
        <label>Nombre del ciclo escolar<input value={form.ciclo} maxLength="40" onChange={e => cambiar({ ciclo: e.target.value })} placeholder="Ej. 2025-2026" required /></label>
        <div className="fila2">
          <label>Inicio de clases<input type="date" value={form.inicioClases} onChange={e => cambiar({ inicioClases: e.target.value })} required /></label>
          <label>Fin de clases<input type="date" value={form.finClases} onChange={e => cambiar({ finClases: e.target.value })} required /></label>
        </div>
      </Card>
      {form.parciales.map(parcial => <Card title={`Parcial ${parcial.n}`} key={parcial.n}>
        <div className="fila2">
          <label>Inicio del parcial<input type="date" value={parcial.inicio} onChange={e => cambiarParcial(parcial.n, 'inicio', e.target.value)} required /></label>
          <label>Fin del parcial<input type="date" value={parcial.fin} onChange={e => cambiarParcial(parcial.n, 'fin', e.target.value)} required /></label>
        </div>
        <div className="fila2">
          <label>Abre captura de calificaciones<input type="date" value={parcial.califAbre} onChange={e => cambiarParcial(parcial.n, 'califAbre', e.target.value)} required /></label>
          <label>Cierra captura de calificaciones<input type="date" value={parcial.califCierra} onChange={e => cambiarParcial(parcial.n, 'califCierra', e.target.value)} required /></label>
        </div>
        <p className="sub">Fuera de la ventana se mostrará una advertencia, pero no se bloqueará la captura docente.</p>
      </Card>)}
      <Card title="Días sin clases">
        <p className="sub">La asistencia estará bloqueada en estas fechas. Agrega únicamente suspensiones confirmadas.</p>
        {form.diasSinClase.map((dia, i) => <div className="periodo-dia" key={`dia-${i}`}>
          <label>Fecha<input type="date" value={dia.fecha} onChange={e => cambiarDia(i, 'fecha', e.target.value)} required /></label>
          <label>Motivo<input value={dia.motivo} maxLength="120" onChange={e => cambiarDia(i, 'motivo', e.target.value)} placeholder="Motivo oficial" required /></label>
          <button className="btn sec" type="button" onClick={() => cambiar({ diasSinClase: form.diasSinClase.filter((_, indice) => indice !== i) })}>Quitar día</button>
        </div>)}
        <button className="btn sec" type="button" disabled={form.diasSinClase.length >= 150} onClick={() => cambiar({ diasSinClase: [...form.diasSinClase, { fecha: '', motivo: '' }] })}>AGREGAR DÍA SIN CLASES</button>
      </Card>
      <Card>
        <button className="btn" type="submit" disabled={guardando}>{guardando ? 'GUARDANDO…' : 'GUARDAR CALENDARIO'}</button>
        {modificado && <p className="sub" role="status">Hay cambios sin guardar.</p>}
      </Card>
    </form>
  </>;
}
