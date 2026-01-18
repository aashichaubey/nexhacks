#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_CMD=(node --experimental-strip-types)

start() {
  local name="$1"
  local cmd="$2"
  echo "[demo] starting $name..."
  bash -c "$cmd" > ".demo-${name}.log" 2>&1 &
  local pid=$!
  echo $pid >> .demo-pids
  echo "[demo] ✓ $name started (PID: $pid)"
  sleep 0.5  # Give service a moment to start
}

cleanup() {
  if [[ -f .demo-pids ]]; then
    echo ""
    echo "[demo] Stopping services..."
    while read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done < .demo-pids
    rm -f .demo-pids
    echo "[demo] All services stopped."
  fi
  rm -f .demo-*.log
}

trap cleanup EXIT

: > .demo-pids

echo "========================================="
echo "  Starting NexHacks Services"
echo "========================================="
echo ""

start "ws-hub" "${NODE_CMD[*]} services/ws-hub/src/index.ts"
start "livekit-agent" "${NODE_CMD[*]} services/livekit-agent/src/index.ts"
start "gemini-worker" "${NODE_CMD[*]} services/gemini-worker/src/index.ts"
start "market-matcher" "${NODE_CMD[*]} services/market-matcher/src/index.ts"

echo ""
echo "========================================="
echo "  All services started!"
echo "========================================="
echo ""
echo "Service logs:"
echo "  - ws-hub: tail -f .demo-ws-hub.log"
echo "  - livekit-agent: tail -f .demo-livekit-agent.log"
echo "  - gemini-worker: tail -f .demo-gemini-worker.log"
echo "  - market-matcher: tail -f .demo-market-matcher.log"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Show logs from all services in real-time
tail -f .demo-*.log 2>/dev/null || {
  echo "Services are running in the background."
  echo "Check log files for output."
  wait
}

