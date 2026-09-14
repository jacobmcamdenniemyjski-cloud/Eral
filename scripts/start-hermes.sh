#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${EARL_API_URL:-http://127.0.0.1:${EARL_API_PORT:-3001}}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SOUL_FILE="$HERMES_HOME/SOUL.md"
SOUL_BACKUP="$SOUL_FILE.earl-$$.bak"
HAD_SOUL=false
EARL_PID=""
STARTED_EARL=false

cleanup() {
  if [ "$STARTED_EARL" = true ] && [ -n "$EARL_PID" ]; then
    kill "$EARL_PID" 2>/dev/null || true
  fi
  if [ "$HAD_SOUL" = true ] && [ -f "$SOUL_BACKUP" ]; then
    mv "$SOUL_BACKUP" "$SOUL_FILE"
  else
    rm -f "$SOUL_FILE"
  fi
}
trap cleanup EXIT INT TERM

command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
command -v curl >/dev/null || { echo "curl is required."; exit 1; }
command -v hermes >/dev/null || {
  echo "Hermes Agent is required. Install it, then run: hermes setup"
  exit 1
}

cd "$ROOT_DIR"
export EARL_BRAIN=hermes
export EARL_API_ENABLED=true
export EARL_API_URL="$API_URL"

mkdir -p "$HERMES_HOME"
if [ -f "$SOUL_FILE" ]; then
  cp "$SOUL_FILE" "$SOUL_BACKUP"
  HAD_SOUL=true
fi
cp "$ROOT_DIR/prompts/SOUL-earl.md" "$SOUL_FILE"

if ! curl -fsS "$API_URL/health" >/dev/null 2>&1; then
  npm start &
  EARL_PID=$!
  STARTED_EARL=true

  for _ in $(seq 1 30); do
    curl -fsS "$API_URL/health" >/dev/null 2>&1 && break
    kill -0 "$EARL_PID" 2>/dev/null || {
      echo "Earl exited before the API became ready."
      exit 1
    }
    sleep 1
  done
fi

curl -fsS "$API_URL/health" >/dev/null || {
  echo "Earl API did not become ready at $API_URL."
  exit 1
}

SEED="Start Earl companion mode. Check body health and pending commands. When idle, arm the background command listener described in HERMES.md."
ARGS=(chat -q "$SEED")
[ "${EARL_HERMES_YOLO:-true}" != "false" ] && ARGS+=(--yolo)
[ -n "${EARL_HERMES_MODEL:-}" ] && ARGS+=(--model "$EARL_HERMES_MODEL")
[ -n "${EARL_HERMES_PROVIDER:-}" ] && ARGS+=(--provider "$EARL_HERMES_PROVIDER")

echo "Starting Earl's Hermes brain. API: $API_URL"
hermes "${ARGS[@]}"
