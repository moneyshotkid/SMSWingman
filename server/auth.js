import crypto from "node:crypto";
import session from "express-session";

function authUser() {
  return (process.env.AUTH_USER || "admin").trim();
}

function authPassword() {
  return (process.env.AUTH_PASSWORD || "").trim();
}

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    crypto.createHash("sha256").update(`wingman-${authPassword() || "dev"}`).digest("hex")
  );
}

export function authConfigured() {
  return Boolean(authPassword());
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
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function verifyCredentials(username, password) {
  const expectedPass = authPassword();
  if (!expectedPass) return false;
  const userOk = safeEqual(
    String(username || "").trim().toLowerCase(),
    authUser().toLowerCase(),
  );
  const passOk = safeEqual(String(password || ""), expectedPass);
  return userOk && passOk;
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
        error: "AUTH_PASSWORD is not set",
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
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!verifyCredentials(username, password)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    req.session.user = { username: authUser() };
    res.json({ ok: true, user: req.session.user });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("wingman.sid");
      res.json({ ok: true });
    });
  });
}
