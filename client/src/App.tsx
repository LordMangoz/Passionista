import { useAuth0 } from "@auth0/auth0-react";

const hasAuth0Config = Boolean(
  import.meta.env.VITE_AUTH0_DOMAIN && 
  import.meta.env.VITE_AUTH0_CLIENT_ID,
);

export default function App() {
  if (!hasAuth0Config) {
    return <SetupNotice />;
  }

  return <AuthExperience />;
}

function AuthExperience() {
  const { isAuthenticated, loginWithRedirect, logout } = useAuth0();

  return (
    <main className="simple-auth-page">
      <button
        className="simple-auth-button"
        onClick={() =>
          isAuthenticated
            ? logout({ logoutParams: { returnTo: window.location.origin } })
            : loginWithRedirect()
        }
        type="button"
      >
        {isAuthenticated ? "Sign out" : "Sign in"}
      </button>
    </main>
  );
}

function SetupNotice() {
  return (
    <main className="simple-auth-page">
      <p>Set your Auth0 domain and client ID in <code>client/.env.local</code>.</p>
    </main>
  );
}