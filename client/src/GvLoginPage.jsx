import { useEffect, useState } from "react";
import { api } from "./api.js";

const PHASE_COPY = {
  "signed-in": "GV is signed in. You can go back to your threads.",
  "sign-in": "Sign-in is open on the desktop. Finish it here — this page notices when GV connects.",
  gv: "GV is open but not signed in yet. Use the desktop below.",
  workspace: "The desktop is on a marketing page. Sign in with the account that owns your GV number.",
  blank: "The desktop is up. If the window is still blank, wait a moment or restart GV Chrome.",
  other: "Finish signing in on the desktop below.",
  "cdp-down": "GV Chrome is not running on the server.",
  restarting: "Restarting GV Chrome…",
};

export function novncLoopbackMismatch(novncUrl) {
  if (!novncUrl || typeof window === "undefined") return false;
  try {
    const resolved = new URL(novncUrl, window.location.href);
    const embedLoopback = ["127.0.0.1", "localhost", "::1"].includes(resolved.hostname);
    const pageLoopback = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
    return embedLoopback && !pageLoopback;
  } catch {
    return false;
  }
}

export default function GvLoginPage({ onBack, onStatus }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      try {
        const next = await api.gvStatus();
        if (cancelled) return;
        setStatus(next);
        setError(next.error || "");
        onStatus(!!next.loggedIn);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        onStatus(false);
      }
    };

    const loop = async () => {
      while (!cancelled) {
        const started = Date.now();
        await tick();
        const wait = Math.max(1500, 8000 - (Date.now() - started));
        if (cancelled) return;
        await new Promise((resolve) => {
          timer = window.setTimeout(resolve, wait);
        });
      }
    };

    loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onStatus]);

  const loggedIn = !!status?.loggedIn;
  const phase = status?.phase || (status ? "other" : "");
  const novncUrl = status?.novncUrl || "";
  const loopbackMismatch = novncLoopbackMismatch(novncUrl);
  const restart = status?.chromeRestart;

  const onRestart = async () => {
    if (restarting) return;
    const ok = window.confirm(
      "Restart GV Chrome on the server? The desktop will reload and you may need to sign in again.",
    );
    if (!ok) return;
    setRestarting(true);
    setError("");
    try {
      await api.restartGvChrome();
      const next = await api.gvStatus();
      setStatus(next);
      onStatus(!!next.loggedIn);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="gv-desk">
      <div className="topbar gv-desk-bar">
        <div className="topbar-title">
          <h2>Reconnect GV</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {PHASE_COPY[phase] || "Checking the GV session…"}
            {status?.startedChrome ? " Chrome was started because it was not running." : ""}
          </p>
        </div>
        <div className="topbar-actions">
          <span className="status-pill" title="GV session">
            <span className={`status-dot ${loggedIn ? "on" : status ? "off" : ""}`} />
            <span>{loggedIn ? "GV connected" : status ? "GV not signed in" : "Checking…"}</span>
          </span>
          <button className="btn" type="button" onClick={onBack}>
            Back
          </button>
          {restart?.enabled ? (
            <button className="btn" type="button" disabled={restarting} onClick={onRestart}>
              {restarting ? "Restarting…" : "Restart GV Chrome"}
            </button>
          ) : null}
          {novncUrl ? (
            <a className="btn" href={novncUrl} target="_blank" rel="noreferrer">
              Open desktop
            </a>
          ) : null}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {loopbackMismatch ? (
        <div className="gv-warn">
          This embed points at 127.0.0.1, which is this device, not the server. Set{" "}
          <code>GV_NOVNC_URL</code> to a Tailscale hostname or a relative path such as{" "}
          <code>/novnc/</code>, then reload.
        </div>
      ) : null}

      {status?.novncError ? <div className="error-banner">{status.novncError}</div> : null}

      {!restart?.enabled && restart?.reason ? (
        <p className="gv-restart-note muted">{restart.reason}</p>
      ) : null}

      <details className="gv-scale-note">
        <summary>Scaling and the hand tool</summary>
        <p>
          The embed loads noVNC with <code>resize=scale</code>, so the whole desktop fits this
          window. The hand/pan tool is intentionally unused in that mode — it only drags the view
          when scaling is off and the remote screen is larger than the browser. Leave the noVNC
          scaling control on Scale. On a phone, pinch-zoom the browser if you need a closer look.
        </p>
      </details>

      <div className="gv-frame-wrap">
        {novncUrl ? (
          <iframe
            className="gv-novnc-frame"
            title="GV desktop"
            src={novncUrl}
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="empty">
            <p>{status ? "The GV desktop URL is not configured yet." : "Checking the GV session…"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
