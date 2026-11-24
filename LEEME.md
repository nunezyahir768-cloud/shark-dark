# SHARK DARK · CBTIS 170

Portal escolar: asistencia con QR, horarios, calificaciones, permisos y avisos.
Funciona en celular, tablet y computadora (se instala como app) y sigue sirviendo sin internet.

## Las 6 herramientas (explicadas fácil)

| Herramienta | Para qué sirve | Dónde está en tu proyecto |
|---|---|---|
| **Visual Studio Code** | Es tu cuaderno: ahí abres y editas los archivos | La carpeta completa `shark-dark` |
| **React** | Son las piezas de lego de las pantallas | `client/src/` |
| **Node.js + Express** | Es la cocina: recibe los pedidos y responde | `server.js` |
| **MongoDB Atlas** | Es la bodega donde se guardan los datos | Se conecta con `MONGODB_URI` |
| **Git + GitHub** | Es la caja fuerte con historial de cambios | Tu repositorio `shark-dark` |
| **Render** | Es la tienda abierta en internet | `https://shark-dark.onrender.com` |

## Carpetas

```
shark-dark/
├── server.js          ← el servidor (Node + Express + MongoDB)
├── build.mjs          ← convierte React en archivos que entiende el navegador
├── package.json       ← lista de librerías y comandos
├── .env               ← TUS CLAVES (solo en tu compu; nunca se sube)
├── client/src/        ← las pantallas en React
│   ├── App.jsx        ← menú lateral y rutas
│   ├── Login.jsx      ← inicio de sesión
│   ├── Intro.jsx      ← animación de entrada
│   ├── paginas.jsx    ← alumno y tutor (y pantallas comunes)
│   ├── docente.jsx    ← asistencia, calificaciones y reportes del docente
│   ├── servicios.jsx  ← Servicios Escolares (cuentas, grupos, horarios; las materias se crean solas al armar el horario)
│   ├── sd.js          ← lo que guarda datos sin internet y sincroniza
│   └── styles.css     ← colores y diseño
└── public/            ← lo que ve el navegador (el resultado de React queda aquí)
```

## Cómo trabajar (primera vez en tu compu)

1. Instala **Node.js** (nodejs.org, botón verde LTS), **Git** (git-scm.com) y **Visual Studio Code** (code.visualstudio.com).
2. En VS Code: **Archivo → Abrir carpeta** y elige `shark-dark`.
3. Abre la terminal de VS Code: menú **Terminal → Nueva terminal**.
4. Crea el archivo `.env` (copia `.env.example`, cámbiale el nombre a `.env` y llena tus datos).
5. En la terminal escribe, uno por uno:
   - `npm install`  (descarga las librerías; solo la primera vez)
   - `npm run build`  (arma las pantallas de React)
   - `npm start`  (enciende el servidor)
6. Abre `http://localhost:3000` en el navegador.
7. Cada vez que cambies algo de `client/src/`, vuelve a escribir `npm run build` y recarga la página.
   (Atajo: `npm run dev` hace build y enciende el servidor.)

## Cómo subir los cambios (Git y GitHub desde VS Code)

En la terminal de VS Code:

```
git add .
git commit -m "Describe aquí qué cambiaste"
git push
```

Render detecta el cambio solo y publica la nueva versión en unos minutos.

## Render (la configuración que debes tener)

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Environment (variables):**
  - `MONGODB_URI` → la dirección de tu Atlas (con tu clave). El servidor selecciona la base `SHARK-DARK`.
  - `TOKEN_SECRET` → una frase larga y secreta
  - `ADMIN_ACCESS_PASSWORD` -> password elegido para Control Escolar; configuralo en Render Environment.
  - `ADMIN_ACCESS_PASSWORD_SARA` -> password para Lic. Sara.
  - `ADMIN_ACCESS_PASSWORD_GABRIELA` -> password para Ing. Gabriela.
  - `ADMIN_ACCESS_PASSWORD_PORTERO` -> password para Portero.
  - `ADMIN_CURP` (opcional) -> identidad interna del administrador para avisos push.
- Ya NO se usan `ADMIN_PASSWORD`, `ADMIN_RFC`, `CODIGO_DOCENTE` ni `CODIGO_ADMIN`: puedes borrarlas.

## Inicio de sesión y contraseñas

- Alumnos, tutores y docentes escriben su **CURP**; el sistema identifica el tipo de cuenta y después pide la contraseña si ya existe.
- Control Escolar entra en `/control-escolar` solo con la variable secreta `ADMIN_ACCESS_PASSWORD`, configurada en Render Environment.
- El administrador da de alta primero la cuenta. La persona activa su cuenta con su CURP y crea una contraseña propia (mínimo 4 caracteres). Solo puede hacerlo una vez mientras la cuenta esté pendiente de activación.
- La contraseña se guarda protegida con `scrypt`, nunca en texto plano. Alumnos pueden usar la misma CURP y contraseña en otros dispositivos conectados a internet.
- Configura `ADMIN_ACCESS_PASSWORD` en Render con el password elegido para Control Escolar. Al cambiarla, reinicia o vuelve a desplegar el servicio.
- Si alguien olvida su contraseña, envía una solicitud desde el inicio de sesión. Administración la revisa en **Cuentas → Solicitudes de restablecimiento**, verifica la identidad y genera una contraseña temporal.
- La contraseña temporal se muestra una sola vez al administrador. Debe entregarse al titular por un canal privado; al entrar tendrá que crear otra.
- Las solicitudes no revelan si una CURP existe y tienen limitación de frecuencia.

