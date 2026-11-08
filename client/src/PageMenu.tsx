import "./PageMenu.css";

type PageMenuProps = {
  current: "home" | "stylist" ;
};

export default function PageMenu({ current }: PageMenuProps) {
  return (
    <details className="page-menu">
      <summary>Menu <span aria-hidden="true">⌄</span></summary>
      <nav className="page-menu-panel" aria-label="Page navigation">
        {current === "home" ? (
          <span className="page-menu-current" aria-current="page">Home <small>Current page</small></span>
        ) : (
          <a href="/">Home</a>
        )}
        <span className="page-menu-disabled" aria-disabled="true">Wardrobe <small>Coming soon</small></span>
        {current === "stylist" ? (
          <span className="page-menu-current" aria-current="page">Stylist <small>Current page</small></span>
        ) : (
          <a href="/stylist">Stylist</a>
        )}
      </nav>
    </details>
  );
}
