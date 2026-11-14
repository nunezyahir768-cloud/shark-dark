const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { crearTicketOffline, obtenerClavePublicaOffline } = require('../offline-auth');

const secretoPrueba = 'solo-para-pruebas-no-usar-en-produccion';
const usuario = { id: 'CURP-DE-PRUEBA', rol: 'admin', nombre: 'Cuenta de prueba' };

test('el ticket offline es verificable con la clave pública', () => {
  const ticket = crearTicketOffline(secretoPrueba, usuario, 123, 1000);
  const [payload, firma] = ticket.split('.');
  const publica = crypto.createPublicKey({ key: Buffer.from(obtenerClavePublicaOffline(secretoPrueba), 'base64url'), format: 'der', type: 'spki' });
  assert.equal(crypto.verify(null, Buffer.from(payload), publica, Buffer.from(firma, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.rol, 'admin');
  assert.equal(claims.sub, usuario.id);
  assert.equal(claims.pwdAt, 123);
  assert.equal(claims.exp - claims.iat, 24 * 3600e3);
});

test('la firma invalida un cambio local del rol o usuario', () => {
  const ticket = crearTicketOffline(secretoPrueba, usuario, 0, 1000);
  const [payload, firma] = ticket.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  claims.rol = 'docente'; claims.usuario.rol = 'docente'; claims.sub = 'OTRA-CURP';
  const alterado = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const publica = crypto.createPublicKey({ key: Buffer.from(obtenerClavePublicaOffline(secretoPrueba), 'base64url'), format: 'der', type: 'spki' });
  assert.equal(crypto.verify(null, Buffer.from(alterado), publica, Buffer.from(firma, 'base64url')), false);
});

test('un secreto distinto produce una clave pública distinta', () => {
  assert.notEqual(obtenerClavePublicaOffline(secretoPrueba), obtenerClavePublicaOffline('otro-secreto'));
});
