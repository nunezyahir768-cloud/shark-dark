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
│   ├── servicios.jsx  ← Servicios Escolares (cuentas, grupos, clases, horarios)
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
  - `ADMIN_CURP` → la CURP de Servicios Escolares (18 caracteres)
  - `ADMIN_INITIAL_PASSWORD` → contraseña temporal de la cuenta de Control Escolar (10+ caracteres; solo se necesita para crearla la primera vez)
- Ya NO se usan `ADMIN_PASSWORD`, `ADMIN_RFC`, `CODIGO_DOCENTE` ni `CODIGO_ADMIN`: puedes borrarlas.

## Inicio de sesión y contraseñas

- Alumnos, tutores y docentes entran con **tipo de cuenta + CURP + contraseña**.
- Control Escolar tiene una entrada independiente en **`/control-escolar`** y autentica la CURP y contraseña de la cuenta de administrador registrada en MongoDB. El rol no se concede por visitar la ruta; el servidor firma una sesión administrativa solo después de comprobar esa cuenta.
- El administrador da de alta primero al alumno. El alumno activa su cuenta en el inicio con CURP, nombre registrado y una contraseña propia (mínimo 10 caracteres). Solo puede hacerlo una vez mientras la cuenta esté pendiente de activación.
- La contraseña se guarda protegida con `scrypt`, nunca en texto plano. Alumnos pueden usar la misma CURP y contraseña en otros dispositivos conectados a internet.
- En el primer inicio, `ADMIN_INITIAL_PASSWORD` crea la cuenta asociada a `ADMIN_CURP` y obliga a cambiar la contraseña. Después, se inicia desde `/control-escolar` con esa CURP y la contraseña personal. Ya no se utiliza una contraseña administrativa compartida ni el acceso de administrador como docente.
- Si la instalación anterior solo usaba `ADMIN_ACCESS_PASSWORD` y aún no tenía una cuenta administrativa guardada, configura `ADMIN_INITIAL_PASSWORD` (10+ caracteres) y `ADMIN_CURP` para inicializarla antes de usar la nueva entrada. La antigua variable `ADMIN_ACCESS_PASSWORD` ya no otorga acceso.
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
- Mantén `TOKEN_SECRET`, `MONGODB_URI` y `ADMIN_INITIAL_PASSWORD` únicamente en variables de entorno; nunca las subas a GitHub.
- Los usuarios que ya existían antes de activar el inicio con contraseña deben solicitar un restablecimiento para recibir su contraseña temporal.

## Notas

- El aviso de "faltan 5 minutos para que termine la clase" le llega al alumno cuando tiene la app abierta (o en segundo plano).
  Para que llegue con la app cerrada se necesita un servicio de notificaciones push (siguiente etapa).
- Si cambias de equipo, borra el archivo `package-lock.json` viejo del repositorio; `npm install` crea uno nuevo.


## Identidad visual, tutorial y horario

- El logo rojo/crema con fondo transparente de `public/img/tiburon.png` es la marca compartida de la app y se usa en la animación de entrada.
- Los iconos instalables del teléfono están en `public/icon-192.png` y `public/icon-512.png`.
- SHARK DARK tiene una interfaz moderna, elegante y profesional, con una identidad visual de tonos oscuros y detalles dorados.
- La paleta oficial combina negro profundo (`#090909`), negro carbón (`#171614`), dorado champagne (`#C9A86A`), dorado claro (`#E4C58A`), crema claro (`#F5F1E6`), beige grisáceo (`#B7AA96`), verde suave (`#8DBB91`) y rojo suave (`#E58A80`).
- Las tarjetas oscuras tienen esquinas redondeadas y bordes dorados discretos; los botones usan un degradado dorado; y los menús se adaptan a computadoras, tabletas y celulares. Los formularios usan campos oscuros y bordes discretos.
- La tipografía sans-serif mantiene una lectura limpia y consistente. El fondo incorpora sutiles formas inspiradas en hojas oscuras.
- Esta identidad busca transmitir innovación, confianza, organización y modernidad en el entorno educativo.
- En Inicio aparece el apartado **Conoce tu plataforma escolar**. Cuando tengas tu video, guárdalo con el nombre `tutorial.mp4` dentro de `public/`. La ruta debe quedar `public/tutorial.mp4`; después ejecuta `npm run build` y sube los cambios.
- El horario permite elegir el día y muestra cada materia en una tarjeta con docente, salón y horas. Los datos reales siguen dependiendo de lo que capture Servicios Escolares.


### Acceso actualizado de alumnos y administrador

- Servicios Escolares primero da de alta al alumno con su nombre y CURP.
- En la pantalla de entrada, el alumno elige **¿Primera vez? Crea tu contraseña**, escribe CURP, nombre exactamente como quedó registrado y crea una contraseña de al menos 10 caracteres.
- La contraseña se guarda en MongoDB como hash con salt; no se almacena en texto plano. Después puede entrar en cualquier dispositivo con CURP y contraseña.
- Control Escolar entra en `/control-escolar` con la CURP definida en `ADMIN_CURP` y la contraseña personal de su cuenta. Al crear la cuenta por primera vez, usa `ADMIN_INITIAL_PASSWORD` como contraseña temporal y cámbiala al iniciar sesión.

## Inicio offline y datos locales

- Para habilitar credenciales offline, `TOKEN_SECRET` debe estar configurado tanto al ejecutar `npm run build` como al iniciar el servidor. El build incluye solo una clave pública derivada; la clave privada nunca se envía al navegador. Render debe tener `TOKEN_SECRET` entre sus variables de entorno durante el build y la ejecución.
- Cada usuario (alumno, tutor, docente o Control Escolar) debe iniciar sesión online una vez en ese dispositivo. La app guarda un ticket firmado con vigencia de 24 horas y cifrado con AES-GCM; la clave se deriva de la contraseña mediante PBKDF2. No guarda la contraseña ni el token de acceso en `localStorage`.
- Los datos escolares y cachés locales de la app se cifran en IndexedDB o `localStorage`. Al abrir o recargar, se pide la contraseña para desbloquearlos. Cerrar sesión borra la sesión de memoria y conserva la credencial offline hasta su vencimiento.
- La sesión offline permite consultar datos ya sincronizados. Docentes pueden dejar asistencias pendientes; el indicador muestra cuántas faltan. Al recuperar internet, la app vuelve al login y exige validación online antes de sincronizar. Las acciones administrativas no se autorizan offline.
- Una cuenta revocada o una contraseña cambiada no se pueden conocer mientras el dispositivo está desconectado. Al volver internet se requiere un login online y el servidor aplica el estado actual; sin conexión, el ticket puede permitir consulta hasta que venza (máximo 24 horas).
- El cifrado protege los datos guardados frente a lectura casual del almacenamiento del navegador, pero un dispositivo controlado por el usuario no es una bóveda confiable: malware, extensiones o código malicioso ejecutado en el sitio pueden acceder a datos mientras la sesión está abierta. Protege el dispositivo y mantén el sitio libre de XSS.
