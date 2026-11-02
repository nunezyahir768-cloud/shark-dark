// Convierte la carpeta client/ (React) en public/bundle.js y public/bundle.css
import { build } from 'esbuild';

await build({
  entryPoints: ['client/src/main.jsx'],
  bundle: true,
  minify: true,
  outfile: 'public/bundle.js',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  jsx: 'automatic',
  target: ['es2019'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info'
});
console.log('Listo: public/bundle.js y public/bundle.css');
