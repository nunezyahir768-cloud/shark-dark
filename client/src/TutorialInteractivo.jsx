import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const EXPLICACIONES = {
  inicio: 'La bienvenida es el punto de partida. Desde aquí puedes abrir este recorrido; en Inicio también encuentras el acceso al menú de tu cuenta.',
  asistencia: { alumno: 'Consulta el porcentaje general, asistencias, faltas y justificadas. La tabla separa resultados por materia y la lista muestra las faltas por fecha, horario y materia.', tutor: 'Consulta el porcentaje, asistencias, faltas y justificadas del alumno seleccionado. Puedes revisar el desglose por materia y los avisos de asistencia.', docente: 'Elige una clase, consulta la lista del grupo y revisa registros. Escanear un QR, cerrar lista o corregir asistencia sí modifica datos; este tutorial no activa esas acciones.' },
  horario: 'Usa los botones de días para cambiar la vista. Cada bloque muestra materia, horas y, según tu rol, el grupo o docente y salón disponibles.',
  calificaciones: { alumno: 'La tabla presenta las notas por materia en los tres parciales y su promedio. El promedio general aparece cuando existen calificaciones.', tutor: 'Consulta las notas del alumno por materia y parcial, además de los promedios disponibles.', docente: 'Elige clase y parcial y pulsa Cargar alumnos para consultar o capturar. Guardar y descargar Excel son acciones reales; no las ejecutaremos durante el recorrido.' },
  permisos: { alumno: 'Aquí puedes consultar los permisos registrados para ti.', tutor: 'Consulta el estado de las solicitudes y, cuando lo necesites, captura fechas y motivo para pedir un permiso. Enviar la solicitud la registra; no lo haremos en este tutorial.', docente: 'Consulta los permisos aprobados para alumnos de tus grupos.', admin: 'Revisa solicitudes pendientes. Aprobar o rechazar cambia su estado y avisa al tutor; no usaremos esos controles durante el tutorial.' },
  avisos: { alumno: 'Lee aquí los avisos de la escuela y su información. Si aparecen controles de lectura, estos actualizan el estado del aviso.', tutor: 'Consulta los mensajes de Servicios Escolares y los avisos relacionados con tus alumnos.', docente: 'Consulta los mensajes de Servicios Escolares.', admin: 'Puedes redactar avisos, elegir destinatarios y enviarlos. Enviar o borrar avisos tiene efectos reales; aquí solo revisaremos la pantalla.' },
  reportes: { alumno: 'Consulta los reportes de conducta que te corresponden y el estado de recepción.', tutor: 'Consulta los reportes correspondientes a tus alumnos vinculados.', docente: 'Puedes registrar un reporte y revisar su recepción. Guardarlo lo envía a administración; no enviaremos uno durante el tutorial.', admin: 'Revisa solicitudes recibidas, registra reportes y confirma su recepción. Confirmar o guardar cambia datos; no usaremos esas acciones.' },
  opciones: 'En Tema puedes elegir Predeterminado, Claro u Oscuro; Predeterminado sigue el dispositivo. Tamaño de fuente ajusta la lectura. Perfiles abre los datos pertinentes a tu rol.',
  cuentas: 'En Cuentas se administran las cuentas escolares y sus datos. Las altas y cambios afectan cuentas reales; el tutorial solo muestra la sección.',
  grupos: 'En Grupos puedes consultar y administrar grupos. Los cambios administrativos se guardan; no los realizaremos aquí.',
  clases: 'En Materias se gestionan materias y sus asignaciones de grupo y docente. Esta pantalla es de administración.',
  horarios: 'En Horarios se capturan y administran los horarios escolares. No modificaremos horarios durante la demostración.',
  historial: 'Consulta los cambios administrativos recientes y quién los realizó.',
  escaner: 'El escáner permite leer el QR de clase o alumno para asistencia. Activar cámara o procesar un código puede registrar asistencia; no iniciaremos la cámara.',
  cuenta: 'Mi cuenta muestra la información de tu cuenta. Si algún dato está incorrecto, la pantalla indica acudir a Servicios Escolares.',
  salir: 'Salir cierra la sesión actual. No pulses esta opción durante el recorrido; el tutorial no cerrará tu sesión.'
};

const texto = (key, rol) => {
  const valor = EXPLICACIONES[key];
  return typeof valor === 'string' ? valor : valor?.[rol] || 'Consulta la información disponible en esta sección.';
};

