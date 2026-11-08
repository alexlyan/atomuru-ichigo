from datetime import UTC, datetime, timedelta

import pytest

from app.core import answers, grammar, importer, kana, srs
from app.core.answers import Tolerance
from app.core.types import Kind

NOW = datetime(2026, 11, 7, 9, 0, tzinfo=UTC)


# ---------- kana ----------

@pytest.mark.parametrize(
    "romaji,expected",
    [
        ("taberu", "たべる"),
        ("motomeru", "もとめる"),
        ("shinbun", "しんぶん"),
        ("sinbun", "しんぶん"),
        ("konnichiwa", "こんにちわ"),
        ("kitte", "きって"),
        ("matcha", "まっちゃ"),
        ("tōkyō", "とうきょう"),
        ("ryokou", "りょこう"),
        ("ten'in", "てんいん"),
        ("jisho", "じしょ"),
        ("zyusho", "じゅしょ"),
    ],
)
def test_romaji_to_hiragana(romaji, expected):
    assert kana.romaji_to_hiragana(romaji) == expected


def test_katakana_to_hiragana_keeps_long_mark():
    assert kana.to_hiragana("パーティー") == "ぱーてぃー"


def test_hiragana_to_romaji_round_trip():
    for word in ["たべる", "しんぶん", "きって", "じしょ", "ちゃいろ", "つくえ"]:
        assert kana.romaji_to_hiragana(kana.hiragana_to_romaji(word)) == word


def test_fold_long_vowels():
    assert kana.fold_long_vowels("とうきょう") == kana.fold_long_vowels("ときょ")
    assert kana.fold_long_vowels("せんせい") == kana.fold_long_vowels("せんせ")


# ---------- answers ----------

def test_meaning_exact_and_split():
    v = answers.check_meaning("кушать", ["есть, кушать"])
    assert v.correct and v.exact


def test_meaning_alt_and_infinitive_marker():
    v = answers.check_meaning("want something", ["to request something", "to want something"])
    assert v.correct and v.exact


def test_meaning_typo_tolerated():
    v = answers.check_meaning("to requets something", ["to request something"])
    assert v.correct and not v.exact and v.note == "typo"


def test_meaning_wrong():
    assert not answers.check_meaning("easy", ["difficult", "hard"]).correct


def test_meaning_strict_rejects_typo():
    assert not answers.check_meaning("dificult", ["difficult"], Tolerance.strict).correct


def test_meaning_yo_normalised():
    assert answers.check_meaning("елка", ["ёлка"]).exact


def test_japanese_romaji_hiragana_katakana():
    for typed in ["motomeru", "もとめる", "モトメル"]:
        v = answers.check_japanese(typed, ["もとめる"], ["求める"])
        assert v.correct and v.exact, typed


def test_japanese_written_form():
    assert answers.check_japanese("求める", ["もとめる"], ["求める"]).exact


def test_japanese_typo():
    v = answers.check_japanese("motomeuru", ["もとめる"])
    assert v.correct and v.note == "typo"


def test_japanese_short_word_no_typo_allowance():
    assert not answers.check_japanese("hachi", ["はし"]).correct


def test_japanese_long_vowel_slip():
    v = answers.check_japanese("tokyo", ["とうきょう"])
    assert v.correct and v.note == "long_vowel"


def test_japanese_katakana_reading():
    v = answers.check_japanese("paatii", ["パーティー"], romaji=["paatii"])
    assert v.correct and v.exact
    assert answers.check_japanese("パーティー", ["パーティー"], romaji=["paatii"]).exact
    assert answers.check_japanese("pati", ["パーティー"], romaji=["paatii"]).note == "long_vowel"


def test_japanese_wrong():
    assert not answers.check_japanese("mitomeru", ["もとめる"], tolerance=Tolerance.strict).correct


# ---------- srs ----------

def test_review_up_and_down():
    up = srs.apply_review(4, True, NOW)
    assert (up.stage_after, up.next_review_at) == (5, NOW + timedelta(days=14))
    down = srs.apply_review(4, False, NOW)
    assert (down.stage_after, down.next_review_at) == (3, NOW + timedelta(days=3))


