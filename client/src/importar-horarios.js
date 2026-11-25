import * as XLSX from 'xlsx';
import { AREAS, SEMESTRES } from './ui.jsx';

const normaliza = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9:]+/g, ' ').trim();
const CURP = /^[A-Z0-9]{18}$/;
const CABECERAS = {
  docente: ['curp docente', 'curp del docente', 'docente', 'curp', 'maestro', 'profesor'],
  semestre: ['semestre', 'grado', 'periodo'], area: ['area', 'carrera', 'especialidad'], grupo: ['grupo', 'seccion'],
  materia: ['materia', 'asignatura', 'catedratico materia'], dia: ['dia', 'dias'], inicio: ['inicio', 'de las', 'hora inicio', 'hora de inicio', 'entrada'], fin: ['fin', 'a las', 'hora fin', 'hora de fin', 'salida']
};
const DIAS = { lunes: 1, lun: 1, '1': 1, martes: 2, mar: 2, '2': 2, miercoles: 3, mie: 3, '3': 3, jueves: 4, jue: 4, '4': 4, viernes: 5, vie: 5, '5': 5, sabado: 6, sab: 6, '6': 6 };
const NOMBRE_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const buscaColumna = (headers, campo) => { const ok = CABECERAS[campo].map(normaliza); return headers.findIndex(h => ok.includes(normaliza(h))); };

function semestreValido(valor) {
  const t = normaliza(valor).replace(/\s+/g, '');
  if (['1ro', '1', 'primero', '1y2', '12'].includes(t)) return SEMESTRES[0];
  if (['3ro', '3', 'tercero', '3y4', '34'].includes(t)) return SEMESTRES[1];
  if (['5to', '5', 'quinto', '5y6', '56'].includes(t)) return SEMESTRES[2];
  return SEMESTRES.find(x => normaliza(x) === normaliza(valor)) || '';
}
/* "7:00", "07:00", "7", "7:00 pm", "13.00" -> "07:00" */
export function horaValida(v) {
  const t = String(v ?? '').trim().toLowerCase().replace(/(\d)\.(\d)/, '$1:$2');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return '';
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const diasDe = v => [...new Set(String(v ?? '').split(/[,;/\s]+|\sy\s/i).map(x => DIAS[normaliza(x)]).filter(Boolean))];

export async function leerHorariosExcel(file) {
  const libro = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no contiene hojas con datos.');
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false, blankrows: false });
  if (filas.length < 2) throw new Error('Agrega una fila de encabezados y al menos una clase.');
  const headers = filas[0], cols = Object.fromEntries(Object.keys(CABECERAS).map(c => [c, buscaColumna(headers, c)]));
  const faltan = Object.keys(cols).filter(c => cols[c] < 0);
  if (faltan.length) throw new Error('Faltan columnas: ' + faltan.join(', ') + '. Descarga la plantilla para ver los encabezados.');
  const bloques = [];
  filas.slice(1, 501).forEach((fila, i) => {
    const n = i + 2, g = c => String(fila[cols[c]] ?? '').trim();
    if (!fila.some(x => String(x).trim())) return;
    const base = {
      fila: n, docente: g('docente').replace(/\s+/g, '').toUpperCase(), semestre: semestreValido(g('semestre')),
      area: AREAS.find(x => normaliza(x) === normaliza(g('area'))) || '', grupo: g('grupo').toUpperCase().replace(/^GRUPO\s*/, ''),
      materia: g('materia').replace(/\s+/g, ' '), inicio: horaValida(g('inicio')), fin: horaValida(g('fin')), errores: []
    };
    if (!CURP.test(base.docente)) base.errores.push('CURP del docente inválida');
    if (!base.semestre) base.errores.push('Semestre inválido');
    if (!base.area) base.errores.push('Área inválida');
    if (!['A', 'B', 'C'].includes(base.grupo)) base.errores.push('Grupo debe ser A, B o C');
    if (base.materia.length < 2) base.errores.push('Falta la materia');
    if (!base.inicio || !base.fin) base.errores.push('Hora inválida');
    else if (base.fin <= base.inicio) base.errores.push('La hora final debe ser mayor a la inicial');
    else if (base.inicio < '10:00' && base.fin > '09:30') base.errores.push('Choca con el descanso (9:30 a 10:00)');
    const dias = diasDe(g('dia'));
    if (!dias.length) { bloques.push({ ...base, dia: 0, errores: [...base.errores, 'Día inválido'] }); return; }
    dias.forEach(dia => bloques.push({ ...base, dia, errores: [...base.errores] }));
  });
  if (filas.length > 501) throw new Error('El archivo supera el máximo de 500 filas por importación.');
  if (!bloques.length) throw new Error('No encontré clases en el archivo.');
  return bloques;
}
export const nombreDia = d => NOMBRE_DIA[d] || '—';

export function descargarPlantillaHorarios() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ['curp docente', 'semestre', 'area', 'grupo', 'materia', 'dia', 'inicio', 'fin'],
    ['EJEMPLOCURP000000A1', '5-6 semestre', 'Programación', 'A', 'Inglés V', 'Lunes, Miércoles', '7:00', '7:50']
  ]);
  hoja['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 24 }, { wch: 8 }, { wch: 34 }, { wch: 20 }, { wch: 10 }, { wch: 10 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Horarios');
  XLSX.writeFile(libro, 'plantilla-horarios-shark-dark.xlsx');
}
