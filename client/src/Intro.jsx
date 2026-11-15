import { useEffect } from 'react';
import Logo from './Logo.jsx';

const rays = Array.from({ length: 24 }, (_, i) => ({
  angle: `${i * 15 - 172}deg`,
  delay: `${(i % 8) * 0.055}s`,
}));

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 5650);
    const keydown = event => { if (event.key === 'Escape') onFin(); };
    window.addEventListener('keydown', keydown);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', keydown); };
  }, [onFin]);

  return (
    <section className="intro" aria-label="Introducción CBTIS 170 Tiburones">
      <div className="intro-atmosfera" />
      <div className="intro-tunel" aria-hidden="true">
        {rays.map((ray, i) => <i key={i} style={{ '--angulo': ray.angle, '--retardo': ray.delay }} />)}
      </div>
      <div className="intro-particulas" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
      </div>
      <div className="intro-centro-luz" aria-hidden="true" />
      <div className="intro-linea" aria-hidden="true" />
      <div className="intro-marca">
        <Logo original className="intro-logo" alt="Logotipo oficial TIBURONES CBTIS 170" />
        <span className="intro-reflejo" aria-hidden="true" />
      </div>
      <div className="intro-brillo" aria-hidden="true" />
      <button className="intro-omitir" type="button" onClick={onFin}>Omitir <span aria-hidden="true">›</span></button>
      <span className="intro-indicador" aria-hidden="true"><i /></span>
    </section>
  );
}
