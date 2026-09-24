import express from "express";
import cors from "cors";
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getSettings, setSettings, nowIso } from "./db.js";
import { normalizePhone } from "../lib/google-voice.mjs";
import { getGvDeskStatus, restartGvChrome } from "./services/gv-desk.js";
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
  getAuthUser,
} from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "..", ".env") });

const PORT = Number(process.env.PORT || 8787);
const db = openDb();

// Seed API settings from env once if UI fields are still empty
{
  const s = getSettings(db);
  const seed = {};
  if (!s.moonshot_api_key && (process.env.LLM_API_KEY || process.env.MOONSHOT_API_KEY)) {
    seed.moonshot_api_key = process.env.LLM_API_KEY || process.env.MOONSHOT_API_KEY;
  }
  if (process.env.LLM_BASE_URL) seed.llm_base_url = process.env.LLM_BASE_URL;
  if (process.env.LLM_MODEL) seed.llm_model = process.env.LLM_MODEL;
  if (Object.keys(seed).length) setSettings(db, seed);
}

const app = express();
app.set("trust proxy", 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware());

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

app.post("/api/gv/reconnect", async (_req, res) => {
  const { spawn } = await import("node:child_process");
  const portalPort = Number(process.env.GV_PORTAL_PORT || 6080);
  const autofillBin = process.env.GV_AUTOFILL_BIN || "/root/.google-voice-sms/bin/gv-autofill";
  try {
    const child = spawn(autofillBin, [], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {}
        resolve(-2);
      }, 90000);
      child.on("error", (err) => {
        clearTimeout(timer);
        stderr += String(err.message || err);
        resolve(-1);
      });
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? -1);
      });
    });
    const lines = stdout.trim().split(/\n/).filter(Boolean);
    const status = (lines.pop() || "").trim();
    const nice = status || (code === -2 ? "error:timeout" : `error:exit_${code}`);
    const ok =
      code === 0 ||
      nice === "already_logged_in" ||
      nice.includes("2fa") ||
      nice.includes("awaiting") ||
      nice.startsWith("filled_");
    res.json({
      ok,
      status: nice,
      portalPath: `:${portalPort}/`,
      detail: stderr.slice(-500),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      status: "error:" + err.message,
      portalPath: `:${portalPort}/`,
    });
  }
});

app.get("/api/settings", (_req, res) => {
  const settings = getSettings(db);
  // Never echo full key in list UIs if empty; still return for edit form
  res.json({ settings });
});

app.put("/api/settings", (req, res) => {
  const allowed = [
    "self_context",
    "system_guidelines",
    "moonshot_api_key",
    "llm_base_url",
    "llm_model",
    "reasoning_effort",
    "keep_recent_messages",
    "compact_when_over",
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      patch[key] = req.body[key];
    }
  }
  const settings = setSettings(db, patch);
  res.json({ settings });
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

app.listen(PORT, () => {
  console.log(`SMSWingman API on http://localhost:${PORT}`);
  if (!authConfigured()) {
    console.warn(
      "[auth] AUTH_PASSWORD is not set — API is locked until you add it to .env",
    );
  } else {
    console.log(`[auth] Login required (user: ${getAuthUser()})`);
  }
});
