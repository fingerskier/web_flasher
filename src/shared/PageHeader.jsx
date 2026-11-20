export default function PageHeader({ title, subtitle, logo, homeHref = '../' }) {
  return <header>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <div className="brand">
      {logo}
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <a className="home-link" href={homeHref}>All flashers</a>
    </div>
  </header>
}
