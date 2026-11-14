const PUBLIC_KEY = process.env.OFFLINE_PUBLIC_KEY || '';
const ITERACIONES = 310000;
export const offlineDisponible = !!PUBLIC_KEY && typeof crypto !== 'undefined' && !!crypto.subtle;
const utf8 = new TextEncoder();
const b64url = s => {
  const bytes = new Uint8Array(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const desdeB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

export function nuevaSal() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return b64url(b);
}

export async function derivarClave(password, salt) {
  const material = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: desdeB64url(salt), iterations: ITERACIONES, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function cifrar(valor, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(valor)));
  return { iv: b64url(iv), ciphertext: b64url(cifrado) };
}

export async function descifrar(registro, key) {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64url(registro.iv) }, key, desdeB64url(registro.ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function validarTicket(ticket) {
  if (!PUBLIC_KEY || !ticket) throw new Error('Esta instalación todavía no tiene habilitada la validación offline.');
  if (!crypto.subtle) throw new Error('Este navegador no admite la verificación criptográfica requerida para el acceso offline.');
  const [payload, firma, extra] = String(ticket).split('.');
  if (!payload || !firma || extra) throw new Error('Credencial offline inválida.');
  const key = await crypto.subtle.importKey('spki', desdeB64url(PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
  const correcta = await crypto.subtle.verify({ name: 'Ed25519' }, key, desdeB64url(firma), utf8.encode(payload));
  if (!correcta) throw new Error('Credencial offline inválida.');
  const claims = JSON.parse(new TextDecoder().decode(desdeB64url(payload)));
  if (claims.v !== 1 || !claims.sub || !['alumno', 'tutor', 'docente', 'admin'].includes(claims.rol) || !claims.usuario || claims.usuario.id !== claims.sub || claims.usuario.rol !== claims.rol) {
    throw new Error('Credencial offline inválida.');
  }
  return claims;
}