def test_review_bounds():
    assert srs.apply_review(7, True, NOW).stage_after == 7
    assert srs.apply_review(7, True, NOW).next_review_at == NOW + timedelta(days=60)
    assert srs.apply_review(1, False, NOW).stage_after == 1


def test_lesson_three_passes_graduate():
    passes, done = 0, 0
    for _ in range(3):
        o = srs.apply_lesson_answer(passes, done, srs.Direction.to_meaning, True, NOW)
        o = srs.apply_lesson_answer(o.passes, o.directions_done, srs.Direction.to_japanese, True, NOW)
        passes, done = o.passes, o.directions_done
    assert o.graduated and o.next_review_at == NOW + timedelta(hours=12)


def test_lesson_wrong_clears_direction_keeps_passes():
    o = srs.apply_lesson_answer(1, int(srs.Direction.to_meaning), srs.Direction.to_meaning, False, NOW)
    assert o.passes == 1 and o.directions_done == 0 and not o.graduated


def test_lesson_same_direction_twice_is_not_a_pass():
    o = srs.apply_lesson_answer(0, 0, srs.Direction.to_meaning, True, NOW)
    o = srs.apply_lesson_answer(o.passes, o.directions_done, srs.Direction.to_meaning, True, NOW)
    assert o.passes == 0


# ---------- grammar ----------

def test_parse_marked():
    m = grammar.parse_marked("コンビニへパンを[かいに]行きます。")
    assert m.target == "かいに"
    assert m.cloze == "コンビニへパンを＿＿＿行きます。"
    assert m.plain == "コンビニへパンをかいに行きます。"


@pytest.mark.parametrize("bad", ["no marks", "[a] and [b]", "[]", "open [only"])
def test_parse_marked_rejects(bad):
    assert not grammar.is_marked(bad)


# ---------- importer ----------

def rows(*items):
    return [dict(zip(importer.TEMPLATES[Kind.vocabulary], r, strict=False)) for r in items]


def test_import_vocabulary_statuses():
    res = importer.validate(
        Kind.vocabulary,
        rows(
            ("求める", "motomeru", "to request; to want", "verb", "transitive"),
            ("難しい", "muzukashii", "difficult; hard", "i-adjective", ""),
            ("たべる", "tabelu", "to eat", "verb", ""),
            ("abc", "abc", "test", "", ""),
            ("話す", "hanasu", "a;b;c;d;e;f;g", "verb", ""),
            ("静か", "shizuka", "quiet", "adjective", ""),
        ),
        existing={"難しい"},
    )
    assert [r.status for r in res] == [
        importer.RowStatus.new,
        importer.RowStatus.update,
        importer.RowStatus.warning,
        importer.RowStatus.error,
        importer.RowStatus.error,
        importer.RowStatus.error,
    ]
    assert res[0].data["reading_kana"] == "もとめる"
    assert res[0].data["alt_meanings"] == ["to want"]
    assert res[0].data["categories"] == ["transitive"]


def test_import_missing_columns():
    with pytest.raises(importer.FileError):
        importer.validate(Kind.vocabulary, [{"japanese": "猫"}], set())


def test_import_kanji():
    res = importer.validate(
        Kind.kanji,
        [{"character": "山", "meaning": "mountain", "onyomi": "サン", "kunyomi": "やま"},
         {"character": "山川", "meaning": "x", "onyomi": "", "kunyomi": ""}],
        set(),
    )
    assert res[0].status == importer.RowStatus.new
    assert res[0].data["details"] == {"onyomi": ["サン"], "kunyomi": ["やま"]}
    assert res[1].status == importer.RowStatus.error


def test_read_csv_with_bom():
    content = "﻿japanese,romaji,meaning\n猫,neko,cat\n".encode()
    assert importer.read_table("x.csv", content) == [{"japanese": "猫", "romaji": "neko", "meaning": "cat"}]
