/**
 * Google Voice send/read via Playwright + system Chrome CDP.
 * Shared by the CLI and the SMSWingman server.
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const VOICE_MESSAGES_URL = "https://voice.google.com/u/0/messages";
export const DEFAULT_PROFILE = join(homedir(), ".google-voice-sms", "chrome-profile");
export const DEFAULT_DEBUG_PORT = 9222;

const SEL = {
  loggedIn: '[gv-test-id="sidenav-messages"], a[aria-label*="Messages"]',
  newMessage: '[aria-label="Send new message"], button[aria-label="Send new message"]',
  recipient:
    'input[placeholder="Type a name or phone number"], input[aria-label*="name or phone"]',
  sendToLabel: ".send-to-label, [role='option']",
  compose:
    "textarea.message-input, textarea[placeholder='Type a message'], textarea[aria-label*='message']",
  send: 'button[aria-label="Send message"], button[aria-label="Send"]',
  threadItem: "gv-thread-list-item",
  threadContact: "gv-annotation.participants",
  threadClickable: ".container, gv-thread-list-item",
  messageBubble: "gv-message-item",
  messageText: ".subject-content-container.bubble, .bubble",
  messageTimestamp: ".sender-timestamp .timestamp, .timestamp, time",
  messageOutgoing: ".message-row.outgoing, .outgoing",
};

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates =
    process.platform === "win32"
      ? [
          join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];

  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  throw new Error("Google Chrome not found. Install Chrome, or set CHROME_PATH.");
}

export function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  throw new Error(`Could not parse phone number: ${JSON.stringify(raw)} (use +1XXXXXXXXXX)`);
}

export function phoneDigits(raw) {
  return normalizePhone(raw).replace(/\D/g, "");
}

function phoneMatches(label, targetDigits) {
  const labelDigits = String(label || "").replace(/\D/g, "");
  if (!labelDigits) return false;
  return labelDigits.slice(-10) === targetDigits.slice(-10);
}

export async function chromeDebugReady(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function cleanStaleLocks(profile) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const lock = join(profile, name);
    try {
      if (existsSync(lock) || (existsSync(lock) && lstatSync(lock).isSymbolicLink())) {
        unlinkSync(lock);
      }
    } catch {
      /* ignore */
    }
  }
}

export async function launchChrome(profile, port, url) {
  const chrome = findChrome();
  mkdirSync(profile, { recursive: true });
  cleanStaleLocks(profile);

  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-background-networking",
    "--disable-features=Translate,BackForwardCache",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,900",
  ];

  // Linux VPS / containers usually need these or Chrome exits before CDP binds
  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
    if (!process.env.DISPLAY) {
      throw new Error(
        "DISPLAY is not set. On a VPS run Xvfb first, e.g. `Xvfb :99 -screen 0 1280x720x24 &` then `export DISPLAY=:99`",
      );
    }
  }

  if (process.env.GV_CHROME_ARGS) {
    args.push(...process.env.GV_CHROME_ARGS.split(/\s+/).filter(Boolean));
  }

  if (url) args.push(url);

  const logDir = join(profile, "wingman-logs");
  mkdirSync(logDir, { recursive: true });
  const errLog = join(logDir, "chrome-stderr.log");
  const errFd = openSync(errLog, "w");

  const child = spawn(chrome, args, {
    detached: true,
    stdio: ["ignore", "ignore", errFd],
    windowsHide: false,
    env: {
      ...process.env,
      // Prefer software rendering on headless servers
      ...(process.platform === "linux" ? { DISPLAY: process.env.DISPLAY } : {}),
    },
  });
  try {
    closeSync(errFd);
  } catch {
    /* ignore */
  }
  child.unref();

  const deadline = Date.now() + Number(process.env.GV_CDP_WAIT_MS || 20000);
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      let detail = "";
      try {
        detail = readFileSync(errLog, "utf8").trim().slice(0, 800);
      } catch {
        /* ignore */
      }
      throw new Error(
        `Chrome exited before remote debugging was ready (code ${child.exitCode}).` +
          (detail ? `\nChrome stderr:\n${detail}` : `\nSee ${errLog}`),
      );
    }
    if (await chromeDebugReady(port)) return child;
    await sleep(250);
  }

  let detail = "";
  try {
    detail = readFileSync(errLog, "utf8").trim().slice(0, 800);
  } catch {
    /* ignore */
  }
  throw new Error(
    "Chrome started but remote debugging port never became ready." +
      (detail ? `\nChrome stderr:\n${detail}` : `\nCheck ${errLog}`) +
      "\nTips: close other Chrome windows using this profile; on VPS ensure Xvfb + DISPLAY=:99; try GV_DEBUG_PORT=9223.",
  );
}

const NAV_TIMEOUT_MS = Number(process.env.GV_NAV_TIMEOUT_MS || 60000);

/**
 * Voice pages often never reach network "load" on VPS/Xvfb (long-polling assets).
 * Prefer DOM ready, then a short settle.
 */
