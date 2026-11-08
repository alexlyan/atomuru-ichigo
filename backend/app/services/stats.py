"""Today screen and Progress screen numbers (BRD: Home, Progress and accuracy by type)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.types import group_of
from app.models import Item, ReviewEvent, Workspace
from app.services.study import learned_today
from app.services.workspaces import due_count, settings_of, start_of_day

ANSWERED = ("correct", "wrong")


def distribution(db: Session, ws: Workspace) -> dict[str, int]:
    rows = db.execute(
        select(Item.stage, func.count()).where(Item.workspace_id == ws.id).group_by(Item.stage)
    ).all()
    out = {"not_started": 0, **{str(i): 0 for i in range(8)}}
    for stage, n in rows:
        out["not_started" if stage is None else str(stage)] = n
    return out


def streak_days(db: Session, ws: Workspace, now: datetime, tz) -> int:
    day = func.date(func.timezone(str(tz), ReviewEvent.created_at))
    days = set(
        db.scalars(
            select(day).where(
                ReviewEvent.workspace_id == ws.id,
                ReviewEvent.outcome.in_(ANSWERED),
                ReviewEvent.session_type.in_(("learn", "review")),
                ReviewEvent.created_at >= now - timedelta(days=400),
            ).distinct()
        ).all()
    )
    today = now.astimezone(tz).date()
    cursor = today if today in days else today - timedelta(days=1)
    n = 0
    while cursor in days:
        n += 1
        cursor -= timedelta(days=1)
    return n


def accuracy(correct: int, total: int) -> float | None:
    return round(100 * correct / total) if total else None


def today(db: Session, ws: Workspace, now: datetime, tz) -> dict:
    s = settings_of(ws)
    due = due_count(db, ws.id, now)
    oldest = db.scalar(select(func.min(Item.next_review_at)).where(
        Item.workspace_id == ws.id, Item.stage >= 1, Item.next_review_at <= now))
    upcoming = db.scalars(
        select(Item.next_review_at).where(
            Item.workspace_id == ws.id, Item.stage >= 1, Item.next_review_at > now,
            Item.next_review_at <= now + timedelta(hours=24),
        )
    ).all()
    forecast = [0] * 12
    forecast[0] += due
    for t in upcoming:
        forecast[min(int((t - now).total_seconds() // 7200), 11)] += 1
    next_at = min(upcoming) if upcoming else None
    next_batch = None
    if next_at:
        next_batch = {"at": next_at, "count": sum(1 for t in upcoming if t <= next_at + timedelta(hours=1))}

    done = learned_today(db, ws, now, tz)
    waiting_q = select(Item).where(Item.workspace_id == ws.id, Item.stage.is_(None)).order_by(Item.position, Item.created_at)
    waiting = db.scalar(select(func.count()).select_from(waiting_q.subquery())) or 0
    in_lessons = db.scalar(select(func.count()).select_from(Item).where(Item.workspace_id == ws.id, Item.stage == 0)) or 0
    next_up = [i.text for i in db.scalars(waiting_q.limit(3)).all()]

    since_today = start_of_day(now, tz)
    reviewed_today = db.scalar(select(func.count()).select_from(ReviewEvent).where(
        ReviewEvent.workspace_id == ws.id, ReviewEvent.session_type == "review",
        ReviewEvent.outcome.in_(ANSWERED), ReviewEvent.created_at >= since_today)) or 0
    c, t = db.execute(select(
        func.count().filter(ReviewEvent.outcome == "correct"), func.count()
    ).where(ReviewEvent.workspace_id == ws.id, ReviewEvent.session_type == "review",
            ReviewEvent.outcome.in_(ANSWERED), ReviewEvent.created_at >= now - timedelta(days=7))).one()
    total = db.scalar(select(func.count()).select_from(Item).where(Item.workspace_id == ws.id)) or 0
    return {
        "reviews_due": due,
        "oldest_due_at": oldest,
        "next_batch": next_batch,
        "new_available": min(max(s.new_per_day - done, 0), waiting),
        "in_lessons": in_lessons,
        "learned_today": done,
        "daily_cap": s.new_per_day,
        "next_up": next_up,
        "streak_days": streak_days(db, ws, now, tz),
        "reviewed_today": reviewed_today,
        "accuracy_7d": accuracy(c, t),
        "total_items": total,
        "forecast": [{"from_hours": 2 * i, "count": n} for i, n in enumerate(forecast)],
        "distribution": distribution(db, ws),
    }


def progress(db: Session, ws: Workspace, now: datetime, tz, days: int | None) -> dict:
    since = (start_of_day(now, tz) - timedelta(days=days - 1)) if days else None
    base = [ReviewEvent.workspace_id == ws.id, ReviewEvent.outcome.in_(ANSWERED)]
    if since:
        base.append(ReviewEvent.created_at >= since)

    is_ok = case((ReviewEvent.outcome == "correct", 1), else_=0)
    rows = db.execute(
        select(ReviewEvent.item_type, ReviewEvent.session_type, ReviewEvent.direction,
               func.sum(is_ok), func.count())
        .where(*base)
        .group_by(ReviewEvent.item_type, ReviewEvent.session_type, ReviewEvent.direction)
    ).all()
    counts = dict(db.execute(
        select(func.coalesce(Item.word_type, Item.kind), func.count()).where(Item.workspace_id == ws.id)
        .group_by(func.coalesce(Item.word_type, Item.kind))
    ).all())
    folded: dict[str, int] = {}
    for detailed, n in counts.items():  # "vocabulary" = vocabulary without a word type, counted as noun
        g = group_of("noun" if detailed == "vocabulary" else detailed)
        folded[g] = folded.get(g, 0) + n
    counts = folded

    agg: dict[str, dict[str, list[int]]] = {}
    for item_type, session, direction, ok, n in rows:
        a = agg.setdefault(group_of(item_type), {"review": [0, 0], "to_meaning": [0, 0], "to_japanese": [0, 0], "practice": [0, 0]})
        if session == "practice":
            a["practice"][0] += ok; a["practice"][1] += n
        else:
            a["review"][0] += ok; a["review"][1] += n
            a[direction][0] += ok; a[direction][1] += n

    by_type = []
    for t in sorted(set(counts) | set(agg), key=lambda x: (-counts.get(x, 0), x)):
        a = agg.get(t, {"review": [0, 0], "to_meaning": [0, 0], "to_japanese": [0, 0], "practice": [0, 0]})
        by_type.append({
            "type": t,
            "items": counts.get(t, 0),
            "answers": a["review"][1],
            "review": accuracy(*a["review"]),
            "to_meaning": accuracy(*a["to_meaning"]),
            "to_japanese": accuracy(*a["to_japanese"]),
            "practice": accuracy(*a["practice"]),
        })

    weakest = None
    candidates = [r for r in by_type if r["answers"] >= 5 and r["review"] is not None]
    if candidates:
        w = min(candidates, key=lambda r: r["review"])
        dirs = [(d, w[d]) for d in ("to_meaning", "to_japanese") if w[d] is not None]
        weak_dir = min(dirs, key=lambda x: x[1]) if dirs else (None, None)
        weakest = {"type": w["type"], "review": w["review"], "direction": weak_dir[0], "direction_accuracy": weak_dir[1]}

    review_ok = sum(r[3] for r in rows if r[1] != "practice")
    review_n = sum(r[4] for r in rows if r[1] != "practice")
    dist = distribution(db, ws)
    return {
        "period_days": days,
        "summary": {
            "accuracy": accuracy(review_ok, review_n),
            "answers": review_n,
            "streak_days": streak_days(db, ws, now, tz),
            "mastered": dist["7"],
        },
        "by_type": by_type,
        "weakest": weakest,
        "distribution": dist,
    }
