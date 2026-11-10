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
  - `ADMIN_INITIAL_PASSWORD` → contraseña inicial heredada de Servicios Escolares (10+ caracteres)
  - `ADMIN_ACCESS_PASSWORD` → contraseña de acceso del rol Administrador (por defecto `admin170`; cámbiala en producción)
- Ya NO se usan `ADMIN_PASSWORD`, `ADMIN_RFC`, `CODIGO_DOCENTE` ni `CODIGO_ADMIN`: puedes borrarlas.

## Inicio de sesión y contraseñas

- Alumnos, tutores y docentes entran con **tipo de cuenta + CURP + contraseña**.
- El administrador da de alta primero al alumno. El alumno activa su cuenta en el inicio con CURP, nombre registrado y una contraseña propia (mínimo 10 caracteres). Solo puede hacerlo una vez mientras la cuenta esté pendiente de activación.
- La contraseña se guarda protegida con `scrypt`, nunca en texto plano. Alumnos pueden usar la misma CURP y contraseña en otros dispositivos conectados a internet.
- **Servicios Escolares** selecciona el tipo de cuenta **Administrador** e ingresa la contraseña configurada en `ADMIN_ACCESS_PASSWORD` (por defecto `admin170`). Cambia ese valor en las variables de entorno de Render por una contraseña larga y privada antes de publicar.
- `ADMIN_INITIAL_PASSWORD` sigue siendo útil para inicializar la cuenta administrativa heredada que entra como docente mediante su CURP; el nuevo acceso Administrador es independiente.
- Si alguien olvida su contraseña, envía una solicitud desde el inicio de sesión. Administración la revisa en **Cuentas → Solicitudes de restablecimiento**, verifica la identidad y genera una contraseña temporal.
- La contraseña temporal se muestra una sola vez al administrador. Debe entregarse al titular por un canal privado; al entrar tendrá que crear otra.
- Las solicitudes no revelan si una CURP existe y tienen limitación de frecuencia.

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

- El logo dorado/negro de `public/img/tiburon.png` se usa en la animación de entrada.
- Los iconos instalables del teléfono están en `public/icon-192.png` y `public/icon-512.png`.
- La interfaz usa negro, dorado champagne y crema.
- En Inicio aparece el apartado **Conoce tu plataforma escolar**. Cuando tengas tu video, guárdalo con el nombre `tutorial.mp4` dentro de `public/`. La ruta debe quedar `public/tutorial.mp4`; después ejecuta `npm run build` y sube los cambios.
- El horario permite elegir el día y muestra cada materia en una tarjeta con docente, salón y horas. Los datos reales siguen dependiendo de lo que capture Servicios Escolares.


### Acceso actualizado de alumnos y administrador

- Servicios Escolares primero da de alta al alumno con su nombre y CURP.
- En la pantalla de entrada, el alumno elige **¿Primera vez? Crea tu contraseña**, escribe CURP, nombre exactamente como quedó registrado y crea una contraseña de al menos 10 caracteres.
- La contraseña se guarda en MongoDB como hash con salt; no se almacena en texto plano. Después puede entrar en cualquier dispositivo con CURP y contraseña.
- El administrador elige **Administrador** y usa la contraseña `admin170`. En producción se recomienda cambiar `ADMIN_ACCESS_PASSWORD` en las variables de entorno de Render por una contraseña larga y privada.
