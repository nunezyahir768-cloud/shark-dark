const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOLERANCIA_ASISTENCIA_MIN,
  fechaHoraMexico,
  dentroVentanaAsistencia,
  estadoAsistenciaHorario,
  decidirRegistroAsistencia,
  validarAutorizacionCierre
} = require('../client/src/asistencia-reglas');

const bloque = { dia: 1, inicio: '08:40', fin: '09:30', tipo: 'clase' };

test('la ventana de asistencia acepta diez minutos antes y hasta el fin del bloque', () => {
  assert.equal(TOLERANCIA_ASISTENCIA_MIN, 10);
  assert.equal(dentroVentanaAsistencia(bloque, 509), false);
  assert.equal(dentroVentanaAsistencia(bloque, 510), true);
  assert.equal(dentroVentanaAsistencia(bloque, 570), true);
  assert.equal(dentroVentanaAsistencia(bloque, 571), false);
});

test('la fecha escolar usa America/Mexico_City aunque UTC ya cambió de día', () => {
  assert.deepEqual(fechaHoraMexico(new Date('2025-01-15T05:30:00.000Z')), {
    fecha: '2025-01-14',
    hora: '23:30',
    dia: 2,
    minuto: 1410
  });
});

test('solo muestra la clase dentro de tolerancia y la siguiente cuando corresponde', () => {
  const siguiente = estadoAsistenciaHorario([bloque], { fecha: '2025-01-13', hora: '08:29', dia: 1, minuto: 509 });
  assert.equal(siguiente.actual, null);
  assert.equal(siguiente.siguiente, bloque);
  const actual = estadoAsistenciaHorario([bloque], { fecha: '2025-01-13', hora: '08:30', dia: 1, minuto: 510 });
  assert.equal(actual.actual, bloque);
  assert.equal(actual.siguiente, null);
});

test('la hora del servidor decide la asistencia en línea y una autorización no la confirma fuera de horario', () => {
  const actual = decidirRegistroAsistencia({
    bloquesActuales: [bloque],
    momento: { fecha: '2025-01-13', hora: '08:30', dia: 1, minuto: 510 },
    fechaDeclarada: '1999-01-01',
    horaDeclarada: '00:01',
    docenteId: 'DOCENTE-1',
    claseId: 'CLASE-1'
  });
  assert.equal(actual.estado, 'confirmada');
  assert.equal(actual.fecha, '2025-01-13');
  assert.equal(actual.hora, '08:30');
  assert.equal(decidirRegistroAsistencia({
    bloquesActuales: [],
    momento: { fecha: '2025-01-14', hora: '12:00', dia: 2, minuto: 720 },
    fechaDeclarada: '2025-01-13',
    horaDeclarada: '08:35',
    docenteId: 'DOCENTE-1',
    claseId: 'CLASE-1'
  }), null);
});

test('una autorización offline permite crear solo un registro pendiente para su docente, clase y fecha', () => {
  const autorizacion = {
    tipo: 'asistencia-offline',
    docente: 'DOCENTE-1',
    claseId: 'CLASE-1',
    fecha: '2025-01-13',
    bloques: [{ inicio: '08:40', fin: '09:30' }],
    exp: 2000
  };
  const base = {
    bloquesActuales: [],
    momento: { fecha: '2025-01-14', hora: '12:00', dia: 2, minuto: 720 },
    autorizacion,
    docenteId: 'DOCENTE-1',
    claseId: 'CLASE-1',
    fechaDeclarada: '2025-01-13',
    horaDeclarada: '08:35',
    ahoraMs: 1000
  };
  assert.equal(decidirRegistroAsistencia(base).estado, 'revision');
  const reenviadaAlDiaSiguiente = decidirRegistroAsistencia({
    ...base,
    bloquesActuales: [{ ...bloque, dia: 2 }],
    momento: { fecha: '2025-01-14', hora: '08:30', dia: 2, minuto: 510 }
  });
  assert.equal(reenviadaAlDiaSiguiente.estado, 'revision');
  assert.equal(reenviadaAlDiaSiguiente.fecha, autorizacion.fecha);
  assert.equal(decidirRegistroAsistencia({ ...base, docenteId: 'OTRO' }), null);
  assert.equal(decidirRegistroAsistencia({ ...base, fechaDeclarada: '2025-01-14' }), null);
  assert.equal(decidirRegistroAsistencia({ ...base, horaDeclarada: '10:00' }), null);
  assert.equal(decidirRegistroAsistencia({ ...base, ahoraMs: 2000 }), null);
});

test('un cierre offline requiere una autorización vigente del docente, clase y fecha', () => {
  const autorizacion = {
    tipo: 'asistencia-offline',
    docente: 'DOCENTE-1',
    claseId: 'CLASE-1',
    fecha: '2025-01-13',
    bloques: [{ inicio: '08:40', fin: '09:30' }],
    exp: 2000
  };
  const base = {
    docenteId: 'DOCENTE-1',
    claseId: 'CLASE-1',
    fechaDeclarada: '2025-01-13',
    fechaActual: '2025-01-14',
    ahoraMs: 1000
  };
  assert.equal(validarAutorizacionCierre(autorizacion, base), true);
  assert.equal(validarAutorizacionCierre(autorizacion, { ...base, claseId: 'OTRA' }), false);
  assert.equal(validarAutorizacionCierre(autorizacion, { ...base, fechaDeclarada: '2025-01-14' }), false);
  assert.equal(validarAutorizacionCierre({ ...autorizacion, exp: 1000 }, base), false);
});
