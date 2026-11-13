import { useEffect } from 'react';

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 7600);
    return () => clearTimeout(timer);
  }, [onFin]);

  return (
    <section className="intro" aria-label="Presentación de SHARK DARK">
      <div className="intro-atmosfera" />
      <div className="intro-particulas" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
      </div>
      <div className="intro-centro-luz" aria-hidden="true" />
      <div className="intro-linea" aria-hidden="true" />
      <div className="intro-marca">
        <div className="intro-logo">
          <img className="intro-logo-imagen" src="/img/tiburon.png" alt="Logotipo oficial SHARK DARK CBTIS 170" />
          <span className="intro-brillo" aria-hidden="true" />
        </div>
      </div>
      <button className="intro-saltar" type="button" onClick={onFin}>Saltar introducción</button>
    </section>
  );
}
