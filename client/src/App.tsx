import { useAuth0 } from "@auth0/auth0-react";
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

  if (path === "/stylist") {
    return <StylistPage />;
  }

  if (path === "/wardrobe") {
    return hasAuth0Config ? <Wardrobe /> : <SetupNotice />;
  }

  return hasAuth0Config ? <AuthExperience /> : <SetupNotice />;
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
          <h1>Style begins<br />with <em>you.</em></h1>
          <p className="description">A space to express yourself, and make every look your own.</p>

          {isLoading ? (
            <p className="account-status" role="status">Checking your account…</p>
          ) : isAuthenticated ? (
            <p className="account-status" role="status">You are signed in.</p>
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
        <div className="hero-decoration" aria-hidden="true">
          <span className="decoration-ring" />
          <span className="decoration-letter">P</span>
        </div>
      </main>

      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
