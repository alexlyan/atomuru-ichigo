"""Database tables (BRD: Data model).

Every user-owned row hangs off a Workspace (one per user and language), so data is
scoped by user and by language from day one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.types import Kind, type_of
from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    active_language: Mapped[str | None] = mapped_column(ForeignKey("languages.code"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    workspaces: Mapped[list[Workspace]] = relationship(back_populates="user")


class Language(Base):
    """Language config is data: adding a language means adding a row (BRD: Switching language)."""

    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    native_name: Mapped[str] = mapped_column(String(80))
    direction: Mapped[str] = mapped_column(String(3), default="ltr")  # ltr | rtl
    supported: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("user_id", "language_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    language_code: Mapped[str] = mapped_column(ForeignKey("languages.code"))
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="workspaces")
    language: Mapped[Language] = relationship()


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        Index("ix_items_ws_due", "workspace_id", "next_review_at"),
        Index("ix_items_ws_stage", "workspace_id", "stage"),
        Index("ix_items_ws_kind_text", "workspace_id", "kind", "text"),
        Index("ix_items_categories", "categories", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))  # vocabulary | kanji | grammar
    word_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # vocabulary only

    text: Mapped[str] = mapped_column(Text)  # word, kanji character, or grammar title
    reading_kana: Mapped[str] = mapped_column(Text, default="")
    romaji: Mapped[str] = mapped_column(Text, default="")
    primary_meaning: Mapped[str] = mapped_column(Text)  # grammar: the summary
    alt_meanings: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    user_synonyms: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    categories: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)  # type-specific fields, validated in schemas.py
    note: Mapped[str] = mapped_column(Text, default="")

    # SRS state. stage None = not started; 0 = in lessons; 1..7 = reviews.
    stage: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    lesson_passes: Mapped[int] = mapped_column(SmallInteger, default=0)
    lesson_directions: Mapped[int] = mapped_column(SmallInteger, default=0)
    lesson_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    position: Mapped[int] = mapped_column(Integer, default=0)  # order in the learn queue
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=utcnow)

    @property
    def type(self) -> str:
        return type_of(Kind(self.kind), self.word_type)


class ReviewEvent(Base):
    """Append-only answer log (BRD: Analytics readiness)."""

    __tablename__ = "review_events"
    __table_args__ = (Index("ix_events_ws_created", "workspace_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    session_type: Mapped[str] = mapped_column(String(16))  # learn | review | practice
    direction: Mapped[str] = mapped_column(String(16))  # to_meaning | to_japanese
    question_kind: Mapped[str] = mapped_column(String(16))  # meaning | reading | cloze | name_pattern
    answer_given: Mapped[str] = mapped_column(Text, default="")
    outcome: Mapped[str] = mapped_column(String(16))  # correct | wrong | skipped
    note: Mapped[str | None] = mapped_column(String(16), nullable=True)  # typo | long_vowel | accepted
    similarity: Mapped[float] = mapped_column(Float, default=0.0)
    stage_before: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    stage_after: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    response_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_type: Mapped[str] = mapped_column(String(32))  # snapshot, so later edits don't rewrite history
    categories: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    undo_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # item state before a self-graded answer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="staged")  # staged | committed | cancelled | undone
    rows: Mapped[list] = mapped_column(JSONB, default=list)  # validation report, see importer.RowResult
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
