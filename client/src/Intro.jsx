import { useEffect } from 'react';

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 30000);
    return () => clearTimeout(timer);
  }, [onFin]);

  return (
    <section className="intro intro-video" aria-label="Presentación de SHARK DARK">
      <video
        className="intro-video-fondo"
        src="/media-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={onFin}
        onError={onFin}
        aria-hidden="true"
      />
      <div className="intro-video-velo" aria-hidden="true" />
      <img
        className="intro-video-logo"
        src="/img/logo-intro.jpeg"
        alt="SHARK DARK CBTIS 170"
      />
      <button className="intro-saltar" type="button" onClick={onFin}>Saltar introducción</button>
    </section>
  );
}
