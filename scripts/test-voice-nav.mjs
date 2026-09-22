import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
console.log("new tab ok");
try {
  const resp = await page.goto("https://voice.google.com/u/0/messages", {
    waitUntil: "commit",
    timeout: 20000,
  });
  console.log("status", resp?.status(), "url", page.url());
} catch (e) {
  console.log("err", String(e.message).split("\n")[0], "url", page.url());
}
await browser.close();
