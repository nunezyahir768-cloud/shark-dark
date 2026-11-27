import { useEffect, useState } from 'react';
import SD from './sd.js';
import { Card } from './ui.jsx';
import Logo from './Logo.jsx';

export default function Login({ onOk, onInstall, installMessage }) {
  const controlEscolar = location.pathname.replace(/\/+$/, '') === '/control-escolar';
  const [bienvenida, setBienvenida] = useState(() => sessionStorage.getItem('sd_bienvenida_vista') !== '1');
  const [controlListo, setControlListo] = useState(false);
  const [rol, setRol] = useState('');
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [u, setU] = useState(''), [password, setPassword] = useState(''), [msg, setMsg] = useState('');
  const [etapa, setEtapa] = useState('curp'), [modo, setModo] = useState('login');
  const [enviado, setEnviado] = useState(false), [cargando, setCargando] = useState(false), [confirmar, setConfirmar] = useState(''), [codigoActivacion, setCodigoActivacion] = useState(''), [estadoAccion, setEstadoAccion] = useState('');
  const esperarMinimo = inicio => new Promise(resolve => setTimeout(resolve, Math.max(0, 3000 - (Date.now() - inicio))));
  async function abrirBienvenida() {
    setCargando(true); setEstadoAccion('cargando');
    await new Promise(resolve => setTimeout(resolve, 3000));
    setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420));
    sessionStorage.setItem('sd_bienvenida_vista', '1'); setBienvenida(false); setCargando(false); setEstadoAccion('');
  }
  async function abrirControl() {
    setCargando(true); setEstadoAccion('cargando');
    await new Promise(resolve => setTimeout(resolve, 3000));
    setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420));
    setControlListo(true); setCargando(false); setEstadoAccion('');
  }
  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    addEventListener('online', actualizar); addEventListener('offline', actualizar);
    return () => { removeEventListener('online', actualizar); removeEventListener('offline', actualizar); };
  }, []);
  async function continuar(e) {
    e.preventDefault(); setMsg(''); setCargando(true); setEstadoAccion('cargando'); const inicio = Date.now();
    try {
      const cuenta = await SD.identificarCuenta(u);
      await esperarMinimo(inicio); setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420));
      setRol(cuenta.rol);
      setPassword(''); setConfirmar(''); setCodigoActivacion('');
      setModo(cuenta.tienePassword ? 'login' : 'activar');
      setEtapa('password');
    } catch (err) { setMsg(err.message); }
    finally { setCargando(false); setEstadoAccion(''); }
  }
  async function entrar(e) {
    e.preventDefault(); setMsg(''); setCargando(true); setEstadoAccion('cargando'); const inicio = Date.now();
    try { await SD.login(controlEscolar ? 'admin' : rol, u, password); await esperarMinimo(inicio); setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420)); localStorage.setItem('sd_rol', controlEscolar ? 'admin' : rol); onOk(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); setEstadoAccion(''); }
  }
  async function activar(e) {
    e.preventDefault(); setMsg(''); setCargando(true); setEstadoAccion('cargando'); const inicio = Date.now();
    try { await SD.activarCuenta(rol, u, codigoActivacion, password, confirmar); await esperarMinimo(inicio); setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420)); setModo('login'); setPassword(''); setConfirmar(''); setCodigoActivacion(''); setMsg('¡Contraseña creada! Inicia sesión con tu CURP y contraseña.'); }
    catch (err) { setMsg(err.message); } finally { setCargando(false); setEstadoAccion(''); }
  }
  async function pedir(e) {
    e.preventDefault(); setMsg(''); setCargando(true); setEstadoAccion('cargando'); const inicio = Date.now();
    try { await SD.solicitarRecuperacion(rol, u); await esperarMinimo(inicio); setEstadoAccion('listo'); await new Promise(resolve => setTimeout(resolve, 420)); setEnviado(true); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); setEstadoAccion(''); }
  }
  const volverCurp = () => { setEtapa('curp'); setModo('login'); setPassword(''); setConfirmar(''); setMsg(''); setEnviado(false); };
  if (bienvenida) return (
    <main className="centro centro-login acceso-bienvenida">
      <section className="bienvenida-glass" aria-label="Bienvenida a Tiburones">
        <div className="bienvenida-marca"><Logo className="logo" darkIcon alt="TIBURONES CBTIS 170" /><p className="bienvenida-sello">CBTIS 170 · PORTAL ESCOLAR</p></div>
        <h1>Bienvenido a<br /><span>TIBURONES</span></h1>
        <p className="bienvenida-descripcion">Un espacio para mantenerte al día con tu vida escolar. Consulta clases, asistencia, calificaciones y avisos desde un solo lugar.</p>
        <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="button" onClick={abrirBienvenida} disabled={cargando}>
          <span className="acceso-btn-texto">{estadoAccion === 'listo' ? '¡Listo!' : cargando ? 'Preparando tu acceso…' : 'CONTINUAR'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span>
        </button>
        <span className="bienvenida-pie">Tu comunidad escolar, más cerca.</span>
      </section>
    </main>
  );
  if (controlEscolar && !controlListo) return (
    <main className="centro centro-login acceso-control">
      <section className="bienvenida-glass control-glass" aria-label="Acceso de Control Escolar">
        <div className="bienvenida-marca"><Logo className="logo" darkIcon alt="TIBURONES CBTIS 170" /><p className="bienvenida-sello">CBTIS 170 · PORTAL ESCOLAR</p></div>
        <h1>CONTROL<br /><span>ESCOLAR</span></h1>
        <p className="bienvenida-descripcion">Acceso para el personal autorizado de Control Escolar.</p>
        <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="button" onClick={abrirControl} disabled={cargando}>
          <span className="acceso-btn-texto">{estadoAccion === 'listo' ? 'Acceso listo' : cargando ? 'Preparando acceso…' : 'CONTINUAR'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span>
        </button>
        <a className="login-control" href="/">Volver a TIBURONES</a>
      </section>
    </main>
  );
  return (
    <main className="centro centro-login">
      <Logo className="logo" darkIcon alt="TIBURONES CBTIS 170" />
      <h1>{controlEscolar ? 'CONTROL ESCOLAR' : 'TIBURONES'}</h1>
      <p className="sub" style={{ textAlign: 'center' }}>{controlEscolar ? 'CBTIS 170 · Portal administrativo' : 'CBTIS 170 · TIBURONES'}</p>
      <Card>
      {controlEscolar ? <form onSubmit={entrar}>
          <label htmlFor="pw">Contraseña de acceso</label><input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="submit" disabled={cargando}><span className="acceso-btn-texto">{estadoAccion === 'listo' ? '¡Listo!' : cargando ? 'VERIFICANDO…' : 'ENTRAR'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span></button><p className="msg" role="alert">{msg}</p>
        </form> : modo === 'recuperar' ? <form onSubmit={pedir}>
          <h2>Recuperar contraseña</h2>
          {!enviado ? <><p className="sub">La solicitud llegará a Servicios Escolares para su revisión.</p>
            <label htmlFor="urec">CURP</label><input id="urec" value={u} onChange={e => setU(e.target.value.toUpperCase())} maxLength="18" placeholder="Tu CURP" required />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'ENVIANDO…' : 'ENVIAR SOLICITUD'}</button><p className="msg" role="alert">{msg}</p>
          </> : <><p className="sub">Si la CURP corresponde a una cuenta, la solicitud fue enviada a Servicios Escolares.</p><button className="btn" type="button" onClick={volverCurp}>VOLVER</button></>}
          {!enviado && <button type="button" className="mini" onClick={volverCurp}>Cancelar</button>}
        </form> : modo === 'activar' ? <form onSubmit={activar}>
          <h2>Crea tu contraseña</h2><p className="sub">Cuenta identificada como {rol}. Escribe el código que te entregó Servicios Escolares.</p>
          <div className="paso-acceso" key="crear-password">
            <label htmlFor="codigo-activacion">Código de activación</label><input id="codigo-activacion" value={codigoActivacion} onChange={e => setCodigoActivacion(e.target.value.toUpperCase())} autoComplete="one-time-code" required />
            <label htmlFor="nueva">Nueva contraseña</label><input id="nueva" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength="4" autoComplete="new-password" required />
            <label htmlFor="confirmar">Confirma tu contraseña</label><input id="confirmar" type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} minLength="4" autoComplete="new-password" required />
          <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="submit" disabled={cargando}><span className="acceso-btn-texto">{estadoAccion === 'listo' ? '¡Listo!' : cargando ? 'GUARDANDO…' : 'CREAR MI CONTRASEÑA'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span></button><p className="msg" role="alert">{msg}</p>
          </div>
          <button type="button" className="mini" onClick={volverCurp}>Usar otra CURP</button>
        </form> : <form onSubmit={etapa === 'curp' ? continuar : entrar}>
          {etapa === 'curp' ? <div className="paso-acceso" key="curp">
            <label htmlFor="u">CURP</label><input id="u" value={u} onChange={e => setU(e.target.value.toUpperCase())} placeholder="Tu CURP (18 caracteres)" maxLength="18" autoComplete="username" required autoFocus />
            <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="submit" disabled={cargando}><span className="acceso-btn-texto">{estadoAccion === 'listo' ? 'Cuenta encontrada' : cargando ? 'BUSCANDO…' : 'CONTINUAR'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span></button>
          </div> : <div className="paso-acceso" key="login-password">
            <p className="sub">Cuenta identificada como {rol}. CURP: <b>{u}</b></p>
            <label htmlFor="pw">Contraseña</label><input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
            <button className={'btn acceso-animado' + (estadoAccion === 'listo' ? ' exito' : '')} type="submit" disabled={cargando}><span className="acceso-btn-texto">{estadoAccion === 'listo' ? '¡Acceso correcto!' : cargando ? 'VERIFICANDO…' : 'INICIAR SESIÓN'}</span><span className="acceso-btn-icono" aria-hidden="true">{estadoAccion === 'listo' ? '✓' : cargando ? '' : '→'}</span></button>
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
        : <div className="login-pie"><p className="sub">La cuenta debe estar dada de alta por Servicios Escolares. Para activarla necesitas su código de activación.</p><a className="login-control" href="/control-escolar">Acceso de Control Escolar</a>
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
