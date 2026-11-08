"""Item kinds and the user-facing Types list (BRD: Item structure)."""

from enum import Enum


class Kind(str, Enum):
    vocabulary = "vocabulary"
    kanji = "kanji"
    grammar = "grammar"


# Word types a vocabulary item can have.
WORD_TYPES: tuple[str, ...] = (
    "verb",
    "noun",
    "i-adjective",
    "na-adjective",
    "adverb",
    "particle",
    "expression",
    "pronoun",
    "question-word",
    "conjunction",
)

# The single Types list shown to the user: word types plus kanji and grammar.
TYPES: tuple[str, ...] = WORD_TYPES + ("kanji", "grammar")

MAX_ALT_MEANINGS = 5


def type_of(kind: Kind, word_type: str | None) -> str:
    if kind is Kind.vocabulary:
        return word_type or "noun"
    return kind.value
