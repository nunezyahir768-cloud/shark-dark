import { useEffect, useState } from 'react';
import SD from './sd.js';
import { Card } from './ui.jsx';
import Logo from './Logo.jsx';

export default function Login({ onOk, onInstall, installMessage }) {
  const controlEscolar = location.pathname.replace(/\/+$/, '') === '/control-escolar';
  const [rol, setRol] = useState('');
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [u, setU] = useState(''), [password, setPassword] = useState(''), [msg, setMsg] = useState('');
  const [etapa, setEtapa] = useState('curp'), [modo, setModo] = useState('login');
  const [enviado, setEnviado] = useState(false), [cargando, setCargando] = useState(false), [confirmar, setConfirmar] = useState('');
  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    addEventListener('online', actualizar); addEventListener('offline', actualizar);
    return () => { removeEventListener('online', actualizar); removeEventListener('offline', actualizar); };
  }, []);
  async function continuar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try {
      const cuenta = await SD.identificarCuenta(u);
      setRol(cuenta.rol);
      setPassword(''); setConfirmar('');
      setModo(cuenta.tienePassword ? 'login' : 'activar');
      setEtapa('password');
    } catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  async function entrar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.login(controlEscolar ? 'admin' : rol, u, password); localStorage.setItem('sd_rol', controlEscolar ? 'admin' : rol); onOk(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  async function activar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.activarCuenta(rol, u, password, confirmar); setModo('login'); setPassword(''); setConfirmar(''); setMsg('¡Contraseña creada! Inicia sesión con tu CURP y contraseña.'); }
    catch (err) { setMsg(err.message); } finally { setCargando(false); }
  }
  async function pedir(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.solicitarRecuperacion(rol, u); setEnviado(true); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  const volverCurp = () => { setEtapa('curp'); setModo('login'); setPassword(''); setConfirmar(''); setMsg(''); setEnviado(false); };
  return (
    <main className="centro centro-login">
      <Logo className="logo" darkIcon alt="TIBURONES CBTIS 170" />
      <h1>{controlEscolar ? 'CONTROL ESCOLAR' : 'TIBURONES'}</h1>
      <p className="sub" style={{ textAlign: 'center' }}>{controlEscolar ? 'CBTIS 170 · Portal administrativo' : 'CBTIS 170 · TIBURONES'}</p>
      <Card>
        {controlEscolar ? <form onSubmit={entrar}>
          <label htmlFor="pw">Contraseña de acceso</label><input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          <button className="btn" type="submit" disabled={cargando}>{cargando ? 'VERIFICANDO…' : 'ENTRAR'}</button><p className="msg" role="alert">{msg}</p>
        </form> : modo === 'recuperar' ? <form onSubmit={pedir}>
          <h2>Recuperar contraseña</h2>
          {!enviado ? <><p className="sub">La solicitud llegará a Servicios Escolares para su revisión.</p>
            <label htmlFor="urec">CURP</label><input id="urec" value={u} onChange={e => setU(e.target.value.toUpperCase())} maxLength="18" placeholder="Tu CURP" required />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'ENVIANDO…' : 'ENVIAR SOLICITUD'}</button><p className="msg" role="alert">{msg}</p>
          </> : <><p className="sub">Si la CURP corresponde a una cuenta, la solicitud fue enviada a Servicios Escolares.</p><button className="btn" type="button" onClick={volverCurp}>VOLVER</button></>}
          {!enviado && <button type="button" className="mini" onClick={volverCurp}>Cancelar</button>}
        </form> : modo === 'activar' ? <form onSubmit={activar}>
          <h2>Crea tu contraseña</h2><p className="sub">Cuenta identificada como {rol}. Elige una contraseña de al menos 4 caracteres.</p>
          <div className="paso-acceso" key="crear-password">
            <label htmlFor="nueva">Nueva contraseña</label><input id="nueva" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength="4" autoComplete="new-password" required />
            <label htmlFor="confirmar">Confirma tu contraseña</label><input id="confirmar" type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} minLength="4" autoComplete="new-password" required />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'GUARDANDO…' : 'CREAR MI CONTRASEÑA'}</button><p className="msg" role="alert">{msg}</p>
          </div>
          <button type="button" className="mini" onClick={volverCurp}>Usar otra CURP</button>
        </form> : <form onSubmit={etapa === 'curp' ? continuar : entrar}>
          {etapa === 'curp' ? <div className="paso-acceso" key="curp">
            <label htmlFor="u">CURP</label><input id="u" value={u} onChange={e => setU(e.target.value.toUpperCase())} placeholder="Tu CURP (18 caracteres)" maxLength="18" autoComplete="username" required autoFocus />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'BUSCANDO…' : 'CONTINUAR'}</button>
          </div> : <div className="paso-acceso" key="login-password">
            <p className="sub">Cuenta identificada como {rol}. CURP: <b>{u}</b></p>
            <label htmlFor="pw">Contraseña</label><input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'VERIFICANDO…' : 'INICIAR SESIÓN'}</button>
            <button type="button" className="mini" onClick={() => { setModo('recuperar'); setMsg(''); }}>¿Olvidaste tu contraseña?</button>
            <button type="button" className="mini" onClick={volverCurp}>Usar otra CURP</button>
          </div>}
          <p className="sub" role="status" style={{ margin: '10px 0 4px' }}>{enLinea
            ? (SD.offlineHabilitado ? 'Conectado. El acceso actualiza tus datos guardados.' : 'Conectado. El acceso offline se habilita en builds realizados con TOKEN_SECRET configurado.')
            : 'Sin conexión: usa una cuenta que ya haya iniciado sesión en línea en este dispositivo.'}</p>
          <p className="msg" role="alert">{msg}</p>
        </form>}
      </Card>
      {controlEscolar
        ? <p className="sub" style={{ textAlign: 'center' }}><a href="/">Volver a TIBURONES</a></p>
        : <div className="login-pie"><p className="sub">El alumno debe estar dado de alta por Servicios Escolares antes de crear su contraseña.</p><a className="login-control" href="/control-escolar">Acceso de Control Escolar</a>
          {modo === 'login' && etapa === 'curp' && <><button className="btn login-instalar" type="button" onClick={onInstall}>Descargar acceso directo</button>{installMessage && <p className="sub login-instalar-ayuda" role="status">{installMessage}</p>}</>}
        </div>}
      <span className={'login-estado' + (enLinea ? ' conectado' : '')} role="status"><i aria-hidden="true" />{enLinea ? 'En línea' : 'Sin conexión'}</span>
    </main>
  );
}

