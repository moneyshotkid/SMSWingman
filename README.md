# SMSWingman

A personal SMS “wingman” for [Google Voice](https://voice.google.com).

Pull in your text threads, get **three reply drafts** from an AI (Moonshot / Kimi), edit the one you like, and send it back through Google Voice—without typing everything yourself.

Google Voice has **no public SMS API**. SMSWingman opens Google Chrome and uses the normal Voice website for you.

> **Personal, one-to-one use only.** Do not use this for spam, mass marketing, or blasting many numbers. That can get your Google Voice number limited or banned. For business SMS, use a real provider such as [Twilio](https://www.twilio.com/).

---

## What you need (requirements)

You can run this on a normal Windows, Mac, or Linux computer.

| Requirement | Notes |
|-------------|--------|
| **Google Voice number** | Already set up in your Google account |
| **Google Chrome** | [Download Chrome](https://www.google.com/chrome/) |
| **Node.js 18 or newer** | [Download Node LTS](https://nodejs.org/) (includes `npm`) |
| **Moonshot API key** | From [Moonshot / Kimi](https://platform.moonshot.ai/) — used to generate reply drafts |
| **Internet** | Needed for Voice and the AI API |

Optional later: a small cloud VPS (about **2 GB RAM** or more if Chrome stays open). First-time Google login on a server is harder than on your home PC.

You do **not** need WAMP/Apache for the app itself—Node runs it. This folder often lives under `C:\wamp\www\` only because that is a convenient place on Windows.

---

## Quick setup (average computer)

### 1. Get the code

Download or clone this project, then open a terminal **in the project folder**.

Example on Windows:

```bat
cd C:\wamp\www\SMSWingman
```

### 2. Install packages

```bash
npm install
```

This also installs the web UI (`client`) automatically.

### 3. Create your settings file

```bat
copy .env.example .env
```

Mac / Linux:

```bash
cp .env.example .env
```

Open `.env` in Notepad (or any editor) and set at least:

```env
AUTH_USER=admin
AUTH_PASSWORD=pick-a-strong-password
SESSION_SECRET=paste-a-long-random-string-here

MOONSHOT_API_KEY=sk-your-key-here

PORT=8787
```

Tips:

- `AUTH_USER` / `AUTH_PASSWORD` — login for the SMSWingman website (not Google).
- `SESSION_SECRET` — any long random string (password manager “generate password” works).
- You can also paste the Moonshot key later under **Settings** in the app.
- If you put the app behind HTTPS (Cloudflare Tunnel, etc.), add `COOKIE_SECURE=1`.

### 4. Sign into Google Voice once

```bash
npm run login
```

Chrome opens. Sign into the **Google account that owns your Voice number** (complete 2FA if asked). When you see Messages, you are done.

Check that it worked:

```bash
npm run check
```

### 5. Start the app

**While developing** (API + web UI with hot reload):

```bash
npm run dev
```

Then open: [http://localhost:5173](http://localhost:5173)

**Everyday / “production” style** (build the UI, one server):

```bash
npm run build
npm start
```

Then open: [http://localhost:8787](http://localhost:8787)

Log in with the `AUTH_USER` / `AUTH_PASSWORD` from your `.env`.

---

## Daily flow

1. Your phone (or Voice) gets a new text.
2. Open SMSWingman → **Pull messages** (or sync that person).
3. New inbound texts are saved; the AI returns **three styled drafts**.
4. Edit the draft you like → **Send this**. It goes out through Google Voice.
5. Optional: set a **response delay** per person before send.
6. Long chats can be compacted into a short **memory summary** so the AI stays focused without losing important history.

---

## Features

| Area | What you get |
|------|----------------|
| System settings | Your context, guidelines, Moonshot key / model / URL, compaction settings |
| Targets | Phone, name, tone / style / length, “push for date,” custom instructions, delay, memory |
| Conversation | Stored thread per person + three pending drafts |
| Compaction | When a thread gets long, older messages fold into an editable summary |

---

## Optional: command-line Google Voice

Same Chrome login as the app:

```bash
npm run gv -- send --to +15551234567 --message "Hi" --yes
npm run gv -- read --from +15551234567 --json
npm run login
npm run check
```

---

## Cloud / VPS notes

Prefer a machine with **≥ 2 GB RAM** if Chrome stays open. Keep Chrome’s debug port (**9222**) on **localhost only**—never expose it to the public internet.

On a headless VPS, Chrome runs under **Xvfb** (virtual display). You cannot see that window on your laptop unless you connect with **VNC** through an SSH tunnel.

### VPS Google Voice login via VNC

#### 1. On the VPS — Chrome + VNC helpers

```bash
export DISPLAY=:99
cd ~/htdocs/wingman   # or your install path

# Virtual display + Chrome remote debugging
./scripts/restart-gv-chrome.sh
# or: ./scripts/start-gv-chrome.sh

# VNC attached to that display (localhost only)
pgrep -x x11vnc >/dev/null || \
  x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared &
```

#### 2. On your PC — SSH tunnel

Leave this terminal open:

```bash
ssh -i /path/to/your-key.pem -L 5900:127.0.0.1:5900 bitnami@YOUR_VPS_IP
```

Windows PowerShell example (Tailscale or public IP):

```powershell
ssh -i $env:USERPROFILE\.ssh\your-key.pem -L 5900:127.0.0.1:5900 bitnami@100.x.x.x
```

#### 3. Connect a VNC client

Install TigerVNC, RealVNC Viewer, or TightVNC, then connect to:

**`127.0.0.1:5900`** (or `localhost:5900`)

No password if you started x11vnc with `-nopw`.

You should see the Xvfb desktop and Chrome.

#### 4. Sign into Google Voice in that Chrome window

1. Sign into the Google account that owns your Voice number (complete 2FA if asked).
2. Open [https://voice.google.com/u/0/messages](https://voice.google.com/u/0/messages).
3. Confirm you see **Messages** (not the Workspace marketing page).

#### 5. Finish Wingman login (second SSH session)

```bash
export DISPLAY=:99
cd ~/htdocs/wingman
npm run login
```

Wait until it prints **Logged in**. Session is stored under `GV_PROFILE` (default `~/.google-voice-sms/chrome-profile`).

If VNC is blank, restart Chrome on the VPS:

```bash
DISPLAY=:99 ./scripts/restart-gv-chrome.sh
pgrep -a x11vnc || x11vnc -display :99 -rfbport 5900 -localhost -nopw -forever -shared &
```

### Useful `.env` on Linux VPS

```env
DISPLAY=:99
GV_PROFILE=/home/bitnami/.google-voice-sms/chrome-profile
GV_DEBUG_PORT=9222
COOKIE_SECURE=1
```

Put HTTPS and app login (`AUTH_*`) in front before exposing the site outside your home network / Tailscale.

---

## Project layout

```
SMSWingman/
├── README.md
├── package.json
├── .env.example          ← copy to .env
├── send-gv-sms.mjs       ← Google Voice CLI helpers
├── lib/google-voice.mjs  ← Chrome / Voice automation
├── scripts/
│   ├── start-gv-chrome.sh
│   └── restart-gv-chrome.sh
├── server/               ← Express API + SQLite
├── client/               ← React (Vite) UI
└── data/                 ← local database (created at runtime)
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `npm` not found | Reinstall Node.js LTS and open a **new** terminal |
| Login / “browser not secure” | Finish Google sign-in by hand in the Chrome window, including 2FA |
| Lands on Workspace marketing page | Not signed into personal Voice — use VNC (above) and sign in, then open Messages |
| `check` fails | Run `npm run login` again (on VPS: `export DISPLAY=:99` first) |
| `page.goto` timeout on VPS | Ensure Xvfb + Chrome CDP; run `./scripts/restart-gv-chrome.sh` |
| AI drafts fail | Confirm `MOONSHOT_API_KEY` in `.env` or Settings; check Moonshot account billing/quota |
| Can’t open the site | Use the URL for how you started (`:5173` for `dev`, `:8787` for `start`) |
| Port in use | Change `PORT` in `.env` |

**Never expose Chrome’s debug port (9222) or VNC (5900) to the public internet**—keep them on localhost and use SSH tunnels or Tailscale.

---

## Important disclaimers

- Unofficial project; **not** affiliated with Google or Moonshot.
- You are responsible for following [Google Voice terms](https://support.google.com/voice/), Moonshot’s terms, and messaging / consent laws where you live.
- Not for spam or abusive automation.
- Software is provided as-is; authors are not liable for account limits, lost messages, or other damages.

---

## Want someone to install it for you?

SMSWingman is free and open source. If you would rather pay to have it installed, configured, or customized (Windows, Mac, Linux, or a cloud VPS), reach out:

**Nick Nguyen**  
Internet Technology Services · Dana Point / Orange County, CA  

- Website: [internettechnologyservices.com](https://internettechnologyservices.com)  
- Email: [Its@Internettechnologyservices.com](mailto:Its@Internettechnologyservices.com)  
- Email: [its@NickNguyen.com](mailto:its@NickNguyen.com)  
- Office: (949) 446-1716  
- Mobile: (949) 386-0344  
- LinkedIn: [linkedin.com/in/itsnicknguyen](https://www.linkedin.com/in/itsnicknguyen/)

Please mention **“SMSWingman setup”** in the subject line.

---

## Contributing

Issues and pull requests are welcome—especially fixes when Google changes the Voice website. Please keep the project oriented around **personal, consenting, one-to-one** messaging.

---

## License

MIT — see [`LICENSE`](LICENSE) if present in this repository.
