import { useAuth0 } from "@auth0/auth0-react";
import "./PageMenu.css";

type PageMenuProps = {
  current: "home" | "wardrobe" | "stylist" | "analytics";
};

export default function PageMenu({ current }: PageMenuProps) {
  const { isAuthenticated, isLoading, logout } = useAuth0();

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
        {current === "analytics" ? (
          <span className="page-menu-current" aria-current="page">Analytics <small>Current page</small></span>
        ) : (
          <a href="/analytics">Analytics</a>
        )}
        {isAuthenticated && (
          <button
            className="page-menu-sign-out"
            type="button"
            disabled={isLoading}
            onClick={() => void logout({ logoutParams: { returnTo: window.location.origin } })}
          >
            Sign out
          </button>
        )}
      </nav>
    </details>
  );
}
