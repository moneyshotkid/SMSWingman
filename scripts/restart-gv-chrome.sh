#!/usr/bin/env bash
set -euo pipefail
export DISPLAY="${DISPLAY:-:99}"
PROF="${GV_PROFILE:-/home/bitnami/.google-voice-sms/chrome-profile}"
PORT="${GV_DEBUG_PORT:-9222}"

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1280x720x24 -ac >/tmp/xvfb.log 2>&1 &
  sleep 1
fi

# Kill only chrome processes using this profile (not this script / ssh)
while read -r pid; do
  [ -n "$pid" ] || continue
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$cmd" in
    *google-chrome*) kill "$pid" 2>/dev/null || true ;;
  esac
done < <(pgrep -f "user-data-dir=${PROF}" || true)
sleep 2

mkdir -p "$PROF"
rm -f "$PROF/SingletonLock" "$PROF/SingletonSocket" "$PROF/SingletonCookie"

nohup google-chrome-stable \
  --user-data-dir="$PROF" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --window-size=1280,900 \
  about:blank \
  >/tmp/chrome-gv.log 2>&1 &

for i in $(seq 1 40); do
  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
    echo "CDP ready"
    curl -s "http://127.0.0.1:${PORT}/json/version" | head -c 200
    echo
    exit 0
  fi
  sleep 0.25
done
echo "FAILED"
tail -30 /tmp/chrome-gv.log
exit 1
