"""Load content/<lang>/{kanji,vocabulary,grammar}.json into the dev user's workspace.

    uv run python -m app.seed            # Japanese
    uv run python -m app.seed --dry-run  # validate only

Safe to run again: existing items (same kind and text) get their content updated,
while stage, schedule, your synonyms and notes are kept.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select

from app.config import get_settings
from app.core.kana import hiragana_to_romaji, to_hiragana
from app.core.types import MAX_ALT_MEANINGS, Kind
from app.db import SessionLocal
from app.models import Item
from app.schemas import ItemIn
from app.services.library import create_item, update_item
from app.services.workspaces import ensure_languages, get_or_create_dev_user, get_workspace


def load(path: Path) -> list[dict]:
    return json.loads(path.read_text()) if path.exists() else []


def kanji_rows(rows: list[dict]) -> list[ItemIn]:
    out = []
    for r in rows:
        reading = r.get("reading_kana") or to_hiragana((r.get("kunyomi") or r["onyomi"])[0]).replace(".", "")
        out.append(ItemIn(
            kind=Kind.kanji, text=r["character"], reading_kana=reading, romaji=hiragana_to_romaji(reading),
            primary_meaning=r["primary_meaning"], alt_meanings=r.get("alt_meanings", [])[:MAX_ALT_MEANINGS],
            categories=r.get("categories", []), source=r.get("source", ""),
            details={"onyomi": r.get("onyomi", []), "kunyomi": r.get("kunyomi", []), "lesson": r.get("lesson")},
        ))
    return out


def vocabulary_rows(rows: list[dict]) -> list[ItemIn]:
    return [ItemIn(
        kind=Kind.vocabulary, text=r["text"], reading_kana=r["reading_kana"], romaji=r["romaji"],
        primary_meaning=r["primary_meaning"], alt_meanings=r.get("alt_meanings", [])[:MAX_ALT_MEANINGS],
        word_type=r.get("word_type"), categories=r.get("categories", []), source=r.get("source", ""),
    ) for r in rows]


def grammar_rows(rows: list[dict]) -> list[ItemIn]:
    return [ItemIn(
        kind=Kind.grammar, text=r["title"], primary_meaning=r["summary"],
        alt_meanings=r.get("summary_alts", [])[:MAX_ALT_MEANINGS], categories=r.get("categories", []),
        source=r.get("source", ""),
        details={"pattern": r.get("pattern", ""), "explanation_md": r.get("explanation_md", ""),
                 "examples": [{"ja": e["ja"], "translation": e.get("translation", "")} for e in r.get("examples", [])]},
    ) for r in rows]


def build(content_dir: Path) -> tuple[list[ItemIn], list[str]]:
    items: list[ItemIn] = []
    errors: list[str] = []
    for name, fn in (("kanji", kanji_rows), ("vocabulary", vocabulary_rows), ("grammar", grammar_rows)):
        rows = load(content_dir / f"{name}.json")
        for i, row in enumerate(rows):
            try:
                items.extend(fn([row]))
            except (ValidationError, KeyError, IndexError) as exc:
                errors.append(f"{name}[{i}] {row.get('text') or row.get('title') or row.get('character')}: {exc}")
    return items, errors


def run(language: str = "ja", dry_run: bool = False) -> dict:
    content_dir = get_settings().content_dir / language
    items, errors = build(content_dir)
    if dry_run:
        return {"valid": len(items), "errors": errors}
    created = updated = 0
    with SessionLocal() as db:
        ensure_languages(db)
        user = get_or_create_dev_user(db)
        ws = get_workspace(db, user, language)
        existing = {(i.kind, i.text): i for i in db.scalars(select(Item).where(Item.workspace_id == ws.id)).all()}
        for position, data in enumerate(items, start=1):
            key = (data.kind.value, data.text)
            if key in existing:
                item = update_item(existing[key], data)
                item.source = data.source
                updated += 1
            else:
                existing[key] = create_item(db, ws, data, position=position)
                created += 1
        db.commit()
    return {"created": created, "updated": updated, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="ja")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.language, args.dry_run)
    for err in result["errors"]:
        print("skipped:", err)
    print({k: v for k, v in result.items() if k != "errors"}, f"errors={len(result['errors'])}")
