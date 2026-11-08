# Ichigo

A personal language-learning platform with a staged spaced-repetition system. Japanese first;
the data model is language-agnostic so Kyrgyz and Arabic can follow.

- Requirements (BRD): [Google Doc](https://docs.google.com/document/d/1Ew__PK7-yfUdWk6qIel3JmirujQZboSOPOoAx6atbAk/edit)
- User flows: in the BRD (section User flows)
- Visual design: tokens and components in `frontend/app/globals.css`

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLAlchemy + Alembic, Postgres. SRS rules, answer checking, imports, stats. |
| `frontend/` | Next.js app (App Router). Talks to the API through `/api` rewrites. |
| `content/` | Loader inputs: `ja/kanji.json`, `ja/vocabulary.json`, `ja/grammar.json` (kept local, git-ignored) and `validate_seed.py`. |
| `docs/` | Guides (`RUNNING.md`). |

## Run it locally

Full guide with troubleshooting: [docs/RUNNING.md](docs/RUNNING.md). Shortest path: `scripts/dev.sh`. Step by step:

```bash
docker compose up -d db                     # Postgres on :5432 (also creates ichigo_test)

cd backend
uv sync
uv run alembic upgrade head                 # create tables
uv run python -m app.seed                   # load content/ja into your workspace (safe to re-run)
uv run uvicorn app.main:app --reload        # API on :8000, docs at /docs

cd ../frontend
npm install
npm run dev                                 # app on :3000
```

Everything in Docker instead: `docker compose --profile full up --build`, then run the seed once with
`docker compose exec api python -m app.seed`.

## Tests

```bash
cd backend
uv run pytest            # core rules + API tests against the ichigo_test database
uv run ruff check app tests
```

## Key rules (from the BRD)

- Stages: new items need 3 passes in lessons (one pass = both directions correct), then stage 1 (12h),
  1 day, 3 days, 7 days, 14 days, 30 days, and stage 7 repeats every 60 days. Wrong answer: down one stage, minimum 1.
- Answers in Japanese can be typed as romaji, hiragana or katakana; typos and long-vowel slips are tolerated
  according to the typo tolerance setting.
- Grammar is reviewed through example sentences whose grammar part is marked with `[brackets]`.
- Practice never changes stages or review dates.
- Single-user mode for now (`DEV_USER_EMAIL`); every table is already scoped by user and language.
