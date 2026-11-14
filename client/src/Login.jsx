import { useEffect, useState } from 'react';
import SD from './sd.js';
import { Card } from './ui.jsx';

export default function Login({ onOk }) {
  const controlEscolar = location.pathname.replace(/\/+$/, '') === '/control-escolar';
  const [rol, setRol] = useState(() => {
    const guardado = localStorage.getItem('sd_rol');
    return ['alumno', 'tutor', 'docente'].includes(guardado) ? guardado : 'alumno';
  });
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [u, setU] = useState(''), [password, setPassword] = useState(''), [msg, setMsg] = useState('');
  const [modo, setModo] = useState('login'), [enviado, setEnviado] = useState(false), [cargando, setCargando] = useState(false);
  const [nombre, setNombre] = useState(''), [confirmar, setConfirmar] = useState('');
  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    addEventListener('online', actualizar); addEventListener('offline', actualizar);
    return () => { removeEventListener('online', actualizar); removeEventListener('offline', actualizar); };
  }, []);
  async function entrar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    const tipo = controlEscolar ? 'admin' : rol;
    try { await SD.login(tipo, u, password); localStorage.setItem('sd_rol', tipo); onOk(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  async function activar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.activarCuenta(rol, u, nombre, password, confirmar); setModo('login'); setPassword(''); setConfirmar(''); setMsg('¡Contraseña creada! Ya puedes iniciar sesión con tu CURP y contraseña.'); }
    catch (err) { setMsg(err.message); } finally { setCargando(false); }
  }
  async function pedir(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.solicitarRecuperacion(rol, u); setEnviado(true); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  return (
    <main className="centro">
      <img className="logo" src="/icon-192.png" alt="" />
      <h1>{controlEscolar ? 'CONTROL ESCOLAR' : 'SHARK DARK'}</h1>
      <p className="sub" style={{ textAlign: 'center' }}>{controlEscolar ? 'CBTIS 170 · Acceso administrativo' : 'CBTIS 170 · Portal escolar'}</p>
      <Card>
        {modo === 'activar' ? <form onSubmit={activar}>
        <h2>Crea tu contraseña</h2><p className="sub">Activa tu cuenta de {rol}. Usa exactamente tu nombre registrado por Servicios Escolares.</p>
        <label>CURP</label><input value={u} onChange={e => setU(e.target.value.toUpperCase())} maxLength="18" autoComplete="username" required />
        <label>Nombre completo registrado</label><input value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="name" required />
        <label>Crea una contraseña (mínimo 10 caracteres)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength="10" autoComplete="new-password" required />
        <label>Confirma tu contraseña</label><input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} minLength="10" autoComplete="new-password" required />
        <button className="btn" disabled={cargando}>{cargando ? 'GUARDANDO…' : 'CREAR MI CONTRASEÑA'}</button><p className="msg" role="alert">{msg}</p>
        <button type="button" className="mini" onClick={() => { setModo('login'); setMsg(''); }}>Volver al inicio</button>
      </form> : modo === 'login' ? <form onSubmit={entrar}>
          {!controlEscolar && <><label htmlFor="rol">Entrar como</label>
            <select id="rol" value={rol} onChange={e => setRol(e.target.value)}><option value="alumno">Alumno</option><option value="tutor">Tutor</option><option value="docente">Docente</option></select></>}
          <label htmlFor="u">CURP</label><input id="u" value={u} onChange={e => setU(e.target.value.toUpperCase())} placeholder="Tu CURP (18 caracteres)" maxLength="18" autoComplete="username" required />
          <label htmlFor="pw">Contraseña</label>
          <input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Escribe tu contraseña" autoComplete="current-password" required />
          <p className="sub" role="status" style={{ margin: '10px 0 4px' }}>{enLinea
            ? (SD.offlineHabilitado ? 'Conectado. El inicio de sesión valida tu cuenta y actualiza los datos guardados.' : 'Conectado. El acceso offline se habilita en builds realizados con TOKEN_SECRET configurado.')
            : 'Sin conexión. Usa tu CURP y contraseña si ya iniciaste sesión en línea en este dispositivo. Los datos pueden estar desactualizados.'}</p>
          <button className="btn" type="submit" disabled={cargando}>{cargando ? 'VERIFICANDO…' : controlEscolar ? 'ENTRAR A CONTROL ESCOLAR' : 'INICIAR SESIÓN'}</button>
          {!controlEscolar && <button type="button" className="mini" style={{ margin: '12px 0 0' }} onClick={() => { setModo('activar'); setMsg(''); }}>¿Primera vez? Crea tu contraseña</button>}
          {!controlEscolar && <button type="button" className="mini" style={{ margin: '12px 0 0' }} onClick={() => { setModo('recuperar'); setMsg(''); }}>¿Olvidaste tu contraseña?</button>}
          <p className="msg" role="alert">{msg}</p>
        </form> : <form onSubmit={pedir}>
          <h2>Recuperar contraseña</h2>
          {!enviado ? <><p className="sub">Escribe tu CURP y tipo de cuenta. La solicitud llegará a Servicios Escolares para su revisión.</p>
            <label htmlFor="rolrec">Tipo de cuenta</label><select id="rolrec" value={rol} onChange={e => setRol(e.target.value)}><option value="alumno">Alumno</option><option value="tutor">Tutor</option><option value="docente">Docente</option></select>
            <label htmlFor="urec">CURP</label><input id="urec" value={u} onChange={e => setU(e.target.value.toUpperCase())} maxLength="18" placeholder="Tu CURP" required />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'ENVIANDO…' : 'ENVIAR SOLICITUD'}</button><p className="msg" role="alert">{msg}</p>
          </> : <><p className="sub">Si los datos corresponden a una cuenta, la solicitud fue enviada a Servicios Escolares. El administrador revisará tu identidad.</p><button className="btn" type="button" onClick={() => { setModo('login'); setEnviado(false); }}>VOLVER AL INICIO</button></>}
          {!enviado && <button type="button" className="mini" style={{ margin: '12px 0 0' }} onClick={() => { setModo('login'); setMsg(''); }}>Cancelar</button>}
        </form>}
      </Card>
      {controlEscolar
        ? <p className="sub" style={{ textAlign: 'center' }}><a href="/">Volver al acceso escolar</a></p>
        : <><p className="sub" style={{ textAlign: 'center' }}>El alumno debe estar dado de alta por Servicios Escolares antes de crear su contraseña.</p>
          <p className="sub" style={{ textAlign: 'center' }}><a href="/control-escolar">Acceso de Control Escolar</a></p></>}
    </main>
  );
}

export function CambiarPassword({ onDone }) {
  const [actual, setActual] = useState(''), [nueva, setNueva] = useState(''), [confirmar, setConfirmar] = useState(''), [msg, setMsg] = useState(''), [cargando, setCargando] = useState(false);
  async function guardar(e) {
    e.preventDefault(); setMsg('');
    if (nueva.length < 10) return setMsg('Usa al menos 10 caracteres.');
    if (nueva !== confirmar) return setMsg('Las contraseñas no coinciden.');
    setCargando(true);
    try { await SD.cambiarPassword(actual, nueva); onDone(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  return <main className="centro"><h1>Actualiza tu contraseña</h1><p className="sub">Por seguridad, debes cambiar tu contraseña temporal antes de continuar.</p><Card><form onSubmit={guardar}>
    <label>Contraseña temporal o actual</label><input type="password" value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" required />
    <label>Nueva contraseña</label><input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" minLength="10" required />
    <label>Confirma la nueva contraseña</label><input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} autoComplete="new-password" required />
    <button className="btn" disabled={cargando}>{cargando ? 'GUARDANDO…' : 'GUARDAR CONTRASEÑA'}</button><p className="msg" role="alert">{msg}</p>
  </form></Card></main>;
}
