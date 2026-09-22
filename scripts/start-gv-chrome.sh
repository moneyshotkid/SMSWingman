#!/usr/bin/env bash
set -euo pipefail
export DISPLAY="${DISPLAY:-:99}"
PROFILE="${GV_PROFILE:-$HOME/.google-voice-sms/chrome-profile}"
PORT="${GV_DEBUG_PORT:-9222}"

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1280x720x24 -ac >/tmp/xvfb.log 2>&1 &
  sleep 1
fi

if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "Chrome CDP already ready on ${PORT}"
  exit 0
fi

mkdir -p "$PROFILE"
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"

nohup google-chrome-stable \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --window-size=1280,900 \
  https://voice.google.com/u/0/messages \
  >/tmp/chrome-gv.log 2>&1 &

for i in $(seq 1 40); do
  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
    echo "Chrome CDP ready on ${PORT}"
    exit 0
  fi
  sleep 0.25
done
echo "FAILED to start Chrome CDP" >&2
tail -40 /tmp/chrome-gv.log >&2 || true
exit 1
