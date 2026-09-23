# SMSWingman

**For the chronic texter.** You know who you are. The triple-text. The "just checking in!!!" The essay at 1:47 AM that somehow made you look *needier* than the last one. SMSWingman is the wingman you wish you'd had before you typed yourself out of getting laid.

It sits between you and your texts: pulls threads in, drafts replies that don't scream anxious attachment, lets you tweak them, and sends. Built for dating-game SMS — including PUA-style flows out of the box — without turning you into a spam cannon.

> **Honest pitch:** this is a **hack**. Real carrier SMS APIs in the US are a compliance maze (10DLC, consent, carriers, money). Access is annoying on purpose. So this project scrapes a consumer web inbox we call **GV** instead. It works. If you're technical, you can run it for practically nothing. Messages are **not** true real-time (though you can bolt on notifications). Sync / send / receive take a beat, and when GV's website changes, things can break. Help fix it when they do.

**Personal, one-to-one use only.** Not for spam, mass outreach, or blasting strangers. Consent and local law still apply. For real business SMS, use a proper provider — this is the cheap workaround for humans who text humans.

---

# Part 1 — Why this exists (and who it's for)

## Who it's for

- **Chronic texters** who turn chemistry into a support-group chat
- People who want **better SMS game** without hiring a coach for every reply
- Technically inclined folks who want a **dating SMS cockpit** for nearly free
- Anyone who already has a **GV** number and an OpenAI-compatible LLM key

## What it does for your SMS dating game

| Feature | Why you care |
|--------|----------------|
| **Three reply drafts** | Pick the chill one, not the "hey did u get my last 4 msgs" one |
| **System-wide chatbot personality** | Teach it *you*: age, work, interests, vibe, hard rules |
| **PUA-ready defaults** | Tuned for dating SMS; change the system prompt if that's not your scene |
| **Per-target sculpting** | Tone, style, length, "push for date," custom instructions per person |
| **Per-target memory** | Remembers each conversation; auto-managed; **you can edit it** |
| **Response delay** | Optional wait before send so you don't look like you live in their inbox |
| **Pull / sync / send via GV** | No official SMS API required — browser automation does the clicking |
| **Local SQLite + web UI** | Your threads and drafts on your box, behind a simple login |
| **CLI helpers** | `npm run login`, `npm run check`, send/read via the same GV session |

### How a night usually goes

1. Someone texts you (on your phone / GV).
2. You open SMSWingman → **Pull messages** (or sync that person).
3. New inbound lands; the LLM returns **three** styled drafts.
4. Edit the one that sounds like a person you'd want to date → **Send**.
5. Optional delay so you're not instantaneous.
6. Long threads get **compacted** into an editable memory summary so the model stays sharp.

You stay in control. The bot suggests. You hit send.

### The catch (read this so you're not surprised)

- **Not real-time.** Syncing and sending scrape a web UI. Expect seconds to tens of seconds, not Instant Messenger magic. There *are* ways to get notified faster (watchers, hooks, your own alerts) — community welcome.
- **It can break.** GV's site changes. Selectors die. PRs that fix scrapes are love.
- **Hardest steps:** standing up a Linux VPS + logging into GV remotely (VNC). After that, it's a breeze.
- **It's still a hack.** Cheap and clever ≠ carrier-grade. Treat it like a power tool, not a bank.

### Technically savvy? Nearly free

A small VPS, Node, Chrome, an OpenAI-compatible API key, and an evening of setup. No SMS aggregator bill. No 10DLC saga. Just you, a VM, and slightly better texts.

If this thing helps you get laid: **show some love** (tip / donate / hire me — details below). I built it, I need work, and paid installs keep the lights on.

### Want it installed for you?

Don't want to fight Xvfb and VNC? Hire me.

**Nick Nguyen** · Internet Technology Services · Dana Point / Orange County, CA

