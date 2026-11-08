"""Grammar example sentences: the grammar part is marked with [square brackets].

コンビニへパンを[かいに]行きます。 -> blank "かいに" for fill-in-the-blank reviews.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_MARK = re.compile(r"\[([^\[\]]+)\]")
BLANK = "＿＿＿"


@dataclass(frozen=True)
class MarkedSentence:
    before: str
    target: str
    after: str

    @property
    def plain(self) -> str:
        return f"{self.before}{self.target}{self.after}"

    @property
    def cloze(self) -> str:
        return f"{self.before}{BLANK}{self.after}"


class MarkError(ValueError):
    pass


def parse_marked(sentence: str) -> MarkedSentence:
    marks = list(_MARK.finditer(sentence or ""))
    if len(marks) != 1:
        raise MarkError(f"expected exactly one [marked] part, found {len(marks)}")
    m = marks[0]
    target = m.group(1).strip()
    if not target:
        raise MarkError("the [marked] part is empty")
    rest = sentence[: m.start()] + sentence[m.end() :]
    if "[" in rest or "]" in rest:
        raise MarkError("unbalanced brackets")
    return MarkedSentence(sentence[: m.start()], target, sentence[m.end() :])


def is_marked(sentence: str) -> bool:
    try:
        parse_marked(sentence)
        return True
    except MarkError:
        return False


def strip_marks(sentence: str) -> str:
    return sentence.replace("[", "").replace("]", "")
