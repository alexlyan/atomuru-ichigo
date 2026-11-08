"""Turn items into questions and check answers against them."""

from __future__ import annotations

import random

from app.core import answers as ans
from app.core.grammar import MarkError, parse_marked, strip_marks
from app.core.kana import is_kana_only
from app.core.types import Kind
from app.models import Item
from app.schemas import Direction, GrammarDetails, Prompt, Question


def meanings_of(item: Item) -> list[str]:
    return [item.primary_meaning, *item.alt_meanings, *item.user_synonyms]


def kanji_readings(item: Item) -> list[str]:
    """Onyomi and kunyomi; a kunyomi like た.べる is accepted whole or as its stem."""
    d = item.details or {}
    out: list[str] = []
    for r in [*d.get("onyomi", []), *d.get("kunyomi", [])]:
        r = r.replace("-", "")
        out.append(r.replace(".", ""))
        if "." in r:
            out.append(r.split(".")[0])
    return out


def reviewable_examples(item: Item) -> list[int]:
    if item.kind != Kind.grammar.value:
        return []
    return GrammarDetails.model_validate(item.details or {}).reviewable_examples


def is_reviewable(item: Item) -> bool:
    """Grammar needs at least one marked example (BRD: Grammar reviews)."""
    return item.kind != Kind.grammar.value or bool(reviewable_examples(item))


def pick_direction(preference: str, rng: random.Random) -> Direction:
    if preference in ("to_meaning", "to_japanese"):
        return preference  # type: ignore[return-value]
    return rng.choice(["to_meaning", "to_japanese"])


def build_question(item: Item, direction: Direction, rng: random.Random | None = None) -> Question:
    rng = rng or random.Random()
    kind = Kind(item.kind)
    base = {"item_id": item.id, "kind": kind, "type": item.type, "direction": direction, "stage": item.stage}

    if kind is Kind.grammar:
        examples = (item.details or {}).get("examples", [])
        marked = reviewable_examples(item)
        if not marked:
            raise ValueError("this grammar entry has no marked example sentence")
        idx = rng.choice(marked)
        ex = examples[idx]
        sentence = parse_marked(ex["ja"])
        if direction == "to_japanese":
            return Question(**base, question_kind="cloze", example_index=idx,
                            prompt=Prompt(text=sentence.cloze, hint=ex.get("translation", "")))
        return Question(**base, question_kind="name_pattern", example_index=idx,
                        prompt=Prompt(text=sentence.plain, highlight=sentence.target))

    if direction == "to_meaning":
        return Question(**base, question_kind="meaning", prompt=Prompt(text=item.text))
    hint = "Type a reading of this kanji" if kind is Kind.kanji else ""
    return Question(**base, question_kind="reading", prompt=Prompt(text=item.primary_meaning, hint=hint))


def check(item: Item, direction: Direction, question_kind: str, answer: str, tolerance: str,
          example_index: int | None) -> tuple[ans.Verdict, list[str]]:
    """Returns the verdict and the answers to display as correct."""
    tol = ans.Tolerance(tolerance)
    kind = Kind(item.kind)

    if kind is Kind.grammar:
        examples = (item.details or {}).get("examples", [])
        if question_kind == "cloze":
            try:
                target = parse_marked(examples[example_index or 0]["ja"]).target
            except (IndexError, KeyError, MarkError) as exc:
                raise ValueError("the example sentence for this question no longer exists") from exc
            readings = [target] if is_kana_only(target) else []
            verdict = ans.check_japanese(answer, readings, written_forms=[target], tolerance=tol)
            return verdict, [target]
        accepted = meanings_of(item)
        return ans.check_meaning(answer, accepted, tol), [item.primary_meaning, *item.alt_meanings]

    if direction == "to_meaning":
        return ans.check_meaning(answer, meanings_of(item), tol), [item.primary_meaning, *item.alt_meanings]

    if kind is Kind.kanji:
        readings = kanji_readings(item)
        verdict = ans.check_japanese(answer, readings, written_forms=[item.text], tolerance=tol)
        d = item.details or {}
        return verdict, [*d.get("onyomi", []), *d.get("kunyomi", [])]

    verdict = ans.check_japanese(answer, [item.reading_kana], written_forms=[item.text], tolerance=tol,
                                 romaji=[item.romaji])
    return verdict, [item.reading_kana, item.romaji]


def plain_example(sentence: str) -> str:
    return strip_marks(sentence)
