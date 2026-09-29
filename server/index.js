import express from "express";
import cors from "cors";
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getSettings, setSettings, nowIso } from "./db.js";
import { normalizePhone } from "../lib/google-voice.mjs";
import { getGvDeskStatus, restartGvChrome, runGvAutofill } from "./services/gv-desk.js";
import {
  syncAllTargets,
  syncTarget,
  sendChosenDraft,
  sendFreeform,
  regenerateDrafts,
  getPendingDraftBundle,
  getRecentMessages,
} from "./services/sync.js";
import {
  sessionMiddleware,
  mountAuthRoutes,
  requireAuth,
  authConfigured,
  authDisabledReason,
  getAuthUser,
  clientAddress,
  sessionSecretWasEphemeral,
} from "./auth.js";
import {
  createRateLimiter,
  isLoopbackBind,
  normalizeSettingsPatch,
  presentSettings,
  validateLlmBaseUrl,
} from "../lib/security.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "..", ".env") });

const PORT = Number(process.env.PORT || 8787);
const HOST = (process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const reconnectLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
const db = openDb();

// Seed API settings from env once if UI fields are still empty
{
  const s = getSettings(db);
  const seed = {};
  if (!s.moonshot_api_key && (process.env.LLM_API_KEY || process.env.MOONSHOT_API_KEY)) {
    seed.moonshot_api_key = process.env.LLM_API_KEY || process.env.MOONSHOT_API_KEY;
  }
  if (process.env.LLM_BASE_URL) {
    try {
      seed.llm_base_url = validateLlmBaseUrl(process.env.LLM_BASE_URL);
    } catch (err) {
      console.warn(`[llm] Ignoring LLM_BASE_URL: ${err.message}`);
    }
  }
  if (process.env.LLM_MODEL) seed.llm_model = process.env.LLM_MODEL;
  if (Object.keys(seed).length) setSettings(db, seed);
}

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const corsOrigin = (process.env.CORS_ORIGIN || "").trim();
if (corsOrigin) {
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
}
app.use(express.json({ limit: "1mb" }));
app.use(sessionMiddleware());

// Browsers send Origin on cross-site POSTs. Same-origin fetches match Host.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  if (!origin) return next();
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: "Blocked cross-site request" });
  }
  if (originHost !== req.get("host")) {
    return res.status(403).json({ error: "Blocked cross-site request" });
  }
  next();
});

mountAuthRoutes(app);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, authConfigured: authConfigured() });
});

// Everything else under /api requires a login session
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path === "/health") return next();
  return requireAuth(req, res, next);
});

function targetRow(row) {
  if (!row) return null;
  return {
    ...row,
    push_for_date: !!row.push_for_date,
  };
}

app.get("/api/gv/status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const status = await getGvDeskStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ loggedIn: false, error: err.message });
  }
});

