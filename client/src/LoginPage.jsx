import { useState } from "react";

export default function LoginPage({ onLogin, configured, defaultUser = "" }) {
  const [username, setUsername] = useState(defaultUser);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>
          Personal dating coach
        </p>
        <h1 className="brand" style={{ marginTop: "0.25rem" }}>
          SMS<span>Wingman</span>
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in to continue
        </p>

        {!configured && (
          <div className="error-banner" style={{ margin: "0 0 0.75rem" }}>
            Set <code>AUTH_PASSWORD</code> (and optionally <code>AUTH_USER</code>) in{" "}
            <code>.env</code>, then restart the server.
          </div>
        )}

        {error && (
          <div className="error-banner" style={{ margin: "0 0 0.75rem" }}>
            {error}
          </div>
        )}

        <label>
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!configured || busy}
            required
          />
        </label>
        <label style={{ marginTop: "0.75rem" }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!configured || busy}
            required
          />
        </label>
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={!configured || busy}
          style={{ marginTop: "1rem" }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
