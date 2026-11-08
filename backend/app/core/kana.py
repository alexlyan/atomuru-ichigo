"""Kana and romaji helpers.

Everything the answer checker needs to compare Japanese answers typed as romaji,
hiragana or katakana. No external dependencies, so it is easy to test.
"""

from __future__ import annotations

import re
import unicodedata

KATAKANA_START, KATAKANA_END = 0x30A1, 0x30F6
HIRAGANA_OFFSET = 0x60

JAPANESE_CHAR = re.compile(r"[぀-ヿ㐀-䶿一-鿿々ー]")
KANA_ONLY = re.compile(r"^[぀-ゟ゠-ヿー\s]+$")
LATIN = re.compile(r"[a-zA-ZÀ-ɏ]")


def has_japanese(text: str) -> bool:
    return bool(JAPANESE_CHAR.search(text or ""))


def is_kana_only(text: str) -> bool:
    return bool(KANA_ONLY.match(text or ""))


def has_latin(text: str) -> bool:
    return bool(LATIN.search(text or ""))


def to_hiragana(text: str) -> str:
    """Katakana to hiragana. Other characters (including ー) are kept."""
    out = []
    for ch in text:
        code = ord(ch)
        if KATAKANA_START <= code <= KATAKANA_END:
            out.append(chr(code - HIRAGANA_OFFSET))
        else:
            out.append(ch)
    return "".join(out)


# Romaji to hiragana. Hepburn and Kunrei spellings are both accepted.
_TABLE: dict[str, str] = {
    "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
    "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
    "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
    "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
    "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
    "sa": "さ", "shi": "し", "si": "し", "su": "す", "se": "せ", "so": "そ",
    "sha": "しゃ", "sya": "しゃ", "shu": "しゅ", "syu": "しゅ", "sho": "しょ", "syo": "しょ", "she": "しぇ",
    "za": "ざ", "ji": "じ", "zi": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
    "ja": "じゃ", "jya": "じゃ", "zya": "じゃ", "ju": "じゅ", "jyu": "じゅ", "zyu": "じゅ",
    "jo": "じょ", "jyo": "じょ", "zyo": "じょ", "je": "じぇ",
    "ta": "た", "chi": "ち", "ti": "ち", "tsu": "つ", "tu": "つ", "te": "て", "to": "と",
    "cha": "ちゃ", "tya": "ちゃ", "cya": "ちゃ", "chu": "ちゅ", "tyu": "ちゅ", "cyu": "ちゅ",
    "cho": "ちょ", "tyo": "ちょ", "cyo": "ちょ", "che": "ちぇ",
    "da": "だ", "di": "ぢ", "du": "づ", "dzu": "づ", "de": "で", "do": "ど",
    "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
    "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
    "ha": "は", "hi": "ひ", "fu": "ふ", "hu": "ふ", "he": "へ", "ho": "ほ",
    "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
    "fa": "ふぁ", "fi": "ふぃ", "fe": "ふぇ", "fo": "ふぉ",
    "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
    "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
    "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
    "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
    "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
    "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
    "ya": "や", "yu": "ゆ", "yo": "よ",
    "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
    "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
    "la": "ら", "li": "り", "lu": "る", "le": "れ", "lo": "ろ",
    "wa": "わ", "wo": "を", "wi": "うぃ", "we": "うぇ",
    "va": "ゔぁ", "vi": "ゔぃ", "vu": "ゔ", "ve": "ゔぇ", "vo": "ゔぉ",
    "-": "ー",
}
_MACRONS = {"ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "ou", "â": "aa", "î": "ii", "û": "uu", "ê": "ee", "ô": "ou"}
_VOWELS = set("aiueo")


def romaji_to_hiragana(text: str) -> str:
    s = unicodedata.normalize("NFC", text.strip().lower())
    s = "".join(_MACRONS.get(ch, ch) for ch in s)
    s = re.sub(r"\s+", "", s)
    out: list[str] = []
    i = 0
    while i < len(s):
        ch = s[i]
        nxt = s[i + 1] if i + 1 < len(s) else ""
        # n / nn / n' as ん
        if ch == "n":
            if nxt == "'":
                out.append("ん")
                i += 2
                continue
            if nxt == "n":
                out.append("ん")
                # "nn" followed by a vowel is ambiguous (konnichiwa); treat second n as the start of the next syllable
                if i + 2 < len(s) and (s[i + 2] in _VOWELS or s[i + 2] == "y"):
                    i += 1
                else:
                    i += 2
                continue
            if nxt == "" or (nxt not in _VOWELS and nxt != "y"):
                out.append("ん")
                i += 1
                continue
        # small tsu for doubled consonants (kk, tt, ss, pp, tch)
        if ch.isalpha() and ch not in _VOWELS and ch != "n" and nxt == ch:
            out.append("っ")
            i += 1
            continue
        if ch == "t" and s[i + 1 : i + 3] == "ch":
            out.append("っ")
            i += 1
            continue
        for size in (3, 2, 1):
            chunk = s[i : i + size]
            if chunk in _TABLE:
                out.append(_TABLE[chunk])
                i += size
                break
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def any_to_hiragana(text: str) -> str:
    """Convert a typed answer (romaji, hiragana or katakana) to hiragana."""
    t = unicodedata.normalize("NFKC", text or "").strip()
    if has_latin(t):
        return romaji_to_hiragana(t)
    return to_hiragana(t).replace(" ", "").replace("　", "")


_LONG_VOWEL_RULES = [
    (re.compile(r"([おこそとのほもよろごぞどぼぽょ])[うお]"), r"\1"),
    (re.compile(r"([うくすつぬふむゆるぐずづぶぷゅ])う"), r"\1"),
    (re.compile(r"([えけせてねへめれげぜでべぺ])[いえ]"), r"\1"),
    (re.compile(r"([あかさたなはまやらわがざだばぱゃ])あ"), r"\1"),
    (re.compile(r"([いきしちにひみりぎじぢびぴ])い"), r"\1"),
]


def fold_long_vowels(hira: str) -> str:
    """Remove long-vowel spelling differences (おう/おお/ー, えい/ええ ...).

    Used only to recognise near misses such as "tokyo" for とうきょう; an answer that
    matches only after folding is reported as a long-vowel slip, not as exact.
    """
    s = hira.replace("ー", "")
    for pattern, repl in _LONG_VOWEL_RULES:
        s = pattern.sub(repl, s)
    return s


def hiragana_to_romaji(text: str) -> str:
    """Hepburn romaji for display and import checks."""
    # First spelling in _TABLE wins, and Hepburn spellings are listed first.
    reverse: dict[str, str] = {}
    for rom, kana in _TABLE.items():
        reverse.setdefault(kana, rom)
    reverse.update({"を": "o", "ぢ": "ji", "づ": "zu"})
    s = to_hiragana(text)
    out: list[str] = []
    i = 0
    while i < len(s):
        if s[i] == "っ" and i + 1 < len(s):
            nxt = s[i + 1 : i + 3] if s[i + 1 : i + 3] in reverse else s[i + 1]
            rom = reverse.get(nxt, "")
            out.append("t" if rom.startswith("ch") else rom[:1])
            i += 1
            continue
        if s[i] == "ん":
            out.append("n")
            i += 1
            continue
        if s[i] == "ー" and out:
            out.append(out[-1][-1] if out[-1] and out[-1][-1] in _VOWELS else "")
            i += 1
            continue
        pair = s[i : i + 2]
        if len(pair) == 2 and pair in reverse:
            out.append(reverse[pair])
            i += 2
            continue
        out.append(reverse.get(s[i], s[i]))
        i += 1
    return "".join(out)