Control Escolar tiene su propio menú de cuentas, grupos, materias, horarios, permisos, avisos, reportes e historial. Los avisos pueden marcarse como revisados; los cambios administrativos relevantes quedan registrados con responsable y fecha. En **Reportes**, docentes y administración pueden registrar reportes de conducta con alumno, lugar, descripción y seguimiento opcional. Los reportes de docentes quedan pendientes hasta que administración confirme su recepción; los creados por administración quedan confirmados directamente. Cada alumno puede consultar sus propios reportes y cada tutor los de sus alumnos vinculados.

Orden recomendado para empezar:
1. **Cuentas** → crea docentes, tutores y alumnos (el alumno lleva semestre, área y grupo A, B o C; el grupo se crea solo)
2. **Cuentas → Vincular alumno** → une a cada tutor con sus hijos
3. **Materias** (materia + grupo + docente)
4. **Horarios** (el descanso de 9:30 a 10:00 ya está fijo)
5. **Avisos** y **Permisos** cuando haga falta

**Grupos** solo muestra los grupos; ahí se puede **eliminar un grupo con todas sus cuentas**.

## Importante sobre la seguridad

- No compartas la contraseña inicial ni las contraseñas temporales.
- Servicios Escolares debe comprobar la identidad antes de aprobar una recuperación.
- La contraseña temporal se debe entregar por un canal privado y no debe enviarse en grupos.
- Mantén `TOKEN_SECRET`, `MONGODB_URI` y `ADMIN_ACCESS_PASSWORD` únicamente en variables de entorno; nunca las subas a GitHub.
- Los usuarios que ya existían antes de activar el inicio con contraseña deben solicitar un restablecimiento para recibir su contraseña temporal.

## Notas

- El recordatorio de "faltan 5 minutos para que termine la clase" y los reportes confirmados por Control Escolar se envían por push a los alumnos. Los avisos escolares se envían a los roles elegidos y los avisos de asistencia también llegan a tutores, aun con la app cerrada, cuando las claves VAPID están configuradas y activaron notificaciones en ese dispositivo.
- Si cambias de equipo, borra el archivo `package-lock.json` viejo del repositorio; `npm install` crea uno nuevo.

### Notificaciones push con la app cerrada

El envío push requiere estas variables en el entorno del servidor: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Genera el par de claves una vez con `npx web-push generate-vapid-keys` y guárdalo como variables privadas en el proveedor de hosting (la clave pública se entrega al navegador desde el servidor). No publiques la clave privada. Después de desplegar, cada usuario de cualquier rol debe iniciar sesión y activar Notificaciones desde Opciones en cada dispositivo. Las notificaciones dependen de que el navegador/sistema permita push y de que el servidor esté disponible.


## Identidad visual, tutorial y horario

- La marca compartida de la app usa `public/img/logo-oscuro.png` en modo oscuro (PNG con fondo transparente, también usado en la intro) y `public/img/logo-claro.png` solo en modo claro; este último conserva su fondo blanco.
- Los iconos de `public/icon-192.png`/`public/icon-512.png` y sus variantes `*-claro.png` se usan en las pestañas, notificaciones y accesos de la app según corresponda al tema.
- SHARK DARK tiene una interfaz moderna, elegante y profesional, con una identidad visual de tonos oscuros y detalles dorados.
- La paleta de marca usa negro principal (`#0B0B0B`), gris oscuro (`#1F1F1F`), rojo principal (`#D6000F`), rojo oscuro (`#8B0008`), dorado principal (`#D4AF37`) y dorado claro (`#F7E7B3`).
- Las tarjetas oscuras tienen esquinas redondeadas y bordes dorados discretos; los botones usan un degradado dorado; y los menús se adaptan a computadoras, tabletas y celulares. Los formularios usan campos oscuros y bordes discretos.
- La tipografía sans-serif mantiene una lectura limpia y consistente. El fondo incorpora sutiles formas inspiradas en hojas oscuras.
- Esta identidad busca transmitir innovación, confianza, organización y modernidad en el entorno educativo.
- En Inicio aparece el apartado **Conoce tu plataforma escolar**. Cuando tengas tu video, guárdalo con el nombre `tutorial.mp4` dentro de `public/`. La ruta debe quedar `public/tutorial.mp4`; después ejecuta `npm run build` y sube los cambios.
- El horario permite elegir el día y muestra cada materia en una tarjeta con docente, salón y horas. Los datos reales siguen dependiendo de lo que capture Servicios Escolares.


### Acceso actualizado de alumnos y administrador

