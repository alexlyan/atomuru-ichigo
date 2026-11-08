"""Library list, item detail, manual add and edit (BRD: Library, Card detail, Add content)."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.types import Kind
from app.models import Item, ReviewEvent, Workspace
from app.schemas import DETAILS_MODEL, ItemIn, ItemOut, ItemPatch, ItemSummary
from app.services.questions import is_reviewable
from app.services.workspaces import categories_filter, stage_filter, types_filter

SORTS = {"recent", "next_review", "most_missed", "az"}


def summary(item: Item) -> ItemSummary:
    return ItemSummary(
        id=item.id, kind=Kind(item.kind), type=item.type, text=item.text, reading_kana=item.reading_kana,
        romaji=item.romaji, primary_meaning=item.primary_meaning, stage=item.stage,
        next_review_at=item.next_review_at, categories=list(item.categories or []),
        pattern=(item.details or {}).get("pattern", "") if item.kind == Kind.grammar.value else "",
    )


def list_items(db: Session, ws: Workspace, tab: str, q: str, types: list[str] | None, stages: list[str] | None,
               sort: str, limit: int, offset: int, categories: list[str] | None = None) -> dict:
    stmt = select(Item).where(Item.workspace_id == ws.id)
    if tab in (k.value for k in Kind):
        stmt = stmt.where(Item.kind == tab)
    for cond in (types_filter(types), stage_filter(stages), categories_filter(categories)):
        if cond is not None:
            stmt = stmt.where(cond)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Item.text.ilike(like), Item.reading_kana.ilike(like), Item.romaji.ilike(like),
            Item.primary_meaning.ilike(like), func.array_to_string(Item.alt_meanings, " ").ilike(like),
        ))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    if sort == "next_review":
        stmt = stmt.order_by(Item.next_review_at.asc().nulls_last(), Item.text)
    elif sort == "az":
        stmt = stmt.order_by(Item.reading_kana, Item.text)
    elif sort == "most_missed":
        wrongs = (select(ReviewEvent.item_id, func.count().label("n"))
                  .where(ReviewEvent.workspace_id == ws.id, ReviewEvent.outcome == "wrong")
                  .group_by(ReviewEvent.item_id).subquery())
        stmt = stmt.outerjoin(wrongs, wrongs.c.item_id == Item.id).order_by(
            func.coalesce(wrongs.c.n, 0).desc(), Item.text)
    elif sort == "queue":  # learn-queue order
        stmt = stmt.order_by(Item.position, Item.created_at)
    else:
        stmt = stmt.order_by(Item.created_at.desc(), Item.position.desc())
    items = db.scalars(stmt.limit(limit).offset(offset)).all()
    counts = dict(db.execute(select(Item.kind, func.count()).where(Item.workspace_id == ws.id).group_by(Item.kind)).all())
    return {
        "items": [summary(i) for i in items],
        "total": total,
        "counts": {"all": sum(counts.values()), **{k.value: counts.get(k.value, 0) for k in Kind}},
    }


def categories(db: Session, ws: Workspace, stages: list[str] | None) -> list[dict]:
    """Every category in use with its item count, lesson labels first."""
    name = func.unnest(Item.categories).label("name")
    inner = select(name).where(Item.workspace_id == ws.id)
    cond = stage_filter(stages)
    if cond is not None:
        inner = inner.where(cond)
    sub = inner.subquery()
    rows = db.execute(select(sub.c.name, func.count()).group_by(sub.c.name)).all()

    def key(row):
        label = row[0]
        digits = "".join(ch for ch in label if ch.isdigit())
        is_lesson = any(word in label.lower() for word in ("урок", "lesson", "катакана", "kanji"))
        return (0 if is_lesson else 1, "".join(ch for ch in label if not ch.isdigit()).lower(),
                int(digits) if digits else 0, label)

    return [{"name": n, "count": c} for n, c in sorted(rows, key=key)]


def get_item(db: Session, ws: Workspace, item_id: uuid.UUID) -> Item | None:
    return db.scalar(select(Item).where(Item.id == item_id, Item.workspace_id == ws.id))


def item_detail(db: Session, ws: Workspace, item: Item) -> ItemOut:
    ok, n = db.execute(select(func.count().filter(ReviewEvent.outcome == "correct"), func.count()).where(
        ReviewEvent.item_id == item.id, ReviewEvent.session_type != "practice",
        ReviewEvent.outcome.in_(("correct", "wrong")))).one()
    links: list[Item] = []
    if item.kind == Kind.vocabulary.value:
        chars = list(dict.fromkeys(ch for ch in item.text if "一" <= ch <= "鿿"))
        if chars:
            found = {i.text: i for i in db.scalars(select(Item).where(
                Item.workspace_id == ws.id, Item.kind == Kind.kanji.value, Item.text.in_(chars))).all()}
            links = [found[c] for c in chars if c in found]
    elif item.kind == Kind.kanji.value:
        links = list(db.scalars(select(Item).where(
            Item.workspace_id == ws.id, Item.kind == Kind.vocabulary.value, Item.text.contains(item.text)
        ).order_by(Item.text).limit(20)).all())
    base = summary(item).model_dump()
    return ItemOut(
        **base, word_type=item.word_type, alt_meanings=list(item.alt_meanings or []),
        user_synonyms=list(item.user_synonyms or []), details=item.details or {}, note=item.note,
        source=item.source, created_at=item.created_at, answers=n, accuracy=round(100 * ok / n) if n else None,
        kanji_links=[summary(i) for i in links], reviewable=is_reviewable(item),
        lesson_passes=item.lesson_passes if item.stage == 0 else 0,
    )


def find_duplicate(db: Session, ws: Workspace, kind: str, text: str) -> Item | None:
    return db.scalar(select(Item).where(Item.workspace_id == ws.id, Item.kind == kind, Item.text == text))


def next_position(db: Session, ws: Workspace) -> int:
    return (db.scalar(select(func.max(Item.position)).where(Item.workspace_id == ws.id)) or 0) + 1


def create_item(db: Session, ws: Workspace, data: ItemIn, position: int | None = None,
                import_batch_id: uuid.UUID | None = None) -> Item:
    item = Item(
        workspace_id=ws.id, kind=data.kind.value, word_type=data.word_type, text=data.text.strip(),
        reading_kana=data.reading_kana.strip(), romaji=data.romaji.strip().lower(),
        primary_meaning=data.primary_meaning.strip(), alt_meanings=[m.strip() for m in data.alt_meanings if m.strip()],
        user_synonyms=[], categories=list(dict.fromkeys(c.strip() for c in data.categories if c.strip())),
        details=data.details, note=data.note, source=data.source,
        position=position if position is not None else next_position(db, ws), import_batch_id=import_batch_id,
    )
    db.add(item)
    return item


def update_item(item: Item, patch: ItemPatch | ItemIn) -> Item:
    fields = patch.model_dump(exclude_unset=True) if isinstance(patch, ItemPatch) else patch.model_dump()
    for key in ("text", "reading_kana", "romaji", "primary_meaning", "alt_meanings", "word_type", "categories", "note"):
        if key in fields and fields[key] is not None:
            setattr(item, key, fields[key])
    if fields.get("details") is not None:
        item.details = DETAILS_MODEL[Kind(item.kind)].model_validate(fields["details"]).model_dump()
    if item.alt_meanings and len(item.alt_meanings) > 5:
        raise ValueError("at most 5 alternative meanings")
    return item
