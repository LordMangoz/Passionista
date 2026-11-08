import "./PageMenu.css";

type PageMenuProps = {
  current: "home" | "wardrobe" | "stylist" ;
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
        {current === "wardrobe" ? (
          <span className="page-menu-current" aria-current="page">Wardrobe <small>Current page</small></span>
        ) : (
          <a href="/wardrobe">Wardrobe</a>
        )}
        {current === "stylist" ? (
          <span className="page-menu-current" aria-current="page">Stylist <small>Current page</small></span>
        ) : (
          <a href="/stylist">Stylist</a>
        )}
      </nav>
    </details>
  );
}
