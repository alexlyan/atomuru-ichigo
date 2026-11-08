from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.types import TYPE_GROUPS, TYPES, WORD_TYPES, Kind
from app.models import Item, Language, User, Workspace
from app.schemas import WorkspaceSettings

LANGUAGES = [
    # code, name, native name, direction, supported
    ("ja", "Japanese", "日本語", "ltr", True),
    ("ky", "Kyrgyz", "Кыргызча", "ltr", False),
    ("ar", "Arabic", "العربية", "rtl", False),
]


def ensure_languages(db: Session) -> None:
    for code, name, native, direction, supported in LANGUAGES:
        lang = db.get(Language, code)
        if lang is None:
            db.add(Language(code=code, name=name, native_name=native, direction=direction, supported=supported))
    db.flush()


def get_or_create_dev_user(db: Session) -> User:
    s = get_settings()
    user = db.scalar(select(User).where(User.email == s.dev_user_email))
    if user is None:
        ensure_languages(db)
        user = User(email=s.dev_user_email, name=s.dev_user_name, active_language="ja")
        db.add(user)
        db.flush()
        db.add(Workspace(user_id=user.id, language_code="ja", settings=WorkspaceSettings().model_dump()))
        db.commit()
    return user


def get_workspace(db: Session, user: User, code: str) -> Workspace | None:
    return db.scalar(select(Workspace).where(Workspace.user_id == user.id, Workspace.language_code == code))


def settings_of(ws: Workspace) -> WorkspaceSettings:
    return WorkspaceSettings.model_validate(ws.settings or {})


def zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def start_of_day(now: datetime, tz: ZoneInfo) -> datetime:
    local = now.astimezone(tz)
    return datetime.combine(local.date(), time.min, tzinfo=tz).astimezone(UTC)


def utcnow() -> datetime:
    return datetime.now(UTC)


def due_count(db: Session, ws_id, now: datetime) -> int:
    return db.scalar(
        select(func.count()).select_from(Item).where(
            Item.workspace_id == ws_id, Item.stage >= 1, Item.next_review_at <= now
        )
    ) or 0


def types_filter(types: list[str] | None):
    """SQL condition for the Types list: groups (verb, noun, adjective, other, kanji, grammar).
    Detailed word types such as i-adjective are still accepted, so old links keep working."""
    if not types or "all" in types:
        return None
    unknown = [t for t in types if t not in TYPES and t not in WORD_TYPES]
    if unknown:
        raise ValueError(f"unknown types: {', '.join(unknown)}")
    word_types: list[str] = []
    for t in types:
        word_types.extend(TYPE_GROUPS.get(t, (t,) if t in WORD_TYPES else ()))
    kinds = [t for t in types if t in (Kind.kanji.value, Kind.grammar.value)]
    parts = []
    if word_types:
        parts.append(and_(Item.kind == Kind.vocabulary.value, func.coalesce(Item.word_type, "noun").in_(word_types)))
    if kinds:
        parts.append(Item.kind.in_(kinds))
    return or_(*parts)


def categories_filter(categories: list[str] | None):
    """Items that have any of the given categories (lesson labels, topics)."""
    if not categories:
        return None
    return Item.categories.overlap(categories)


def stage_filter(stages: list[str] | None):
    """stages: 'new' (not started), '0'..'7'."""
    if not stages:
        return None
    parts = []
    nums = [int(s) for s in stages if s.isdigit()]
    if "new" in stages:
        parts.append(Item.stage.is_(None))
    if nums:
        parts.append(Item.stage.in_(nums))
    return or_(*parts) if parts else None


def day_window(now: datetime, tz: ZoneInfo, days: int) -> datetime:
    return start_of_day(now, tz) - timedelta(days=days - 1)
