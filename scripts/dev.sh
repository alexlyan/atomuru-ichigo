#!/usr/bin/env bash
# Start Postgres, the API and the web app with one command. Ctrl+C stops the API and the web app.
#   scripts/dev.sh            start everything
#   scripts/dev.sh --seed     also (re)load content/ja first
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }

for tool in docker uv npm; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See docs/RUNNING.md (Requirements)."; exit 1; }
done

if ! docker info >/dev/null 2>&1; then
  say "Starting Docker Desktop..."
  open -a Docker 2>/dev/null || { echo "Start Docker Desktop, then run this again."; exit 1; }
  for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "Docker did not start in time. Start it and run this again."; exit 1; }
fi

for p in 8000 3000; do
  if port_busy "$p"; then echo "Port $p is already in use. Stop that process first (lsof -iTCP:$p -sTCP:LISTEN)."; exit 1; fi
done

say "Database"
docker compose up -d db
for _ in $(seq 1 40); do docker compose exec -T db pg_isready -U ichigo >/dev/null 2>&1 && break; sleep 1; done
docker compose exec -T db pg_isready -U ichigo >/dev/null || { echo "Postgres did not become ready. Run: docker compose logs db"; exit 1; }

say "Backend setup"
(cd backend && uv sync -q && uv run alembic upgrade head)
if [[ "${1:-}" == "--seed" ]] || [[ "$(docker compose exec -T db psql -U ichigo -tAc 'select count(*) from items' 2>/dev/null || echo 0)" == "0" ]]; then
  say "Loading content/ja"
  (cd backend && uv run python -m app.seed)
fi

[[ -d frontend/node_modules ]] || { say "Installing frontend packages"; (cd frontend && npm install); }

pids=()
cleanup() { trap - INT TERM EXIT; say "Stopping..."; for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

say "API on http://localhost:8000 and app on http://localhost:3000"
(cd backend && exec uv run uvicorn app.main:app --reload --port 8000) &
pids+=($!)
(cd frontend && exec npm run dev -- --port 3000) &
pids+=($!)
wait