- Servicios Escolares primero da de alta al alumno con su nombre y CURP.
- En la pantalla de entrada, el alumno elige **¿Primera vez? Crea tu contraseña**, escribe su CURP y crea una contraseña de al menos 4 caracteres.
- La contraseña se guarda en MongoDB como hash con salt; no se almacena en texto plano. Después puede entrar en cualquier dispositivo con CURP y contraseña.
- Control Escolar entra en `/control-escolar` solo con la variable secreta `ADMIN_ACCESS_PASSWORD`, configurada en Render Environment.

## Inicio offline y datos locales

- Para habilitar credenciales offline, `TOKEN_SECRET` debe estar configurado tanto al ejecutar `npm run build` como al iniciar el servidor. El build incluye solo una clave pública derivada; la clave privada nunca se envía al navegador. Render debe tener `TOKEN_SECRET` entre sus variables de entorno durante el build y la ejecución.
- Cada usuario (alumno, tutor, docente o Control Escolar) debe iniciar sesión online una vez en ese dispositivo. La app guarda un ticket firmado con vigencia de 24 horas y cifrado con AES-GCM; la clave se deriva de la contraseña mediante PBKDF2. No guarda la contraseña ni el token de acceso en `localStorage`.
- Los datos escolares y cachés locales de la app se cifran en IndexedDB o `localStorage`. Al abrir o recargar, se pide la contraseña para desbloquearlos. Cerrar sesión borra la sesión de memoria y conserva la credencial offline hasta su vencimiento.
- La sesión offline permite consultar datos ya sincronizados. Docentes pueden dejar asistencias pendientes; el indicador muestra cuántas faltan. Al recuperar internet, la app vuelve al login y exige validación online antes de sincronizar. Las acciones administrativas no se autorizan offline.
- Una cuenta revocada o una contraseña cambiada no se pueden conocer mientras el dispositivo está desconectado. Al volver internet se requiere un login online y el servidor aplica el estado actual; sin conexión, el ticket puede permitir consulta hasta que venza (máximo 24 horas).
- El cifrado protege los datos guardados frente a lectura casual del almacenamiento del navegador, pero un dispositivo controlado por el usuario no es una bóveda confiable: malware, extensiones o código malicioso ejecutado en el sitio pueden acceder a datos mientras la sesión está abierta. Protege el dispositivo y mantén el sitio libre de XSS.

## Entradas y salidas (portero) y fin de clases

- **Escáner en modo ráfaga:** el portero enciende la cámara una vez y apunta a cada QR. Una franja arriba muestra el último alumno (verde = entrada, ámbar = salida) con un pitido corto; cada lectura reemplaza a la anterior. El primer escaneo del día es entrada y el siguiente salida. Si se lee el mismo QR dos veces en menos de 15 segundos no cambia nada. "Deshacer" borra el último registro.
- **Contadores y buscador:** Dentro · Salieron · Sin llegar, buscador por nombre, grupo o CURP (con botón "Registrar" para quien olvidó su QR) y los últimos 5 movimientos.
- **Salida:** solo se permite con un **permiso aprobado** para hoy o si Servicios Escolares presionó **Terminar clases de hoy** (en Inicio de Lic. Sara o Control Escolar; pide confirmación). Si no, sale una tarjeta roja y no se registra nada.
- **Fin de clases:** todos salen libres sin escanear y a todos los tutores les llega **un solo aviso general** ("Las clases terminaron"). Las salidas escaneadas después de eso se registran pero no generan aviso individual.
- **Entradas y salidas con permiso:** avisan al tutor vinculado (notificación y sección Notificaciones).
- Colecciones nuevas en MongoDB: `accesos` y `diasEscolares` (se crean solas). Para ver el estado del día hace falta internet.

## Importar cuentas desde Excel, CSV, Word o PDF

- En Control Escolar → Cuentas, sube un archivo **.xlsx / .xls / .csv / .docx / .pdf**. No hay plantilla obligatoria (la de Excel quedó como opcional) ni orden fijo de columnas: la app detecta cada dato por su **contenido** (CURP de 18 caracteres, rol, semestre como "3-4", "3ro" o "tercero", carrera, grupo A/B/C, y lo que sobra es el nombre). También entiende apellidos y nombre en columnas separadas, listas numeradas, encabezados de sección ("ALUMNOS", "DOCENTES:") y líneas de texto corrido.
- Antes de crear se muestran todas las filas; se pueden **quitar filas** sueltas o todas las que tengan errores. Si el archivo no dice el rol se puede elegir uno por defecto.
- Los PDF deben tener texto (generados desde Word/Excel); un PDF escaneado o una foto no se puede leer. Los .doc antiguos hay que guardarlos como .docx.
- El lector de PDF usa `pdfjs-dist`: `npm run build` genera `public/pdf-lector.js` y `public/pdf-worker.js`, que solo se descargan cuando alguien sube un PDF. pdfjs-dist 6 pide Node 22 o superior para instalarse (en Render pon la variable `NODE_VERSION=22`).
