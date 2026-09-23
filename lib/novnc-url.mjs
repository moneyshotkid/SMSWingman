/**
 * Build the noVNC viewer URL embedded by Reconnect GV.
 *
 * `resize=scale` is always set. In that mode the remote desktop is fitted to
 * the iframe, so noVNC's hand/pan tool is intentionally unused — panning only
 * applies when scaling is off and the framebuffer is larger than the view.
 */

export const DEFAULT_NOVNC_BASE = "http://127.0.0.1:6080/";

export function buildNovncEmbedUrl(raw) {
  const input = String(raw ?? "").trim() || DEFAULT_NOVNC_BASE;
  if (input.startsWith("//") || input.includes("\\")) {
    throw new Error("GV_NOVNC_URL must be an http(s) URL or a path starting with /");
  }

  const relative = input.startsWith("/");
  let url;
  try {
    url = relative ? new URL(input, "http://novnc.local") : new URL(input);
  } catch {
    throw new Error(`GV_NOVNC_URL is not a valid URL: ${input}`);
  }

  if (!relative && url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GV_NOVNC_URL must be an http(s) URL or a path starting with /");
  }
  if (relative && url.hostname !== "novnc.local") {
    throw new Error("GV_NOVNC_URL path must stay on this host");
  }

  let pathname = url.pathname || "/";
  if (!pathname.includes("vnc.html")) {
    if (!pathname.endsWith("/")) pathname += "/";
    pathname += "vnc.html";
  }
  url.pathname = pathname;

  if (!url.searchParams.has("autoconnect")) url.searchParams.set("autoconnect", "1");
  if (!url.searchParams.has("reconnect")) url.searchParams.set("reconnect", "1");
  // Always scale. Do not honor resize=off / remote — that brings back the hand tool.
  url.searchParams.set("resize", "scale");

  if (!url.searchParams.has("path")) {
    const dir = pathname.replace(/[^/]*$/, "");
    const prefix = dir.replace(/^\/+|\/+$/g, "");
    if (prefix) url.searchParams.set("path", `${prefix}/websockify`);
  }

  if (relative) return `${url.pathname}${url.search}${url.hash}`;
  return url.toString();
}
