import { useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import AnalyticsPage from "./AnalyticsPage";
import PageMenu from "./PageMenu";
import StylistPage from "./StylistPage";
import "./App.css";
import Wardrobe from "./WardrobePage/Wardrobe/Wardrobe";

const hasAuth0Config = Boolean(
  import.meta.env.VITE_AUTH0_DOMAIN &&
  import.meta.env.VITE_AUTH0_CLIENT_ID,
);

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "");

  if (!hasAuth0Config) {
    return <SetupNotice />;
  }

  if (path === "/stylist") {
    return <StylistPage />;
  }

  if (path === "/analytics") {
    return <AnalyticsPage />;
  }

  if (path === "/wardrobe") {
    return <Wardrobe />;
  }

  if (path === "/outfits" || path === "/outfit") {
    return <Wardrobe />;
  }

  if (path === "/outfit-creation") {
    return <Wardrobe />;
  }

  return <AuthExperience />;
}

function AuthExperience() {
  const { isAuthenticated, isLoading, loginWithRedirect, logout } = useAuth0();

  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      onSignIn={() => void loginWithRedirect({ appState: { returnTo: "/wardrobe" } })}
      onSignUp={() =>
        void loginWithRedirect({
          authorizationParams: { screen_hint: "signup" },
          appState: { returnTo: "/wardrobe" },
        })
      }
      onSignOut={() =>
        void logout({ logoutParams: { returnTo: window.location.origin } })
      }
    />
  );
}

function SetupNotice() {
  return <LandingPage needsSetup />;
}

type LandingPageProps = {
  isAuthenticated?: boolean;
  isLoading?: boolean;
  needsSetup?: boolean;
  onSignIn?: () => void;
  onSignUp?: () => void;
  onSignOut?: () => void;
};

function LandingPage({
  isAuthenticated = false,
  isLoading = false,
  needsSetup = false,
  onSignIn,
  onSignUp,
}: LandingPageProps) {
  const [youStyleIndex, setYouStyleIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setYouStyleIndex((index) => (index + 1) % 4);
    }, 3500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="landing-page">
       <header className="stylist-header">
          <a className="stylist-wordmark" href="/">
          passionista<span>.</span>
          </a>
          <span className="stylist-header-title">THE STYLIST STUDIO</span>
          <PageMenu current="home" />
      </header>

      <main className="hero">
        <div className="hero-inner">
          <p className="eyebrow"><span className="eyebrow-line" /> WELCOME TO PASSIONISTA</p>
          <h1>Style begins<br />with <span className={`landing-you landing-you-${youStyleIndex}`}>you.</span></h1>
          <p className="description">A space to express yourself, and make every look your own.</p>

          {isLoading ? (
            <p className="account-status" role="status">Checking your account…</p>
          ) : isAuthenticated ? (
            <div className="account-actions">
              <p className="account-status" role="status">You are signed in.</p>
              <a className="primary-button view-wardrobe-button" href="/wardrobe">
                View wardrobe <span aria-hidden="true">→</span>
              </a>
            </div>
          ) : (
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={onSignUp} disabled={needsSetup}>
                Sign up <span aria-hidden="true">↗</span>
              </button>
              <button className="secondary-button" type="button" onClick={onSignIn} disabled={needsSetup}>
                Sign in
              </button>
            </div>
          )}
        </div>
        <div className="hero-visual">
          <img src="/landing-hero.jpg" alt="A rack of clothes being browsed" />
        </div>
      </main>

      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
