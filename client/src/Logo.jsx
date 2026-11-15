export default function Logo({ className = '', alt = 'Logo de TIBURONES CBTIS 170', darkIcon = false, original = false }) {
  if (original) return <img className={'logo-original ' + className} src="/img/tiburones-claro.svg" alt={alt} />;
  const light = '/img/tiburones-claro.svg';
  const dark = '/img/tiburones-oscuro.svg';
  return (
    <span className={'logo-tema ' + className} role="img" aria-label={alt}>
      <img className="logo-tema-imagen logo-tema-oscuro" src={dark} alt="" aria-hidden="true" />
      <img className="logo-tema-imagen logo-tema-claro" src={light} alt="" aria-hidden="true" />
    </span>
  );
}
