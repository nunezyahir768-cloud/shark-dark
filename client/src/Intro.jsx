import { useEffect } from 'react';
import Logo from './Logo.jsx';

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 7600);
    return () => clearTimeout(timer);
  }, [onFin]);

  return (
    <section className="intro" aria-label="Presentación de SHARK DARK">
      <div className="intro-atmosfera" aria-hidden="true" />
      <div className="intro-tunel" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ '--angulo': `${(360 / 28) * i}deg`, '--retardo': `${(i % 7) * 45}ms` }} />
        ))}
      </div>
      <div className="intro-particulas" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
      </div>
      <div className="intro-centro-luz" aria-hidden="true" />
      <div className="intro-linea" aria-hidden="true" />
      <div className="intro-marca">
        <div className="intro-logo">
          <Logo className="intro-logo-imagen" alt="Logotipo oficial SHARK DARK CBTIS 170" />
          <span className="intro-brillo" aria-hidden="true" />
        </div>
        <span className="intro-reflejo" aria-hidden="true" />
      </div>
      <button className="intro-saltar" type="button" onClick={onFin}>Saltar introducción</button>
    </section>
  );
}
