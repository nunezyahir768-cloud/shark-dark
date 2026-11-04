import { useState } from 'react';
import SD from './sd.js';
import { Card } from './ui.jsx';

export default function Login({ onOk }) {
  const [rol, setRol] = useState(localStorage.getItem('sd_rol') || 'alumno');
  const [u, setU] = useState(''), [msg, setMsg] = useState('');
  async function entrar(e) {
    e.preventDefault(); setMsg('Entrando…');
    try { await SD.login(rol, u); localStorage.setItem('sd_rol', rol); onOk(); }
    catch (err) { setMsg(err.message); }
  }
  return (
    <main className="centro">
      <img className="logo" src="icon-192.png" alt="" />
      <h1>SHARK DARK</h1><p className="sub" style={{ textAlign: 'center' }}>CBTIS 170 · Portal escolar</p>
      <Card>
        <form onSubmit={entrar}>
          <label htmlFor="rol">Entrar como</label>
          <select id="rol" value={rol} onChange={e => setRol(e.target.value)}>
            <option value="alumno">Alumno</option><option value="tutor">Tutor</option><option value="docente">Docente</option>
          </select>
          <label htmlFor="u">CURP</label>
          <input id="u" value={u} onChange={e => setU(e.target.value.toUpperCase())} placeholder="Tu CURP (18 caracteres)" maxLength="18" autoComplete="username" required />
          <button className="btn" type="submit">ENTRAR</button>
          <p className="msg">{msg}</p>
        </form>
      </Card>
      <p className="sub" style={{ textAlign: 'center' }}>Las cuentas las da de alta Servicios Escolares. Si tu CURP no entra, acude con ellos.</p>
    </main>
  );
}
