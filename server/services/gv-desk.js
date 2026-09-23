import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeGvSession } from "../../lib/google-voice.mjs";
import { buildNovncEmbedUrl } from "../../lib/novnc-url.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const restartScript = join(repoRoot, "scripts", "restart-gv-chrome.sh");

// Unit names only — never a client-supplied command line.
const UNIT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/;

let statusInflight = null;
let restartInflight = null;

function clip(text, max = 500) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function novncEmbedConfig() {
  try {
    return {
      novncUrl: buildNovncEmbedUrl(process.env.GV_NOVNC_URL),
      scaling: "scale",
      novncError: null,
    };
  } catch (err) {
    return {
      novncUrl: null,
      scaling: "scale",
      novncError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function chromeRestartConfig() {
  const enabled = process.env.GV_CHROME_RESTART === "1";
  const unit = (process.env.GV_CHROME_SYSTEMD_UNIT || "").trim();
  const userScope = process.env.GV_CHROME_SYSTEMD_USER === "1";
  const unitValid = Boolean(unit) && UNIT_RE.test(unit);
  let mode = null;
  if (enabled && unitValid) mode = "systemd";
  else if (enabled) mode = "script";

  let reason = null;
  if (!enabled) {
    // TODO: keep this opt-in. Restarting Chrome from the web is admin-only
    // and shells a fixed script (or a validated unit name), but it is still
    // a process kill. Leave GV_CHROME_RESTART unset until the Node user is
    // the admin who owns the GV profile.
    reason =
      "Chrome restart from the UI is off. Set GV_CHROME_RESTART=1 (admin-only) or run scripts/restart-gv-chrome.sh over SSH.";
  } else if (unit && !unitValid) {
    reason = "GV_CHROME_SYSTEMD_UNIT is not a safe unit name.";
  } else if (!unit && !existsSync(restartScript)) {
    reason = "scripts/restart-gv-chrome.sh is missing.";
  }

  return {
    enabled: enabled && !reason,
    mode: enabled && !reason ? mode : null,
    userScope,
    reason,
  };
}

function runFixed(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const err = new Error("GV Chrome restart timed out");
      err.status = 504;
      reject(err);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-4000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      const err = new Error(clip(stderr || stdout || `GV Chrome restart exited ${code}`, 800));
      err.status = 500;
      reject(err);
    });
  });
}

/**
 * Admin-only Chrome restart.
 *
 * scripts/start-gv-chrome.sh exits immediately when CDP is already up, so it
 * cannot recover a wedged window. This runs scripts/restart-gv-chrome.sh
 * instead, unless GV_CHROME_SYSTEMD_UNIT names a unit to restart.
 * TODO: deployments that must not kill Chrome should wrap the start script
 * in their own unit and set GV_CHROME_SYSTEMD_UNIT, leaving this path unused.
 */
export function restartGvChrome() {
  if (restartInflight) return restartInflight;

  const cfg = chromeRestartConfig();
  if (!cfg.enabled) {
    const err = new Error(cfg.reason || "GV Chrome restart is disabled.");
    err.status = 403;
    return Promise.reject(err);
  }

  const timeoutMs = Number(process.env.GV_CHROME_RESTART_TIMEOUT_MS || 60000);
  const task =
    cfg.mode === "systemd"
      ? runFixed(
          "systemctl",
          [
            ...(cfg.userScope ? ["--user"] : []),
            "restart",
            (process.env.GV_CHROME_SYSTEMD_UNIT || "").trim(),
          ],
          timeoutMs,
        )
      : runFixed("bash", [restartScript], timeoutMs);

  restartInflight = task
    .then((output) => ({
      ok: true,
      mode: cfg.mode,
      output: clip(output.stdout || output.stderr || "GV Chrome restarted", 400),
    }))
    .finally(() => {
      restartInflight = null;
    });
  return restartInflight;
}

export function getGvDeskStatus() {
  if (restartInflight) {
    return Promise.resolve({
      loggedIn: false,
      cdpReady: false,
      phase: "restarting",
      startedChrome: false,
      ...novncEmbedConfig(),
      chromeRestart: chromeRestartConfig(),
      checkedAt: new Date().toISOString(),
    });
  }
  if (statusInflight) return statusInflight;

  statusInflight = probeGvSession()
    .then((probe) => ({
      loggedIn: !!probe.loggedIn,
      cdpReady: !!probe.cdpReady,
      phase: probe.phase || (probe.loggedIn ? "signed-in" : "other"),
      startedChrome: !!probe.startedChrome,
      error: probe.error ? clip(probe.error) : undefined,
      ...novncEmbedConfig(),
      chromeRestart: chromeRestartConfig(),
      checkedAt: new Date().toISOString(),
    }))
    .finally(() => {
      statusInflight = null;
    });
  return statusInflight;
}
