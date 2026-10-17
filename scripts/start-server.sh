#!/usr/bin/env bash
# Starts the MONOCHROME server (site + /api) if it is not already answering.
# Idempotent, so it is safe to call from a shell hook on every login.
#
# The container is recycled regularly and takes every process with it; the only
# thing the platform restarts by itself is the agent server. Hooking this into
# ~/.bashrc is what brings the music back without a human noticing the reset.
set -u

PROJECT=/workspace/project
LOG=/tmp/monochrome-server.log
PORT=12000
LOCK=/tmp/monochrome-server.lock

# A second copy would fight for the port and crash-loop, so bail out early.
if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  exit 0
fi

# One supervisor only. Two would race for the port and restart each other
# forever, so the loser steps aside.
exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$PROJECT" || exit 0
export PATH="$HOME/.local/bin:$PATH"
export MONO_SERVER_PORT="$PORT"

# Supervise: if the process dies, bring it straight back.
setsid nohup bash -c "
  cd /workspace/project || exit 1
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  export MONO_SERVER_PORT=$PORT
  while true; do
    node server/index.mjs >> /tmp/monochrome-server.log 2>&1
    echo '[supervisor] server exited, restarting' >> /tmp/monochrome-server.log
    sleep 2
  done
" >/dev/null 2>&1 < /dev/null &

# Give it a moment so the caller (and the browser) does not race the bind.
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done
echo "[monochrome] server did not come up; see $LOG" >&2
