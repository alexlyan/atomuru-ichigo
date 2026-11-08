"""Learn, review and practice sessions (BRD: Learn new items, Review due items, Practice)."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import srs
from app.models import Item, ReviewEvent, Workspace
from app.schemas import AcceptOut, AnswerIn, AnswerOut, LessonState, Question
from app.services import questions as q
from app.services.workspaces import categories_filter, settings_of, stage_filter, start_of_day, types_filter

DIRS = {"to_meaning": srs.Direction.to_meaning, "to_japanese": srs.Direction.to_japanese}


class Conflict(Exception):
    pass


def _filtered(stmt, types: list[str] | None, categories: list[str] | None = None):
    for cond in (types_filter(types), categories_filter(categories)):
        if cond is not None:
            stmt = stmt.where(cond)
    return stmt


# ---------- learn ----------

def learned_today(db: Session, ws: Workspace, now: datetime, tz) -> int:
    return db.scalar(
        select(func.count()).select_from(Item).where(
            Item.workspace_id == ws.id, Item.lesson_started_at >= start_of_day(now, tz)
        )
    ) or 0


def learn_queue(db: Session, ws: Workspace, now: datetime, tz, types: list[str] | None, extra: int = 0,
                categories: list[str] | None = None) -> dict:
    s = settings_of(ws)
    done_today = learned_today(db, ws, now, tz)
    remaining = max(s.new_per_day - done_today, 0) + max(extra, 0)
    in_progress = db.scalars(
        _filtered(select(Item).where(Item.workspace_id == ws.id, Item.stage == 0), types, categories).order_by(Item.lesson_started_at)
    ).all()
    candidates = db.scalars(
        _filtered(select(Item).where(Item.workspace_id == ws.id, Item.stage.is_(None)), types, categories)
        .order_by(Item.position, Item.created_at)
        .limit(remaining * 3 + 10)
    ).all()
    new_items = [i for i in candidates if q.is_reviewable(i)][:remaining]
    waiting = db.scalar(
        _filtered(select(func.count()).select_from(Item).where(Item.workspace_id == ws.id, Item.stage.is_(None)), types,
                  categories)
    ) or 0
    return {
        "in_progress": in_progress,
        "new": new_items,
        "daily_cap": s.new_per_day,
        "learned_today": done_today,
        "waiting": waiting,
        "cap_reached": remaining == 0 and waiting > 0,
    }


def prioritize(db: Session, ws: Workspace, item_ids: list[uuid.UUID]) -> int:
    """Move these not-started items to the front of the learn queue, in the given order."""
    items = {i.id: i for i in db.scalars(select(Item).where(
        Item.workspace_id == ws.id, Item.id.in_(item_ids), Item.stage.is_(None))).all()}
    front = db.scalar(select(func.min(Item.position)).where(Item.workspace_id == ws.id, Item.stage.is_(None))) or 0
    ordered = [items[i] for i in dict.fromkeys(item_ids) if i in items]
    for offset, item in enumerate(ordered):
        item.position = front - len(ordered) + offset
    db.commit()
    return len(ordered)


def start_lessons(db: Session, ws: Workspace, item_ids: list[uuid.UUID], now: datetime) -> int:
    items = db.scalars(select(Item).where(Item.workspace_id == ws.id, Item.id.in_(item_ids), Item.stage.is_(None))).all()
    for it in items:
        it.stage, it.lesson_passes, it.lesson_directions, it.lesson_started_at = 0, 0, 0, now
    db.commit()
    return len(items)


def lesson_questions(db: Session, ws: Workspace, item_ids: list[uuid.UUID], rng: random.Random) -> list[Question]:
    """The directions still missing in the current pass, for every requested stage-0 item."""
    items = db.scalars(select(Item).where(Item.workspace_id == ws.id, Item.id.in_(item_ids), Item.stage == 0)).all()
    out: list[Question] = []
    for it in items:
        done = srs.Direction(it.lesson_directions)
        for name, flag in DIRS.items():
            if not done & flag:
                out.append(q.build_question(it, name, rng))  # type: ignore[arg-type]
    rng.shuffle(out)
    return out


# ---------- review ----------

def review_queue(db: Session, ws: Workspace, now: datetime, types: list[str] | None, limit: int | None,
                 rng: random.Random) -> list[Question]:
    s = settings_of(ws)
    items = db.scalars(
        _filtered(select(Item).where(Item.workspace_id == ws.id, Item.stage >= 1, Item.next_review_at <= now), types)
        .order_by(Item.next_review_at)
        .limit(limit or s.session_size)
    ).all()
    return [q.build_question(it, q.pick_direction(s.review_direction, rng), rng) for it in items if q.is_reviewable(it)]


# ---------- practice ----------

def practice_items_stmt(ws: Workspace, types, stages, source: str, now: datetime, categories=None):
    stmt = _filtered(select(Item).where(Item.workspace_id == ws.id), types, categories)
    cond = stage_filter(stages)
    if cond is not None:
        stmt = stmt.where(cond)
    else:
        stmt = stmt.where(Item.stage.is_not(None))  # default: items you have started
    if source == "recent":
        stmt = stmt.where(Item.lesson_started_at >= now - timedelta(days=7))
    elif source in ("missed_7d", "most_missed"):
        missed = select(ReviewEvent.item_id).where(ReviewEvent.workspace_id == ws.id, ReviewEvent.outcome == "wrong")
        if source == "missed_7d":
            missed = missed.where(ReviewEvent.created_at >= now - timedelta(days=7))
        stmt = stmt.where(Item.id.in_(missed))
    return stmt


def practice_count(db: Session, ws: Workspace, types, stages, source: str, now: datetime, categories=None) -> int:
    stmt = practice_items_stmt(ws, types, stages, source, now, categories)
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


def practice_queue(db: Session, ws: Workspace, types, stages, source: str, direction: str, count: int | None,
                   now: datetime, rng: random.Random, categories=None) -> list[Question]:
    stmt = practice_items_stmt(ws, types, stages, source, now, categories)
    if source == "most_missed":
        wrongs = (
            select(ReviewEvent.item_id, func.count().label("n"))
            .where(ReviewEvent.workspace_id == ws.id, ReviewEvent.outcome == "wrong")
            .group_by(ReviewEvent.item_id)
            .subquery()
        )
        stmt = stmt.join(wrongs, wrongs.c.item_id == Item.id).order_by(wrongs.c.n.desc())
    else:
        stmt = stmt.order_by(func.random())
    items = [i for i in db.scalars(stmt.limit(count or 500)).all() if q.is_reviewable(i)]
    return [q.build_question(it, q.pick_direction(direction, rng), rng) for it in items]


# ---------- answers ----------

def answer(db: Session, ws: Workspace, body: AnswerIn, now: datetime) -> AnswerOut:
    item = db.scalar(select(Item).where(Item.id == body.item_id, Item.workspace_id == ws.id))
    if item is None:
        raise LookupError("item not found")
    s = settings_of(ws)
    stage_before = item.stage
    event = ReviewEvent(
        workspace_id=ws.id, item_id=item.id, session_type=body.session_type, direction=body.direction,
        question_kind=body.question_kind, answer_given=body.answer.strip()[:500], response_ms=body.response_ms,
        item_type=item.type, categories=list(item.categories or []), stage_before=stage_before,
    )

    if body.skipped:
        if not s.skip_enabled:
            raise Conflict("Skipping is turned off in Settings.")
        event.outcome, event.stage_after = "skipped", stage_before
        db.add(event)
        db.commit()
        return AnswerOut(event_id=event.id, correct=False, exact=False, note="skipped", expected=[],
                         your_answer="", stage_before=stage_before, stage_after=stage_before,
                         next_review_at=item.next_review_at)

    verdict, expected = q.check(item, body.direction, body.question_kind, body.answer, s.typo_tolerance,
                                body.example_index)
    lesson: LessonState | None = None

    if body.session_type == "learn":
        if item.stage is None:
            item.stage, item.lesson_started_at = 0, now
            stage_before = 0
        if item.stage != 0:
            raise Conflict("This item has already finished its lessons.")
        o = srs.apply_lesson_answer(item.lesson_passes, item.lesson_directions, DIRS[body.direction],
                                    verdict.correct, now, s.intervals_hours)
        item.lesson_passes, item.lesson_directions = o.passes, o.directions_done
        if o.graduated:
            item.stage, item.next_review_at = 1, o.next_review_at
        lesson = LessonState(
            passes=o.passes,
            directions_done=[n for n, f in DIRS.items() if srs.Direction(o.directions_done) & f],  # type: ignore[misc]
            graduated=o.graduated,
        )
    elif body.session_type == "review":
        if item.stage is None or item.stage < 1:
            raise Conflict("This item is not in reviews yet.")
        o = srs.apply_review(item.stage, verdict.correct, now, s.intervals_hours)
        item.stage, item.next_review_at = o.stage_after, o.next_review_at
    # practice: never touches SRS state

    event.outcome = "correct" if verdict.correct else "wrong"
    event.note = verdict.note
    event.similarity = verdict.similarity
    event.stage_before, event.stage_after = stage_before, item.stage
    db.add(event)
    db.commit()
    can_accept = (not verdict.correct) and bool(event.answer_given) and body.question_kind in ("meaning", "name_pattern")
    return AnswerOut(
        event_id=event.id, correct=verdict.correct, exact=verdict.exact, note=verdict.note,
        expected=[e for e in expected if e], your_answer=event.answer_given, stage_before=stage_before,
        stage_after=item.stage, next_review_at=item.next_review_at, lesson=lesson, can_accept=can_accept,
    )


def accept(db: Session, ws: Workspace, event_id: int, now: datetime) -> AcceptOut:
    """"My answer was right": count it as correct and keep the typed text as an accepted answer."""
    ev = db.scalar(select(ReviewEvent).where(ReviewEvent.id == event_id, ReviewEvent.workspace_id == ws.id))
    if ev is None:
        raise LookupError("answer not found")
    if ev.outcome != "wrong" or ev.note == "accepted":
        raise Conflict("Only a wrong answer can be marked as right, and only once.")
    if ev.question_kind not in ("meaning", "name_pattern") or not ev.answer_given:
        raise Conflict("Only typed meanings can be added as accepted answers.")
    item = db.get(Item, ev.item_id)
    s = settings_of(ws)
    added = None
    if ev.answer_given not in (item.user_synonyms or []):
        item.user_synonyms = [*(item.user_synonyms or []), ev.answer_given]
        added = ev.answer_given
    if ev.session_type == "review" and ev.stage_before:
        o = srs.undo_wrong_review(ev.stage_before, now, s.intervals_hours)
        item.stage, item.next_review_at = o.stage_after, o.next_review_at
    elif ev.session_type == "learn" and item.stage == 0:
        o = srs.apply_lesson_answer(item.lesson_passes, item.lesson_directions, DIRS[ev.direction], True, now,
                                    s.intervals_hours)
        item.lesson_passes, item.lesson_directions = o.passes, o.directions_done
        if o.graduated:
            item.stage, item.next_review_at = 1, o.next_review_at
    ev.outcome, ev.note, ev.stage_after = "correct", "accepted", item.stage
    db.commit()
    return AcceptOut(stage_after=item.stage, next_review_at=item.next_review_at, added_synonym=added)
