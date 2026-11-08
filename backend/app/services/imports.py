"""Staged bulk import with preview, commit, cancel and undo (BRD: Bulk import, Cancelling and undoing an add)."""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core import importer
from app.core.types import Kind
from app.models import ImportBatch, Item, Workspace
from app.schemas import ItemIn
from app.services.library import create_item, next_position

STAGED_TTL = timedelta(hours=24)


class ImportConflict(Exception):
    pass


def stage(db: Session, ws: Workspace, kind: Kind, filename: str, content: bytes) -> ImportBatch:
    rows = importer.read_table(filename, content)
    existing = set(db.scalars(select(Item.text).where(Item.workspace_id == ws.id, Item.kind == kind.value)).all())
    results = importer.validate(kind, rows, existing)
    batch = ImportBatch(workspace_id=ws.id, filename=filename, kind=kind.value, status="staged",
                        rows=[{**asdict(r), "status": r.status.value} for r in results])
    db.add(batch)
    db.commit()
    return batch


def summary(batch: ImportBatch) -> dict:
    counts = {"new": 0, "update": 0, "warning": 0, "error": 0}
    for r in batch.rows:
        counts[r["status"]] += 1
    return {
        "id": batch.id, "filename": batch.filename, "kind": batch.kind, "status": batch.status,
        "created_at": batch.created_at, "committed_at": batch.committed_at, "counts": counts,
        "importable": counts["new"] + counts["update"] + counts["warning"],
        "expires_at": batch.created_at + STAGED_TTL if batch.created_at else None,
        "rows": batch.rows,
    }


def get(db: Session, ws: Workspace, batch_id: uuid.UUID) -> ImportBatch | None:
    return db.scalar(select(ImportBatch).where(ImportBatch.id == batch_id, ImportBatch.workspace_id == ws.id))


def commit(db: Session, ws: Workspace, batch: ImportBatch, now: datetime) -> dict:
    if batch.status == "committed":
        return summary(batch)  # a second click changes nothing
    if batch.status != "staged":
        raise ImportConflict(f"This import is {batch.status} and cannot be imported.")
    if batch.created_at and now - batch.created_at > STAGED_TTL:
        batch.status = "cancelled"
        db.commit()
        raise ImportConflict("This preview expired after 24 hours. Upload the file again.")
    pos = next_position(db, ws)
    for r in batch.rows:
        data = r.get("data")
        if not data or r["status"] == "error":
            continue
        existing = db.scalar(select(Item).where(Item.workspace_id == ws.id, Item.kind == data["kind"],
                                                Item.text == data["text"]))
        if existing:
            existing.reading_kana = data["reading_kana"] or existing.reading_kana
            existing.romaji = data["romaji"] or existing.romaji
            existing.primary_meaning = data["primary_meaning"]
            existing.alt_meanings = data["alt_meanings"]
            if data.get("word_type"):
                existing.word_type = data["word_type"]
            existing.categories = list(dict.fromkeys([*(existing.categories or []), *data["categories"]]))
            if data.get("details"):
                existing.details = {**(existing.details or {}), **data["details"]}
            continue
        create_item(db, ws, ItemIn(**{**data, "details": data.get("details", {})}), position=pos,
                    import_batch_id=batch.id)
        pos += 1
    batch.status, batch.committed_at = "committed", now
    db.commit()
    return summary(batch)


def cancel(db: Session, batch: ImportBatch) -> None:
    if batch.status != "staged":
        raise ImportConflict("Only an import that has not been confirmed can be cancelled.")
    batch.status = "cancelled"
    db.commit()


def undo(db: Session, ws: Workspace, batch: ImportBatch) -> int:
    if batch.status != "committed":
        raise ImportConflict("Only a confirmed import can be undone.")
    started = db.scalar(select(func.count()).select_from(Item).where(
        Item.import_batch_id == batch.id, Item.stage.is_not(None))) or 0
    if started:
        raise ImportConflict(
            f"{started} item(s) from this import are already being learned, so it can't be undone. "
            "Edit or delete items one by one instead.")
    removed = db.execute(delete(Item).where(Item.import_batch_id == batch.id, Item.workspace_id == ws.id)).rowcount
    batch.status = "undone"
    db.commit()
    return removed or 0
