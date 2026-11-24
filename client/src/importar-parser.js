/* Importación inteligente de cuentas.
   Recibe filas/texto sacados de cualquier archivo (Excel, CSV, Word, PDF) y detecta cada dato por su CONTENIDO,
   no por su posición: CURP, rol, nombre, semestre, carrera y grupo pueden venir en cualquier orden. */

// Mismos valores que ui.jsx (se repiten aquí para poder probar este archivo sin React)
export const SEMESTRES = ['1-2 semestre', '3-4 semestre', '5-6 semestre'];
export const AREAS = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];

export const normaliza = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
const sinAcentos = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

const CURP_ESTRICTA = /[A-Z]{4}\d{6}[HMX][A-Z]{2}[A-Z]{3}[A-Z0-9]\d/;
const CURP_FLOJA = /(?<![A-Z0-9])[A-Z0-9]{18}(?![A-Z0-9])/;
const CURP_OK = /^[A-Z0-9]{18}$/;

const ROLES = { alumno: 'alumno', alumnos: 'alumno', alumna: 'alumno', alumnas: 'alumno', estudiante: 'alumno', estudiantes: 'alumno', docente: 'docente', docentes: 'docente', profesor: 'docente', profesores: 'docente', profesora: 'docente', profesoras: 'docente', maestro: 'docente', maestros: 'docente', maestra: 'docente', maestras: 'docente', tutor: 'tutor', tutores: 'tutor', tutora: 'tutor', tutoras: 'tutor', padre: 'tutor', madre: 'tutor' };

const ALIAS_AREA = [
  ['Programación', ['programacion', 'programador']],
  ['Ofimática', ['ofimatica']],
  ['Enfermería', ['enfermeria']],
  ['Electricidad', ['electricidad']],
  ['Laboratorios Químicos', ['laboratorios quimicos', 'laboratorio quimico', 'laboratorista quimico', 'lab quimico', 'lab quimicos', 'laboratorios quimica']],
  ['Administración', ['administracion']]
];
const RELLENO_AREA = /\b(tecnico|tecnica|en|de|la|el|carrera|area|especialidad)\b/g;

const NUM_ORDINAL = { primero: 1, primer: 1, segundo: 2, tercero: 3, tercer: 3, cuarto: 4, quinto: 5, sexto: 6 };
const semDeNumero = n => n <= 2 ? SEMESTRES[0] : n <= 4 ? SEMESTRES[1] : SEMESTRES[2];

/* Cabeceras (normalizadas) que reconoce la app */
const CAB = {
  rol: ['rol', 'tipo', 'tipo de cuenta', 'perfil', 'cargo'],
  nombre: ['nombre', 'nombres', 'nombre completo', 'nombre s', 'alumno', 'alumnos', 'alumna', 'docente', 'docentes', 'tutor', 'tutores', 'apellido', 'apellidos', 'apellido paterno', 'apellido materno', 'primer apellido', 'segundo apellido', 'a paterno', 'a materno'],
  id: ['curp', 'id', 'identificador', 'clave'],
  semestre: ['semestre', 'grado', 'periodo', 'sem'],
  area: ['area', 'carrera', 'especialidad', 'modulo', 'opcion'],
  grupo: ['grupo', 'salon', 'seccion']
};
function campoDeCabecera(texto) {
  const n = normaliza(texto);
  if (!n || n.length > 40) return '';
  for (const [campo, lista] of Object.entries(CAB)) if (lista.some(s => n === s || n.startsWith(s + ' '))) return campo;
  return '';
}
function rangoNombre(texto) {   // orden para armar el nombre cuando viene en varias columnas
  const n = normaliza(texto);
  if (/materno|segundo apellido/.test(n)) return 3;
  if (/apellido|paterno|primer apellido/.test(n)) return 2;
  return 1;
}

