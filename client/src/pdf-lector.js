/* Lector de PDF (se empaqueta aparte en public/pdf-lector.js y se carga solo al importar un PDF) */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf-worker.js';

export async function extraerItemsPdf(buffer) {
  let pdf;
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise; }
  catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'El PDF tiene contraseña.' : 'No se pudo abrir el PDF.'); }
  const items = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 60); p++) {
    const pagina = await pdf.getPage(p), contenido = await pagina.getTextContent();
    const piezas = contenido.items.filter(x => x.str && x.str.trim()).map(x => ({ t: x.str, x: x.transform[4], y: x.transform[5], w: x.width, h: Math.abs(x.height) || Math.abs(x.transform[3]) || 10 }));
    piezas.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = [];
    for (const pz of piezas) {   // agrupa por altura (misma línea)
      const l = lineas[lineas.length - 1];
      if (l && Math.abs(l.y - pz.y) <= Math.max(2.5, pz.h * 0.45)) l.piezas.push(pz); else lineas.push({ y: pz.y, piezas: [pz] });
    }
    lineas.forEach((l, i) => {
      l.piezas.sort((a, b) => a.x - b.x);
      const cells = [], xs = []; let actual = '', fin = null, h = 10, ini = 0;
      for (const pz of l.piezas) {   // un hueco ancho entre textos = otra columna
        const hueco = fin === null ? 0 : pz.x - fin;
        if (fin !== null && hueco > Math.max(7, pz.h * 0.9)) { cells.push(actual.trim()); xs.push(ini); actual = ''; }
        else if (fin !== null && hueco > pz.h * 0.15 && !/\s$/.test(actual) && !/^\s/.test(pz.t)) actual += ' ';
        if (!actual) ini = pz.x;
        actual += pz.t; fin = pz.x + pz.w; h = pz.h;
      }
      cells.push(actual.trim()); xs.push(ini);
      const lim = cells.filter(Boolean);
      if (lim.length === 1) items.push({ tipo: 'texto', texto: lim[0] }); else if (lim.length) items.push({ tipo: 'fila', cells: lim, pdf: true, nuevaTabla: p === 1 && i === 0 });
    });
  }
  if (!items.length) throw new Error('El PDF no tiene texto (parece un escaneo o una foto).');
  return items;
}
