export default function Logo({ className = '', alt = 'Logo de TIBURONES CBTIS 170', darkIcon = false, original = false }) {
  const light = '/img/tiburon-claro.png';
  const dark = '/img/tiburon.png';
  if (original) return <picture className={'logo-original ' + className} role="img" aria-label={alt}>
    <img className="logo-original-claro" src={light} alt="" aria-hidden="true" />
    <img className="logo-original-oscuro" src={dark} alt="" aria-hidden="true" />
  </picture>;
  return (
    <span className={'logo-tema ' + className} role="img" aria-label={alt}>
      <img className="logo-tema-imagen logo-tema-oscuro" src={dark} alt="" aria-hidden="true" />
      <img className="logo-tema-imagen logo-tema-claro" src={light} alt="" aria-hidden="true" />
    </span>
  );
}
