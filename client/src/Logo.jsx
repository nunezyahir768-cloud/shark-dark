export default function Logo({ className = '', alt = 'Logo de SHARK DARK CBTIS 170', darkIcon = false }) {
  const light = darkIcon ? '/icon-192-claro.png' : '/img/tiburon-claro.png';
  const dark = darkIcon ? '/icon-192.png' : '/img/tiburon.png';
  return (
    <span className={'logo-tema ' + className} role="img" aria-label={alt}>
      <img className="logo-tema-imagen logo-tema-oscuro" src={dark} alt="" aria-hidden="true" />
      <img className="logo-tema-imagen logo-tema-claro" src={light} alt="" aria-hidden="true" />
    </span>
  );
}
