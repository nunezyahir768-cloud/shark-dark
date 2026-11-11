import { useEffect } from 'react';

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 8500);
    return () => clearTimeout(timer);
  }, [onFin]);

  return (
    <section className="intro" aria-label="Presentación de SHARK DARK">
      <div className="intro-atmosfera" />
      <div className="intro-destello" />
      <div className="intro-marca">
        <div className="intro-tiburon">
          <img src="icon-512.png" alt="" />
          <span className="intro-brillo" />
        </div>
        <img className="intro-cbtis" src="img/texto.png" alt="CBTIS 170" />
        <img className="intro-wordmark" src="img/barra.png" alt="SHARK DARK" />
      </div>
      <button className="intro-saltar" type="button" onClick={onFin}>Saltar introducción</button>
    </section>
  );
}
