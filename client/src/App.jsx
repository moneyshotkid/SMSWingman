import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import SettingsPanel from "./SettingsPanel.jsx";
import TargetPanel from "./TargetPanel.jsx";
import LoginPage from "./LoginPage.jsx";
import GvLoginPage from "./GvLoginPage.jsx";

const GV_LOGIN_PATH = "/gv-login";

function displayName(t) {
  const name = String(t?.name || "").trim();
  return name || t?.phone || "Unnamed";
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [authUser, setAuthUser] = useState(null);

  const [view, setView] = useState(() =>
    window.location.pathname === GV_LOGIN_PATH ? "gv" : "inbox",
  );
  const [targets, setTargets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [gvOk, setGvOk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [busyDetail, setBusyDetail] = useState("");
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [navOpen, setNavOpen] = useState(() => {
    const mobile = window.matchMedia("(max-width: 860px)").matches;
    if (mobile && window.location.pathname === GV_LOGIN_PATH) return false;
    return true;
  });

  const locked = busy || booting;
  const lockLabel = booting ? "Loading…" : busyMessage || "Working…";
  const lockDetail = booting ? "Getting things ready…" : busyDetail;

  const selected = useMemo(
    () => targets.find((t) => t.id === selectedId) || null,
    [targets, selectedId],
  );

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const startBusy = useCallback((message = "Working…", detail = "") => {
    setBusyMessage(message);
    setBusyDetail(detail);
    setBusy(true);
  }, []);

  const startGvBusy = useCallback(
    (message = "Talking to GV…") => {
      startBusy(message, "Patience is a virtue.");
    },
    [startBusy],
  );

  const stopBusy = useCallback(() => {
    setBusy(false);
    setBusyMessage("");
    setBusyDetail("");
  }, []);

  const onPanelBusy = useCallback(
    (isBusy, message = "Working…", detail = "") => {
      if (isBusy) startBusy(message, detail);
      else stopBusy();
    },
    [startBusy, stopBusy],
  );

  const refreshTargets = useCallback(async () => {
    const { targets: rows } = await api.targets();
    setTargets(rows);
    setSelectedId((prev) => {
      if (prev && rows.some((r) => r.id === prev)) return prev;
      return rows[0]?.id ?? null;
    });
  }, []);

  const refreshGv = useCallback(async () => {
    try {
      const { loggedIn } = await api.gvStatus();
      setGvOk(!!loggedIn);
    } catch {
      setGvOk(false);
    }
  }, []);

  const loadApp = useCallback(async () => {
    setBooting(true);
    setError("");
    try {
      await refreshTargets();
      await refreshGv();
    } catch (err) {
      if (err.status === 401) {
        setAuthenticated(false);
        setAuthUser(null);
      } else {
        setError(err.message);
      }
    } finally {
      setBooting(false);
    }
  }, [refreshTargets, refreshGv]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setAuthConfigured(me.configured !== false);
        if (me.authenticated) {
          setAuthenticated(true);
          setAuthUser(me.user || null);
        } else {
          setAuthenticated(false);
        }
      } catch (err) {
        setAuthConfigured(false);
        setAuthenticated(false);
        setError(err.message);
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (authenticated) loadApp();
  }, [authenticated, loadApp]);

  useEffect(() => {
    const onPop = () => {
      setView(window.location.pathname === GV_LOGIN_PATH ? "gv" : "inbox");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!authenticated || view === "gv") return undefined;
    const id = window.setInterval(() => {
      refreshGv();
    }, 45000);
    return () => window.clearInterval(id);
  }, [authenticated, view, refreshGv]);

  // On phones, collapse the people nav once a chat is open
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const apply = () => {
      if (!mq.matches) {
        setNavOpen(true);
        return;
      }
      if (view === "gv" || (selectedId && view === "inbox")) setNavOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [selectedId, view]);

  const handleLogin = async (username, password) => {
    const result = await api.login(username, password);
    setAuthenticated(true);
    setAuthUser(result.user || { username });
    setAuthConfigured(true);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* still clear local state */
    }
    setAuthenticated(false);
    setAuthUser(null);
    setTargets([]);
    setSelectedId(null);
    setGvOk(null);
    setView("inbox");
    if (window.location.pathname === GV_LOGIN_PATH) {
      window.history.pushState({}, "", "/");
    }
  };

  const reportError = useCallback((msg) => {
    const text = msg || "";
    setError(text);
    if (/GV is not signed in|Not signed in to GV|not logged in/i.test(text)) {
      setGvOk(false);
    }
  }, []);

  const openGvLogin = () => {
    if (locked) return;
    if (window.location.pathname !== GV_LOGIN_PATH) {
      window.history.pushState({ view: "gv" }, "", GV_LOGIN_PATH);
    }
    setError("");
    setView("gv");
    setNavOpen(false);
  };

  const leaveGvLogin = (next = "inbox") => {
    if (window.location.pathname === GV_LOGIN_PATH) {
      window.history.pushState({ view: next }, "", "/");
    }
    setView(next);
    refreshGv();
  };
  const onSyncAll = async () => {
    if (locked) return;
    startGvBusy("Pulling GV messages…");
    setError("");
    try {
      const result = await api.syncAll();
      setGvOk(!!result.loggedIn);
      await refreshTargets();
      const inbound = (result.results || []).reduce(
        (n, r) => n + (r.newInboundCount || 0),
        0,
      );
      flash(
        inbound
          ? `Synced. ${inbound} new inbound message(s).`
          : "Synced. No new inbound messages.",
      );
    } catch (err) {
      reportError(err.message);
    } finally {
      stopBusy();
    }
  };

  const onCreate = async (e) => {
    e.preventDefault();
    if (locked) return;
    startGvBusy("Adding target & syncing GV…");
    setError("");
    try {
      const result = await api.createTarget({
        phone: newPhone,
        name: newName,
      });
      setNewPhone("");
      setNewName("");
      setShowNew(false);
      await refreshTargets();
      setSelectedId(result.target.id);
      if (window.location.pathname === GV_LOGIN_PATH) {
        window.history.pushState({ view: "inbox" }, "", "/");
      }
      setView("inbox");
      setNavOpen(false);
      if (result.syncError) {
        flash(`Added — sync failed: ${result.syncError}`);
        reportError(result.syncError);
      } else {
        const n = result.sync?.messageCount || 0;
        const inbound = result.sync?.newInboundCount || 0;
        flash(
          inbound
            ? `Added & synced — ${inbound} new inbound, drafts ready`
            : `Added & synced — ${n} message(s)`,
        );
      }
    } catch (err) {
      reportError(err.message);
    } finally {
      stopBusy();
    }
  };

  const openChat = (id) => {
    if (locked) return;
    if (window.location.pathname === GV_LOGIN_PATH) {
      window.history.pushState({ view: "inbox" }, "", "/");
    }
    setSelectedId(id);
    setView("inbox");
    if (window.matchMedia("(max-width: 860px)").matches) setNavOpen(false);
  };

  if (!authReady) {
    return (
      <div className="login-screen">
        <div className="busy-card">
          <div className="busy-spinner" aria-hidden="true" />
          <p className="busy-title">Loading…</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginPage
        configured={authConfigured}
        onLogin={handleLogin}
        defaultUser=""
      />
    );
  }

  return (
    <div
      className={`app-shell ${navOpen ? "nav-open" : "nav-closed"} ${locked ? "is-locked" : ""}`}
      aria-busy={locked}
    >
      <aside className={`sidebar ${navOpen ? "is-open" : "is-closed"}`}>
        <div className="brand-block">
          <div>
            <p className="muted eyebrow">Personal dating coach</p>
            <h1 className="brand">
              SMS<span>Wingman</span>
            </h1>
          </div>
          <button
            type="button"
            className={`status-pill ${gvOk === false ? "is-off" : ""}`}
            title={gvOk === false ? "Reconnect GV" : "GV session"}
            disabled={locked}
            onClick={openGvLogin}
          >
            <span className={`status-dot ${gvOk ? "on" : ""} ${gvOk === false ? "off" : ""}`} />
            <span className="status-label status-label-short">
              {gvOk ? "GV on" : gvOk === false ? "GV off" : "…"}
            </span>
            <span className="status-label status-label-full">
              GV {gvOk ? "connected" : gvOk === false ? "not signed in" : "…"}
            </span>
          </button>
        </div>

        <div className="nav-actions">
          <button className="btn btn-primary" disabled={locked} onClick={onSyncAll}>
            <span className="label-full">{busy ? "Working…" : "Pull messages"}</span>
            <span className="label-short">{busy ? "…" : "Pull"}</span>
          </button>
          <button className="btn" disabled={locked} onClick={() => setShowNew((v) => !v)}>
            <span className="label-full">Add target</span>
            <span className="label-short">Add</span>
          </button>
          <button
            className={`btn btn-settings ${view === "settings" ? "btn-primary" : ""}`}
            disabled={locked}
            onClick={() => {
              const next = view === "settings" ? "inbox" : "settings";
              if (window.location.pathname === GV_LOGIN_PATH) {
                window.history.pushState({ view: next }, "", "/");
              }
              setView(next);
              setNavOpen(true);
            }}
          >
            Settings
          </button>
          <button className="btn btn-ghost" disabled={locked} onClick={handleLogout} title="Sign out">
            Logout
          </button>
        </div>

        {showNew && (
          <form className="card" onSubmit={onCreate} style={{ padding: "0.85rem" }}>
            <label>
              Name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Alex"
                required
              />
            </label>
            <label style={{ marginTop: "0.6rem" }}>
              Phone
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+19495551212"
                required
              />
            </label>
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button className="btn btn-primary" type="submit" disabled={locked}>
                Save
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={locked}
                onClick={() => setShowNew(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <ul className="target-list">
          {targets.map((t) => {
            const named = String(t.name || "").trim();
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={selectedId === t.id && view === "inbox" ? "active" : ""}
                  disabled={locked}
                  onClick={() => openChat(t.id)}
                >
                  <span className="name">{displayName(t)}</span>
                  {named ? null : <span className="phone">{t.phone}</span>}
                </button>
              </li>
            );
          })}
          {!targets.length && (
            <li className="muted" style={{ padding: "0.5rem" }}>
              No targets yet — add a phone number to coach.
            </li>
          )}
        </ul>
      </aside>

      {navOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      )}

      <main className="main">
        {error && view !== "gv" && <div className="error-banner">{error}</div>}

        {gvOk === false && view !== "gv" && (
          <div className="gv-cta-banner" role="status">
            <div>
              <strong>GV is signed out.</strong>{" "}
              <span>Pull and send will fail until you sign in again on the GV desktop.</span>
            </div>
            <button className="btn btn-primary" type="button" disabled={locked} onClick={openGvLogin}>
              Reconnect GV
            </button>
          </div>
        )}

        {view === "gv" ? (
          <GvLoginPage onBack={() => leaveGvLogin("inbox")} onStatus={setGvOk} />
        ) : view === "settings" ? (
          <SettingsPanel onSaved={flash} onError={reportError} onReconnect={openGvLogin} />
        ) : selected ? (
          <TargetPanel
            key={selected.id}
            targetId={selected.id}
            onTargetsChanged={refreshTargets}
            onToast={flash}
            onError={reportError}
            onOpenNav={() => setNavOpen(true)}
            onBusyChange={onPanelBusy}
            interactionLocked={locked}
          />
        ) : (
          <div className="empty">
            <h2 style={{ fontFamily: "var(--display)", fontWeight: 400 }}>
              Pick or add a target
            </h2>
            <p>When you get a GV notification, open Wingman and hit Pull messages.</p>
            <button
              className="btn btn-primary"
              type="button"
              disabled={locked}
              onClick={() => setNavOpen(true)}
            >
              Open menu
            </button>
          </div>
        )}
      </main>

      {locked && (
        <div className="busy-overlay" role="alert" aria-live="assertive">
          <div className="busy-card">
            <div className="busy-spinner" aria-hidden="true" />
            <p className="busy-title">{lockLabel}</p>
            {lockDetail ? <p className="busy-detail">{lockDetail}</p> : null}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
