"""Bulk import: read CSV/XLSX and validate rows (BRD: Bulk import).

Pure functions: the caller passes the existing items for duplicate detection and
decides what to write. Nothing here touches the database.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from enum import Enum

from app.core.kana import has_japanese, has_latin, hiragana_to_romaji, is_kana_only, romaji_to_hiragana, to_hiragana
from app.core.types import MAX_ALT_MEANINGS, WORD_TYPES, Kind

MAX_ROWS = 2000
MAX_BYTES = 2_000_000

TEMPLATES: dict[Kind, list[str]] = {
    Kind.vocabulary: ["japanese", "romaji", "meaning", "type", "categories"],
    Kind.kanji: ["character", "meaning", "onyomi", "kunyomi", "categories"],
}
REQUIRED: dict[Kind, list[str]] = {
    Kind.vocabulary: ["japanese", "romaji", "meaning"],
    Kind.kanji: ["character", "meaning"],
}


class RowStatus(str, Enum):
    new = "new"
    update = "update"
    warning = "warning"
    error = "error"


@dataclass
class RowResult:
    row: int  # 1-based row number in the file, header is row 1
    status: RowStatus
    messages: list[str] = field(default_factory=list)
    data: dict | None = None  # normalised item fields when the row is importable


class FileError(ValueError):
    pass


def read_table(filename: str, content: bytes) -> list[dict[str, str]]:
    if len(content) > MAX_BYTES:
        raise FileError("The file is larger than 2 MB. Split it into smaller files.")
    name = filename.lower()
    if name.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise FileError("The file is not UTF-8. Save it as CSV UTF-8 and upload it again.") from exc
        rows = list(csv.DictReader(io.StringIO(text)))
    elif name.endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        values = list(ws.iter_rows(values_only=True))
        if not values:
            return []
        header = [str(h or "").strip() for h in values[0]]
        rows = [{header[i]: ("" if v is None else str(v)) for i, v in enumerate(r) if i < len(header)} for r in values[1:]]
    else:
        raise FileError("Upload a .csv or .xlsx file.")
    rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in rows]
    rows = [r for r in rows if any(r.values())]
    if len(rows) > MAX_ROWS:
        raise FileError(f"The file has {len(rows)} rows; the limit is {MAX_ROWS}.")
    return rows


def check_headers(kind: Kind, rows: list[dict[str, str]]) -> None:
    if not rows:
        raise FileError("The file has no rows.")
    missing = [c for c in REQUIRED[kind] if c not in rows[0]]
    if missing:
        raise FileError(f"Missing columns: {', '.join(missing)}. Download the template to see the expected columns.")


def split_list(value: str, sep: str = ";") -> list[str]:
    return [p.strip() for p in (value or "").split(sep) if p.strip()]


def validate_vocabulary(rows: list[dict[str, str]], existing: set[str]) -> list[RowResult]:
    results: list[RowResult] = []
    seen: set[str] = set()
    for idx, r in enumerate(rows, start=2):
        msgs: list[str] = []
        warns: list[str] = []
        jp, romaji, meaning = r.get("japanese", ""), r.get("romaji", ""), r.get("meaning", "")
        word_type = (r.get("type") or "").strip().lower() or None
        for col in REQUIRED[Kind.vocabulary]:
            if not r.get(col):
                msgs.append(f"{col} is empty")
        if jp and not has_japanese(jp):
            msgs.append("japanese has no Japanese characters")
        if romaji and (has_japanese(romaji) or not has_latin(romaji)):
            msgs.append("romaji must be written in Latin letters")
        meanings = split_list(meaning)
        if len(meanings) > 1 + MAX_ALT_MEANINGS:
            msgs.append(f"{len(meanings) - 1} alternative meanings, the limit is {MAX_ALT_MEANINGS}")
        if word_type and word_type not in WORD_TYPES:
            msgs.append(f'type "{word_type}" is not one of: {", ".join(WORD_TYPES)}')
        if jp in seen:
            msgs.append("the same word appears earlier in this file")

        reading = ""
        if jp and romaji and not msgs:
            reading = to_hiragana(jp) if is_kana_only(jp) else romaji_to_hiragana(romaji)
            if is_kana_only(jp):
                generated = hiragana_to_romaji(jp)
                if generated.replace(" ", "") != romaji.lower().replace(" ", ""):
                    warns.append(f'romaji looks like "{generated}"')
            if not is_kana_only(reading):
                msgs.append("romaji could not be read as Japanese syllables")

        if msgs:
            results.append(RowResult(idx, RowStatus.error, msgs))
            continue
        seen.add(jp)
        data = {
            "kind": Kind.vocabulary.value,
            "text": jp,
            "reading_kana": reading,
            "romaji": romaji.lower(),
            "primary_meaning": meanings[0],
            "alt_meanings": meanings[1:],
            "word_type": word_type,
            "categories": split_list(r.get("categories", ""), ","),
        }
        status = RowStatus.update if jp in existing else (RowStatus.warning if warns else RowStatus.new)
        results.append(RowResult(idx, status, warns, data))
    return results


def validate_kanji(rows: list[dict[str, str]], existing: set[str]) -> list[RowResult]:
    results: list[RowResult] = []
    seen: set[str] = set()
    for idx, r in enumerate(rows, start=2):
        msgs: list[str] = []
        ch, meaning = r.get("character", ""), r.get("meaning", "")
        on, kun = split_list(r.get("onyomi", ""), ","), split_list(r.get("kunyomi", ""), ",")
        if not ch:
            msgs.append("character is empty")
        elif len(ch) != 1 or not has_japanese(ch):
            msgs.append("character must be a single kanji")
        if not meaning:
            msgs.append("meaning is empty")
        if not on and not kun:
            msgs.append("give at least one reading (onyomi or kunyomi)")
        for reading in on + kun:
            if not is_kana_only(reading.replace(".", "").replace("-", "")):
                msgs.append(f'reading "{reading}" must be written in kana')
        meanings = split_list(meaning)
        if len(meanings) > 1 + MAX_ALT_MEANINGS:
            msgs.append(f"{len(meanings) - 1} alternative meanings, the limit is {MAX_ALT_MEANINGS}")
        if ch in seen:
            msgs.append("the same kanji appears earlier in this file")
        if msgs:
            results.append(RowResult(idx, RowStatus.error, msgs))
            continue
        seen.add(ch)
        data = {
            "kind": Kind.kanji.value,
            "text": ch,
            "reading_kana": to_hiragana((kun or on)[0]).replace(".", "").replace("-", ""),
            "romaji": hiragana_to_romaji((kun or on)[0].replace(".", "").replace("-", "")),
            "primary_meaning": meanings[0],
            "alt_meanings": meanings[1:],
            "word_type": None,
            "categories": split_list(r.get("categories", ""), ","),
            "details": {"onyomi": on, "kunyomi": kun},
        }
        results.append(RowResult(idx, RowStatus.update if ch in existing else RowStatus.new, [], data))
    return results


def validate(kind: Kind, rows: list[dict[str, str]], existing: set[str]) -> list[RowResult]:
    check_headers(kind, rows)
    if kind is Kind.vocabulary:
        return validate_vocabulary(rows, existing)
    if kind is Kind.kanji:
        return validate_kanji(rows, existing)
    raise FileError("Bulk import supports vocabulary and kanji. Add grammar entries one at a time.")


def template_csv(kind: Kind) -> str:
    examples = {
        Kind.vocabulary: ["求める", "motomeru", "to request something; to want something", "verb", "transitive, JLPT N4"],
        Kind.kanji: ["山", "mountain", "サン", "やま", "lesson 1"],
    }
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(TEMPLATES[kind])
    w.writerow(examples[kind])
    return buf.getvalue()