/* ---- Detectores sobre un trozo de texto ---- */
function buscaCurp(texto) {
  const t = sinAcentos(texto).toUpperCase();
  const m = t.match(CURP_ESTRICTA) || t.replace(/\s+/g, '').match(CURP_FLOJA) && t.match(CURP_FLOJA);
  if (m) return { id: m[0], resto: texto.replace(new RegExp(m[0], 'i'), ' ') };
  const junto = t.replace(/[\s-]+/g, '');
  if (CURP_OK.test(junto) && /\d/.test(junto)) return { id: junto, resto: '' };   // CURP escrita con espacios o guiones
  return null;
}
function buscaArea(n) {   // n = texto normalizado
  for (const [area, alias] of ALIAS_AREA) for (const a of alias) {
    const re = new RegExp(`(^| )${a}( |$)`);
    if (re.test(n)) return { area, resto: n.replace(re, ' ').replace(RELLENO_AREA, ' ') };
  }
  return null;
}
function buscaSemestre(n, { desnudo = false } = {}) {
  let m;
  if ((m = n.match(/(^| )([1-6]) ?(?:a|y|al)? ?([1-6]) ?(?:semestres?|sem)?( |$)/)) && Math.abs(+m[3] - +m[2]) === 1) return { semestre: semDeNumero(Math.min(+m[2], +m[3])), resto: n.replace(m[0], ' ') };
  if ((m = n.match(/(^| )([1-6]) ?(?:er|ro|do|to|ero|o|vo)? ?(?:semestre|sem)( |$)/))) return { semestre: semDeNumero(+m[2]), resto: n.replace(m[0], ' ') };
  if ((m = n.match(/(^| )(primero|primer|segundo|tercero|tercer|cuarto|quinto|sexto)( ?semestre)?( |$)/))) return { semestre: semDeNumero(NUM_ORDINAL[m[2]]), resto: n.replace(m[0], ' ') };
  if (desnudo && (m = n.match(/^([1-6]) ?(?:er|ro|do|to|ero|o|vo)?$/))) return { semestre: semDeNumero(+m[1]), resto: '' };
  return null;
}
function buscaGrupo(n, { sueltaFinal = false, soloLetra = false } = {}) {
  let m;
  if ((m = n.match(/(^| )grupo ?([abc])( |$)/))) return { grupo: m[2].toUpperCase(), resto: n.replace(m[0], ' ') };
  if (soloLetra && (m = n.match(/^([abc])$/))) return { grupo: m[1].toUpperCase(), resto: '' };
  if (sueltaFinal && (m = n.match(/(^| )([abc])$/))) return { grupo: m[2].toUpperCase(), resto: n.slice(0, m.index) };
  return null;
}
function buscaSemGrupo(n) {   // "3B", "3° A", "5-C"
  const m = n.match(/(^| )([1-6]) ?([abc])( |$)/);
  return m ? { semestre: semDeNumero(+m[2]), grupo: m[3].toUpperCase(), resto: n.replace(m[0], ' ') } : null;
}
function buscaRol(n) {
  const palabras = n.split(' ');
  for (const p of palabras) if (ROLES[p]) return { rol: ROLES[p], resto: palabras.filter(x => x !== p).join(' ') };
  return null;
}

/* Quita etiquetas tipo "Nombre:" y numeración "1." del inicio */
function limpiaNombre(t) {
  return String(t ?? '').replace(/\b(nombre completo|nombre|curp|rol|semestre|grupo|area|área|carrera|especialidad)\s*:/gi, ' ')
    .replace(/^\s*\d+\s*[.)\-–]?\s+/, ' ').replace(/[|;,:()\[\]/\\_*•·]+/g, ' ').replace(/(^|\s)[-–—.](?=\s|$)/g, ' ')
    .replace(/(^|\s)\d+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}
const pareceNombre = t => /\p{L}{2}/u.test(t) && !/\d/.test(t);

