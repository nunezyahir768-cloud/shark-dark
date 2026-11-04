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
export const Card = ({ title, children, className = '', style }) => (
  <div className={'card ' + className} style={style}>{title && <h2>{title}</h2>}{children}</div>
);
export const Hero = ({ titulo, sub }) => <div className="hero"><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>;
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