// Session-authenticated. Runs the fixed autofill helper (not a request-supplied
// command) and returns only a short status token. The in-app desktop is
// /gv-login; this route does not hand the browser a public noVNC port.
app.post("/api/gv/reconnect", async (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({
      error: 'Send { "confirm": true } to run GV autofill.',
    });
  }
  const gate = reconnectLimiter.check(clientAddress(req));
  if (!gate.ok) {
    const retryAfter = Math.max(1, Math.ceil(gate.retryAfterMs / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many GV reconnect attempts. Try again later." });
  }
  try {
    const result = await runGvAutofill();
    res.json({ ok: result.ok, status: result.status });
  } catch (err) {
    res.status(err.status || 500).json({
      ok: false,
      status: "error:failed",
      error: "GV autofill could not be started.",
    });
  }
});

// Opt-in, session-authenticated. The command is a fixed script or a validated
// systemd unit — the request body cannot choose what runs.
app.post("/api/gv/chrome/restart", async (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({
      error: 'Send { "confirm": true } to restart GV Chrome.',
    });
  }
  try {
    const result = await restartGvChrome();
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/settings", (_req, res) => {
  res.json({ settings: presentSettings(getSettings(db)) });
});

app.put("/api/settings", (req, res) => {
  try {
    const patch = normalizeSettingsPatch(req.body);
    const settings = setSettings(db, patch);
    res.json({ settings: presentSettings(settings) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid settings" });
  }
});

app.get("/api/targets", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM targets ORDER BY updated_at DESC")
    .all()
    .map(targetRow);
  res.json({ targets: rows });
});

app.post("/api/targets", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const name = String(req.body.name || "").trim();
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO targets
         (phone, name, memory_summary, response_delay_seconds, content_length, tone, style,
          push_for_date, custom_instructions, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        phone,
        name,
        Number(req.body.response_delay_seconds) || 0,
        req.body.content_length || "medium",
        req.body.tone || "flirty",
        req.body.style || "casual",
        req.body.push_for_date ? 1 : 0,
        req.body.custom_instructions || "",
        ts,
        ts,
      );

    const id = info.lastInsertRowid;
    let syncResult = null;
    let syncError = null;
    try {
      syncResult = await syncTarget(db, id);
    } catch (err) {
      syncError = err.message;
    }

    const target = targetRow(db.prepare("SELECT * FROM targets WHERE id = ?").get(id));
    res.status(201).json({
      target,
      sync: syncResult
        ? {
            newInboundCount: syncResult.newInboundCount,
            pendingDrafts: syncResult.pendingDrafts,
            messageCount: syncResult.messages?.length || 0,
          }
        : null,
      syncError,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/targets/:id", (req, res) => {
  const target = targetRow(
    db.prepare("SELECT * FROM targets WHERE id = ?").get(Number(req.params.id)),
  );
  if (!target) return res.status(404).json({ error: "Not found" });
  const messages = getRecentMessages(db, target.id, 300);
  const pendingDrafts = getPendingDraftBundle(db, target.id);
  res.json({ target, messages, pendingDrafts });
});

app.put("/api/targets/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM targets WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  let phone = existing.phone;
  try {
    if (req.body.phone) phone = normalizePhone(req.body.phone);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE targets SET
      phone = ?,
      name = ?,
      memory_summary = ?,
      response_delay_seconds = ?,
      content_length = ?,
      tone = ?,
      style = ?,
      push_for_date = ?,
      custom_instructions = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    phone,
    req.body.name != null ? String(req.body.name) : existing.name,
    req.body.memory_summary != null
      ? String(req.body.memory_summary)
      : existing.memory_summary,
    req.body.response_delay_seconds != null
      ? Number(req.body.response_delay_seconds)
      : existing.response_delay_seconds,
    req.body.content_length || existing.content_length,
    req.body.tone || existing.tone,
    req.body.style || existing.style,
    req.body.push_for_date != null
      ? req.body.push_for_date
        ? 1
        : 0
      : existing.push_for_date,
    req.body.custom_instructions != null
      ? String(req.body.custom_instructions)
      : existing.custom_instructions,
    nowIso(),
    id,
  );

  res.json({
    target: targetRow(db.prepare("SELECT * FROM targets WHERE id = ?").get(id)),
  });
});

app.delete("/api/targets/:id", (req, res) => {
  const info = db.prepare("DELETE FROM targets WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

app.post("/api/sync", async (_req, res) => {
  try {
    const result = await syncAllTargets(db);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/targets/:id/sync", async (req, res) => {
  try {
    const result = await syncTarget(db, Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/targets/:id/regenerate", async (req, res) => {
  try {
    const pendingDrafts = await regenerateDrafts(db, Number(req.params.id));
    res.json({ pendingDrafts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/drafts/:id/send", async (req, res) => {
  try {
    const result = await sendChosenDraft(db, {
      draftId: Number(req.params.id),
      editedBody: req.body?.body,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/targets/:id/send", async (req, res) => {
  try {
    const result = await sendFreeform(db, {
      targetId: Number(req.params.id),
      body: req.body?.body,
      applyDelay: req.body?.applyDelay !== false,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Production: serve built client
const clientDist = join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, HOST, () => {
  console.log(`SMSWingman API on http://${HOST}:${PORT}`);
  if (!isLoopbackBind(HOST)) {
    console.warn(
      `[bind] Listening on ${HOST}. Prefer 127.0.0.1 and a reverse proxy or Tailscale. Do not publish ports 9222, 5900, or 6080.`,
    );
    if (process.env.COOKIE_SECURE !== "1") {
      console.warn("[auth] COOKIE_SECURE is not 1. Session cookies will travel over plain HTTP.");
    }
  }
  if (sessionSecretWasEphemeral()) {
    console.warn(
      "[auth] SESSION_SECRET is missing or still the example value. Using a random secret for this process; set a long random SESSION_SECRET in .env.",
    );
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    console.warn(
      "[auth] The server is running as root. A stolen session can start the GV autofill helper and Chrome. Run Wingman as a dedicated user.",
    );
  }
  if (!authConfigured()) {
    console.warn(`[auth] ${authDisabledReason()} — API is locked until you fix .env`);
  } else {
    console.log(`[auth] Login required (user: ${getAuthUser()})`);
  }
});