/* Analiza una celda suelta (sin pista de cabecera): puede traer uno o varios datos juntos */
function analizaCelda(texto, contexto) {
  const hallado = {};
  let resto = String(texto ?? '').trim().replace(/^\d+\s*[.)]\s+/, '');
  if (!resto) return hallado;
  const c = buscaCurp(resto);
  if (c) { hallado.id = c.id; resto = c.resto; }
  resto = resto.replace(/\b(nombre completo|nombre|curp|rol|semestre|area|área|carrera|especialidad)\s*:/gi, ' ').replace(/\bgrupo\s*:/gi, 'grupo ');
  let n = normaliza(resto);
  const g1 = buscaGrupo(n, { soloLetra: true });
  if (g1) { hallado.grupo = g1.grupo; n = g1.resto; }
  const sg = !hallado.grupo && buscaSemGrupo(n);
  if (sg) { hallado.semestre = sg.semestre; hallado.grupo = sg.grupo; n = sg.resto; }
  const s = !hallado.semestre && buscaSemestre(n);
  if (s) { hallado.semestre = s.semestre; n = s.resto; }
  const a = buscaArea(n);
  if (a) { hallado.area = a.area; n = a.resto; }
  const r = buscaRol(n);
  if (r && (!n.includes(' ') || contexto.celdaCompuesta || n.split(' ').length <= 3)) {
    if (!n.includes(' ') || Object.keys(hallado).length || contexto.celdaCompuesta) { hallado.rol = r.rol; n = r.resto; }
  }
  if (!hallado.grupo) { const g = buscaGrupo(n, { sueltaFinal: Object.keys(hallado).length > 0 }); if (g) { hallado.grupo = g.grupo; n = g.resto; } }
  n = n.replace(/(^| )(semestres?|sem|grupo|curp|carrera|area)(?= |$)/g, ' ').replace(/ +/g, ' ').trim();
  // lo que sobra es candidato a nombre; usamos el texto original (con mayúsculas y acentos) si no se tocó nada
  const intacto = !Object.keys(hallado).length;
  const candidato = limpiaNombre(intacto ? texto : n);
  if (candidato && pareceNombre(candidato) && !/^(no|n o|num|numero|folio|obs|observaciones|total)\b/i.test(sinAcentos(candidato))) hallado.nombre = intacto ? candidato : recuperaMayusculas(candidato, texto);
  return hallado;
}
/* n viene en minúsculas sin acentos: lo reconstruimos con el texto original palabra por palabra */
function recuperaMayusculas(candidato, original) {
  const orig = String(original).split(/\s+/).filter(Boolean), usadas = new Set();
  return candidato.split(' ').map(p => {
    const i = orig.findIndex((o, k) => !usadas.has(k) && normaliza(o) === p);
    if (i >= 0) { usadas.add(i); return orig[i].replace(/[|;,:()\[\]]+/g, ''); }
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

/* Interpreta una celda cuando su columna ya se sabe por la cabecera */
function celdaConCampo(campo, texto) {
  const t = String(texto ?? '').trim();
  if (!t) return {};
  if (campo === 'id') { const c = buscaCurp(t); return { id: c ? c.id : t.replace(/[\s-]+/g, '').toUpperCase() }; }
  if (campo === 'rol') { const n = normaliza(t); return { rol: ROLES[n] || (buscaRol(n) || {}).rol || n }; }
  if (campo === 'semestre') {
    const n = normaliza(t), s = buscaSemestre(n, { desnudo: true }) || (buscaSemGrupo(n) && { semestre: buscaSemGrupo(n).semestre });
    const res = { semestre: s ? s.semestre : '' };
    const sg = buscaSemGrupo(n); if (sg) res.grupo = sg.grupo;
    return res;
  }
  if (campo === 'area') { const a = buscaArea(normaliza(t)); return { area: a ? a.area : t }; }
  if (campo === 'grupo') { const n = normaliza(t), g = buscaGrupo(n, { soloLetra: true }) || buscaGrupo(n, { sueltaFinal: true }) || n.match(/^([abc])\b/) && { grupo: n[0].toUpperCase() }; return { grupo: g ? g.grupo : t.toUpperCase() }; }
  if (campo === 'nombre') { const c = limpiaNombre(t); return c && pareceNombre(c) ? { nombre: c } : {}; }
  return {};
}

const esCabecera = fila => {
  const celdas = fila.filter(c => String(c ?? '').trim());
  if (celdas.length < 2 || celdas.some(c => buscaCurp(String(c)))) return false;
  const campos = new Set(celdas.map(campoDeCabecera).filter(Boolean));
  return campos.size >= 2;
};

/* ---- Núcleo: de filas/texto a cuentas ---- */
export function construirCuentas(items, { rolPorDefecto = '' } = {}) {
  const cuentas = [];
  let mapa = null, rolSeccion = '', rolCabecera = '', n = 0;
  const confirmaRol = c => {
    if (c.rol && ROLES[c.rol]) c.rol = ROLES[c.rol];
    if (!c.rol) c.rol = rolSeccion || rolCabecera || rolPorDefecto || ((c.semestre || c.area || c.grupo) ? 'alumno' : '');
  };
  for (const it of items) {
    if (it.tipo === 'texto') {
      const t = String(it.texto ?? '').trim();
      if (!t) continue;
      const nt = normaliza(t.replace(/:$/, ''));
      if (!buscaCurp(t) && ROLES[nt]) { rolSeccion = ROLES[nt]; mapa = null; rolCabecera = ''; continue; }   // encabezado de sección: "ALUMNOS", "Docentes:"
      const partes = t.split(/\t+| {3,}| \| |;/).map(x => x.trim()).filter(Boolean);
      it.cells = partes.length > 1 ? partes : [t]; it.tipo = 'fila'; it.libre = true;
    }
    const cells = (it.cells || []).map(c => String(c ?? '').trim());
    if (!cells.some(Boolean)) continue;
    if (it.nuevaTabla) { mapa = null; rolCabecera = ''; }
    if (!it.libre && esCabecera(cells)) {
      mapa = cells.map(campoDeCabecera);
      const primero = mapa.indexOf('nombre');
      rolCabecera = primero >= 0 ? ROLES[normaliza(cells[primero])] || '' : '';
      mapa.rangos = cells.map(rangoNombre);
      continue;
    }
    const hallado = { nombrePartes: [], sobrantes: [] };
    // En PDF las celdas vacías no existen: si la fila trae menos celdas que la cabecera no se puede confiar en la posición y se lee por contenido
    const libre = !!it.libre || !!(it.pdf && mapa && cells.length !== mapa.length);
    cells.forEach((texto, i) => {
      if (!texto) return;
      const campo = !libre && mapa && mapa[i];
      if (campo) {
        const r = celdaConCampo(campo, texto);
        if (campo === 'nombre' && r.nombre) hallado.nombrePartes.push([mapa.rangos[i], i, r.nombre]);
        else for (const [k, v] of Object.entries(r)) if (v && !hallado[k]) hallado[k] = v;
        return;
      }
      if (mapa && !campo && !libre) return;   // columna sin significado (No., Observaciones...) en una tabla con cabeceras
      const r = analizaCelda(texto, { celdaCompuesta: cells.length === 1 });
      for (const [k, v] of Object.entries(r)) { if (k === 'nombre') hallado.sobrantes.push([i, v]); else if (!hallado[k]) hallado[k] = v; }
    });
    const nombre = hallado.nombrePartes.length
      ? hallado.nombrePartes.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(p => p[2]).join(' ')
      : hallado.sobrantes.sort((a, b) => a[0] - b[0]).map(p => p[1]).join(' ');
    const tieneCurp = !!hallado.id;
    if (!tieneCurp && (libre || !mapa || !nombre || nombre.length < 3)) continue;   // sin CURP solo cuenta si está dentro de una tabla con cabeceras
    n++;
    const cuenta = { fila: it.fila || n, rol: hallado.rol || '', nombre: nombre.replace(/\s+/g, ' ').trim(), id: String(hallado.id || '').toUpperCase(), semestre: hallado.semestre || '', area: hallado.area || '', grupo: hallado.grupo || '', errores: [] };
    confirmaRol(cuenta);
    if (cuenta.rol !== 'alumno') { cuenta.semestre = ''; cuenta.area = ''; cuenta.grupo = ''; }
    cuentas.push(cuenta);
  }
  const vistos = new Set();
  for (const c of cuentas) {
    if (!['alumno', 'docente', 'tutor'].includes(c.rol)) c.errores.push('No encontré el rol (alumno, docente o tutor)');
    if (c.nombre.length < 3) c.errores.push('Falta nombre completo');
    if (!CURP_OK.test(c.id)) c.errores.push(c.id ? 'CURP debe tener 18 letras o números' : 'Falta la CURP');
    if (c.rol === 'alumno') {
      if (!SEMESTRES.includes(c.semestre)) c.errores.push('No encontré el semestre');
      if (!AREAS.includes(c.area)) c.errores.push('No encontré la carrera');
      if (!['A', 'B', 'C'].includes(c.grupo)) c.errores.push('No encontré el grupo (A, B o C)');
    }
    if (c.id && vistos.has(c.id)) c.errores.push('CURP repetida en el archivo');
    vistos.add(c.id);
  }
  return cuentas;
}