- Website: [internettechnologyservices.com](https://internettechnologyservices.com)
- Email: [Its@Internettechnologyservices.com](mailto:Its@Internettechnologyservices.com)
- Office: (949) 446-1716
- LinkedIn: [linkedin.com/in/itsnicknguyen](https://www.linkedin.com/in/itsnicknguyen/)

Subject line: **SMSWingman setup** (or "I got a date, here's a tip"). Freelance web / AI / cloud work welcome too.

---

# Part 2 - Install on a Linux VPS (start to finish)

This path assumes a fresh-ish **Ubuntu/Debian VPS** (~ **2 GB RAM+** recommended; Chrome is hungry), SSH access as a normal user with `sudo`, and that you'll log into **GV** once through **VNC**.

Paths below use `/opt/SMSWingman`. Change them if you want.

## 0. What you need before you start

- A VPS with a public IP (or Tailscale)
- A **GV** number on a Google account you can sign into (2FA ok)
- **Node.js 18+**
- Google **Chrome** (or Chromium the scripts can launch)
- An **OpenAI-compatible** LLM API key (OpenAI, Groq, Together, local gateway, etc.)
- A VNC client on your laptop (TigerVNC, RealVNC Viewer, TightVNC, …), or just a browser once **Reconnect GV** is running

## 1. SSH in and update the box

```bash
ssh you@YOUR_VPS_IP
sudo apt update && sudo apt upgrade -y
```

## 2. Install system packages

```bash
sudo apt install -y git curl build-essential python3 \
  xvfb x11vnc novnc websockify \
  fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 \
  libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libasound2t64 || sudo apt install -y libasound2
```

Install **Google Chrome** (stable):

```bash
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
  | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
```

Install **Node.js 20 LTS**:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

## 3. Clone the repo

```bash
sudo mkdir -p /opt/SMSWingman
sudo chown "$USER":"$USER" /opt/SMSWingman
git clone https://github.com/moneyshotkid/SMSWingman.git /opt/SMSWingman
cd /opt/SMSWingman
```

## 4. Install app dependencies

```bash
npm install
```

(`postinstall` also installs the `client` UI packages.)

## 5. Create `.env`

```bash
cp .env.example .env
nano .env   # or vim / whatever
```

Minimum:

```env
AUTH_USER=admin
AUTH_PASSWORD=pick-a-strong-password
SESSION_SECRET=paste-a-long-random-string-here

# OpenAI-compatible LLM (seeds System Settings; also editable in the UI)
LLM_API_KEY=sk-your-openai-compatible-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

PORT=8787
DISPLAY=:99
GV_PROFILE=/home/YOUR_LINUX_USER/.google-voice-sms/chrome-profile
GV_DEBUG_PORT=9222

# Desktop embedded on Reconnect GV. See "Reconnect GV inside Wingman" below.
# GV_NOVNC_URL=http://127.0.0.1:6080/

# When you put HTTPS in front (Tailscale Serve, Caddy, Cloudflare Tunnel, …):
# COOKIE_SECURE=1
```

Notes:

- `AUTH_*` = login for the **SMSWingman website**, not Google.
- `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` seed System Settings for any OpenAI-compatible provider. You can also paste/change all of this later under **System Settings** in the UI.
- Never expose Chrome debug port **9222**, VNC **5900**, or noVNC **6080** to the public internet.

## 6. Start the virtual display + Chrome (GV session home)

```bash
cd /opt/SMSWingman
export DISPLAY=:99
chmod +x scripts/*.sh
./scripts/restart-gv-chrome.sh
# or: ./scripts/start-gv-chrome.sh
```

Attach VNC to that same display (**localhost only** on the VPS), then expose it to the browser with noVNC:

```bash
pgrep -x x11vnc >/dev/null || \
  x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared &

# Browser viewer used by Wingman's Reconnect GV page. Also localhost only.
pgrep -f "websockify .*6080" >/dev/null || \
  websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
```

`/usr/share/novnc` is the usual Debian/Ubuntu path. If `websockify` is missing, install the `novnc` and `websockify` packages from step 2.

You can sign in with a normal VNC client (steps 7–8) or, once Wingman itself is running, from **Reconnect GV** in the web UI (`/gv-login`). The in-app page is the one that works on a phone. See [Reconnect GV inside Wingman](#reconnect-gv-inside-wingman).

## 7. Tunnel VNC from your laptop

**Keep this SSH session open** on your computer:

```bash
ssh -L 5900:127.0.0.1:5900 you@YOUR_VPS_IP
```

Windows PowerShell (same idea):

```powershell
ssh -L 5900:127.0.0.1:5900 you@YOUR_VPS_IP
```

If you use a key file:

```bash
ssh -i /path/to/your-key -L 5900:127.0.0.1:5900 you@YOUR_VPS_IP
```

## 8. Open VNC and sign into GV

1. On your laptop, open TigerVNC / RealVNC / TightVNC.
2. Connect to **`127.0.0.1:5900`** (or `localhost:5900`).
3. You should see the Xvfb desktop and Chrome.
4. In that Chrome window, sign into the **Google account that owns your GV number** (complete 2FA).
5. Open the GV **Messages** UI and confirm you see your threads (not a marketing dead-end page).

Blank VNC? Restart Chrome on the VPS:

```bash
export DISPLAY=:99
cd /opt/SMSWingman
./scripts/restart-gv-chrome.sh
pgrep -a x11vnc || x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared &
```

## 9. Finish Wingman login (second SSH session)

Open **another** SSH session to the VPS:

```bash
ssh you@YOUR_VPS_IP
export DISPLAY=:99
cd /opt/SMSWingman
npm run login
```

Wait until it prints that you're logged in. Session lives under `GV_PROFILE`.

Sanity check:

```bash
export DISPLAY=:99
npm run check
```

## 10. Build and run the app

```bash
cd /opt/SMSWingman
npm run build
npm start
```

Open `http://YOUR_VPS_IP:8787` (or better: put **Caddy/nginx + HTTPS**, or **Tailscale**, in front and set `COOKIE_SECURE=1`).

Log in with `AUTH_USER` / `AUTH_PASSWORD`.

If the sidebar says **GV not signed in**, use the **Reconnect GV** banner — don't keep hitting Pull and wondering why nothing happens.

Dev mode (hot reload) if you're hacking on the box:

```bash
npm run dev
# UI often on :5173, API on :8787 — see terminal output
```

## 11. First-run product setup (inside the UI)

1. **System Settings** — paste your LLM key if needed; set base URL + model; write who you are (age, work, interests) and global guidelines.
2. Add a **target** (phone + name) — tone, style, length, push-for-date, custom instructions, delay.
3. **Pull messages** / sync that person.
4. Review the **three drafts**, edit, send.
5. Peek at **memory** after a few exchanges — edit it if the bot learned the wrong lore.

## 12. Optional CLI (same GV session)

```bash
export DISPLAY=:99
cd /opt/SMSWingman
npm run gv -- send --to +15551234567 --message "Hi" --yes
npm run gv -- read --from +15551234567 --json
```

## 13. Keep it alive (optional)

Use `systemd`, `pm2`, or your favorite process manager for `npm start`, Xvfb/Chrome, `x11vnc`, and `websockify`. After a reboot you'll usually need display + Chrome (+ noVNC if you're signing in again) before Wingman can talk to GV.

Example sketch with pm2:

```bash
sudo npm i -g pm2
cd /opt/SMSWingman
pm2 start npm --name smswingman -- start
pm2 save
```

(Still start Xvfb/Chrome via the scripts on boot — wire that however you prefer.)

---

## Reconnect GV inside Wingman

When the GV session expires you do not need a separate VNC app. Sign in inside Wingman:

1. Open the app and sign in with `AUTH_USER` / `AUTH_PASSWORD`.
2. Go to **Settings → Reconnect GV**, tap the **GV not signed in** banner, or open `/gv-login` directly.
3. The page embeds the noVNC desktop (`GV_NOVNC_URL`, default `http://127.0.0.1:6080/`). The server turns that into `vnc.html` with **`resize=scale`**.
4. Sign in on that desktop (2FA included). The page polls `GET /api/gv/status` and the banner clears once `loggedIn` is true.

**Hand tool.** `resize=scale` fits the whole remote screen in the iframe. noVNC's hand/pan tool is intentionally unused in that mode — panning is only for an unscaled desktop that is larger than the browser. Leave the noVNC scaling control on **Scale**. On a phone, pinch-zoom the browser if you need a closer look; don't switch scaling to None or you'll get the hand tool back.

**`GV_NOVNC_URL`.** `http://127.0.0.1:6080/` is the websockify port on the machine running Wingman. That is correct when the browser is on that same machine. From a phone, `127.0.0.1` is the phone, so the embed will be blank. Either:

- Set an absolute URL the phone can open, usually over Tailscale: `GV_NOVNC_URL=http://wingman.tailnet.ts.net:6080/` (still do not publish 6080 on the public internet), or
- Reverse-proxy noVNC onto the same origin as Wingman and use a relative path: `GV_NOVNC_URL=/novnc/`. The server then loads `/novnc/vnc.html` and sets the websocket `path` to `novnc/websockify` unless you already set `path`. Proxy WebSocket upgrades, not just HTTP. If Wingman is HTTPS, the embed has to be HTTPS or that relative path — browsers block an `http://` iframe on an `https://` page.

`GET /api/gv/status` (session login required) returns `{ loggedIn, phase, cdpReady, novncUrl, scaling: "scale", chromeRestart, checkedAt }`. `loggedIn` uses the same `isLoggedIn` check as `npm run check`. The poll does **not** navigate a tab that is already on a Google sign-in screen. A blank window is opened onto GV messages, and if Chrome's debug port is down the status check starts it.

**Restart button (optional, off by default).** Set `GV_CHROME_RESTART=1` to show **Restart GV Chrome**. It is behind the same Wingman login as the rest of the API and only runs `scripts/restart-gv-chrome.sh`, or `systemctl restart` on `GV_CHROME_SYSTEMD_UNIT` when that is set. The unit name is checked against a safe pattern; the browser cannot pass a command. `scripts/start-gv-chrome.sh` is the boot helper — it exits immediately when Chrome is already listening, so the button does not use it. There is no `sudo`. If you don't set the flag, the page tells you to run the restart script over SSH.

---

## Security (non-negotiable)

- **Do not** publish ports **9222** (Chrome CDP), **5900** (VNC), or **6080** (noVNC) on the open internet. Localhost + SSH tunnel (or Tailscale) only. Wingman's login does not protect the noVNC port itself.
- Put a real password on `AUTH_PASSWORD`. Prefer HTTPS before you leave the LAN.
- This scrapes a consumer messaging UI. Treat account risk seriously.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `npm` not found | Reinstall Node 18+ and open a new shell |
| GV login / "browser not secure" | Finish sign-in **by hand** in Reconnect GV or a VNC client, including 2FA |
| Reconnect GV iframe is blank on a phone | `GV_NOVNC_URL` is still `127.0.0.1` — use a Tailscale URL or `/novnc/` (see above). Confirm `websockify` is listening on 6080 |
| Marketing page instead of Messages | Wrong Google account / not fully in GV — fix in VNC, then `npm run login` again |
| `check` fails | `export DISPLAY=:99` then `npm run login` / `npm run check` |
| `page.goto` timeout | Restart `./scripts/restart-gv-chrome.sh`; confirm CDP on 9222 |
| AI drafts fail | Key + `LLM_BASE_URL` + `LLM_MODEL` in `.env` or System Settings; check provider quota |
| Can't open the site | `:8787` after `npm start`; `:5173` often for `npm run dev` |
| Port in use | Change `PORT` in `.env` |
| Sync/send feels slow or flakes | Expected — it's a scrape. Retry; file an issue / PR when GV markup changes |

---

## Project layout

```
SMSWingman/
├── README.md
├── package.json
├── .env.example
├── send-gv-sms.mjs       # GV CLI helpers
├── scripts/              # Xvfb + Chrome helpers (VPS)
├── server/               # Express API + SQLite
├── client/               # React (Vite) UI
└── data/                 # local DB (runtime)
```

---

## Contributing

Issues and PRs welcome — especially when GV's website moves the cheese. Keep the project aimed at **personal, consenting, one-to-one** messaging. If the scrape breaks and you fix it, you're the real wingman.

---

## Disclaimers

- Unofficial. Not affiliated with Google or any LLM vendor.
- You are responsible for GV's terms, your LLM provider's terms, and messaging / consent laws where you live.
- Not for spam or abusive automation.
- Provided as-is. Authors aren't liable for account limits, lost messages, awkward dates, or other damages.
- Yes, it's a hack. A working one. Act accordingly.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

Got a date out of it? Tip, donate, or hire me for the next hack. I need the work more than I need another triple-text.
