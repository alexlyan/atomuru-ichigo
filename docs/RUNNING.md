# Running Ichigo locally

Three pieces run together: Postgres (Docker), the API (FastAPI, port 8000) and the web app (Next.js, port 3000).
The browser only talks to port 3000; Next forwards `/api/*` to the API.

## Requirements

- Docker Desktop (for Postgres)
- [uv](https://docs.astral.sh/uv/) (Python 3.12+ is installed by uv on demand)
- Node.js 22 or newer and npm

## First time

Run these from the repository root.

```bash
# 1. Database
open -a Docker                      # start Docker Desktop if it is not running
docker compose up -d db             # Postgres on :5432, also creates the ichigo_test database

# 2. API
cd backend
uv sync
uv run alembic upgrade head         # create the tables
uv run python -m app.seed           # load content/ja (kanji, vocabulary, grammar)

# 3. Web app (second terminal)
cd frontend
npm install
```

## Every time

One command starts Docker, Postgres, migrations (and the content on a fresh database), the API and the web app:

```bash
scripts/dev.sh            # add --seed to reload content/ja first
```

Press `Ctrl+C` to stop the API and the web app. Or start the three parts by hand, in this order:

```bash
docker compose up -d db                              # from the repository root
cd backend && uv run uvicorn app.main:app --reload   # terminal 1, API on http://localhost:8000
cd frontend && npm run dev                           # terminal 2, app on http://localhost:3000
```

Open http://localhost:3000. API documentation is at http://localhost:8000/docs.

Stop: `Ctrl+C` in both terminals, then `docker compose stop db`. Your data stays in the Docker volume.

## Everything in Docker

```bash
docker compose --profile full up --build
docker compose exec api python -m app.seed     # once, to load the content
```

## Your data

- Items, progress and answer history live in the `pgdata` Docker volume.
- `uv run python -m app.seed` is safe to run again after editing `content/ja/*.json`. It updates content and keeps
  your stages, schedules, accepted answers and notes.
- Check content files before loading: `python3 content/validate_seed.py`.
- Start from zero (deletes everything): `docker compose down -v`, then repeat the first-time steps.
- Reset only your learning progress, keeping the library:

  ```bash
  docker compose exec -T db psql -U ichigo -c "
    DELETE FROM review_events;
    UPDATE items SET stage=NULL, lesson_passes=0, lesson_directions=0, lesson_started_at=NULL,
                     next_review_at=NULL, user_synonyms='{}';"
  ```

## Tests and checks

```bash
cd backend
uv run pytest                    # rules and API, against the separate ichigo_test database
uv run ruff check app tests

cd frontend
npx tsc --noEmit && npm run lint && npm run build
```

## Configuration

Environment variables (a `backend/.env` file works too):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://ichigo:ichigo@localhost:5432/ichigo` | API database |
| `TEST_DATABASE_URL` | `...localhost:5432/ichigo_test` | database used by `pytest` |
| `DEV_USER_EMAIL` | `me@ichigo.local` | the single user until sign-in exists |
| `CONTENT_DIR` | `content/` in the repo | where `app.seed` reads content |
| `API_URL` (frontend) | `http://localhost:8000` | where Next forwards `/api/*`; fixed when the app is built |

## When something goes wrong

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop (`open -a Docker`), wait until it is ready, retry. |
| `docker compose up` fails while pulling the image | Network error. Run `docker pull postgres:16-alpine` until it completes, then `docker compose up -d db`. |
| `service "db" is not running` | The image did not start. Check `docker compose logs db`. |
| Page says the Ichigo server did not answer | The API is not running. Start it and check port 8000: `lsof -iTCP:8000 -sTCP:LISTEN`. |
| `Address already in use` | Another process holds the port. Find it with `lsof -iTCP:<port> -sTCP:LISTEN`, stop it, or use another port (`npm run dev -- --port 3001`). |
| `ModuleNotFoundError: No module named 'app'` from alembic | Run it from the `backend/` folder. |
| Tests fail with `database "ichigo_test" does not exist` | The test database is only created when the Docker volume is first made. Create it: `docker compose exec -T db psql -U ichigo -c "CREATE DATABASE ichigo_test"`. |
| Changed the API URL but the app still calls the old one | `API_URL` is read at build time. Restart `npm run dev`, or rebuild. |
| The API ignores a code change | Start it with `--reload`, or restart it. |

## Not built yet

Google sign-in (the app runs as one local user), data export, and Redis, Terraform and GCP deployment.
