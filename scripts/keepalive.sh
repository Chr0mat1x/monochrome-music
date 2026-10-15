#!/usr/bin/env bash
# Keeps the MONOCHROME dev server (audio proxy + Vite) alive across crashes.
cd /workspace/project
export PATH="$HOME/.local/bin:$PATH"
while true; do
  if ! curl -s -m 5 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    echo "[keepalive] $(date -u +%H:%M:%S) starting server"
    npm run dev >> /tmp/mono-dev.log 2>&1
    echo "[keepalive] $(date -u +%H:%M:%S) server exited, restarting in 3s"
  fi
  sleep 3
done
