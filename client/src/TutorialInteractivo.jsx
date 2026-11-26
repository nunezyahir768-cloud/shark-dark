import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const EXPLICACIONES = {
  inicio: 'Esta es la pantalla principal de tu cuenta. Desde aquí puedes volver a empezar el recorrido y consultar la información destacada. Para cambiar de sección, usa el menú lateral o los botones de navegación de la parte inferior. En cada paso del tutorial se ilumina una opción del menú para que sepas dónde encontrarla.',
  asistencia: {
    alumno: 'Aquí puedes revisar las listas de asistencia que registraron tus docentes. Consulta por materia y fecha para distinguir los días que asististe, las faltas y las retardos. Si ves un dato que no coincide, habla con tu docente o con Control Escolar para que lo revisen.',
    tutor: 'Selecciona al alumno que quieres consultar y revisa sus asistencias por materia y fecha. La lista permite identificar asistencias, faltas y retardos. Si tienes más de un alumno vinculado, cambia de alumno desde el selector de la pantalla.',
    docente: 'Elige uno de tus grupos y la materia correspondiente para pasar lista. Marca el estado de cada alumno y guarda la lista para registrar la asistencia. También puedes consultar listas anteriores. Si no aparece un grupo o una materia, revisa tu horario o solicita que actualicen tu asignación.'
  },
  horario: 'Consulta las materias, los días y las horas de clase que corresponden a tu cuenta. Si eres tutor, selecciona primero al alumno que deseas revisar. Si eres docente, verás los grupos y clases que tienes asignados. El horario te ayuda a confirmar qué clase corresponde a cada bloque.',
  calificaciones: {
    alumno: 'Consulta las calificaciones que tus docentes ya publicaron. Elige o revisa cada materia para ver las notas disponibles por parcial. Un parcial puede no mostrarse todavía si su periodo de captura sigue abierto; las notas aparecen cuando la escuela las publica.',
    tutor: 'Selecciona al alumno vinculado y revisa sus calificaciones publicadas por materia y parcial. Si una nota aún no aparece, puede ser porque el docente todavía está capturándola o porque el parcial no se ha publicado.',
    docente: 'Elige el grupo, la materia y el parcial para consultar o capturar las calificaciones de tus alumnos. Escribe cada nota dentro de la escala indicada y guarda los cambios. Revisa el grupo antes de guardar para asegurarte de que las notas correspondan a la clase correcta.',
    admin: 'Esta sección es de consulta. Filtra por área y semestre, elige un grupo y selecciona el parcial para ver las calificaciones que capturaron los docentes. Cada columna corresponde a una materia y cada fila a un alumno.'
  },
  permisos: {
    alumno: 'Consulta las solicitudes de permiso relacionadas con tu cuenta y revisa su estado. Si tienes dudas sobre una respuesta o necesitas solicitar un permiso, coméntalo con tu tutor o con la escuela.',
    tutor: 'Elige al alumno, completa las fechas y explica el motivo para enviar una solicitud de permiso. Después puedes volver a esta sección para revisar si fue aprobada o si sigue pendiente.',
    docente: 'Consulta las solicitudes de permiso de tus grupos y revisa su estado. Atiende las solicitudes que te correspondan según las indicaciones de la escuela.',
    admin: 'Revisa las solicitudes de permiso pendientes y su información. Usa esta sección para dar seguimiento a cada solicitud de acuerdo con las reglas de la escuela.'
  },
  avisos: {
    alumno: 'Lee aquí los comunicados y notificaciones escolares. Abre cada aviso para revisar el mensaje completo y márcalo como revisado cuando termines.',
    tutor: 'Consulta los comunicados de la escuela y las notificaciones relacionadas con tus alumnos. Revisa las fechas y las indicaciones; marca los avisos como revisados cuando los hayas leído.',
    docente: 'Lee los comunicados escolares y avisos que te envía la administración. Vuelve a esta sección para consultar las indicaciones y fechas importantes.',
    admin: 'Lic. Sara puede enviar comunicados a los grupos de usuarios que elija. En esta sección también puede programar un día o un periodo corto sin clases; esas fechas bloquean la asistencia y generan un aviso para la comunidad.'
  },
  reportes: {
    alumno: 'Consulta los reportes asociados con tu cuenta y revisa si tienen información de seguimiento. Si necesitas aclarar un reporte, pregunta a la persona que lo registró o a Control Escolar.',
    tutor: 'Selecciona al alumno vinculado para consultar sus reportes y el seguimiento registrado por la escuela.',
    docente: 'Registra un reporte seleccionando al alumno y describiendo lo ocurrido con claridad. Después podrás consultar tus reportes y el estado de revisión de Control Escolar.',
    admin: 'Consulta los reportes enviados por docentes y administración, revisa su seguimiento y atiende los que estén pendientes de confirmación.'
  },
  opciones: 'Cambia el tema de la aplicación y el tamaño del texto para que la lectura te resulte más cómoda. Los cambios se aplican a tu cuenta en este dispositivo.',
  cuentas: 'Control Escolar organiza las cuentas en tres secciones: Alumnos, Tutores y Docentes. Abre una sección para buscar por nombre o CURP; en Alumnos también puedes filtrar por área, semestre y grupo. Desde cada cuenta están disponibles las acciones correspondientes, como cambiar el grupo de un alumno o vincular un tutor.',
  grupos: 'Consulta los grupos existentes y las cuentas de alumnos registradas en cada uno. Las acciones disponibles permiten revisar o administrar las cuentas del grupo; eliminar cuentas de alumnos no elimina automáticamente las materias ni los horarios del grupo.',
  clases: 'Administra las materias y asígnalas al grupo y docente correspondientes. Revisa cuidadosamente área, semestre y grupo para que cada clase quede en la lista correcta y aparezca en los horarios.',
  horarios: 'Consulta o administra los horarios. Elige semestre, área y grupo para revisar las clases y sus horas. Al crear o cambiar un horario, verifica que los bloques no se encimen y que la materia y el docente sean correctos.',
  periodos: 'Control Escolar configura las fechas oficiales del ciclo y de los parciales. Los parciales se habilitan en orden: el segundo aparece cuando termina el primero y el tercero cuando termina el segundo. Lic. Sara programa los días o periodos sin clases desde Notificaciones.',
  historial: 'Consulta los cambios administrativos recientes, quién los realizó y cuándo. Puedes buscar una acción o un nombre para localizar un registro.',
  escaner: 'Usa la cámara para leer el código QR de una clase o credencial. Centra el código dentro de la imagen y espera a que la aplicación lo reconozca antes de continuar con la asistencia.'
};

