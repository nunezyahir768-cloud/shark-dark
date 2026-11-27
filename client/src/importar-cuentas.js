import * as XLSX from 'xlsx';
import { AREAS, SEMESTRES } from './ui.jsx';

const normaliza = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const CURP = /^[A-Z0-9]{18}$/;
const ROLES = { alumno: 'alumno', alumnos: 'alumno', alumna: 'alumno', alumnas: 'alumno', estudiante: 'alumno', estudiantes: 'alumno', docente: 'docente', docentes: 'docente', profesor: 'docente', profesores: 'docente', profesora: 'docente', profesoras: 'docente', maestro: 'docente', maestros: 'docente', maestra: 'docente', maestras: 'docente', tutor: 'tutor', tutores: 'tutor', tutora: 'tutor', tutoras: 'tutor', padre: 'tutor', madre: 'tutor' };
const CABECERAS = {
  rol: ['rol', 'tipo', 'tipo de cuenta', 'perfil'], nombre: ['nombre', 'nombre completo', 'alumno', 'alumnos', 'docente', 'docentes', 'tutor', 'tutores'],
  id: ['curp', 'id', 'identificador'], semestre: ['semestre', 'grado', 'periodo'], area: ['area', 'carrera', 'especialidad'], grupo: ['grupo', 'salon', 'seccion'],
  curpAlumno: ['curp alumno', 'curp del alumno', 'curp hija', 'curp hijo', 'alumno curp']
};

function buscaColumna(headers, campo) {
  const permitidas = CABECERAS[campo].map(normaliza);
  return headers.findIndex(h => permitidas.includes(normaliza(h)));
}

function semestreValido(valor) {
  const t = normaliza(valor).replace(/\s+/g, '');
  const ordinal = { primero: 1, primeroa: 1, segundo: 2, tercero: 3, tercer: 3, cuarto: 4, quinto: 5, sexto: 6 };
  const numero = Number(t.match(/^([1-6])(?:ro|do|to|er|o)?(?:semestre)?$/)?.[1] || ordinal[t] || 0);
  return SEMESTRES[numero - 1] || '';
}

export async function leerCuentasExcel(file, semestresActivos = SEMESTRES) {
  const libro = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no contiene hojas con datos.');
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false, blankrows: false });
  if (filas.length < 2) throw new Error('Agrega una fila de encabezados y al menos una cuenta.');
  const headers = filas[0];
  const cols = Object.fromEntries(Object.keys(CABECERAS).map(c => [c, buscaColumna(headers, c)]));
  const rolInferido = cols.nombre >= 0 ? ROLES[normaliza(headers[cols.nombre])] : '';
  if (cols.nombre < 0 || cols.id < 0 || (cols.rol < 0 && !rolInferido)) throw new Error('Se requieren nombre, CURP y rol; el rol puede inferirse de encabezados como Alumnos:, Docentes: o Tutores:.');
  const cuentas = filas.slice(1, 501).map((fila, i) => {
    const rawRol = cols.rol >= 0 ? normaliza(fila[cols.rol]) : '', cuenta = {
      fila: i + 2, rol: ROLES[rawRol] || rawRol || rolInferido,
      nombre: String(fila[cols.nombre] ?? '').trim().replace(/\s+/g, ' '),
      id: String(fila[cols.id] ?? '').trim().replace(/\s+/g, '').toUpperCase(),
      semestre: cols.semestre >= 0 ? semestreValido(fila[cols.semestre]) : '',
      area: cols.area >= 0 ? AREAS.find(x => normaliza(x) === normaliza(fila[cols.area])) || String(fila[cols.area] ?? '').trim() : '',
      grupo: cols.grupo >= 0 ? String(fila[cols.grupo] ?? '').trim().toUpperCase().replace(/^GRUPO\s*/, '') : '',
      curpAlumno: cols.curpAlumno >= 0 ? String(fila[cols.curpAlumno] ?? '').trim().replace(/\s+/g, '').toUpperCase() : '',
      errores: []
    };
    if (!['alumno', 'docente', 'tutor'].includes(cuenta.rol)) cuenta.errores.push('Rol inválido');
    if (cuenta.nombre.length < 3) cuenta.errores.push('Falta nombre completo');
    if (!CURP.test(cuenta.id)) cuenta.errores.push('CURP debe tener 18 letras o números');
    if (cuenta.rol === 'alumno') {
      if (!cuenta.semestre) cuenta.errores.push('Semestre inválido');
      else if (!semestresActivos.includes(cuenta.semestre)) cuenta.errores.push('Ese semestre no está activo en el periodo actual');
      if (!AREAS.some(x => normaliza(x) === normaliza(cuenta.area))) cuenta.errores.push('Área inválida');
      if (!['A', 'B', 'C'].includes(cuenta.grupo)) cuenta.errores.push('Grupo debe ser A, B o C');
    }
    if (cuenta.rol === 'tutor' && !CURP.test(cuenta.curpAlumno)) cuenta.errores.push('Agrega la CURP válida del alumno para vincularlo');
    return cuenta;
  }).filter(x => x.nombre || x.id || x.rol);
  if (filas.length > 501) throw new Error('El archivo supera el máximo de 500 cuentas por importación.');
  const vistos = new Map();   // CURP -> tipos de cuenta que ya la usan en el archivo
  for (const cuenta of cuentas) {
    if (!cuenta.id) continue;
    const antes = vistos.get(cuenta.id) || new Set();
    if (antes.has(cuenta.rol) || (cuenta.rol === 'alumno' && antes.size) || antes.has('alumno')) cuenta.errores.push('CURP repetida en el archivo');
    antes.add(cuenta.rol); vistos.set(cuenta.id, antes);
  }
  if (!cuentas.length) throw new Error('No encontré filas de cuentas.');
  return cuentas;
}

export function descargarPlantillaCuentas() {
  const hoja = XLSX.utils.aoa_to_sheet([['rol', 'nombre', 'CURP', 'semestre', 'area', 'grupo', 'CURP alumno']]);
  hoja['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 28 }, { wch: 12 }, { wch: 22 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Cuentas');
  XLSX.writeFile(libro, 'plantilla-cuentas-shark-dark.xlsx');
}
