# Ichigo: notes for Claude

Read README.md first. The BRD (Google Doc linked there) is the source of truth for behaviour; when code and BRD
disagree, ask before changing either.

## Conventions
- Backend: pure rules live in `backend/app/core/` (no DB access) and have unit tests in `tests/test_core.py`.
  Services in `app/services/` use SQLAlchemy sessions; routes in `app/api/routes.py` stay thin.
  Every user-owned query must filter by workspace (user + language).
- Schema changes go through Alembic: edit `app/models.py`, then `uv run alembic revision --autogenerate -m "..."`.
- Run `uv run pytest` and `uv run ruff check app tests` after backend changes. Do not apply ruff `--unsafe-fixes`
  blindly: it once removed a needed set copy in `core/answers.py`.
- Frontend design follows the tokens and components in `frontend/app/globals.css`: study-notebook look, indigo accent, Mincho for Japanese,
  no emoji, no gradients, no decorative card stripes. One user-facing Types list (word types + kanji + grammar).
- Content language: meanings stay in the language of the source (mostly Russian); the UI is English.
- Seed data: edit `content/ja/*.json`, check with `python3 content/validate_seed.py`, load with `uv run python -m app.seed`.
