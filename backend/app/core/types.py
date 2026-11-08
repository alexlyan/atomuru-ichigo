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

# The single Types list shown to the user: six groups. Detailed word types stay in the data
# (an i-adjective is still an i-adjective) but filters and statistics use the groups.
TYPES: tuple[str, ...] = ("verb", "noun", "adjective", "other", "kanji", "grammar")

TYPE_GROUPS: dict[str, tuple[str, ...]] = {
    "verb": ("verb",),
    "noun": ("noun",),
    "adjective": ("i-adjective", "na-adjective"),
    "other": ("adverb", "particle", "expression", "pronoun", "question-word", "conjunction"),
}
_GROUP_OF = {wt: group for group, wts in TYPE_GROUPS.items() for wt in wts}


def group_of(detailed_type: str | None) -> str:
    """'i-adjective' -> 'adjective'; 'kanji' and 'grammar' map to themselves; no word type counts as noun."""
    if detailed_type in ("kanji", "grammar"):
        return detailed_type
    return _GROUP_OF.get(detailed_type or "noun", "other")

MAX_ALT_MEANINGS = 5


def type_of(kind: Kind, word_type: str | None) -> str:
    if kind is Kind.vocabulary:
        return word_type or "noun"
    return kind.value
