import crypto from "node:crypto";
import session from "express-session";
import {
  passwordIsPlaceholder,
  sessionSecretIsPlaceholder,
  createRateLimiter,
} from "../lib/security.mjs";

const loginLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });

let cachedSessionSecret = null;
let sessionSecretEphemeral = false;

function authUser() {
  return (process.env.AUTH_USER || "admin").trim() || "admin";
}

function authPassword() {
  return (process.env.AUTH_PASSWORD || "").trim();
}

export function authDisabledReason() {
  const password = authPassword();
  if (!password) return "AUTH_PASSWORD is not set";
  if (passwordIsPlaceholder(password)) {
    return "AUTH_PASSWORD is a known placeholder. Set a unique password in .env";
  }
  return null;
}

export function authConfigured() {
  return authDisabledReason() == null;
}

export function sessionSecret() {
  if (cachedSessionSecret) return cachedSessionSecret;
  const configured = (process.env.SESSION_SECRET || "").trim();
  if (configured && !sessionSecretIsPlaceholder(configured)) {
    cachedSessionSecret = configured;
    sessionSecretEphemeral = false;
    return cachedSessionSecret;
  }
  cachedSessionSecret = crypto.randomBytes(32).toString("hex");
  sessionSecretEphemeral = true;
  return cachedSessionSecret;
}

export function sessionSecretWasEphemeral() {
  sessionSecret();
  return sessionSecretEphemeral;
}

export function sessionMiddleware() {
  return session({
    name: "wingman.sid",
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "1",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b), "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyCredentials(username, password) {
  const expectedPass = authPassword();
  if (!expectedPass || passwordIsPlaceholder(expectedPass)) return false;
  const userOk = safeEqual(
    String(username || "").trim().toLowerCase(),
    authUser().toLowerCase(),
  );
  const passOk = safeEqual(String(password || ""), expectedPass);
  return userOk && passOk;
}

export function clientAddress(req) {
  const socketAddr = req.socket?.remoteAddress || req.ip || "unknown";
  if (process.env.TRUST_PROXY === "1") return req.ip || socketAddr;
  return socketAddr;
}

export function requireAuth(req, res, next) {
  if (!authConfigured()) {
    return res.status(503).json({
      error: "Set AUTH_PASSWORD in .env before using the app online.",
    });
  }
  if (req.session?.user) return next();
  return res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
}

export function getAuthUser() {
  return authUser();
}

export function mountAuthRoutes(app) {
  app.get("/api/auth/me", (req, res) => {
    if (!authConfigured()) {
      return res.json({
        authenticated: false,
        configured: false,
        error: authDisabledReason(),
      });
    }
    if (req.session?.user) {
      return res.json({
        authenticated: true,
        configured: true,
        user: req.session.user,
      });
    }
    return res.json({ authenticated: false, configured: true });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authConfigured()) {
      return res.status(503).json({
        error: "Set AUTH_PASSWORD in .env before logging in.",
      });
    }
    const address = clientAddress(req);
    const gate = loginLimiter.check(address);
    if (!gate.ok) {
      const retryAfter = Math.max(1, Math.ceil(gate.retryAfterMs / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!verifyCredentials(username, password)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    loginLimiter.reset(address);
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not start a session" });
      }
      req.session.user = { username: authUser() };
      res.json({ ok: true, user: req.session.user });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("wingman.sid");
      res.json({ ok: true });
    });
  });
}