export async function gotoVoice(page, url, { timeout = NAV_TIMEOUT_MS } = {}) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  } catch (err) {
    const current = page.url();
    if (
      /voice\.google\.com|accounts\.google\.com|myaccount\.google\.com/i.test(current)
    ) {
      return current;
    }
    throw new Error(
      `${err.message}\nCurrent URL: ${current || "(blank)"}\n` +
        "On VPS: export DISPLAY=:99 and ensure Xvfb is running. " +
        "If Chrome opened a marketing page, you are not signed into GV yet.",
    );
  }
  await sleep(800);
  return page.url();
}

export async function ensureBrowser(profile, port) {
  if (!(await chromeDebugReady(port))) {
    await launchChrome(profile, port, VOICE_MESSAGES_URL);
    await sleep(1500);
  }
}

export async function connectPage(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error("Connected to Chrome but found no browser context.");
  }
  const ctx = contexts[0];
  let page = ctx.pages().find((p) => p.url().includes("voice.google.com"));
  if (!page) {
    // Prefer a real page; avoid chrome:// UI targets
    page =
      ctx.pages().find((p) => /^https?:/i.test(p.url())) ||
      ctx.pages()[0] ||
      (await ctx.newPage());
  }
  if (!page.url().includes("voice.google.com")) {
    // Marketing / workspace pages block a clean Voice session — use a fresh tab
    if (/workspace\.google\.com|chrome:\/\//i.test(page.url())) {
      page = await ctx.newPage();
    }
    await gotoVoice(page, VOICE_MESSAGES_URL);
  }
  return { browser, page };
}

export async function isLoggedIn(page, { timeout = 8000 } = {}) {
  const url = page.url();
  if (url.includes("accounts.google.com") || url.includes("signin")) return false;
  if (url.includes("workspace.google.com")) return false;
  try {
    if (await page.$(SEL.loggedIn)) return true;
    await page.waitForSelector(SEL.loggedIn, { timeout });
    return true;
  } catch {
    return false;
  }
}

function classifyGvUrl(url) {
  const u = String(url || "");
  if (!u || u === "about:blank" || /^chrome:\/\/(newtab|new-tab-page)/i.test(u)) return "blank";
  if (u.includes("accounts.google.com") || u.includes("signin") || u.includes("accountchooser")) {
    return "sign-in";
  }
  if (u.includes("workspace.google.com")) return "workspace";
  if (u.includes("voice.google.com")) return "gv";
  return "other";
}

/**
 * Same signed-in check as `check` / `checkLogin` (`isLoggedIn`), but it does not
 * navigate a tab that is already on a sign-in screen. A blank GV window is
 * opened onto the messages UI — that is the only automatic navigation.
 */
