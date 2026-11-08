"""Answer checking for both directions.

to_meaning:  the user types a meaning; any accepted meaning counts (primary, alternatives,
             user synonyms), with a typo tolerance.
to_japanese: the user types romaji, hiragana or katakana (or the exact written form);
             compared in hiragana, with a typo tolerance and a long-vowel slip check.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import Enum

from app.core.kana import any_to_hiragana, fold_long_vowels, to_hiragana


class Tolerance(str, Enum):
    strict = "strict"
    normal = "normal"
    forgiving = "forgiving"


@dataclass(frozen=True)
class Verdict:
    correct: bool
    exact: bool
    matched: str | None  # the accepted answer the input was matched to
    distance: int
    note: str | None  # "typo" | "long_vowel" | None

    @property
    def similarity(self) -> float:
        if self.matched is None:
            return 0.0
        longest = max(len(self.matched), 1)
        return max(0.0, 1 - self.distance / longest)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def allowed_distance(length: int, tolerance: Tolerance) -> int:
    if tolerance is Tolerance.strict:
        return 0
    if tolerance is Tolerance.normal:
        if length <= 3:
            return 0
        if length <= 6:
            return 1
        if length <= 12:
            return 2
        return length // 6
    # forgiving
    if length <= 2:
        return 0
    if length <= 4:
        return 1
    if length <= 8:
        return 2
    return length // 4


# ---------- meanings ----------

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_PARENS = re.compile(r"\([^)]*\)|（[^）]*）")
_SPLIT = re.compile(r"[;,/、；]")


def normalize_meaning(text: str) -> str:
    s = unicodedata.normalize("NFKC", text or "").lower().replace("ё", "е")
    s = _PUNCT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.removeprefix("to ")
    return s


def meaning_variants(meanings: list[str]) -> list[str]:
    """Every string a user may type for these meanings, normalised.

    "есть, кушать" accepts "есть", "кушать" and the whole phrase;
    "to request (something)" accepts it with or without the bracketed part.
    """
    out: list[str] = []
    for m in meanings:
        if not m:
            continue
        candidates = {m, _PARENS.sub(" ", m)}
        for c in tuple(candidates):  # copy: the set grows inside the loop
            candidates.update(_SPLIT.split(c))
        for c in candidates:
            n = normalize_meaning(c)
            if n and n not in out:
                out.append(n)
    return out


def check_meaning(answer: str, meanings: list[str], tolerance: Tolerance = Tolerance.normal) -> Verdict:
    given = normalize_meaning(answer)
    if not given:
        return Verdict(False, False, None, 0, None)
    best: tuple[int, str] | None = None
    for variant in meaning_variants(meanings):
        if given == variant:
            return Verdict(True, True, variant, 0, None)
        d = levenshtein(given, variant)
        if best is None or d < best[0]:
            best = (d, variant)
    if best and best[0] <= allowed_distance(len(best[1]), tolerance):
        return Verdict(True, False, best[1], best[0], "typo")
    return Verdict(False, False, best[1] if best else None, best[0] if best else 0, None)


# ---------- Japanese ----------

_ROMAJI_MACRONS = {"ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "ou"}
_ROMAJI_LONG = [("ou", "o"), ("oo", "o"), ("uu", "u"), ("aa", "a"), ("ii", "i"), ("ee", "e"), ("ei", "e")]


def normalize_romaji(text: str, fold: bool = False) -> str:
    s = unicodedata.normalize("NFC", (text or "").lower())
    s = "".join(_ROMAJI_MACRONS.get(c, c) for c in s)
    s = re.sub(r"[\s\-'’]", "", s)
    if fold:
        for long, short in _ROMAJI_LONG:
            s = s.replace(long, short)
    return s


def check_japanese(
    answer: str,
    readings: list[str],
    written_forms: list[str] | None = None,
    tolerance: Tolerance = Tolerance.normal,
    romaji: list[str] | None = None,
) -> Verdict:
    """readings: kana readings (hiragana or katakana). written_forms: e.g. 食べる, accepted verbatim.
    romaji: stored romaji spellings, used for loanwords whose katakana has no single romaji (パーティー)."""
    raw = unicodedata.normalize("NFKC", answer or "").strip()
    if not raw:
        return Verdict(False, False, None, 0, None)
    for form in written_forms or []:
        if form and raw == unicodedata.normalize("NFKC", form).strip():
            return Verdict(True, True, form, 0, None)
    if romaji and re.fullmatch(r"[a-zA-Z\s\-'’āīūēō]+", raw):
        typed = normalize_romaji(raw)
        for r in romaji:
            if r and typed == normalize_romaji(r):
                return Verdict(True, True, r, 0, None)
        if tolerance is not Tolerance.strict:
            for r in romaji:
                if r and normalize_romaji(raw, fold=True) == normalize_romaji(r, fold=True):
                    return Verdict(True, False, r, levenshtein(typed, normalize_romaji(r)), "long_vowel")

    given = any_to_hiragana(raw)
    targets = [to_hiragana(r).replace(".", "").replace("-", "").replace(" ", "") for r in readings if r]
    best: tuple[int, str] | None = None
    for target in targets:
        if given == target:
            return Verdict(True, True, target, 0, None)
        d = levenshtein(given, target)
        if best is None or d < best[0]:
            best = (d, target)

    if tolerance is not Tolerance.strict:
        folded = fold_long_vowels(given)
        for target in targets:
            if folded == fold_long_vowels(target):
                return Verdict(True, False, target, levenshtein(given, target), "long_vowel")

    if best and best[0] <= allowed_distance(len(best[1]), tolerance):
        return Verdict(True, False, best[1], best[0], "typo")
    return Verdict(False, False, best[1] if best else None, best[0] if best else 0, None)