export function CambiarPassword({ onDone }) {
  const [actual, setActual] = useState(''), [nueva, setNueva] = useState(''), [confirmar, setConfirmar] = useState(''), [msg, setMsg] = useState(''), [cargando, setCargando] = useState(false);
  async function guardar(e) {
    e.preventDefault(); setMsg('');
    if (nueva.length < 4) return setMsg('Usa al menos 4 caracteres.');
    if (nueva !== confirmar) return setMsg('Las contraseñas no coinciden.');
    setCargando(true);
    try { await SD.cambiarPassword(actual, nueva); onDone(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  return <main className="centro"><h1>Actualiza tu contraseña</h1><p className="sub">Por seguridad, debes cambiar tu contraseña temporal antes de continuar.</p><Card><form onSubmit={guardar}>
    {!SD.session()?.debeCambiarPassword && <><label>Contraseña actual</label><input type="password" value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" required /></>}
    <label>Nueva contraseña</label><input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" minLength="4" required />
    <label>Confirma la nueva contraseña</label><input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} autoComplete="new-password" required />
    <button className="btn" disabled={cargando}>{cargando ? 'GUARDANDO…' : 'GUARDAR CONTRASEÑA'}</button><p className="msg" role="alert">{msg}</p>
  </form></Card></main>;
}
