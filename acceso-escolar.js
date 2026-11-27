const { fechaHoraMexico } = require('./client/src/asistencia-reglas');

const ESPERA_ACCESO_MIN = 10;
const ESPERA_SALIDA_MIN = 30;
const tipoAccesoValido = tipo => tipo === 'entrada' || tipo === 'salida';
const esMismoAcceso = (anterior, { curp, tipo }) => !!anterior && anterior.curp === curp && anterior.tipo === tipo;

function decidirAcceso(ultimoRegistroDeHoy, ahora, tipoSolicitado) {
  if (!tipoAccesoValido(tipoSolicitado)) return { estado: 'tipo-invalido' };
  const esperado = ultimoRegistroDeHoy
    ? (ultimoRegistroDeHoy.tipo === 'entrada' ? 'salida' : 'entrada')
    : 'entrada';
  if (ultimoRegistroDeHoy) {
    const creado = new Date(ultimoRegistroDeHoy.creado).getTime();
    const transcurrido = ahora.getTime() - creado;
    if (!Number.isFinite(creado) || transcurrido < 0) return { estado: 'hora-invalida' };
    const esperaMinutos = ultimoRegistroDeHoy.tipo === 'entrada' ? ESPERA_SALIDA_MIN : ESPERA_ACCESO_MIN;
    const esperaRestante = esperaMinutos * 60e3 - transcurrido;
    if (esperaRestante > 0) return {
      estado: 'espera',
      esperado,
      minutosRestantes: Math.ceil(esperaRestante / 60e3),
      ultimo: ultimoRegistroDeHoy
    };
  }
  if (tipoSolicitado !== esperado) return { estado: 'tipo-incorrecto', esperado };
  return { estado: 'registrar', tipo: esperado };
}

function crearRegistroAcceso({ uid, curp, alumno, tipo, actor, creado = new Date() }) {
  if (!tipoAccesoValido(tipo)) throw new TypeError('Tipo de acceso inválido');
  const momento = fechaHoraMexico(creado);
  return {
    _id: uid,
    uid,
    curp,
    alumno: alumno.nombre,
    semestre: alumno.semestre || '',
    area: alumno.area || '',
    grupo: alumno.grupo || '',
    tipo,
    fecha: momento.fecha,
    hora: momento.hora,
    creado,
    registradoPor: actor.id,
    registradoPorNombre: actor.nombre || 'Portero',
    registradoPorArea: actor.adminArea
  };
}

module.exports = { ESPERA_ACCESO_MIN, ESPERA_SALIDA_MIN, tipoAccesoValido, esMismoAcceso, decidirAcceso, crearRegistroAcceso };
