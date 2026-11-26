const test = require('node:test');
const assert = require('node:assert/strict');
const { fechaValida, validarPeriodo, estadoPeriodo, eventosAutomaticosPeriodo } = require('../periodos-reglas');

const periodoEjemplo = () => ({
  ciclo: '2025-2026',
  inicioClases: '2025-08-01',
  finClases: '2026-06-30',
  parciales: [
    { n: 1, inicio: '2025-08-01', fin: '2025-11-30', califAbre: '2025-10-01', califCierra: '2025-11-30' },
    { n: 2, inicio: '2025-12-01', fin: '2026-03-31', califAbre: '2026-02-01', califCierra: '2026-03-31' },
    { n: 3, inicio: '2026-04-01', fin: '2026-06-30', califAbre: '2026-05-01', califCierra: '2026-06-30' }
  ],
  diasSinClase: [{ fecha: '2025-09-16', motivo: 'Suspensión oficial' }]
});

test('valida fechas calendario reales y configuración completa del ciclo', () => {
  assert.equal(fechaValida('2025-02-28'), true);
  assert.equal(fechaValida('2025-02-29'), false);
  assert.equal(validarPeriodo(periodoEjemplo()), '');
  const invalido = periodoEjemplo();
  invalido.parciales[1].inicio = '2025-11-30';
  assert.match(validarPeriodo(invalido), /traslaparse/);
  const malformado = periodoEjemplo();
  malformado.parciales[1] = null;
  assert.match(validarPeriodo(malformado), /parcial 2/);
  const diaDuplicado = periodoEjemplo();
  diaDuplicado.diasSinClase.push({ fecha: '2025-09-16', motivo: 'Otro motivo' });
  assert.match(validarPeriodo(diaDuplicado), /No repitas fechas/);
});

test('calcula ciclo, día sin clases y ventana de captura en sus límites', () => {
  const periodo = periodoEjemplo();
  assert.equal(estadoPeriodo(periodo, '2025-07-31').mensaje, 'Aún no inician las clases.');
  assert.equal(estadoPeriodo(periodo, '2025-09-16').enCiclo, false);
  assert.equal(estadoPeriodo(periodo, '2025-09-16').mensaje, 'No hay clases: Suspensión oficial');
  assert.equal(estadoPeriodo(periodo, '2025-10-01').parciales[0].califAbierta, true);
  assert.equal(estadoPeriodo(periodo, '2025-12-01').parciales[0].califAbierta, false);
  assert.equal(estadoPeriodo(periodo, '2025-11-30').parciales[1].habilitado, false);
  assert.equal(estadoPeriodo(periodo, '2025-12-01').parciales[1].habilitado, true);
  assert.equal(estadoPeriodo(periodo, '2025-12-01').parciales[0].califPublicada, true);
  assert.equal(estadoPeriodo(periodo, '2026-07-01').parciales[2].estado, 'cerrado');
});

test('el estado manual persistente prevalece sobre las fechas automáticas', () => {
  const periodo = periodoEjemplo();
  periodo.parciales[0].manualEstado = 'cerrado';
  periodo.parciales[1].manualEstado = 'abierto';
  const estado = estadoPeriodo(periodo, '2025-09-01');
  assert.equal(estado.parciales[0].estado, 'cerrado');
  assert.equal(estado.parciales[0].estadoManual, true);
  assert.equal(estado.parciales[1].estado, 'proximo');
  assert.equal(estado.parciales[1].habilitado, false);
});

test('genera eventos automáticos deterministas en la fecha de cambio y omite overrides manuales', () => {
  const periodo = periodoEjemplo();
  periodo.parciales[0].manualEstado = 'abierto';
  assert.deepEqual(eventosAutomaticosPeriodo(periodo, '2025-08-01'), []);
  const eventos = eventosAutomaticosPeriodo(periodo, '2025-12-01');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estado, 'abierto');
  assert.equal(eventos[0].id, 'auto:2025-2026:2:abierto:2025-12-01');
  assert.equal(eventosAutomaticosPeriodo(periodo, '2025-12-02').length, 0);
  const cambio = eventosAutomaticosPeriodo(periodo, '2026-04-01');
  assert.deepEqual(cambio.map(x => [x.parcial.n, x.estado]), [[2, 'cerrado'], [3, 'abierto']]);
});
