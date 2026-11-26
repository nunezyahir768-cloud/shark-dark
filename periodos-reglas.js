const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const NUMEROS_PARCIAL = [1, 2, 3];

function fechaValida(fecha) {
  if (!FECHA.test(String(fecha || ''))) return false;
  const date = new Date(`${fecha}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === fecha;
}

function validarPeriodo(periodo) {
  if (!periodo || typeof periodo.ciclo !== 'string' || !periodo.ciclo.trim() || periodo.ciclo.length > 40)
    return 'Escribe el nombre del ciclo escolar.';
  if (!fechaValida(periodo.inicioClases) || !fechaValida(periodo.finClases) || periodo.finClases < periodo.inicioClases)
    return 'Revisa las fechas de inicio y fin del ciclo escolar.';
  if (!Array.isArray(periodo.parciales) || periodo.parciales.length !== 3)
    return 'Configura los tres parciales.';

  const parciales = periodo.parciales.slice().sort((a, b) => Number(a?.n) - Number(b?.n));
  for (let i = 0; i < NUMEROS_PARCIAL.length; i++) {
    const parcial = parciales[i];
    if (!parcial || typeof parcial !== 'object' || Number(parcial.n) !== NUMEROS_PARCIAL[i]
      || !fechaValida(parcial.inicio) || !fechaValida(parcial.fin) || parcial.fin < parcial.inicio
      || !fechaValida(parcial.califAbre) || !fechaValida(parcial.califCierra) || parcial.califCierra < parcial.califAbre)
      return `Revisa las fechas del parcial ${NUMEROS_PARCIAL[i]}.`;
    if (parcial.inicio < periodo.inicioClases || parcial.fin > periodo.finClases
      || parcial.califAbre < periodo.inicioClases || parcial.califCierra > periodo.finClases)
      return `Las fechas del parcial ${NUMEROS_PARCIAL[i]} deben quedar dentro del ciclo escolar.`;
    if (i && parcial.inicio <= parciales[i - 1].fin)
      return 'Las fechas de los parciales no pueden traslaparse.';
  }

  if (!Array.isArray(periodo.diasSinClase) || periodo.diasSinClase.length > 150)
    return 'La lista de días sin clases no es válida.';
  const dias = new Set();
  for (const dia of periodo.diasSinClase) {
    if (!dia || typeof dia !== 'object' || !fechaValida(dia.fecha) || dia.fecha < periodo.inicioClases || dia.fecha > periodo.finClases
      || !String(dia.motivo || '').trim() || String(dia.motivo).length > 120)
      return 'Revisa la fecha y el motivo de cada día sin clases.';
    if (dias.has(dia.fecha)) return 'No repitas fechas en los días sin clases.';
    dias.add(dia.fecha);
  }
  return '';
}

function estadoPeriodo(periodo, fecha) {
  const error = validarPeriodo(periodo);
  if (error || !fechaValida(fecha)) return {
    configurado: false,
    enCiclo: false,
    mensaje: error || 'No se pudo determinar la fecha escolar.'
  };
  const diaSinClase = periodo.diasSinClase.find(d => d.fecha === fecha);
  const enCiclo = fecha >= periodo.inicioClases && fecha <= periodo.finClases && !diaSinClase;
  const mensaje = fecha < periodo.inicioClases
    ? 'Aún no inician las clases.'
    : fecha > periodo.finClases
      ? 'El ciclo escolar ya terminó.'
      : diaSinClase
        ? `No hay clases: ${diaSinClase.motivo}`
        : '';
  const parciales = periodo.parciales.map(parcial => {
    const automatico = fecha < parcial.inicio ? 'proximo' : fecha <= parcial.fin ? 'en-curso' : 'cerrado';
    const estado = parcial.manualEstado === 'abierto' ? 'en-curso'
      : parcial.manualEstado === 'cerrado' ? 'cerrado' : automatico;
    return {
      n: Number(parcial.n),
      inicio: parcial.inicio,
      fin: parcial.fin,
      califAbre: parcial.califAbre,
      califCierra: parcial.califCierra,
      ...(parcial.manualEstado ? { manualEstado: parcial.manualEstado } : {}),
      versionManual: Number(parcial.versionManual) || 0,
      estado,
      estadoManual: Boolean(parcial.manualEstado),
      califAbierta: fecha >= parcial.califAbre && fecha <= parcial.califCierra
    };
  });
  return { configurado: true, ciclo: periodo.ciclo, fecha, enCiclo, mensaje, parciales };
}

function diaSiguiente(fecha) {
  const date = new Date(`${fecha}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function eventosAutomaticosPeriodo(periodo, fecha) {
  if (validarPeriodo(periodo)) return [];
  return periodo.parciales.flatMap(parcial => {
    if (parcial.manualEstado) return [];
    if (parcial.inicio === fecha) return [{ parcial, estado: 'abierto', id: `auto:${periodo.ciclo}:${parcial.n}:abierto:${fecha}` }];
    if (diaSiguiente(parcial.fin) === fecha) return [{ parcial, estado: 'cerrado', id: `auto:${periodo.ciclo}:${parcial.n}:cerrado:${parcial.fin}` }];
    return [];
  });
}

module.exports = { fechaValida, validarPeriodo, estadoPeriodo, eventosAutomaticosPeriodo };
