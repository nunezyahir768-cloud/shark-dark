const crypto = require('node:crypto');

const prefijoPKCS8Ed25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

function clavePrivada(secret) {
  if (!secret) throw new Error('TOKEN_SECRET no está configurado');
  const seed = crypto.createHash('sha256').update('SHARK-DARK-OFFLINE-V1\0' + secret).digest();
  return crypto.createPrivateKey({ key: Buffer.concat([prefijoPKCS8Ed25519, seed]), format: 'der', type: 'pkcs8' });
}

function obtenerClavePublicaOffline(secret) {
  return crypto.createPublicKey(clavePrivada(secret)).export({ format: 'der', type: 'spki' }).toString('base64url');
}

function crearTicketOffline(secret, usuario, pwdAt = 0, ahora = Date.now()) {
  const claims = { v: 1, sub: usuario.id, rol: usuario.rol, pwdAt, iat: ahora, exp: ahora + 24 * 3600e3, usuario };
  const cuerpo = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const firma = crypto.sign(null, Buffer.from(cuerpo), clavePrivada(secret)).toString('base64url');
  return `${cuerpo}.${firma}`;
}

module.exports = { crearTicketOffline, obtenerClavePublicaOffline };
