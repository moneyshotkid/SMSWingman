import test from "node:test";
import assert from "node:assert/strict";
import {
  passwordIsPlaceholder,
  sessionSecretIsPlaceholder,
  maskSecret,
  redactSecrets,
  validateLlmBaseUrl,
  presentSettings,
  normalizeSettingsPatch,
  publicAutofillStatus,
  sanitizedChildEnv,
  createRateLimiter,
} from "./security.mjs";

test("placeholder passwords are rejected, real ones are not", () => {
  assert.equal(passwordIsPlaceholder(""), true);
  assert.equal(passwordIsPlaceholder("change-me-now"), true);
  assert.equal(passwordIsPlaceholder("pick-a-strong-password"), true);
  assert.equal(passwordIsPlaceholder("a-real-passphrase-1"), false);
});

test("example session secret is a placeholder", () => {
  assert.equal(sessionSecretIsPlaceholder(""), true);
  assert.equal(sessionSecretIsPlaceholder("generate-a-long-random-string"), true);
  assert.equal(sessionSecretIsPlaceholder("x".repeat(40)), false);
});

test("maskSecret keeps only the ends of a long value", () => {
  assert.equal(maskSecret("sk-live-secret-value"), "sk-l…alue");
  assert.equal(maskSecret("short"), "••••");
  assert.equal(maskSecret(""), "");
});

test("redactSecrets strips key-shaped tokens", () => {
  const out = redactSecrets("provider said sk-abc123456789 is invalid");
  assert.equal(out.includes("sk-abc123456789"), false);
  assert.match(out, /sk-\*\*\*\*/);
});

test("validateLlmBaseUrl blocks metadata, debug ports, and cleartext public hosts", () => {
  assert.equal(
    validateLlmBaseUrl("https://api.openai.com/v1"),
    "https://api.openai.com/v1",
  );
  assert.equal(validateLlmBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  assert.throws(() => validateLlmBaseUrl("http://169.254.169.254/latest"), /blocked/);
  assert.throws(() => validateLlmBaseUrl("http://metadata.google.internal/"), /blocked/);
  assert.throws(() => validateLlmBaseUrl("http://127.0.0.1:9222"), /port/);
  assert.throws(() => validateLlmBaseUrl("http://example.com/v1"), /https/);
  assert.throws(() => validateLlmBaseUrl("file:///etc/passwd"), /http/);
  assert.throws(() => validateLlmBaseUrl("http://user:pass@127.0.0.1:11434"), /credential/);
});

test("presentSettings does not echo the stored API key", () => {
  const view = presentSettings({
    moonshot_api_key: "sk-live-secret-value",
    llm_model: "gpt-4o-mini",
  });
  assert.equal(view.moonshot_api_key, "");
  assert.equal(view.llm_api_key_set, true);
  assert.equal(view.llm_api_key_hint, "sk-l…alue");
  assert.equal(JSON.stringify(view).includes("sk-live-secret-value"), false);
});

test("blank API key on save keeps the stored key", () => {
  const patch = normalizeSettingsPatch({
    moonshot_api_key: "",
    llm_model: "gpt-4o-mini",
    llm_base_url: "https://api.openai.com/v1",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "moonshot_api_key"), false);
  assert.equal(patch.llm_model, "gpt-4o-mini");
});

test("settings patch rejects a metadata base URL", () => {
  assert.throws(
    () => normalizeSettingsPatch({ llm_base_url: "http://169.254.169.254/" }),
    /blocked/,
  );
});

test("autofill status is reduced to a token", () => {
  assert.equal(publicAutofillStatus("already_logged_in", 0), "already_logged_in");
  assert.equal(publicAutofillStatus("filled_email", 0), "filled_email");
  assert.equal(publicAutofillStatus("password=hunter2", 0), "ok");
  assert.equal(publicAutofillStatus("password=hunter2", 1), "error:failed");
  assert.equal(publicAutofillStatus("", -2), "error:timeout");
});

test("child env drops app secrets", () => {
  const env = sanitizedChildEnv({
    PATH: "/usr/bin",
    AUTH_PASSWORD: "super-secret-password",
    LLM_API_KEY: "sk-live-secret-value",
    DISPLAY: ":99",
    GV_PROFILE: "/tmp/profile",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.DISPLAY, ":99");
  assert.equal(env.GV_PROFILE, "/tmp/profile");
  assert.equal(env.AUTH_PASSWORD, undefined);
  assert.equal(env.LLM_API_KEY, undefined);
});

test("rate limiter locks after the configured number of hits", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check("a", 0).ok, true);
  assert.equal(limiter.check("a", 10).ok, true);
  assert.equal(limiter.check("a", 20).ok, false);
  limiter.reset("a");
  assert.equal(limiter.check("a", 30).ok, true);
});