export async function probeGvSession(overrides = {}) {
  const { profile, port } = getGvConfig(overrides);
  let startedChrome = false;
  if (!(await chromeDebugReady(port))) {
    try {
      await ensureBrowser(profile, port);
      startedChrome = true;
    } catch (err) {
      return {
        loggedIn: false,
        cdpReady: false,
        phase: "cdp-down",
        startedChrome: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const ctx = browser.contexts()[0];
    if (!ctx) {
      return { loggedIn: false, cdpReady: true, phase: "blank", startedChrome };
    }
    const pages = ctx.pages();
    const voice = pages.find((p) => p.url().includes("voice.google.com"));
    const signInOpen = pages.some((p) => classifyGvUrl(p.url()) === "sign-in");
    if (voice) {
      const loggedIn = await isLoggedIn(voice, { timeout: signInOpen ? 800 : 2500 });
      if (loggedIn) {
        return { loggedIn: true, cdpReady: true, phase: "signed-in", startedChrome };
      }
      if (signInOpen) {
        return { loggedIn: false, cdpReady: true, phase: "sign-in", startedChrome };
      }
      return { loggedIn: false, cdpReady: true, phase: "gv", startedChrome };
    }
    if (signInOpen) {
      return { loggedIn: false, cdpReady: true, phase: "sign-in", startedChrome };
    }
    if (pages.some((p) => classifyGvUrl(p.url()) === "workspace")) {
      return { loggedIn: false, cdpReady: true, phase: "workspace", startedChrome };
    }

    const onlyBlank = pages.length === 0 || pages.every((p) => classifyGvUrl(p.url()) === "blank");
    if (onlyBlank) {
      const page = pages.find((p) => classifyGvUrl(p.url()) === "blank") || (await ctx.newPage());
      try {
        await gotoVoice(page, VOICE_MESSAGES_URL);
      } catch (err) {
        return {
          loggedIn: false,
          cdpReady: true,
          phase: "blank",
          startedChrome,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const loggedIn = await isLoggedIn(page, { timeout: 2500 });
      return {
        loggedIn,
        cdpReady: true,
        phase: loggedIn ? "signed-in" : classifyGvUrl(page.url()),
        startedChrome,
      };
    }

    return { loggedIn: false, cdpReady: true, phase: "other", startedChrome };
  } catch (err) {
    const cdpReady = await chromeDebugReady(port);
    return {
      loggedIn: false,
      cdpReady,
      phase: cdpReady ? "other" : "cdp-down",
      startedChrome,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* disconnect only — leave the headed Chrome process running */
      }
    }
  }
}

async function ensureMessages(page) {
  const url = page.url();
  if (!url.startsWith(VOICE_MESSAGES_URL) || url.includes("itemId=")) {
    await gotoVoice(page, VOICE_MESSAGES_URL);
    await sleep(1000);
  }
}

export async function openConversationByNumber(page, to) {
  if (!(await isLoggedIn(page))) {
    await ensureMessages(page);
    if (!(await isLoggedIn(page))) {
      throw new Error(
        "Not signed in to GV. Open Reconnect GV in Wingman, or run npm run login on the server.",
      );
    }
  }

  const toNorm = normalizePhone(to);
  const target = phoneDigits(toNorm);

  const itemUrl = `${VOICE_MESSAGES_URL}?itemId=t.${toNorm}`;
  await gotoVoice(page, itemUrl);
  await sleep(1500);
  if ((await page.$(SEL.messageBubble)) || (await page.$(SEL.compose))) return;

  await ensureMessages(page);
  const items = await page.$$(SEL.threadItem);
  for (const item of items) {
    const contactEl = await item.$(SEL.threadContact);
    const label = contactEl ? (await contactEl.innerText()) || "" : "";
    if (
      phoneMatches(label, target) ||
      (label && target.slice(-10) && label.replace(/\D/g, "").includes(target.slice(-10)))
    ) {
      const clickable = (await item.$(SEL.threadClickable)) || item;
      await clickable.click();
      await sleep(1200);
      return;
    }
  }

  await page.click(SEL.newMessage, { timeout: 10000 });
  await sleep(800);
  let recip = await page.$(SEL.recipient);
  if (!recip) recip = await page.$("input[type='tel'], input[type='text']");
  if (!recip) {
    throw new Error("Could not find recipient input to open the thread.");
  }
  await recip.fill(toNorm);
  await sleep(1500);
  try {
    await page.waitForSelector(SEL.sendToLabel, { timeout: 5000 });
    await page.click(SEL.sendToLabel);
  } catch {
    await page.keyboard.press("Enter");
  }
  await sleep(1200);
  await page.keyboard.press("Escape");
  await sleep(400);
}

export async function extractMessages(page, limit = 30) {
  try {
    await page.waitForSelector(SEL.messageBubble, { timeout: 10000 });
  } catch {
    return [];
  }

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const list =
        document.querySelector("gv-message-list, .message-list, [role='log']") ||
        document.querySelector("gv-message-item")?.parentElement;
      if (list) list.scrollTop = 0;
    });
    await sleep(400);
  }

  const rows = await page.$$eval(
    SEL.messageBubble,
    (els, sel) =>
      els.map((el) => {
        const textEl = el.querySelector(sel.text);
        const tsEl = el.querySelector(sel.ts);
        const outgoing = !!el.querySelector(sel.outgoing);
        const aria = (el.getAttribute("aria-label") || "").trim();
        let text = (textEl && textEl.textContent ? textEl.textContent : "").trim();
        if (!text && aria) text = aria.replace(/^You:\s*/i, "").trim();
        return {
          direction: outgoing || /^You:/i.test(aria) ? "outbound" : "inbound",
          text,
          timestamp: (tsEl && tsEl.textContent ? tsEl.textContent : "").trim(),
        };
      }),
    { text: SEL.messageText, ts: SEL.messageTimestamp, outgoing: SEL.messageOutgoing },
  );

  let cleaned = rows.filter((r) => r.text);
  if (limit > 0) cleaned = cleaned.slice(-limit);
  return cleaned;
}

export async function sendSms(page, to, message) {
  await openConversationByNumber(page, to);
  const compose = page.locator(SEL.compose).first();
  await compose.click();
  await sleep(200);
  await compose.pressSequentially(message);
  await sleep(400);
  await page.locator(SEL.send).first().click({ force: true });
  await sleep(2000);
  const match = page.url().match(/itemId=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * High-level helpers that own browser lifecycle.
 */
export function getGvConfig(overrides = {}) {
  return {
    profile: overrides.profile || process.env.GV_PROFILE || DEFAULT_PROFILE,
    port: Number(overrides.port || process.env.GV_DEBUG_PORT || DEFAULT_DEBUG_PORT),
  };
}

export async function withGvPage(fn, overrides = {}) {
  const { profile, port } = getGvConfig(overrides);
  await ensureBrowser(profile, port);
  const { browser, page } = await connectPage(port);
  try {
    return await fn(page, { profile, port, browser });
  } finally {
    await browser.close();
  }
}

export async function checkLogin(overrides = {}) {
  return withGvPage(async (page) => isLoggedIn(page), overrides);
}

export async function readThread(fromNumber, { limit = 50, ...overrides } = {}) {
  const from = normalizePhone(fromNumber);
  return withGvPage(async (page) => {
    await openConversationByNumber(page, from);
    const messages = await extractMessages(page, limit);
    return { from, count: messages.length, messages };
  }, overrides);
}

export async function sendMessage(to, message, overrides = {}) {
  const toNorm = normalizePhone(to);
  return withGvPage(async (page) => {
    const conversationId = await sendSms(page, toNorm, message);
    return { to: toNorm, conversationId };
  }, overrides);
}
