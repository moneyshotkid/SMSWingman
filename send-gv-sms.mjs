#!/usr/bin/env node
/**
 * Send / read SMS via the Google Voice website (no official API).
 *
 * Usage:
 *   node send-gv-sms.mjs login
 *   node send-gv-sms.mjs check
 *   node send-gv-sms.mjs send --to +19495551212 --message "Hello"
 *   node send-gv-sms.mjs read --from +19495551212 --limit 20 --json
 */

import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import {
  DEFAULT_PROFILE,
  DEFAULT_DEBUG_PORT,
  VOICE_MESSAGES_URL,
  chromeDebugReady,
  launchChrome,
  ensureBrowser,
  connectPage,
  isLoggedIn,
  normalizePhone,
  sendSms,
  openConversationByNumber,
  extractMessages,
  gotoVoice,
} from "./lib/google-voice.mjs";

function askConfirm(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase());
    });
  });
}

async function cmdLogin(profile, port) {
  console.log("Opening Google Voice in Chrome…");
  console.log("Sign in to the Google account that owns your Voice number.");
  console.log("When you see Messages, you can close this window (Chrome may keep running).");
  console.log();
  if (!(await chromeDebugReady(port))) {
    await launchChrome(profile, port, VOICE_MESSAGES_URL);
  } else {
    console.log(`Chrome already listening on port ${port}; connecting…`);
  }

  const { browser, page } = await connectPage(port);
  try {
    if (!page.url().includes("voice.google.com")) {
      await gotoVoice(page, VOICE_MESSAGES_URL);
    }
    // Personal Voice often redirects to Workspace marketing when logged out
    if (page.url().includes("workspace.google.com")) {
      console.log();
      console.log("Chrome landed on the Google Workspace marketing page (not signed in).");
      console.log("Opening Google sign-in…");
      await gotoVoice(page, "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fvoice.google.com%2Fu%2F0%2Fmessages");
    }
    console.log("Waiting for login (up to 5 minutes)…");
    console.log(`Open this URL if needed: ${VOICE_MESSAGES_URL}`);
    console.log(`Current tab: ${page.url()}`);
    console.log();
    console.log("On a headless VPS you must view the Xvfb screen (VNC) to enter Google credentials.");
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (await isLoggedIn(page)) {
        console.log("Logged in. Session saved in:");
        console.log(`  ${profile}`);
        console.log();
        console.log('Next: node send-gv-sms.mjs send --to +1XXXXXXXXXX --message "Hi"');
        console.log("  or: node send-gv-sms.mjs read --from +1XXXXXXXXXX");
        return;
      }
      // If still stuck on marketing, keep nudging toward Voice after possible login
      const u = page.url();
      if (u.includes("workspace.google.com") && Date.now() % 20000 < 2500) {
        try {
          await gotoVoice(page, VOICE_MESSAGES_URL);
        } catch {
          /* ignore transient */
        }
      }
      await sleep(2000);
    }
    console.error("Timed out waiting for login. Run login again after signing in.");
    console.error(`Last URL: ${page.url()}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

async function cmdCheck(profile, port) {
  await ensureBrowser(profile, port);
  const { browser, page } = await connectPage(port);
  try {
    const ok = await isLoggedIn(page);
    console.log(ok ? "logged_in" : "NOT logged in — run: node send-gv-sms.mjs login");
    if (!ok) process.exit(1);
  } finally {
    await browser.close();
  }
}

async function cmdSend(profile, port, to, message, yes) {
  to = normalizePhone(to);
  console.log(`To:      ${to}`);
  console.log(`Message: ${message}`);
  console.log();
  if (!yes) {
    const answer = await askConfirm("Send this text via Google Voice? [y/N] ");
    if (answer !== "y" && answer !== "yes") {
      console.log("Cancelled.");
      return;
    }
  }

  await ensureBrowser(profile, port);
  const { browser, page } = await connectPage(port);
  try {
    const convo = await sendSms(page, to, message);
    console.log("Sent.");
    if (convo) console.log(`Conversation id: ${convo}`);
  } finally {
    await browser.close();
  }
}

async function cmdRead(profile, port, fromNumber, limit, asJson) {
  fromNumber = normalizePhone(fromNumber);
  await ensureBrowser(profile, port);
  const { browser, page } = await connectPage(port);
  try {
    await openConversationByNumber(page, fromNumber);
    const messages = await extractMessages(page, limit);

    if (asJson) {
      console.log(JSON.stringify({ from: fromNumber, count: messages.length, messages }, null, 2));
      return;
    }
    if (!messages.length) {
      console.log(`No messages found for ${fromNumber}.`);
      console.log("(If this is a brand-new number with no history, that is expected.)");
      return;
    }
    console.log(`Thread with ${fromNumber} (${messages.length} message(s)):\n`);
    for (const m of messages) {
      const arrow = m.direction === "inbound" ? "←" : "→";
      const ts = m.timestamp ? `  [${m.timestamp}]` : "";
      console.log(`${arrow}${ts} ${m.text}`);
    }
  } finally {
    await browser.close();
  }
}

function printHelp() {
  console.log(`Usage:
  node send-gv-sms.mjs login
  node send-gv-sms.mjs check
  node send-gv-sms.mjs send --to +1XXXXXXXXXX --message "Hi" [--yes]
  node send-gv-sms.mjs read --from +1XXXXXXXXXX [--limit 30] [--json]

Options:
  --profile DIR   Chrome profile (default: ${DEFAULT_PROFILE})
  --port N        Remote debugging port (default: ${DEFAULT_DEBUG_PORT})
`);
}

function parseArgs(argv) {
  const out = {
    command: null,
    profile: process.env.GV_PROFILE || DEFAULT_PROFILE,
    port: Number(process.env.GV_DEBUG_PORT || DEFAULT_DEBUG_PORT),
    to: null,
    from: null,
    message: null,
    yes: false,
    limit: 30,
    json: false,
  };
  const args = [...argv];
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  out.command = args.shift();
  while (args.length) {
    const a = args.shift();
    if (a === "--profile") out.profile = args.shift();
    else if (a === "--port") out.port = Number(args.shift());
    else if (a === "--to") out.to = args.shift();
    else if (a === "--from") out.from = args.shift();
    else if (a === "--message" || a === "-m") out.message = args.shift();
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--limit") out.limit = Number(args.shift());
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { command, profile, port } = args;

  if (command === "login") await cmdLogin(profile, port);
  else if (command === "check") await cmdCheck(profile, port);
  else if (command === "send") {
    if (!args.to || !args.message) {
      console.error("send requires --to and --message");
      process.exit(1);
    }
    await cmdSend(profile, port, args.to, args.message, args.yes);
  } else if (command === "read") {
    if (!args.from) {
      console.error("read requires --from");
      process.exit(1);
    }
    await cmdRead(profile, port, args.from, args.limit, args.json);
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
