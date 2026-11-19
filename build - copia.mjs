// Convierte la carpeta client/ (React) en public/bundle.js y public/bundle.css
import 'dotenv/config';
import { build } from 'esbuild';
import offlineAuth from './offline-auth.js';

// La clave pública se incluye en el cliente para validar los permisos offline sin exponer el secreto.
const offlinePublicKey = process.env.TOKEN_SECRET
  ? offlineAuth.obtenerClavePublicaOffline(process.env.TOKEN_SECRET)
  : 'tiburonmorado12345678';
if (!offlinePublicKey) console.warn('Aviso: TOKEN_SECRET no está definido en build; el acceso offline quedará desactivado en este bundle.');

await build({
  entryPoints: ['client/src/main.jsx'],
  bundle: true,
  minify: true,
  outfile: 'public/bundle.js',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  jsx: 'automatic',
  target: ['es2019'],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.OFFLINE_PUBLIC_KEY': JSON.stringify(offlinePublicKey) },
  logLevel: 'info'
});
console.log('Listo: public/bundle.js y public/bundle.css');
