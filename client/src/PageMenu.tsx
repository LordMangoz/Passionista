import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import "./PageMenu.css";

type PageMenuProps = {
  current: "home" | "wardrobe" | "stylist" | "analytics";
};

export default function PageMenu({ current }: PageMenuProps) {
  const { isAuthenticated, isLoading, logout } = useAuth0();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`page-menu ${isOpen ? "is-open" : ""}`}>
      <button
        className="page-menu-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls="page-menu-links"
        onClick={() => setIsOpen((open) => !open)}
      >
        Menu <span aria-hidden="true">⌄</span>
      </button>
      <nav id="page-menu-links" className="page-menu-panel" aria-label="Page navigation">
        {current === "home" ? (
          <span className="page-menu-current" aria-current="page">Home <small>Current page</small></span>
        ) : (
          <a href="/" onClick={() => setIsOpen(false)}>Home</a>
        )}
        {current === "wardrobe" ? (
          <span className="page-menu-current" aria-current="page">Wardrobe <small>Current page</small></span>
        ) : (
          <a href="/wardrobe" onClick={() => setIsOpen(false)}>Wardrobe</a>
        )}
        {current === "stylist" ? (
          <span className="page-menu-current" aria-current="page">Stylist <small>Current page</small></span>
        ) : (
          <a href="/stylist" onClick={() => setIsOpen(false)}>Stylist</a>
        )}
        {current === "analytics" ? (
          <span className="page-menu-current" aria-current="page">Analytics <small>Current page</small></span>
        ) : (
          <a href="/analytics" onClick={() => setIsOpen(false)}>Analytics</a>
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
    </div>
  );
}
