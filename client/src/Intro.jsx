import { useEffect } from 'react';
import Logo from './Logo.jsx';

export default function Intro({ onFin }) {
  useEffect(() => {
    const timer = setTimeout(onFin, 7600);
    return () => clearTimeout(timer);
  }, [onFin]);

  return (
    <section className="intro" role="button" tabIndex="0" aria-label="Toca o haz clic en cualquier parte para saltar la introducción" onClick={onFin} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFin(); } }}>
      <Logo original className="intro-logo" alt="Logotipo oficial SHARK DARK CBTIS 170" />
    </section>
  );
}
