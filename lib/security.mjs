/**
 * Shared checks for the Wingman HTTP API.
 * These stay free of Express so the unit tests can import them directly.
 */

const PLACEHOLDER_PASSWORDS = new Set([
  "change-me-now",
  "changeme",
  "change-me",
  "password",
  "admin",
  "wingman",
  "secret",
  "pick-a-strong-password",
  "pick-a-unique-password",
  "your-password",
]);

const PLACEHOLDER_SECRETS = new Set([
  "generate-a-long-random-string",
  "paste-a-long-random-string-here",
  "change-me",
  "change-me-now",
  "changeme",
  "secret",
  "password",
  "wingman",
]);

// Ports that must not be used as an LLM base URL. 9222 is Chrome's DevTools
// port; 5900/6080 are the VNC / noVNC desktop.
const BLOCKED_LLM_PORTS = new Set([9222, 9223, 5900, 5901, 6080]);

const BLOCKED_LLM_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

const CHILD_ENV_DENY = new Set([
  "AUTH_PASSWORD",
  "SESSION_SECRET",
  "LLM_API_KEY",
  "MOONSHOT_API_KEY",
  "OPENAI_API_KEY",
]);

const SETTINGS_TEXT_LIMITS = {
  self_context: 20000,
  system_guidelines: 20000,
  llm_model: 120,
};

const REASONING_EFFORTS = new Set(["", "low", "high", "max"]);

export function passwordIsPlaceholder(password) {
  const value = String(password || "").trim().toLowerCase();
  if (!value) return true;
  return PLACEHOLDER_PASSWORDS.has(value);
}

export function sessionSecretIsPlaceholder(secret) {
  const value = String(secret || "").trim().toLowerCase();
  if (!value) return true;
  return PLACEHOLDER_SECRETS.has(value);
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length < 8) return "••••";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function redactSecrets(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-****")
    .replace(
      /((?:api[_-]?key|password|secret|token)["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi,
      "$1****",
    );
}

export function isLoopbackBind(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums.reduce((acc, n) => (acc << 8) + n, 0) >>> 0;
}

function isLinkLocal(host) {
  const value = host.toLowerCase();
  if (value.startsWith("fe80:") || value === "::") return true;
  const n = ipv4ToInt(value);
  if (n == null) return false;
  return (n >>> 16) === 0xa9fe;
}

function isLoopbackHost(host) {
  const value = host.toLowerCase();
  if (value === "localhost" || value === "::1" || value.endsWith(".localhost")) return true;
  const n = ipv4ToInt(value);
  if (n == null) return false;
  return (n >>> 24) === 127;
}

function isPrivateNet(host) {
  const n = ipv4ToInt(host);
  if (n == null) return false;
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Accept https LLM endpoints, plus http only for loopback or a private-network
 * gateway. Reject cloud-metadata addresses and the local desktop/debug ports.
 */
export function validateLlmBaseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "https://api.openai.com/v1";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LLM base URL is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("LLM base URL must not include credentials");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    throw new Error("LLM base URL host is not allowed");
  }
  if (BLOCKED_LLM_HOSTS.has(host) || host.endsWith(".metadata.google.internal")) {
    throw new Error("LLM base URL points at a blocked host");
  }
  if (host === "0.0.0.0" || isLinkLocal(host)) {
    throw new Error("LLM base URL points at a blocked address");
  }
  const loopback = isLoopbackHost(host);
  const privateNet = isPrivateNet(host);
  if (url.protocol === "http:") {
    if (!loopback && !privateNet) {
      throw new Error(
        "LLM base URL must use https, except for a localhost or private-network gateway",
      );
    }
  } else if (url.protocol !== "https:") {
    throw new Error("LLM base URL must be http(s)");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (BLOCKED_LLM_PORTS.has(port)) {
    throw new Error("LLM base URL uses a blocked port");
  }
  return url.toString().replace(/\/$/, "");
}

export function presentSettings(settings) {
  const key = settings?.moonshot_api_key || "";
  return {
    ...settings,
    moonshot_api_key: "",
    llm_api_key_set: Boolean(key),
    llm_api_key_hint: maskSecret(key),
  };
}

export function normalizeSettingsPatch(body) {
  const src = body && typeof body === "object" ? body : {};
  const patch = {};
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
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(src, key)) patch[key] = src[key];
  }

  for (const key of Object.keys(SETTINGS_TEXT_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const text = String(patch[key] ?? "");
    const limit = SETTINGS_TEXT_LIMITS[key];
    if (text.length > limit) {
      throw new Error(`${key} is too long`);
    }
    patch[key] = text;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "moonshot_api_key")) {
    const next = String(patch.moonshot_api_key ?? "").trim();
    if (!next) delete patch.moonshot_api_key;
    else if (next.length > 500) throw new Error("LLM API key is too long");
    else patch.moonshot_api_key = next;
  }
  if (src.clear_llm_api_key === true) patch.moonshot_api_key = "";

  if (Object.prototype.hasOwnProperty.call(patch, "llm_base_url")) {
    patch.llm_base_url = validateLlmBaseUrl(patch.llm_base_url);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "reasoning_effort")) {
    const effort = String(patch.reasoning_effort ?? "").trim().toLowerCase();
    if (!REASONING_EFFORTS.has(effort)) {
      throw new Error("reasoning_effort must be low, high, or max");
    }
    patch.reasoning_effort = effort;
  }

  for (const key of ["keep_recent_messages", "compact_when_over"]) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    const min = key === "keep_recent_messages" ? 8 : 20;
    const max = 500;
    patch[key] = String(Math.min(max, Math.max(min, Math.trunc(n))));
  }

  return patch;
}

/**
 * Last-line status from the autofill helper. Only a short token is returned
 * to the browser so a noisy helper cannot echo a password into the UI.
 */
export function publicAutofillStatus(raw, code) {
  const status = String(raw || "").trim();
  if (
    /^(already_logged_in|ok|needs_2fa|filled_[a-z0-9_]{0,40}|awaiting_[a-z0-9_]{0,40}|error:[a-z0-9_]{1,40})$/i.test(
      status,
    )
  ) {
    return status;
  }
  if (code === -2) return "error:timeout";
  if (code === 0) return "ok";
  return "error:failed";
}

export function sanitizedChildEnv(source = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    if (CHILD_ENV_DENY.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    check(key, now = Date.now()) {
      const row = hits.get(key);
      if (!row || now - row.start >= windowMs) {
        hits.set(key, { start: now, count: 1 });
        return { ok: true, remaining: limit - 1 };
      }
      if (row.count >= limit) {
        return { ok: false, retryAfterMs: windowMs - (now - row.start) };
      }
      row.count += 1;
      return { ok: true, remaining: limit - row.count };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
