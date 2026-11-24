import { useEffect, useRef } from 'react';

/* Entrada: el icono del tiburón cae con rebote (como "bouncy"), brilla, vuela a la esquina
   donde vive en la barra superior y desde ahí se abre un círculo que revela la app. */
const T_CAIDA = 1150, T_ESPERA = 650, T_VUELO = 850, T_REVELA = 950;

export default function Intro({ onFin }) {
  const raiz = useRef(null), vuelo = useRef(null), icono = useRef(null);

  useEffect(() => {
    let vivo = true, raf = 0; const timers = [];
    const fin = () => { if (vivo) { vivo = false; onFin(); } };
    const en = (ms, fn) => timers.push(setTimeout(() => { if (vivo) fn(); }, ms));
    const tecla = e => { if (e.key === 'Escape') fin(); };
    window.addEventListener('keydown', tecla);

    en(T_CAIDA + T_ESPERA, () => {
      const el = icono.current, cont = vuelo.current, base = raiz.current;
      if (!el || !cont || !base) return fin();
      const destino = document.querySelector('[data-intro-destino]');
      const r0 = el.getBoundingClientRect();
      const r1 = destino ? destino.getBoundingClientRect() : { left: 14, top: 14, width: 38, height: 27 };
      const dx = r1.left + r1.width / 2 - (r0.left + r0.width / 2), dy = r1.top + r1.height / 2 - (r0.top + r0.height / 2);
      const esc = r1.width / r0.width;
      base.classList.add('volando');
      cont.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px,${dy}px) scale(${esc})` }],
        { duration: T_VUELO, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' });
      const cx = r1.left + r1.width / 2, cy = r1.top + r1.height / 2;
      const maxR = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 20;
      en(T_VUELO - 80, () => {
        if (destino) cont.style.opacity = '0';          // el icono real de la barra queda justo debajo
        else cont.style.transition = 'opacity .5s .5s', cont.style.opacity = '0';
        const t0 = performance.now();
        base.style.setProperty('--cx', cx + 'px'); base.style.setProperty('--cy', cy + 'px');
        const paso = ahora => {
          if (!vivo) return;
          const p = Math.min(1, (ahora - t0) / T_REVELA), e = p * p * (3 - 2 * p);
          base.style.setProperty('--r', (e * maxR) + 'px');
          if (p < 1) raf = requestAnimationFrame(paso); else fin();
        };
        raf = requestAnimationFrame(paso);
      });
    });
    return () => { vivo = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); window.removeEventListener('keydown', tecla); };
  }, [onFin]);

  return (
    <section className="intro-n" ref={raiz} aria-label="Introducción CBTIS 170 Tiburones">
      <div className="intro-n-fondo" aria-hidden="true">
        <div className="intro-n-luz" />
        <div className="intro-n-aro" /><div className="intro-n-aro dos" />
        <div className="intro-n-chispas">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>
      </div>
      <div className="intro-n-vuelo" ref={vuelo}>
        <div className="intro-n-icono" ref={icono}>
          <img src="/img/icono-tiburon.png" alt="Tiburones CBTIS 170" />
          <span className="intro-n-brillo" aria-hidden="true" />
        </div>
      </div>
      <button className="intro-omitir" type="button" onClick={onFin}>Omitir <span aria-hidden="true">›</span></button>
    </section>
  );
}
