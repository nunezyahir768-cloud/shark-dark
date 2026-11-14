import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import SD from './sd.js';

export const AlumnoCtx = createContext(null);
export const TutorCtx = createContext({ vinc: [], activo: '', setActivo: () => {} });
export const useAlumno = () => useContext(AlumnoCtx);

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const ROL = { alumno: 'Alumno', tutor: 'Tutor', docente: 'Docente', admin: 'Administración' };
export const SEMESTRES = ['1-2 semestre', '3-4 semestre', '5-6 semestre'];
export const AREAS = ['Programación', 'Ofimática', 'Enfermería', 'Electricidad', 'Laboratorios Químicos', 'Administración'];
export const fmtF = f => (f || '').split('-').reverse().join('/');
export const hh = t => (t || '').replace(/^0/, '');
export const toMin = t => { const [h, m] = t.split(':'); return +h * 60 + +m; };
export const hoyISO = () => new Date().toLocaleDateString('sv-SE');
export const nombreGrupo = g => `${g.semestre} ${g.area} ${g.grupo}`;
export const post = (path, body = {}) => SD.api(path, { method: 'POST', body });
export const msgErr = e => (e.status ? e.message : 'Necesitas internet para esto');

export function useBanner() {
  const [b, setB] = useState(null);
  return [b, (t, h, x = '') => setB({ t, h, x })];
}
export const Banner = ({ b }) => (b ? <div className={'banner ' + b.t}><b>{b.h}</b>{b.x}</div> : null);
const ICONOS_APARTADO = {
  inicio: 'M3 10 12 3l9 7M5 9v12h14V9m-9 12v-7h4v7',
  opciones: 'M4 6h6m4 0h6M4 12h2m4 0h10M4 18h8m4 0h4M12 4v4M8 10v4m6 2v4',
  asistencia: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-4-10 3 3 6-6',
  horario: 'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18',
  calificaciones: 'M4 20V11m5 9V4m6 16v-7m5 7V8M2 21h20',
  permisos: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-4',
  actividad: 'M3 12h4l3-8 4 16 3-8h4',
  reporte: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  cuenta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  grupos: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-3a3 3 0 0 0 0-6m3 15v-2a4 4 0 0 0-3-3.87',
  clases: 'M3 5.5A3.5 3.5 0 0 1 6.5 2H21v17H6.5A3.5 3.5 0 0 0 3 22zM3 5.5v13A3.5 3.5 0 0 1 6.5 15H21M8 6h8',
  escaner: 'M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M4 12h16',
  historial: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5m4-1v5l3 2',
  general: 'M12 3 14.8 9.2 21 10l-4.5 4.3 1.2 6.2L12 17.3l-5.7 3.2 1.2-6.2L3 10l6.2-.8z'
};
function IconoApartado({ titulo }) {
  const t = String(titulo || '').toLocaleLowerCase();
  const clave = /opcion/.test(t) ? 'opciones' : /asisten|clase de ahora|lista de la clase|faltas/.test(t) ? 'asistencia' : /horario|d[ií]a/.test(t) ? 'horario' : /calific|promedio|parcial/.test(t) ? 'calificaciones' : /permiso/.test(t) ? 'permisos' : /actividad|aviso/.test(t) ? 'actividad' : /reporte|historial/.test(t) ? 'reporte' : /esc[aá]ner|qr|c[oó]digo/.test(t) ? 'escaner' : /grupo|materia|clase|cuenta|perfil|alumno|tutor|docente|nombre|curp/.test(t) ? 'grupos' : /ahora|bienvenido|inicio|datos|general|selecciona/.test(t) ? 'inicio' : 'general';
  return <svg className="apartado-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONOS_APARTADO[clave]} /></svg>;
}
export const Card = ({ title, children, className = '', style }) => (
  <div className={'card ' + className} style={style}>{title && <h2><IconoApartado titulo={title} /><span>{title}</span></h2>}{children}</div>
);
export const Hero = ({ titulo, sub }) => <div className="hero"><h1><IconoApartado titulo={titulo} /><span>{titulo}</span></h1>{sub && <p className="sub">{sub}</p>}</div>;
export const QR = ({ texto }) => <div className="qr" dangerouslySetInnerHTML={{ __html: SD.qr(texto) }} />;

