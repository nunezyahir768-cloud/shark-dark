const test = require('node:test');
const assert = require('node:assert/strict');
const { ESPERA_ACCESO_MIN, tipoAccesoValido, esMismoAcceso, decidirAcceso, crearRegistroAcceso } = require('../acceso-escolar');

test('solo acepta eventos explícitos de entrada o salida', () => {
  assert.equal(tipoAccesoValido('entrada'), true);
  assert.equal(tipoAccesoValido('salida'), true);
  assert.equal(tipoAccesoValido('llegada'), false);
  assert.equal(tipoAccesoValido(''), false);
});

test('crea el registro con hora escolar y actor del servidor', () => {
  const creado = new Date('2025-01-01T05:05:00.000Z');
  const registro = crearRegistroAcceso({
    uid: 'evento-1',
    curp: 'ABCD123456HDFXYZ01',
    alumno: { nombre: 'Alumna Ejemplo', semestre: '2', area: 'Electrónica', grupo: 'A' },
    tipo: 'entrada',
    actor: { id: 'CONTROL_ESCOLAR', nombre: 'Portero', adminArea: 'portero' },
    fecha: '2099-12-31',
    hora: '12:00',
    creado
  });

  assert.equal(registro._id, 'evento-1');
  assert.equal(registro.tipo, 'entrada');
  assert.equal(registro.fecha, '2024-12-31');
  assert.equal(registro.hora, '23:05');
  assert.equal(registro.creado, creado);
  assert.equal(registro.registradoPorArea, 'portero');
  assert.equal(Object.hasOwn(registro, 'horaCliente'), false);
});

test('rechaza tipos de evento desconocidos al construir registros', () => {
  assert.throws(() => crearRegistroAcceso({
    uid: 'evento-2',
    curp: 'ABCD123456HDFXYZ01',
    alumno: { nombre: 'Alumno' },
    tipo: 'desconocido',
    actor: { id: 'CONTROL_ESCOLAR' }
  }), /Tipo de acceso inválido/);
});

test('solo considera idempotente un reintento con el mismo alumno y tipo', () => {
  const anterior = { _id: 'evento-3', curp: 'ABCD123456HDFXYZ01', tipo: 'salida' };
  assert.equal(esMismoAcceso(anterior, { curp: anterior.curp, tipo: 'salida' }), true);
  assert.equal(esMismoAcceso(anterior, { curp: anterior.curp, tipo: 'entrada' }), false);
  assert.equal(esMismoAcceso(anterior, { curp: 'EFGH123456HDFXYZ01', tipo: 'salida' }), false);
  assert.equal(esMismoAcceso(null, { curp: anterior.curp, tipo: 'salida' }), false);
});

test('sin registros solo permite la entrada y respeta el orden manual de eventos', () => {
  const ahora = new Date('2025-02-01T14:00:00.000Z');
  assert.deepEqual(decidirAcceso(null, ahora, 'entrada'), { estado: 'registrar', tipo: 'entrada' });
  assert.deepEqual(decidirAcceso(null, ahora, 'salida'), { estado: 'tipo-incorrecto', esperado: 'entrada' });
});

test('bloquea un nuevo evento antes de diez minutos y permite la salida al cumplirlos', () => {
  const ahora = new Date('2025-02-01T14:00:00.000Z');
  const ultimo = { tipo: 'entrada', hora: '08:00', creado: new Date(ahora.getTime() - (ESPERA_ACCESO_MIN * 60e3 - 1000)) };
  assert.deepEqual(decidirAcceso(ultimo, ahora, 'salida'), {
    estado: 'espera',
    esperado: 'salida',
    minutosRestantes: 1,
    ultimo
  });
  ultimo.creado = new Date(ahora.getTime() - ESPERA_ACCESO_MIN * 60e3);
  assert.deepEqual(decidirAcceso(ultimo, ahora, 'salida'), { estado: 'registrar', tipo: 'salida' });
});

test('después de una salida permite regresar con una nueva entrada tras la espera', () => {
  const ahora = new Date('2025-02-01T14:00:00.000Z');
  const ultimo = { tipo: 'salida', hora: '08:10', creado: new Date(ahora.getTime() - (ESPERA_ACCESO_MIN + 1) * 60e3) };
  assert.deepEqual(decidirAcceso(ultimo, ahora, 'entrada'), { estado: 'registrar', tipo: 'entrada' });
  assert.deepEqual(decidirAcceso(ultimo, ahora, 'salida'), { estado: 'tipo-incorrecto', esperado: 'entrada' });
});
