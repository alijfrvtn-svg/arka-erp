#!/usr/bin/env bash
# Netlify build script. Netlify's own deploy-log viewer is currently down
# ("Deploy logs are currently unavailable"), so this script also mirrors its
# complete output to a temporary public log-drop (ntfy.sh) on exit -- success
# or failure -- so the real error can be read back afterwards even though the
# Netlify UI shows nothing.
set -e

NTFY_TOPIC="arka-erp-diag-x7q2k9"
LOG=/tmp/build.log
: > "$LOG"

# Mirror all subsequent stdout/stderr to both the normal build log and $LOG.
exec > >(tee -a "$LOG") 2>&1

send_log() {
  local code=$?
  tail -c 3500 "$LOG" | curl -s -X POST -H "Title: arka-erp build exit $code" --data-binary @- "https://ntfy.sh/$NTFY_TOPIC" > /dev/null 2>&1 || true
}
trap send_log EXIT

echo "=== STAGE 1: backend npm install ==="
cd backend
# --include=dev is passed explicitly because this script calls npm itself;
# Netlify's NPM_FLAGS/NODE_ENV=production only affects Netlify's own
# automatic install step, not npm calls made from inside a custom script.
npm install --include=dev

echo "=== STAGE 2: backend build (tsc) ==="
npm run build

echo "=== STAGE 3: frontend npm install ==="
cd ../frontend
npm install --include=dev

echo "=== STAGE 4: frontend build (vite) ==="
npm run build

echo "=== BUILD COMPLETE ==="
