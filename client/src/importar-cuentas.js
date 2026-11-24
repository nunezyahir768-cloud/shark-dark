import * as XLSX from 'xlsx';
import { construirCuentas } from './importar-parser.js';

/* Importación de cuentas desde Excel, CSV, Word (.docx) o PDF.
   Cada lector solo saca filas/texto del archivo; el orden de los datos no importa (ver importar-parser.js). */

/* ---------- Excel / ODS ---------- */
async function itemsExcel(file) {
  const libro = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const items = [];
  for (const nombre of libro.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: '', raw: false, blankrows: false });
    filas.forEach((cells, i) => items.push({ tipo: 'fila', cells, nuevaTabla: i === 0 }));
  }
  return items;
}

/* ---------- CSV / TXT ---------- */
function itemsCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = [',', ';', '\t', '|'].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0];
  const filas = []; let fila = [], celda = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) { if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; } else if (ch === '"') comillas = false; else celda += ch; }
    else if (ch === '"') comillas = true;
    else if (sep[1] > 1 && ch === sep[0]) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter(f => f.some(c => String(c).trim())).map((cells, i) => sep[1] > 1 ? { tipo: 'fila', cells, nuevaTabla: i === 0 } : { tipo: 'texto', texto: cells[0] });
}

/* ---------- Word (.docx): un .docx es un ZIP; lo abrimos sin librerías ---------- */
async function leerZip(buffer) {
  const v = new DataView(buffer), u8 = new Uint8Array(buffer);
  let fin = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo Word no es válido o está dañado.');
  const total = v.getUint16(fin + 10, true), tablaOff = v.getUint32(fin + 16, true), archivos = {};
  let p = tablaOff;
  for (let n = 0; n < total && v.getUint32(p, true) === 0x02014b50; n++) {
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true), nom = v.getUint16(p + 28, true), ext = v.getUint16(p + 30, true), com = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nom));
    archivos[nombre] = { metodo, tam, off };
    p += 46 + nom + ext + com;
  }
  return async nombre => {
    const a = archivos[nombre]; if (!a) return null;
    const lh = a.off, ini = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true), datos = u8.subarray(ini, ini + a.tam);
    if (a.metodo === 0) return new TextDecoder().decode(datos);
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir archivos Word. Actualízalo o usa Excel/PDF.');
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(flujo).arrayBuffer());
  };
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const textoDe = el => {   // texto de un párrafo o celda, respetando tabuladores y saltos
  let t = '';
  const rec = n => {
    if (n.nodeType === 3) return;
    const nombre = n.localName;
    if (nombre === 't') t += n.textContent;
    else if (nombre === 'tab') t += '\t';
    else if (nombre === 'br' || nombre === 'cr') t += '\n';
    else if (nombre === 'p' && t && !/\s$/.test(t)) { for (const h of n.childNodes) rec(h); t += ' '; return; }
    for (const h of n.childNodes) rec(h);
  };
  rec(el);
  return t;
};
async function itemsDocx(file) {
  const abrir = await leerZip(await file.arrayBuffer());
  const xml = await abrir('word/document.xml');
  if (!xml) throw new Error('No encontré el contenido del documento Word.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), cuerpo = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!cuerpo) throw new Error('El documento Word está vacío.');
  const items = [];
  for (const hijo of cuerpo.children) {
    if (hijo.localName === 'tbl') {
      let primera = true;
      for (const tr of hijo.children) if (tr.localName === 'tr') {
        const cells = [...tr.children].filter(c => c.localName === 'tc').map(tc => textoDe(tc).replace(/\s+/g, ' ').trim());
        items.push({ tipo: 'fila', cells, nuevaTabla: primera }); primera = false;
      }
    } else if (hijo.localName === 'p') {
      for (const linea of textoDe(hijo).split('\n')) if (linea.trim()) items.push({ tipo: 'texto', texto: linea });
    }
  }
  return items;
}

/* ---------- PDF: se carga solo cuando hace falta (pdf-lector.js) ---------- */
async function itemsPdf(file) {
  let lector;
  try { lector = await import('/pdf-lector.js'); } catch { throw new Error('No se pudo cargar el lector de PDF. Revisa tu conexión e intenta de nuevo.'); }
  return lector.extraerItemsPdf(await file.arrayBuffer());
}

export const TIPOS_ARCHIVO = '.xlsx,.xls,.ods,.csv,.txt,.docx,.pdf';

export async function leerCuentasArchivo(file, { rolPorDefecto = '' } = {}) {
  const nombre = file.name.toLowerCase();
  let items;
  if (/\.(xlsx|xlsm|xls|ods)$/.test(nombre)) items = await itemsExcel(file);
  else if (/\.(csv|txt)$/.test(nombre)) items = itemsCsv(await file.text());
  else if (/\.docx$/.test(nombre)) items = await itemsDocx(file);
  else if (/\.pdf$/.test(nombre)) items = await itemsPdf(file);
  else if (/\.doc$/.test(nombre)) throw new Error('Los archivos .doc antiguos no se pueden leer. Ábrelo en Word y guárdalo como .docx.');
  else throw new Error('Formato no compatible. Usa Excel (.xlsx), CSV, Word (.docx) o PDF.');
  if (!items.length) throw new Error('El archivo no tiene contenido.');
  const cuentas = construirCuentas(items, { rolPorDefecto });
  if (!cuentas.length) throw new Error(/\.pdf$/.test(nombre) ? 'No encontré cuentas en el PDF. Si es una foto o un escaneo no tiene texto que leer; usa un PDF generado desde Word o Excel.' : 'No encontré cuentas. Cada persona necesita al menos su CURP (18 caracteres) y su nombre.');
  if (cuentas.length > 500) throw new Error(`El archivo trae ${cuentas.length} cuentas; el máximo es 500 por importación. Divídelo en partes.`);
  return cuentas;
}

export function descargarPlantillaCuentas() {
  const hoja = XLSX.utils.aoa_to_sheet([['rol', 'nombre', 'CURP', 'semestre', 'area', 'grupo']]);
  hoja['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 28 }, { wch: 12 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Cuentas');
  XLSX.writeFile(libro, 'plantilla-cuentas-shark-dark.xlsx');
}
