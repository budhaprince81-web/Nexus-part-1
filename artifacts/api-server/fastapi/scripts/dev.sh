#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

REDIS_PID=""
if [[ -z "${REDIS_URL:-}" ]]; then
  REDIS_PORT="${NEXUS_DEV_REDIS_PORT:-6380}"
  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --bind 127.0.0.1 --port "$REDIS_PORT" --save "" --appendonly no &
    REDIS_PID=$!
    for _ in $(seq 1 40); do
      if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then break; fi
      sleep 0.25
    done
    redis-cli -p "$REDIS_PORT" ping >/dev/null
  fi
  export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}/0"
fi

cleanup() {
  if [[ -n "$REDIS_PID" ]]; then kill "$REDIS_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
