import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const EXPLICACIONES = {
  inicio: 'Vuelve a la pantalla principal.',
  asistencia: { alumno: 'Revisa tus asistencias y faltas.', tutor: 'Consulta la asistencia de tus alumnos.', docente: 'Pasa lista y revisa tus grupos.' },
  horario: 'Consulta tus materias y horarios.',
  calificaciones: { alumno: 'Consulta tus calificaciones y promedios.', tutor: 'Revisa las calificaciones de tus alumnos.', docente: 'Consulta o captura calificaciones.' },
  permisos: { alumno: 'Consulta tus permisos.', tutor: 'Solicita y revisa permisos de tus alumnos.', docente: 'Consulta permisos de tus grupos.', admin: 'Revisa solicitudes de permisos.' },
  avisos: { alumno: 'Lee los avisos de la escuela.', tutor: 'Consulta avisos y mensajes escolares.', docente: 'Consulta avisos escolares.', admin: 'Envía avisos a la comunidad escolar.' },
  reportes: { alumno: 'Consulta tus reportes.', tutor: 'Revisa los reportes de tus alumnos.', docente: 'Registra y consulta reportes.', admin: 'Revisa y gestiona reportes.' },
  opciones: 'Personaliza el tema y el tamaño de letra.',
  cuentas: 'Administra las cuentas escolares.',
  grupos: 'Consulta y administra grupos.',
  clases: 'Administra materias y asignaciones.',
  horarios: 'Consulta y administra horarios.',
  historial: 'Consulta los cambios administrativos recientes.',
  escaner: 'Escanea códigos QR para asistencia.'
};

const texto = (key, rol) => {
  const valor = EXPLICACIONES[key];
  return typeof valor === 'string' ? valor : valor?.[rol] || 'Consulta la información disponible en esta sección.';
};

export default function TutorialInteractivo({ rol, menu, enBarra = [], onMenu, onClose }) {
  const pasos = useMemo(() => {
    const orden = [...menu.filter(([k]) => enBarra.includes(k)).sort((a, b) => enBarra.indexOf(a[0]) - enBarra.indexOf(b[0])), ...menu.filter(([k]) => !enBarra.includes(k))];
    const lista = orden.map(([key, titulo]) => ({ tipo: 'menu', key, titulo, texto: texto(key, rol), enBarra: enBarra.includes(key) }));
    lista.push({ tipo: 'final', titulo: '¡Listo!', texto: 'Ya conoces las secciones principales de tu cuenta.' });
    return lista;
  }, [menu, rol, enBarra]);
  const [indice, setIndice] = useState(0);
  const [posicionTarjeta, setPosicionTarjeta] = useState(null);
  const paso = pasos[indice];

  useEffect(() => {
    setPosicionTarjeta(null);
    const menuAbierto = paso.tipo === 'menu' && !paso.enBarra;
    onMenu(menuAbierto);
    let selector = null;
    if (paso.tipo === 'menu') selector = paso.enBarra ? `.nav-flotante a[href="#/${paso.key}"]` : `.side nav a[href="#/${paso.key}"]`;
    let posicionTimer;
    const timer = setTimeout(() => {
      document.querySelectorAll('.tutorial-enfoque').forEach(el => el.classList.remove('tutorial-enfoque'));
      const target = selector && document.querySelector(selector);
      if (target) {
        target.classList.add('tutorial-enfoque');
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        target.closest('.apartado-vista')?.classList.add('tutorial-vista-activa');
        posicionTimer = setTimeout(() => {
          const tarjeta = document.querySelector('.tutorial-tarjeta');
          if (!tarjeta) return;
          const foco = target.getBoundingClientRect(), caja = tarjeta.getBoundingClientRect(), margen = 12, alto = window.innerHeight;
          const seCruzan = foco.bottom + margen > caja.top && foco.top - margen < caja.bottom;
          if (!seCruzan) return setPosicionTarjeta(null);
          if (foco.top - margen >= caja.height) setPosicionTarjeta({ top: `${Math.max(margen, foco.top - caja.height - margen)}px`, bottom: 'auto' });
          else if (alto - foco.bottom - margen >= caja.height) setPosicionTarjeta({ top: `${foco.bottom + margen}px`, bottom: 'auto' });
          else setPosicionTarjeta(null);
        }, 40);
      }
    }, 0);
    return () => { clearTimeout(timer); clearTimeout(posicionTimer); document.querySelectorAll('.tutorial-enfoque').forEach(el => el.classList.remove('tutorial-enfoque')); document.querySelectorAll('.tutorial-vista-activa').forEach(el => el.classList.remove('tutorial-vista-activa')); };
  }, [indice, paso, onMenu]);

  const cerrar = () => { document.querySelectorAll('.tutorial-enfoque').forEach(el => el.classList.remove('tutorial-enfoque')); document.querySelectorAll('.tutorial-vista-activa').forEach(el => el.classList.remove('tutorial-vista-activa')); onClose(); };
  const siguiente = () => {
    if (paso.tipo === 'final') { location.hash = '#/inicio'; cerrar(); return; }
    setIndice(i => Math.min(i + 1, pasos.length - 1));
  };
  const anterior = () => setIndice(i => Math.max(0, i - 1));

  return createPortal(<>
    <div className="tutorial-sombra" aria-hidden="true" />
    <section className="tutorial-tarjeta" style={posicionTarjeta || undefined} role="dialog" aria-modal="true" aria-label="Tutorial interactivo de TIBURONES">
      <p className="tutorial-counter">Paso {indice + 1} de {pasos.length}</p>
      <h2>{paso.titulo}</h2>
      <div className="tutorial-texto"><p>{paso.texto}</p></div>
      {paso.tipo === 'final' && <button className="btn tutorial-comenzar" onClick={() => { location.hash = '#/inicio'; cerrar(); }}>Comenzar a utilizar TIBURONES</button>}
      <div className="tutorial-acciones">
        <button className="btn sec" onClick={anterior} disabled={indice === 0}>Anterior</button>
        <button className="mini" onClick={cerrar}>Omitir tutorial</button>
        {paso.tipo !== 'final' && <button className="btn" onClick={siguiente}>Siguiente</button>}
      </div>
    </section>
  </>, document.body);
}
