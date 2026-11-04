import { useState, useEffect, useMemo, useRef } from 'react';
import SD from './sd.js';
import Intro from './Intro.jsx';
import Login from './Login.jsx';
import { AlumnoCtx, TutorCtx, ROL, estadoHorario, delGrupo, conDescanso, hh } from './ui.jsx';
import { Inicio, PerfilAlumno, PerfilesTutor, AsistenciaVer, Horario, CalifVer, Permisos, Avisos, ReporteVer, Cuenta } from './paginas.jsx';
import { AsistenciaDocente, CalifDocente, ReporteDocente } from './docente.jsx';
import { Cuentas, Grupos, Clases, Horarios, Escaner } from './servicios.jsx';

const MENU = {
  alumno: [['inicio', 'Inicio'], ['perfil', 'Perfil'], ['asistencia', 'Asistencia'], ['horario', 'Horario'], ['calificaciones', 'Calificaciones'], ['permisos', 'Permisos'], ['avisos', 'Avisos'], ['reportes', 'Reportes']],
  tutor: [['inicio', 'Inicio'], ['asistencia', 'Asistencia'], ['permisos', 'Permisos'], ['horario', 'Horario'], ['calificaciones', 'Calificaciones'], ['avisos', 'Avisos'], ['perfiles', 'Perfiles'], ['reportes', 'Reportes']],
  docente: [['horario', 'Horario'], ['asistencia', 'Asistencia'], ['reportes', 'Reportes'], ['avisos', 'Avisos'], ['calificaciones', 'Calificaciones'], ['permisos', 'Permisos']],
  admin: [['cuentas', 'Cuentas'], ['grupos', 'Grupos'], ['clases', 'Clases'], ['horarios', 'Horarios'], ['permisos', 'Permisos'], ['avisos', 'Avisos'], ['escaner', 'Escáner']]
};
const INICIO = { alumno: 'inicio', tutor: 'inicio', docente: 'horario', admin: 'cuentas' };
const PAGINAS = {
  inicio: { alumno: Inicio, tutor: Inicio },
  perfil: { alumno: PerfilAlumno }, perfiles: { tutor: PerfilesTutor },
  asistencia: { alumno: AsistenciaVer, tutor: AsistenciaVer, docente: AsistenciaDocente },
  horario: { alumno: Horario, tutor: Horario, docente: Horario },
  calificaciones: { alumno: CalifVer, tutor: CalifVer, docente: CalifDocente },
  permisos: { alumno: Permisos, tutor: Permisos, docente: Permisos, admin: Permisos },
  avisos: { alumno: Avisos, tutor: Avisos, docente: Avisos, admin: Avisos },
  reportes: { alumno: ReporteVer, tutor: ReporteVer, docente: ReporteDocente },
  cuenta: { alumno: Cuenta, tutor: Cuenta, docente: Cuenta, admin: Cuenta },
  cuentas: { admin: Cuentas }, grupos: { admin: Grupos }, clases: { admin: Clases }, horarios: { admin: Horarios }, escaner: { admin: Escaner }
};

