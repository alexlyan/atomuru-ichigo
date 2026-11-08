"""Staged SRS rules (see BRD: Staged SRS).

stage None  not started (waiting in the learn queue)
stage 0     being learned: needs STAGE0_PASSES passes; one pass = both directions correct
stage 1..7  reviews; correct = +1 (7 stays 7), wrong = -1 (minimum 1)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import IntFlag

MAX_STAGE = 7
STAGE0_PASSES = 3

# Hours until the next review after reaching each stage. Stage 7 repeats every 60 days.
DEFAULT_INTERVALS_HOURS: dict[int, int] = {1: 12, 2: 24, 3: 72, 4: 168, 5: 336, 6: 720, 7: 1440}


class Direction(IntFlag):
    to_meaning = 1
    to_japanese = 2


BOTH = Direction.to_meaning | Direction.to_japanese


def interval_for(stage: int, intervals: dict[int, int] | None = None) -> timedelta:
    table = intervals or DEFAULT_INTERVALS_HOURS
    return timedelta(hours=table[stage])


@dataclass(frozen=True)
class ReviewOutcome:
    stage_before: int
    stage_after: int
    next_review_at: datetime


def apply_review(stage: int, correct: bool, now: datetime, intervals: dict[int, int] | None = None) -> ReviewOutcome:
    if not 1 <= stage <= MAX_STAGE:
        raise ValueError(f"reviews apply to stages 1..{MAX_STAGE}, got {stage}")
    new_stage = min(stage + 1, MAX_STAGE) if correct else max(stage - 1, 1)
    return ReviewOutcome(stage, new_stage, now + interval_for(new_stage, intervals))


@dataclass(frozen=True)
class LessonOutcome:
    passes: int
    directions_done: int  # Direction flags answered correctly in the current pass
    graduated: bool  # moved to stage 1
    next_review_at: datetime | None


def apply_lesson_answer(
    passes: int,
    directions_done: int,
    direction: Direction,
    correct: bool,
    now: datetime,
    intervals: dict[int, int] | None = None,
) -> LessonOutcome:
    """Stage 0. A wrong answer clears that direction in the current pass; completed passes stay."""
    done = Direction(directions_done)
    if not correct:
        return LessonOutcome(passes, int(done & ~direction), False, None)
    done |= direction
    if done == BOTH:
        passes += 1
        done = Direction(0)
    if passes >= STAGE0_PASSES:
        return LessonOutcome(STAGE0_PASSES, 0, True, now + interval_for(1, intervals))
    return LessonOutcome(passes, int(done), False, None)


def undo_wrong_review(stage_before: int, now: datetime, intervals: dict[int, int] | None = None) -> ReviewOutcome:
    """"My answer was right": recompute the outcome as if the answer had been correct."""
    return apply_review(stage_before, True, now, intervals)
