const ZONA_ESCOLAR = 'America/Mexico_City';
const TOLERANCIA_ASISTENCIA_MIN = 5;
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function fechaHoraMexico(ahora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_ESCOLAR,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(ahora).map(p => [p.type, p.value]));
  const hora = `${partes.hour}:${partes.minute}`;
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora,
    dia: DIAS[partes.weekday],
    minuto: Number(partes.hour) * 60 + Number(partes.minute)
  };
}

function minutosDeHora(hora) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(hora || ''))) return null;
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

function dentroVentanaAsistencia(bloque, minuto, tolerancia = TOLERANCIA_ASISTENCIA_MIN) {
  const inicio = minutosDeHora(bloque?.inicio), fin = minutosDeHora(bloque?.fin);
  return Number.isInteger(minuto) && inicio !== null && fin !== null && fin > inicio
    && minuto >= inicio - tolerancia && minuto <= fin;
}

function estadoAsistenciaHorario(bloques, instante = new Date()) {
  const momento = instante && Number.isInteger(instante.minuto) ? instante : fechaHoraMexico(instante);
  const clases = (bloques || []).filter(b => b.dia === momento.dia && b.tipo !== 'descanso')
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const actual = clases.find(b => dentroVentanaAsistencia(b, momento.minuto)) || null;
  const siguiente = clases.find(b => minutosDeHora(b.inicio) - TOLERANCIA_ASISTENCIA_MIN > momento.minuto) || null;
  return { ...momento, clases, actual, siguiente };
}

function decidirRegistroAsistencia({ bloquesActuales, momento, autorizacion, docenteId, claseId, fechaDeclarada, horaDeclarada, ahoraMs = Date.now() }) {
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(String(autorizacion?.fecha || ''));
  const bloques = Array.isArray(autorizacion?.bloques) ? autorizacion.bloques : [];
  const bloqueDeclarado = bloques.find(b => dentroVentanaAsistencia(b, minutosDeHora(horaDeclarada)));
  const autorizacionValida = autorizacion?.tipo === 'asistencia-offline'
    && autorizacion.docente === docenteId
    && autorizacion.claseId === claseId
    && fechaValida
    && autorizacion.fecha === fechaDeclarada
    && autorizacion.fecha <= momento.fecha
    && Number.isFinite(autorizacion.exp)
    && autorizacion.exp > ahoraMs
    && bloqueDeclarado;
  if (autorizacionValida && autorizacion.fecha !== momento.fecha)
    return { estado: 'revision', fecha: autorizacion.fecha, horaDeclarada, bloque: bloqueDeclarado };

  const bloqueActual = (bloquesActuales || []).find(b => b.dia === momento.dia && dentroVentanaAsistencia(b, momento.minuto));
  if (bloqueActual) return { estado: 'confirmada', fecha: momento.fecha, hora: momento.hora, bloque: bloqueActual };
  if (autorizacionValida) return { estado: 'revision', fecha: autorizacion.fecha, horaDeclarada, bloque: bloqueDeclarado };
  return null;
}

function validarAutorizacionCierre(autorizacion, { docenteId, claseId, fechaDeclarada, fechaActual, ahoraMs = Date.now() }) {
  return autorizacion?.tipo === 'asistencia-offline'
    && autorizacion.docente === docenteId
    && autorizacion.claseId === claseId
    && /^\d{4}-\d{2}-\d{2}$/.test(String(autorizacion.fecha || ''))
    && autorizacion.fecha === fechaDeclarada
    && autorizacion.fecha <= fechaActual
    && Number.isFinite(autorizacion.exp)
    && autorizacion.exp > ahoraMs
    && Array.isArray(autorizacion.bloques)
    && autorizacion.bloques.some(b => minutosDeHora(b.inicio) !== null && minutosDeHora(b.fin) > minutosDeHora(b.inicio));
}

module.exports = {
  ZONA_ESCOLAR,
  TOLERANCIA_ASISTENCIA_MIN,
  fechaHoraMexico,
  minutosDeHora,
  dentroVentanaAsistencia,
  estadoAsistenciaHorario,
  decidirRegistroAsistencia,
  validarAutorizacionCierre
};
