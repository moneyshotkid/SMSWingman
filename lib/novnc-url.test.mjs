import test from "node:test";
import assert from "node:assert/strict";
import { buildNovncEmbedUrl, DEFAULT_NOVNC_BASE } from "./novnc-url.mjs";

test("default base becomes a scaled viewer URL", () => {
  const url = new URL(buildNovncEmbedUrl(""));
  assert.equal(url.origin + "/", new URL(DEFAULT_NOVNC_BASE).origin + "/");
  assert.equal(url.pathname, "/vnc.html");
  assert.equal(url.searchParams.get("resize"), "scale");
  assert.equal(url.searchParams.get("autoconnect"), "1");
  assert.equal(url.searchParams.get("reconnect"), "1");
  assert.equal(url.searchParams.get("path"), null);
});

test("directory URL grows a vnc.html path and keeps the host", () => {
  const url = new URL(buildNovncEmbedUrl("http://127.0.0.1:6080/"));
  assert.equal(url.pathname, "/vnc.html");
  assert.equal(url.searchParams.get("resize"), "scale");
});

test("resize is forced to scale", () => {
  const url = new URL(buildNovncEmbedUrl("http://127.0.0.1:6080/vnc.html?resize=remote&autoconnect=0"));
  assert.equal(url.searchParams.get("resize"), "scale");
  assert.equal(url.searchParams.get("autoconnect"), "0");
});

test("subpath proxy sets the websocket path and stays relative", () => {
  const built = buildNovncEmbedUrl("/novnc/");
  assert.equal(built.startsWith("/novnc/vnc.html?"), true);
  const url = new URL(built, "http://wingman.local");
  assert.equal(url.pathname, "/novnc/vnc.html");
  assert.equal(url.searchParams.get("path"), "novnc/websockify");
  assert.equal(url.searchParams.get("resize"), "scale");
});

test("explicit websocket path is preserved", () => {
  const built = buildNovncEmbedUrl("/novnc/vnc.html?path=custom/ws");
  const url = new URL(built, "http://wingman.local");
  assert.equal(url.searchParams.get("path"), "custom/ws");
  assert.equal(url.searchParams.get("resize"), "scale");
});

test("rejects non-http schemes and protocol-relative URLs", () => {
  assert.throws(() => buildNovncEmbedUrl("javascript:alert(1)"), /http/);
  assert.throws(() => buildNovncEmbedUrl("//evil.example/vnc.html"), /http/);
});
