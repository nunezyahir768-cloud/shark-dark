import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import SD from './sd.js';
import Intro from './Intro.jsx';
import Logo from './Logo.jsx';
import Login, { CambiarPassword } from './Login.jsx';
import { AlumnoCtx, TutorCtx, ROL, estadoHorario, delGrupo, conDescanso, hh } from './ui.jsx';
import { Inicio, PerfilAlumno, PerfilesTutor, AsistenciaVer, Horario, CalifVer, Permisos, Avisos, Cuenta, Opciones } from './paginas.jsx';
import { AsistenciaDocente, CalifDocente } from './docente.jsx';
import { InicioAdmin, Cuentas, Grupos, Clases, Horarios, Escaner, Historial } from './servicios.jsx';
import ReportesConducta from './ReportesConducta.jsx';

const ICONOS_MENU = {
  inicio: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>,
  perfil: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  asistencia: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>,
  horario: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  calificaciones: <><path d="M4 20V10m5 10V4m5 16v-7m5 7V7" /><path d="M2 20h20" /></>,
  permisos: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  avisos: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  reportes: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  opciones: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  cuentas: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
  grupos: <><circle cx="12" cy="8" r="3" /><circle cx="5" cy="11" r="2" /><circle cx="19" cy="11" r="2" /><path d="M6 21a6 6 0 0 1 12 0M1.5 19a4 4 0 0 1 4-4m13 0a4 4 0 0 1 4 4" /></>,
  clases: <><path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H21v17H6.5A3.5 3.5 0 0 0 3 22z" /><path d="M3 5.5v13A3.5 3.5 0 0 1 6.5 15H21M8 6h8" /></>,
  horarios: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  escaner: <><path d="M4 8V4h4m8 0h4v4M20 16v4h-4M8 20H4v-4M4 12h16" /></>,
  historial: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>
};
const IconoMenu = ({ nombre }) => <svg className="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONOS_MENU[nombre]}</svg>;

