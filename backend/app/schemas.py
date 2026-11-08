"""API and validation models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.grammar import is_marked
from app.core.srs import DEFAULT_INTERVALS_HOURS
from app.core.types import MAX_ALT_MEANINGS, WORD_TYPES, Kind

Direction = Literal["to_meaning", "to_japanese"]
SessionType = Literal["learn", "review", "practice"]
QuestionKind = Literal["meaning", "reading", "cloze", "name_pattern"]


# ---------- settings (BRD: Settings and session behavior) ----------

class WorkspaceSettings(BaseModel):
    new_per_day: int = Field(10, ge=1, le=200)
    session_size: int = Field(25, ge=5, le=500)
    typo_tolerance: Literal["strict", "normal", "forgiving"] = "normal"
    review_direction: Literal["both", "to_meaning", "to_japanese"] = "both"
    after_answer: Literal["wait", "advance_if_correct", "always_advance"] = "wait"
    auto_advance_seconds: Literal[1, 2, 4] = 2
    skip_enabled: bool = True
    show_on_wrong: Literal["answer_and_mine", "answer_only"] = "answer_and_mine"
    intervals_hours: dict[int, int] = Field(default_factory=lambda: dict(DEFAULT_INTERVALS_HOURS))

    @field_validator("intervals_hours")
    @classmethod
    def _all_stages(cls, v: dict[int, int]) -> dict[int, int]:
        if sorted(v) != list(range(1, 8)) or any(h <= 0 for h in v.values()):
            raise ValueError("intervals must give a positive number of hours for stages 1 to 7")
        return v


# ---------- item details per kind (BRD: Item structure) ----------

class Pair(BaseModel):
    ja: str
    en: str = ""  # translation, in any language


class PatternOfUse(BaseModel):
    pattern: str
    combinations: list[Pair] = []


class VocabularyDetails(BaseModel):
    meaning_explanation: str = ""
    reading_explanation: str = ""
    patterns: list[PatternOfUse] = []
    sentences: list[Pair] = []


class KanjiDetails(BaseModel):
    onyomi: list[str] = []
    kunyomi: list[str] = []
    mnemonic: str = ""
    lesson: int | None = None

    @model_validator(mode="after")
    def _one_reading(self) -> KanjiDetails:
        if not self.onyomi and not self.kunyomi:
            raise ValueError("a kanji needs at least one onyomi or kunyomi reading")
        return self


class GrammarExample(BaseModel):
    ja: str  # grammar part marked with [brackets]
    translation: str = ""


class GrammarDetails(BaseModel):
    pattern: str = ""
    explanation_md: str = ""
    examples: list[GrammarExample] = []

    @property
    def reviewable_examples(self) -> list[int]:
        return [i for i, e in enumerate(self.examples) if is_marked(e.ja)]


DETAILS_MODEL = {Kind.vocabulary: VocabularyDetails, Kind.kanji: KanjiDetails, Kind.grammar: GrammarDetails}


class ItemIn(BaseModel):
    kind: Kind
    text: str = Field(min_length=1, max_length=500)
    reading_kana: str = ""
    romaji: str = ""
    primary_meaning: str = Field(min_length=1)
    alt_meanings: list[str] = []
    word_type: str | None = None
    categories: list[str] = []
    details: dict = {}
    note: str = ""
    source: str = ""

    @model_validator(mode="after")
    def _check(self) -> ItemIn:
        if len(self.alt_meanings) > MAX_ALT_MEANINGS:
            raise ValueError(f"at most {MAX_ALT_MEANINGS} alternative meanings")
        if self.kind is Kind.vocabulary:
            if not self.reading_kana or not self.romaji:
                raise ValueError("vocabulary needs reading_kana and romaji")
            if self.word_type and self.word_type not in WORD_TYPES:
                raise ValueError(f"word_type must be one of {', '.join(WORD_TYPES)}")
        else:
            self.word_type = None
        self.details = DETAILS_MODEL[self.kind].model_validate(self.details).model_dump()
        return self


class ItemPatch(BaseModel):
    text: str | None = None
    reading_kana: str | None = None
    romaji: str | None = None
    primary_meaning: str | None = None
    alt_meanings: list[str] | None = None
    word_type: str | None = None
    categories: list[str] | None = None
    details: dict | None = None
    note: str | None = None


class ItemSummary(BaseModel):
    id: uuid.UUID
    kind: Kind
    type: str
    text: str
    reading_kana: str
    romaji: str
    primary_meaning: str
    stage: int | None
    next_review_at: datetime | None
    categories: list[str]
    pattern: str = ""  # grammar only


class ItemOut(ItemSummary):
    word_type: str | None
    alt_meanings: list[str]
    user_synonyms: list[str]
    details: dict
    note: str
    source: str
    created_at: datetime
    answers: int = 0
    accuracy: float | None = None
    kanji_links: list[ItemSummary] = []  # vocabulary -> its kanji; kanji -> words that use it
    reviewable: bool = True
    lesson_passes: int = 0  # stage 0 only: completed passes out of 3


# ---------- sessions ----------

class Prompt(BaseModel):
    text: str  # what is shown in the practice square
    hint: str = ""  # e.g. the translation for a cloze
    highlight: str = ""  # name_pattern: the marked part


class Question(BaseModel):
    item_id: uuid.UUID
    kind: Kind
    type: str
    direction: Direction
    question_kind: QuestionKind
    prompt: Prompt
    stage: int | None
    example_index: int | None = None


class AnswerIn(BaseModel):
    item_id: uuid.UUID
    session_type: SessionType
    direction: Direction
    question_kind: QuestionKind
    answer: str = ""
    skipped: bool = False
    response_ms: int | None = None
    example_index: int | None = None


class LessonState(BaseModel):
    passes: int
    directions_done: list[Direction]
    graduated: bool


class AnswerOut(BaseModel):
    event_id: int
    correct: bool
    exact: bool
    note: str | None
    expected: list[str]  # what to show as the right answer
    your_answer: str
    stage_before: int | None
    stage_after: int | None
    next_review_at: datetime | None
    lesson: LessonState | None = None
    can_accept: bool = False  # "My answer was right" is offered


class AcceptOut(BaseModel):
    stage_after: int | None
    next_review_at: datetime | None
    added_synonym: str | None