const useRuta = () => {
  const [r, setR] = useState(location.hash.replace(/^#\/?/, ''));
  useEffect(() => { const f = () => setR(location.hash.replace(/^#\/?/, '')); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
};

/* Aviso 5 minutos antes de que termine la clase: dice cuál sigue (funciona con la app abierta) */
function useAvisoSiguiente(alumno, activo) {
  const [toast, setToast] = useState('');
  const bl = useRef([]);
  useEffect(() => {
    if (!activo || !alumno) return;
    const rev = () => {
      const e = estadoHorario(bl.current);
      if (!e.ahora || e.minutosParaFin > 5 || e.minutosParaFin < 1) return;
      const k = `sd_hn_${new Date().toLocaleDateString('sv-SE')}_${e.ahora.id}`;
      if (localStorage.getItem(k)) return; localStorage.setItem(k, '1');
      const t = `Termina ${e.ahora.materia} en ${e.minutosParaFin} min. ` + (e.sig ? (e.sig.tipo === 'descanso' ? `Sigue el descanso (${hh(e.sig.inicio)}).` : `Sigue: ${e.sig.materia} a las ${hh(e.sig.inicio)}.`) : 'Es la última clase del día.');
      setToast(t); SD.notificar(t); setTimeout(() => setToast(''), 20000);
    };
    SD.cached('horario', '/api/horarios').then(l => { bl.current = conDescanso(delGrupo(l, alumno)); rev(); });
    const i = setInterval(rev, 20000); return () => clearInterval(i);
  }, [alumno && alumno.curp, activo]);
  return toast;
}

function Shell({ ses }) {
  const rol = ses.rol, [abre, setAbre] = useState(false);
  const ruta = useRuta() || INICIO[rol];
  const [yo, setYo] = useState(null), [vinc, setVinc] = useState([]), [activo, setActivo] = useState(localStorage.getItem('sd_alumno') || '');
  useEffect(() => {
    if (rol === 'alumno') SD.api('/api/yo').then(setYo).catch(() => setYo(ses));
    if (rol === 'tutor') SD.vinculos().then(setVinc);
  }, [rol]);
  const alumno = useMemo(() => {
    if (rol === 'alumno') { const y = yo || ses; return { curp: y.curp || y.id, nombre: y.nombre, area: y.area, semestre: y.semestre, grupo: y.grupo, correo: y.correo }; }
    if (rol === 'tutor') { const ok = vinc.filter(v => v.estado === 'vinculado'); return ok.find(v => v.curp === activo) || ok[0] || null; }
    return null;
  }, [rol, yo, vinc, activo]);
  const elegir = c => { localStorage.setItem('sd_alumno', c); setActivo(c); };
  const toast = useAvisoSiguiente(alumno, rol === 'alumno');
  useEffect(() => { setAbre(false); window.scrollTo(0, 0); }, [ruta]);
  const Pag = (PAGINAS[ruta] || {})[rol];
  const ok = vinc.filter(v => v.estado === 'vinculado');
  return (
    <AlumnoCtx.Provider value={alumno}>
      <TutorCtx.Provider value={{ vinc, activo: alumno ? alumno.curp : '', setActivo: elegir }}>
        <div className="app">
          <aside className={'side' + (abre ? ' abre' : '')}>
            <div className="marca"><img src="icon-192.png" alt="" /><span>SHARK DARK<small>CBTIS 170</small></span></div>
            <nav>{MENU[rol].map(([k, t]) => <a key={k} href={'#/' + k} className={ruta === k ? 'on' : ''}>{t}</a>)}</nav>
            <div className="pie">
              <div className="quien"><b>{ses.nombre}</b><small>{ROL[rol]}</small></div>
              <a href="#/cuenta">Mi cuenta</a>
              <button className="salir" onClick={SD.logout}>Salir</button>
            </div>
          </aside>
          <div className={'velo' + (abre ? ' abre' : '')} onClick={() => setAbre(false)} />
          <div className="contenido">
            <div className="top"><button aria-label="Menú" onClick={() => setAbre(true)}>☰</button><b>SHARK DARK</b></div>
            {toast && <div className="toast">{toast}</div>}
            <main>
              {rol === 'tutor' && ok.length > 1 && ruta !== 'perfiles' && (
                <div style={{ marginBottom: 14 }}><label style={{ marginTop: 0 }}>Alumno que estás viendo</label>
                  <select value={alumno ? alumno.curp : ''} onChange={e => elegir(e.target.value)}>{ok.map(v => <option key={v.curp} value={v.curp}>{v.nombre}</option>)}</select></div>
              )}
              {Pag ? <Pag key={ruta + (alumno ? alumno.curp : '')} /> : <div className="card"><p className="vacio">Esta sección no existe.</p></div>}
            </main>
          </div>
        </div>
      </TutorCtx.Provider>
    </AlumnoCtx.Provider>
  );
}

export default function App() {
  const [ses, setSes] = useState(SD.session());
  const [intro, setIntro] = useState(() => !sessionStorage.getItem('sd_intro') && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { sessionStorage.setItem('sd_intro', '1'); }, []);
  return (<>
    {intro && <Intro onFin={() => setIntro(false)} />}
    {ses ? <Shell ses={ses} /> : <Login onOk={() => { location.hash = ''; setSes(SD.session()); }} />}
  </>);
}
