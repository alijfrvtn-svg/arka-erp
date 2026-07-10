#!/usr/bin/env bash
# Netlify build script, staged with distinct exit codes so that if the
# Netlify UI's deploy log is unavailable (as it intermittently is), the
# deploy summary's error_message ("exit code N") at least tells us which
# stage failed, instead of a single opaque "exit code 2" for everything.
set -e

echo "=== STAGE 1: backend npm install ==="
cd backend
npm install || { echo "STAGE 1 FAILED"; exit 11; }

echo "=== STAGE 2: backend build (tsc) ==="
npm run build || { echo "STAGE 2 FAILED"; exit 12; }

echo "=== STAGE 3: frontend npm install ==="
cd ../frontend
npm install || { echo "STAGE 3 FAILED"; exit 13; }

echo "=== STAGE 4: frontend build (vite) ==="
npm run build || { echo "STAGE 4 FAILED"; exit 14; }

echo "=== BUILD COMPLETE ==="
