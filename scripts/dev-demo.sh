#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  echo "[demo] Loading environment variables from .env file..."
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
  echo "[demo] ✓ Environment variables loaded"
fi

NODE_CMD=(node --experimental-strip-types)
export WS_HUB_URL="ws://127.0.0.1:8788"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

start() {
  local name="$1"
  local cmd="$2"
  echo "[demo] starting $name"
  # Load .env variables and pass them to the background process
  # This properly handles quotes and special characters
  if [ -f .env ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      # Skip comments and empty lines
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// }" ]] && continue
      # Export each variable to be available in the bash -c command
      export "$line"
    done < .env
  fi
  # Run with all exported variables
  bash -c "$cmd" > ".demo-${name}.log" 2>&1 &
  local pid=$!
  echo $pid >> .demo-pids
  echo "[demo] $name started (PID: $pid, log: .demo-${name}.log)"
}

cleanup() {
  if [[ -f .demo-pids ]]; then
    while read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done < .demo-pids
    rm -f .demo-pids
  fi
}

trap cleanup EXIT

: > .demo-pids

start "ws-hub" "${NODE_CMD[*]} services/ws-hub/src/index.ts"
if [[ -n "${LIVEKIT_DISABLED:-}" ]]; then
  echo "[demo] skipping livekit-agent (LIVEKIT_DISABLED set)"
elif [[ -n "${LIVEKIT_URL:-}" && -n "${LIVEKIT_TOKEN:-}" ]]; then
  start "livekit-agent" "${NODE_CMD[*]} services/livekit-agent/src/index.ts"
else
  echo "[demo] skipping livekit-agent (LIVEKIT_URL/LIVEKIT_TOKEN not set)"
fi
start "gemini-worker" "${NODE_CMD[*]} services/gemini-worker/src/index.ts"
start "market-matcher" "${NODE_CMD[*]} services/market-matcher/src/index.ts"

echo "[demo] all services started. Press Ctrl+C to stop."
wait
