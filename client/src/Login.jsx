import { useState } from 'react';
import SD from './sd.js';
import { Card } from './ui.jsx';

export default function Login({ onOk }) {
  const [rol, setRol] = useState(localStorage.getItem('sd_rol') || 'alumno');
  const [u, setU] = useState(''), [password, setPassword] = useState(''), [msg, setMsg] = useState('');
  const [recuperar, setRecuperar] = useState(false), [enviado, setEnviado] = useState(false), [cargando, setCargando] = useState(false);
  async function entrar(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.login(rol, u, password); localStorage.setItem('sd_rol', rol); onOk(); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  async function pedir(e) {
    e.preventDefault(); setMsg(''); setCargando(true);
    try { await SD.solicitarRecuperacion(rol, u); setEnviado(true); }
    catch (err) { setMsg(err.message); }
    finally { setCargando(false); }
  }
  return (
    <main className="centro">
      <img className="logo" src="icon-192.png" alt="" />
      <h1>SHARK DARK</h1><p className="sub" style={{ textAlign: 'center' }}>CBTIS 170 · Portal escolar</p>
      <Card>
        {!recuperar ? <form onSubmit={entrar}>
          <label htmlFor="rol">Entrar como</label>
          <select id="rol" value={rol} onChange={e => setRol(e.target.value)}><option value="alumno">Alumno</option><option value="tutor">Tutor</option><option value="docente">Docente</option></select>
          <label htmlFor="u">CURP</label>
          <input id="u" value={u} onChange={e => setU(e.target.value.toUpperCase())} placeholder="Tu CURP (18 caracteres)" maxLength="18" autoComplete="username" required />
          <label htmlFor="pw">Contraseña</label>
          <input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Escribe tu contraseña" autoComplete="current-password" required />
          <button className="btn" type="submit" disabled={cargando}>{cargando ? 'VERIFICANDO…' : 'INICIAR SESIÓN'}</button>
          <button type="button" className="mini" style={{ margin: '12px 0 0' }} onClick={() => { setRecuperar(true); setMsg(''); }}>¿Olvidaste tu contraseña?</button>
          <p className="msg" role="alert">{msg}</p>
        </form> : <form onSubmit={pedir}>
          <h2>Recuperar contraseña</h2>
          {!enviado ? <><p className="sub">Escribe tu CURP y tipo de cuenta. La solicitud llegará a Servicios Escolares para su revisión.</p>
            <label htmlFor="rolrec">Tipo de cuenta</label><select id="rolrec" value={rol} onChange={e => setRol(e.target.value)}><option value="alumno">Alumno</option><option value="tutor">Tutor</option><option value="docente">Docente</option></select>
            <label htmlFor="urec">CURP</label><input id="urec" value={u} onChange={e => setU(e.target.value.toUpperCase())} maxLength="18" placeholder="Tu CURP" required />
            <button className="btn" type="submit" disabled={cargando}>{cargando ? 'ENVIANDO…' : 'ENVIAR SOLICITUD'}</button><p className="msg" role="alert">{msg}</p>
          </> : <><p className="sub">Si los datos corresponden a una cuenta, la solicitud fue enviada a Servicios Escolares. El administrador revisará tu identidad.</p><button className="btn" type="button" onClick={() => { setRecuperar(false); setEnviado(false); }}>VOLVER AL INICIO</button></>}
          {!enviado && <button type="button" className="mini" style={{ margin: '12px 0 0' }} onClick={() => { setRecuperar(false); setMsg(''); }}>Cancelar</button>}
        </form>}
      </Card>
      <p className="sub" style={{ textAlign: 'center' }}>Si no tienes una contraseña inicial, solicita a Servicios Escolares que habilite tu cuenta.</p>
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