/* Datos guardados en el teléfono (alumnos, asistencias, avisos) que se refrescan al sincronizar */
export function useDatos() {
  const [d, setD] = useState({ alumnos: [], asistencias: [], avisos: [] });
  const refresh = useCallback(() => SD.datos().then(setD), []);
  useEffect(() => {
    refresh(); document.addEventListener('sd-sync', refresh);
    return () => document.removeEventListener('sd-sync', refresh);
  }, [refresh]);
  return { ...d, refresh };
}
/* Pide al servidor y, sin internet, usa la última copia guardada */
export function useCached(key, path) {
  const [v, setV] = useState(null);
  const load = useCallback(() => SD.cached(key, path).then(setV), [key, path]);
  useEffect(() => { load(); }, [load]);
  return [v, load];
}
export function descargar(blob, nombre) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_'); a.click();
}

/* Horario: clase actual y siguiente según el día y la hora */
export function estadoHorario(bl) {
  const d = new Date(), dia = d.getDay(), n = d.getHours() * 60 + d.getMinutes();
  const hoy = (bl || []).filter(b => b.dia === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const i = hoy.findIndex(b => toMin(b.inicio) <= n && n < toMin(b.fin));
  const sig = i >= 0 ? hoy[i + 1] : hoy.find(b => toMin(b.inicio) > n);
  return { hoy, ahora: i >= 0 ? hoy[i] : null, sig, minutosParaFin: i >= 0 ? toMin(hoy[i].fin) - n : null };
}
export const DESCANSO = { inicio: '09:30', fin: '10:00' };
export const conDescanso = bl => {
  const l = [...(bl || [])];
  for (let d = 1; d <= 5; d++) if (!l.some(b => b.dia === d && b.tipo === 'descanso')) l.push({ id: 'desc' + d, dia: d, inicio: DESCANSO.inicio, fin: DESCANSO.fin, tipo: 'descanso', materia: 'Descanso', docenteNombre: '' });
  return l;
};
export const delGrupo = (bl, a) => (bl || []).filter(b => a && b.area === a.area && b.semestre === a.semestre && b.grupo === a.grupo);

/* Asistencias de una clase en un mes (para tabla y Excel) */
export function mesDatos(c, d, mes) {
  const g = d.alumnos.filter(a => a.area === c.area && a.semestre === c.semestre && a.grupo === c.grupo).sort((x, y) => x.nombre.localeCompare(y.nombre));
  const cur = new Set(g.map(a => a.curp)), k = c.materia.toLowerCase();
  const rs = d.asistencias.filter(r => cur.has(r.curp) && r.fecha.startsWith(mes) && (r.materia || '').toLowerCase() === k);
  const fechas = [...new Set(rs.map(r => r.fecha))].sort(), M = { asistio: '✓', falta: '✗', justificada: 'J' };
  const idx = new Map(rs.map(r => [r.curp + '|' + r.fecha, M[r.estado] || '·']));
  return { g, fechas, rs, filas: g.map(a => [a.nombre, fechas.map(f => idx.get(a.curp + '|' + f) || '·')]) };
}
export function resumenAsistencia(rs) {
  const asist = rs.filter(a => a.estado === 'asistio').length, falt = rs.filter(a => a.estado === 'falta').length, just = rs.filter(a => a.estado === 'justificada').length;
  const tot = asist + falt + just;
  return { asist, falt, just, pct: tot ? Math.round((asist + just) * 100 / tot) : 100 };
}
export const ListaFaltas = ({ rs }) => {
  const l = rs.filter(a => a.estado === 'falta').sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 15);
  return <ul className="l">{l.map(a => (
    <li key={a.uid}><span>{fmtF(a.fecha)}{a.horaInicio ? ` · de ${hh(a.horaInicio)} a ${hh(a.horaFin)}` : ''}</span><span>{a.materia}</span></li>
  ))}{!l.length && <li className="vacio">Sin faltas</li>}</ul>;
};