const texto = (key, rol) => {
  const valor = EXPLICACIONES[key];
  return typeof valor === 'string' ? valor : valor?.[rol] || 'Consulta la información disponible en esta sección.';
};

export default function TutorialInteractivo({ rol, menu, enBarra = [], onMenu, onClose }) {
  const pasos = useMemo(() => {
    const orden = [...menu.filter(([k]) => enBarra.includes(k)).sort((a, b) => enBarra.indexOf(a[0]) - enBarra.indexOf(b[0])), ...menu.filter(([k]) => !enBarra.includes(k))];
    const lista = [{ tipo: 'intro', titulo: 'Cómo usar este tutorial', texto: 'Avanza con “Siguiente” y usa “Anterior” si quieres volver a leer algo. En los pasos de secciones administrativas se abrirá el menú y se resaltará la opción correspondiente. Puedes omitir el recorrido en cualquier momento; no cambia ni guarda información de tu cuenta.' }, ...orden.map(([key, titulo]) => ({ tipo: 'menu', key, titulo, texto: texto(key, rol), enBarra: enBarra.includes(key) }))];
    lista.push({ tipo: 'final', titulo: '¡Listo!', texto: 'Ya recorriste las secciones disponibles para tu cuenta. Cierra el tutorial o pulsa “Comenzar a utilizar TIBURONES” para volver a Inicio. Puedes repetir el tutorial más adelante desde las opciones de tu cuenta.' });
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
      <div className="tutorial-texto">{paso.texto.split('\n\n').map((parrafo, i) => <p key={i}>{parrafo}</p>)}</div>
      {paso.tipo === 'final' && <button className="btn tutorial-comenzar" onClick={() => { location.hash = '#/inicio'; cerrar(); }}>Comenzar a utilizar TIBURONES</button>}
      <div className="tutorial-acciones">
        <button className="btn sec" onClick={anterior} disabled={indice === 0}>Anterior</button>
        <button className="mini" onClick={cerrar}>Omitir tutorial</button>
        {paso.tipo !== 'final' && <button className="btn" onClick={siguiente}>Siguiente</button>}
      </div>
    </section>
  </>, document.body);
}
