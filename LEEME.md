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
  - `MONGODB_URI` → la dirección de tu Atlas (con tu clave)
  - `TOKEN_SECRET` → una frase larga y secreta
  - `ADMIN_CURP` → la CURP de la persona de Servicios Escolares (18 caracteres)
- Ya NO se usan `ADMIN_PASSWORD`, `ADMIN_RFC`, `CODIGO_DOCENTE` ni `CODIGO_ADMIN`: puedes borrarlas.

## Cómo se entra (sin contraseñas)

- Todos entran con **Entrar como** + su **CURP**: Alumno, Tutor o Docente.
- **Servicios Escolares** entra igual: **Entrar como: Docente** y la CURP que pusiste en `ADMIN_CURP`.
- Nadie puede crear cuenta solo: **Servicios Escolares da de alta** a docentes, alumnos y tutores.

Orden recomendado para empezar:
1. **Cuentas** → crea docentes, tutores y alumnos (el alumno lleva semestre, área y grupo A, B o C; el grupo se crea solo)
2. **Cuentas → Vincular alumno** → une a cada tutor con sus hijos
3. **Clases** (materia + grupo + docente)
4. **Horarios** (el descanso de 9:30 a 10:00 ya está fijo)
5. **Avisos** y **Permisos** cuando haga falta

**Grupos** solo muestra los grupos; ahí se puede **eliminar un grupo con todas sus cuentas**.

## Importante sobre la seguridad

Como no hay contraseña, **quien conozca una CURP puede entrar con ella**. Por eso:
- No compartas la CURP de Servicios Escolares.
- Si más adelante quieres más seguridad, se puede agregar un PIN corto.

## Notas

- El aviso de "faltan 5 minutos para que termine la clase" le llega al alumno cuando tiene la app abierta (o en segundo plano).
  Para que llegue con la app cerrada se necesita un servicio de notificaciones push (siguiente etapa).
- Si cambias de equipo, borra el archivo `package-lock.json` viejo del repositorio; `npm install` crea uno nuevo.