const MENU = {
  alumno: [['inicio', 'Inicio'], ['asistencia', 'Asistencia'], ['horario', 'Horario'], ['calificaciones', 'Calificaciones'], ['permisos', 'Permisos'], ['avisos', 'Actividad'], ['reportes', 'Reportes'], ['opciones', 'Opciones']],
  tutor: [['inicio', 'Inicio'], ['asistencia', 'Asistencia'], ['permisos', 'Permisos'], ['horario', 'Horario'], ['calificaciones', 'Calificaciones'], ['avisos', 'Actividad'], ['reportes', 'Reportes'], ['opciones', 'Opciones']],
  docente: [['inicio', 'Inicio'], ['horario', 'Horario'], ['asistencia', 'Asistencia'], ['reportes', 'Reportes'], ['avisos', 'Actividad'], ['calificaciones', 'Calificaciones'], ['permisos', 'Permisos'], ['opciones', 'Opciones']],
  admin: [['inicio', 'Inicio'], ['cuentas', 'Cuentas'], ['grupos', 'Grupos'], ['clases', 'Materias'], ['horarios', 'Horarios'], ['permisos', 'Permisos'], ['avisos', 'Actividad'], ['reportes', 'Reportes'], ['historial', 'Historial'], ['escaner', 'Escáner'], ['opciones', 'Opciones']]
};
const INICIO = { alumno: 'inicio', tutor: 'inicio', docente: 'inicio', admin: 'inicio' };
const PAGINAS = {
  inicio: { alumno: Inicio, tutor: Inicio, docente: Inicio, admin: InicioAdmin },
  perfil: { alumno: PerfilAlumno }, perfiles: { tutor: PerfilesTutor },
  asistencia: { alumno: AsistenciaVer, tutor: AsistenciaVer, docente: AsistenciaDocente },
  horario: { alumno: Horario, tutor: Horario, docente: Horario },
  calificaciones: { alumno: CalifVer, tutor: CalifVer, docente: CalifDocente },
  permisos: { alumno: Permisos, tutor: Permisos, docente: Permisos, admin: Permisos },
  avisos: { alumno: Avisos, tutor: Avisos, docente: Avisos, admin: Avisos },
  reportes: { alumno: ReportesConducta, tutor: ReportesConducta, docente: ReportesConducta, admin: ReportesConducta },
  opciones: { alumno: Opciones, tutor: Opciones, docente: Opciones, admin: Opciones },
  cuenta: { alumno: Cuenta, tutor: Cuenta, docente: Cuenta, admin: Cuenta },
  cuentas: { admin: Cuentas }, grupos: { admin: Grupos }, clases: { admin: Clases }, horarios: { admin: Horarios }, escaner: { admin: Escaner }, historial: { admin: Historial }
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

function Shell({ ses, tema, setTema, tamanoFuente, setTamanoFuente }) {
  const rol = ses.rol, [abre, setAbre] = useState(false);
  const ruta = useRuta() || INICIO[rol];
  const [yo, setYo] = useState(null), [vinc, setVinc] = useState([]), [activo, setActivo] = useState(sessionStorage.getItem('sd_alumno') || '');
  useEffect(() => {
    if (rol === 'alumno') SD.api('/api/yo').then(setYo).catch(() => setYo(ses));
    if (rol === 'tutor') SD.vinculos().then(setVinc);
  }, [rol]);
  const alumno = useMemo(() => {
    if (rol === 'alumno') { const y = yo || ses; return { curp: y.curp || y.id, nombre: y.nombre, area: y.area, semestre: y.semestre, grupo: y.grupo, correo: y.correo }; }
    if (rol === 'tutor') { const ok = vinc.filter(v => v.estado === 'vinculado'); return ok.find(v => v.curp === activo) || ok[0] || null; }
    return null;
  }, [rol, yo, vinc, activo]);
  const elegir = c => { sessionStorage.setItem('sd_alumno', c); setActivo(c); };
  const toast = useAvisoSiguiente(alumno, rol === 'alumno');
  useEffect(() => { setAbre(false); window.scrollTo(0, 0); }, [ruta]);
  const Pag = (PAGINAS[ruta] || {})[rol];
  const paginaProps = ruta === 'opciones' ? { tema, setTema, tamanoFuente, setTamanoFuente, rol } : {};
  const ok = vinc.filter(v => v.estado === 'vinculado');
  return (
    <AlumnoCtx.Provider value={alumno}>
      <TutorCtx.Provider value={{ vinc, activo: alumno ? alumno.curp : '', setActivo: elegir }}>
        <div className="app">
          <aside className={'side' + (abre ? ' abre' : '')}>
            <div className="marca"><Logo darkIcon alt="SHARK DARK CBTIS 170" /><span>SHARK DARK<small>CBTIS 170</small></span></div>
            <button className="side-close" type="button" aria-label="Cerrar menú" onClick={() => setAbre(false)}>×</button>
            <nav>{MENU[rol].map(([k, t]) => {
              const activa = ruta === k || (k === 'opciones' && (ruta === 'perfiles' || ruta === 'perfil'));
              return <a key={k} href={'#/' + k} className={activa ? 'on' : ''} aria-current={activa ? 'page' : undefined}><IconoMenu nombre={k} /><span>{t}</span></a>;
            })}</nav>
            <div className="pie">
              <div className="quien"><b>{ses.nombre}</b><small>{ROL[rol]}</small></div>
              <a href="#/cuenta">Mi cuenta</a>
              <button className="salir" onClick={SD.logout}>Salir</button>
            </div>
          </aside>
          <div className={'velo' + (abre ? ' abre' : '')} onClick={() => setAbre(false)} />
          <div className="contenido">
            <div className="top"><button aria-label="Abrir menú" aria-expanded={abre} onClick={() => setAbre(true)}>☰</button><b>{rol === 'admin' ? 'CONTROL ESCOLAR' : 'SHARK DARK'}</b></div>
            {toast && <div className="toast">{toast}</div>}
            <main>
              {rol === 'tutor' && ok.length > 1 && ruta !== 'perfiles' && (
                <div style={{ marginBottom: 14 }}><label style={{ marginTop: 0 }}>Alumno que estás viendo</label>
                  <select value={alumno ? alumno.curp : ''} onChange={e => elegir(e.target.value)}>{ok.map(v => <option key={v.curp} value={v.curp}>{v.nombre}</option>)}</select></div>
              )}
              {Pag ? <Pag key={ruta + (alumno ? alumno.curp : '')} {...paginaProps} /> : <div className="card"><p className="vacio">Esta sección no existe.</p></div>}
            </main>
          </div>
        </div>
      </TutorCtx.Provider>
    </AlumnoCtx.Provider>
  );
}

export default function App() {
  const [ses, setSes] = useState(null), [ready, setReady] = useState(false);
  const [tema, setTema] = useState(() => {
    const guardado = localStorage.getItem('sd_tema');
    return ['claro', 'oscuro', 'predeterminado'].includes(guardado) ? guardado : 'predeterminado';
  });
  const [tamanoFuente, setTamanoFuente] = useState(() => {
    const guardado = localStorage.getItem('sd_tamano_fuente');
    return ['pequena', 'normal', 'grande'].includes(guardado) ? guardado : 'normal';
  });
  const [intro, setIntro] = useState(() => !sessionStorage.getItem('sd_intro') && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const controlRoute = location.pathname.replace(/\/+$/, '') === '/control-escolar';
  useEffect(() => { SD.init().then(setSes).catch(() => setSes(null)).finally(() => setReady(true)); }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const preferenciaSistema = window.matchMedia('(prefers-color-scheme: dark)');
    const aplicarTema = () => {
      const temaAplicado = tema === 'predeterminado' ? (preferenciaSistema.matches ? 'oscuro' : 'claro') : tema;
      root.dataset.tema = temaAplicado;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = temaAplicado === 'oscuro' ? '#080808' : '#F5F2EC';
      const icono = temaAplicado === 'oscuro' ? '/icon-192.png' : '/icon-192-claro.png';
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(link => { link.href = icono; });
    };
    aplicarTema();
    root.dataset.tamanoFuente = tamanoFuente;
    localStorage.setItem('sd_tema', tema);
    localStorage.setItem('sd_tamano_fuente', tamanoFuente);
    if (tema === 'predeterminado') {
      preferenciaSistema.addEventListener('change', aplicarTema);
      return () => preferenciaSistema.removeEventListener('change', aplicarTema);
    }
  }, [tema, tamanoFuente]);
  useEffect(() => { sessionStorage.setItem('sd_intro', '1'); }, []);
  useEffect(() => {
    if (ses && ses.rol === 'admin' && !controlRoute) location.replace('/control-escolar' + location.hash);
  }, [ses, controlRoute]);
  if (ses && ses.rol === 'admin' && !controlRoute) return null;
  const sesVisible = controlRoute && ses && ses.rol !== 'admin' ? null : ses;
  return (<>
    {intro && <Intro onFin={() => setIntro(false)} />}
    {ready && (sesVisible ? (sesVisible.debeCambiarPassword ? <CambiarPassword onDone={() => setSes(SD.session())} /> : <Shell ses={sesVisible} tema={tema} setTema={setTema} tamanoFuente={tamanoFuente} setTamanoFuente={setTamanoFuente} />) : <Login onOk={() => { location.hash = ''; setSes(SD.session()); }} />)}
  </>);
}
