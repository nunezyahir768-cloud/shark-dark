/* Menú lateral para todas las pantallas con sesión iniciada */
(() => {
  const MENU = {
    alumno:  [['🏠', 'Inicio', 'menu_alumnos.html'], ['🔳', 'Mi QR', 'qr_alumno.html'], ['👪', 'Mis tutores', 'vinculos.html'], ['📊', 'Calificaciones', 'calificaciones.html'], ['📢', 'Avisos', 'avisos.html'], ['⚙️', 'Mi cuenta', 'cuenta.html']],
    docente: [['🏠', 'Inicio', 'menu_docentes.html'], ['📷', 'Escanear', 'escanear.html'], ['📊', 'Calificaciones', 'calificaciones.html'], ['📝', 'Permisos', 'permisos.html'], ['📢', 'Avisos', 'avisos.html'], ['⚙️', 'Mi cuenta', 'cuenta.html']],
    tutor:   [['🏠', 'Inicio', 'menu_tutor.html'], ['👨‍👧', 'Alumnos', 'vinculos.html'], ['🎓', 'Ficha del alumno', 'escanear.html'], ['📊', 'Calificaciones', 'calificaciones.html'], ['📝', 'Permisos', 'permisos.html'], ['📢', 'Avisos', 'avisos.html'], ['⚙️', 'Mi cuenta', 'cuenta.html']],
    admin:   [['👥', 'Cuentas', 'admin.html#cuentas'], ['🏫', 'Grupos', 'admin.html#grupos'], ['📚', 'Clases', 'admin.html#clases'], ['📝', 'Permisos', 'permisos.html'], ['📢', 'Avisos', 'avisos.html'], ['📷', 'Escáner', 'escanear.html'], ['⚙️', 'Mi cuenta', 'cuenta.html']]
  };
  const ROL = { alumno: 'Alumno', docente: 'Docente', tutor: 'Tutor', admin: 'Administrador' };
  document.addEventListener('DOMContentLoaded', () => {
    const s = SD.session(), main = document.querySelector('main');
    if (!s || !main) return;
    const aqui = location.pathname.split('/').pop() || 'entrada.html';
    const activo = h => { const [p, x] = h.split('#'); return p === aqui && (!x || x === (location.hash.slice(1) || 'cuentas')); };
    const nav = () => (MENU[s.rol] || []).map(([i, t, h]) => `<a href="${h}" class="${activo(h) ? 'on' : ''}"><span>${i}</span>${t}</a>`).join('');
    const side = document.createElement('aside'); side.className = 'side';
    side.innerHTML = `<div class="marca"><img src="icon-192.png" alt=""><span>SHARK DARK<small>CBTIS 170</small></span></div>
      <div class="perfil"><div><b>${SD.esc(s.nombre || '')}</b><small>${ROL[s.rol] || ''}</small></div><a href="#" class="salir" id="salir">Salir</a></div><nav>${nav()}</nav>`;
    const velo = document.createElement('div'); velo.className = 'velo';
    const top = document.createElement('div'); top.className = 'top'; top.innerHTML = '<button aria-label="Menú">☰</button><b>SHARK DARK</b><a href="#" class="salir" id="salir2">Salir</a>';
    const cont = document.createElement('div'); cont.className = 'contenido';
    main.parentNode.insertBefore(cont, main); cont.append(top, main);
    if (s.rol === 'tutor') SD.vinculos().then(l => {
      const ok = l.filter(x => x.estado === 'vinculado'); if (!ok.length) return;
      const act = localStorage.getItem('sd_alumno') || ok[0].curp, bar = document.createElement('div');
      bar.style.cssText = 'padding:14px 16px 0;max-width:940px;margin:0 auto';
      bar.innerHTML = `<label style="margin:0">Alumno que estás viendo</label><select id="selAlumno">${ok.map(x => `<option value="${x.curp}" ${x.curp === act ? 'selected' : ''}>${SD.esc(x.nombre)}</option>`).join('')}</select>`;
      cont.insertBefore(bar, main); bar.querySelector('select').onchange = e => { localStorage.setItem('sd_alumno', e.target.value); location.reload(); };
    });
    document.body.classList.add('conmenu'); document.body.prepend(side, velo);
    const cierra = () => { side.classList.remove('abre'); velo.classList.remove('abre'); };
    top.querySelector('button').onclick = () => { side.classList.add('abre'); velo.classList.add('abre'); };
    velo.onclick = cierra; side.addEventListener('click', e => { if (e.target.closest('nav a')) cierra(); });
    for (const b of [side.querySelector('#salir'), top.querySelector('#salir2')]) b.onclick = e => { e.preventDefault(); SD.logout(); };
    addEventListener('hashchange', () => { side.querySelector('nav').innerHTML = nav(); });
  });
})();