export default function TutorialInteractivo({ rol, menu, onMenu, onClose }) {
  const pasos = useMemo(() => {
    const lista = [];
    for (const [key, titulo] of menu) {
      lista.push({ tipo: 'menu', key, titulo, texto: `${texto(key, rol)} Para entrar, selecciona «${titulo}» en este menú.` });
      if (key !== 'salir') lista.push({ tipo: 'vista', key, titulo, texto: `${texto(key, rol)} Ya estás en esta sección; revisa el elemento resaltado para ubicar sus controles.` });
    }
    lista.push({ tipo: 'menu', key: 'cuenta', titulo: 'Mi cuenta', texto: `${texto('cuenta', rol)} Para abrirla, pulsa «Mi cuenta» al final del menú lateral.` }, { tipo: 'vista', key: 'cuenta', titulo: 'Mi cuenta', texto: `${texto('cuenta', rol)} Ya estás viendo la información de tu cuenta.` });
    lista.push({ tipo: 'menu', key: 'salir', titulo: 'Salir', texto: `${texto('salir', rol)} El botón está al final del menú. No lo pulses durante el recorrido.` }, { tipo: 'final', titulo: '¡Recorrido completado!', texto: '¡Felicidades! Ya conoces las funciones principales de SHARK DARK disponibles para tu cuenta.' });
    return lista;
  }, [menu, rol]);
  const [indice, setIndice] = useState(0);
  const [posicionTarjeta, setPosicionTarjeta] = useState(null);
  const paso = pasos[indice];

  useEffect(() => {
    setPosicionTarjeta(null);
    const menuAbierto = paso.tipo === 'menu';
    onMenu(menuAbierto);
    if (paso.tipo === 'vista') location.hash = `#/${paso.key}`;
    let selector = null;
    if (paso.tipo === 'menu') selector = paso.key === 'cuenta' ? '.side .pie a[href="#/cuenta"]' : paso.key === 'salir' ? '.side .salir' : `.side nav a[href="#/${paso.key}"]`;
    if (paso.tipo === 'vista') {
      const controles = { asistencia: rol === 'docente' ? '.contenido main select' : '.contenido main .stats', horario: '.contenido main .dias-selector', calificaciones: rol === 'docente' ? '.contenido main select' : '.contenido main .tabla', permisos: rol === 'tutor' ? '.contenido main form' : '.contenido main .card', avisos: '.contenido main .card', reportes: '.contenido main .reporte-panel', opciones: '.contenido main .opciones-item', cuenta: '.contenido main .card', escaner: '.contenido main .card', cuentas: '.contenido main .card', grupos: '.contenido main .card', clases: '.contenido main .card', horarios: '.contenido main .card', historial: '.contenido main .card' };
      selector = controles[paso.key] || '.contenido main .hero';
    }
    let posicionTimer;
    const timer = setTimeout(() => {
      document.querySelectorAll('.tutorial-enfoque').forEach(el => el.classList.remove('tutorial-enfoque'));
      const target = (selector && document.querySelector(selector)) || (paso.tipo === 'vista' && document.querySelector('.contenido main .hero'));
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
    }, paso.tipo === 'vista' ? 220 : 0);
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
    <section className="tutorial-tarjeta" style={posicionTarjeta || undefined} role="dialog" aria-modal="true" aria-label="Tutorial interactivo de SHARK DARK">
      <p className="tutorial-counter">Paso {indice + 1} de {pasos.length}</p>
      <h2>{paso.titulo}</h2>
      <div className="tutorial-texto"><p>{paso.texto}</p></div>
      {paso.tipo === 'vista' && <small>Explora la pantalla; usa Siguiente para volver al menú y continuar.</small>}
      {paso.tipo === 'final' && <button className="btn tutorial-comenzar" onClick={() => { location.hash = '#/inicio'; cerrar(); }}>Comenzar a utilizar SHARK DARK</button>}
      <div className="tutorial-acciones">
        <button className="btn sec" onClick={anterior} disabled={indice === 0}>Anterior</button>
        <button className="mini" onClick={cerrar}>Omitir tutorial</button>
        {paso.tipo !== 'final' && <button className="btn" onClick={siguiente}>Siguiente</button>}
      </div>
    </section>
  </>, document.body);
}
