from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.db import SessionLocal
from app.models import Item

W = "/api/w/ja"

VERB = {
    "kind": "vocabulary", "text": "求める", "reading_kana": "もとめる", "romaji": "motomeru",
    "primary_meaning": "to request something", "alt_meanings": ["to want something"],
    "word_type": "verb", "categories": ["transitive"],
}
ADJ = {
    "kind": "vocabulary", "text": "難しい", "reading_kana": "むずかしい", "romaji": "muzukashii",
    "primary_meaning": "difficult", "alt_meanings": ["hard"], "word_type": "i-adjective",
}
GRAMMAR = {
    "kind": "grammar", "text": "Цель движения: глагол + に", "primary_meaning": "идти куда-то с целью",
    "details": {"pattern": "основа ます + に + 行きます", "explanation_md": "**rule**",
                "examples": [{"ja": "コンビニへパンを[かいに]行きます。", "translation": "Пойду купить хлеб."}]},
}
KANJI = {
    "kind": "kanji", "text": "求", "reading_kana": "もと", "romaji": "moto", "primary_meaning": "request",
    "details": {"onyomi": ["キュウ"], "kunyomi": ["もと.める"]},
}


def add(client, body):
    r = client.post(f"{W}/items", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def set_item(item_id, **values):
    with SessionLocal() as db:
        db.execute(update(Item).where(Item.id == item_id).values(**values))
        db.commit()


def answer(client, q, text, session="review"):
    body = {"item_id": q["item_id"], "session_type": session, "direction": q["direction"],
            "question_kind": q["question_kind"], "answer": text, "example_index": q.get("example_index")}
    r = client.post(f"{W}/answers", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_me_has_japanese_workspace(client):
    me = client.get("/api/me").json()
    assert me["active_language"] == "ja"
    assert [w["language"] for w in me["workspaces"]] == ["ja"]
    assert "grammar" in me["types"]
    assert {lang["language"] for lang in me["available_languages"]} == {"ky", "ar"}
    assert client.post("/api/workspaces", json={"language": "ar"}).status_code == 409  # coming soon


def test_duplicate_and_kanji_links(client):
    verb = add(client, VERB)
    assert client.post(f"{W}/items", json=VERB).status_code == 409
    kanji = add(client, KANJI)
    detail = client.get(f"{W}/items/{verb['id']}").json()
    assert [k["text"] for k in detail["kanji_links"]] == ["求"]
    assert [w["text"] for w in client.get(f"{W}/items/{kanji['id']}").json()["kanji_links"]] == ["求める"]


def test_library_types_filter_and_counts(client):
    add(client, VERB); add(client, ADJ); add(client, GRAMMAR); add(client, KANJI)
    lib = client.get(f"{W}/items", params={"types": "i-adjective,grammar"}).json()
    assert sorted(i["type"] for i in lib["items"]) == ["grammar", "i-adjective"]
    assert lib["counts"] == {"all": 4, "vocabulary": 2, "kanji": 1, "grammar": 1}
    assert client.get(f"{W}/items", params={"q": "muzu"}).json()["total"] == 1
    assert client.get(f"{W}/items", params={"types": "bogus"}).status_code == 422


def test_lessons_graduate_after_three_passes(client):
    verb = add(client, VERB)
    queue = client.get(f"{W}/learn/queue").json()
    assert [i["text"] for i in queue["new"]] == ["求める"]
    client.post(f"{W}/learn/start", json={"item_ids": [verb["id"]]})
    for _ in range(3):
        qs = client.post(f"{W}/learn/questions", json={"item_ids": [verb["id"]]}).json()
        assert {q["direction"] for q in qs} == {"to_meaning", "to_japanese"}
        for q in qs:
            res = answer(client, q, "want something" if q["direction"] == "to_meaning" else "もとめる", "learn")
            assert res["correct"]
    assert res["lesson"]["graduated"] and res["stage_after"] == 1
    assert client.get(f"{W}/learn/queue").json()["learned_today"] == 1


def test_review_down_then_accept(client):
    adj = add(client, ADJ)
    set_item(adj["id"], stage=4, next_review_at=datetime.now(UTC) - timedelta(hours=1))
    qs = client.get(f"{W}/review/queue").json()
    assert len(qs) == 1
    q = {**qs[0], "direction": "to_meaning", "question_kind": "meaning"}
    res = answer(client, q, "tough")
    assert not res["correct"] and res["stage_after"] == 3 and res["can_accept"]
    acc = client.post(f"{W}/answers/{res['event_id']}/accept").json()
    assert acc["stage_after"] == 5 and acc["added_synonym"] == "tough"
    assert client.post(f"{W}/answers/{res['event_id']}/accept").status_code == 409
    assert "tough" in client.get(f"{W}/items/{adj['id']}").json()["user_synonyms"]


def test_practice_never_changes_stage(client):
    adj = add(client, ADJ)
    set_item(adj["id"], stage=2, next_review_at=datetime.now(UTC) + timedelta(days=1))
    assert client.get(f"{W}/practice/count", params={"types": "i-adjective"}).json() == {"count": 1}
    qs = client.get(f"{W}/practice/queue", params={"types": "i-adjective", "direction": "to_japanese"}).json()
    res = answer(client, qs[0], "wrong answer", "practice")
    assert not res["correct"] and res["stage_after"] == 2
    prog = client.get(f"{W}/progress").json()
    row = next(r for r in prog["by_type"] if r["type"] == "adjective")
    assert row["practice"] == 0 and row["review"] is None


def test_grammar_cloze(client):
    g = add(client, GRAMMAR)
    set_item(g["id"], stage=1, next_review_at=datetime.now(UTC) - timedelta(minutes=1))
    qs = client.get(f"{W}/review/queue").json()
    q = qs[0]
    if q["question_kind"] == "cloze":
        assert "＿" in q["prompt"]["text"] and q["prompt"]["hint"]
        assert answer(client, q, "kaini")["correct"]
    else:
        assert q["prompt"]["highlight"] == "かいに"
        assert answer(client, q, "идти куда-то с целью")["correct"]


def test_skip_changes_nothing(client):
    adj = add(client, ADJ)
    set_item(adj["id"], stage=3, next_review_at=datetime.now(UTC) - timedelta(minutes=1))
    q = client.get(f"{W}/review/queue").json()[0]
    r = client.post(f"{W}/answers", json={**{k: q[k] for k in ("item_id", "direction", "question_kind")},
                                           "session_type": "review", "skipped": True}).json()
    assert r["note"] == "skipped" and r["stage_after"] == 3


def test_import_preview_commit_undo(client):
    csv = "japanese,romaji,meaning,type\n猫,neko,кошка,noun\n犬,inu,собака; пёс,noun\nabc,abc,x,\n"
    r = client.post(f"{W}/imports", files={"file": ("words.csv", csv.encode(), "text/csv")}, data={"kind": "vocabulary"})
    assert r.status_code == 201, r.text
    batch = r.json()
    assert batch["counts"] == {"new": 2, "update": 0, "warning": 0, "error": 1}
    assert client.get(f"{W}/items").json()["total"] == 0  # nothing written before confirm
    done = client.post(f"{W}/imports/{batch['id']}/commit").json()
    assert done["status"] == "committed"
    assert client.post(f"{W}/imports/{batch['id']}/commit").status_code == 200  # double click is harmless
    assert client.get(f"{W}/items").json()["total"] == 2
    assert client.post(f"{W}/imports/{batch['id']}/undo").json() == {"removed": 2}
    assert client.get(f"{W}/items").json()["total"] == 0


def test_import_rejects_bad_file(client):
    r = client.post(f"{W}/imports", files={"file": ("w.txt", b"x", "text/plain")}, data={"kind": "vocabulary"})
    assert r.status_code == 422


def test_today_shape(client):
    add(client, VERB)
    t = client.get(f"{W}/today").json()
    assert t["new_available"] == 1 and t["next_up"] == ["求める"]
    assert len(t["forecast"]) == 12 and t["distribution"]["not_started"] == 1


def test_settings_roundtrip(client):
    s = client.get(f"{W}/settings").json()
    s["new_per_day"] = 3
    s["after_answer"] = "advance_if_correct"
    assert client.put(f"{W}/settings", json=s).json()["new_per_day"] == 3
    s["intervals_hours"] = {"1": 12}
    assert client.put(f"{W}/settings", json=s).status_code == 422


def test_categories_and_prioritize(client):
    a = add(client, {**VERB, "categories": ["Урок 8", "verbs, motion"]})
    b = add(client, {**ADJ, "categories": ["Урок 10"]})
    c = add(client, {**KANJI, "categories": ["kanji lesson 1"]})
    cats = client.get(f"{W}/categories", params={"stages": "new"}).json()
    assert [x["name"] for x in cats][:3] == ["kanji lesson 1", "Урок 8", "Урок 10"]
    # a category name containing a comma still filters, because the list separator is "|"
    q = client.get(f"{W}/learn/queue", params={"categories": "verbs, motion|Урок 10"}).json()
    assert sorted(i["text"] for i in q["new"]) == ["求める", "難しい"]
    assert client.get(f"{W}/practice/count", params={"categories": "Урок 10", "stages": "new"}).json() == {"count": 1}
    lib = client.get(f"{W}/items", params={"categories": "Урок 8"}).json()
    assert lib["total"] == 1 and lib["counts"]["all"] == 3
    # move the kanji and the adjective to the front, in that order
    assert client.post(f"{W}/learn/prioritize", json={"item_ids": [c["id"], b["id"]]}).json() == {"moved": 2}
    order = [i["text"] for i in client.get(f"{W}/learn/queue").json()["new"]]
    assert order == ["求", "難しい", "求める"]
    assert [i["text"] for i in client.get(f"{W}/items", params={"sort": "queue"}).json()["items"]] == order
    assert a["id"]


def test_type_groups_filter_and_progress(client):
    add(client, VERB); add(client, ADJ); add(client, GRAMMAR); add(client, KANJI)
    add(client, {**ADJ, "text": "静か", "reading_kana": "しずか", "romaji": "shizuka", "word_type": "na-adjective"})
    add(client, {**ADJ, "text": "もう", "reading_kana": "もう", "romaji": "mou", "word_type": "adverb"})
    me = client.get("/api/me").json()
    assert me["types"] == ["verb", "noun", "adjective", "other", "kanji", "grammar"]
    assert "i-adjective" in me["word_types"]

    def texts(types):
        return sorted(i["text"] for i in client.get(f"{W}/items", params={"types": types}).json()["items"])

    assert texts("adjective") == ["難しい", "静か"]  # i- and na-adjectives together
    assert texts("other") == ["もう"]
    assert texts("adjective,verb") == ["求める", "難しい", "静か"]
    assert texts("i-adjective") == ["難しい"]  # detailed types still work in old links
    rows = {r["type"]: r["items"] for r in client.get(f"{W}/progress").json()["by_type"]}
    assert rows == {"adjective": 2, "verb": 1, "other": 1, "kanji": 1, "grammar": 1}


def test_practice_cards_self_grade_and_reveal(client):
    adj = add(client, ADJ)
    set_item(adj["id"], stage=3, next_review_at=datetime.now(UTC) + timedelta(days=1))
    base = {"item_id": adj["id"], "session_type": "practice", "direction": "to_meaning", "question_kind": "meaning"}
    yes = client.post(f"{W}/answers", json={**base, "self_grade": "yes"}).json()
    assert yes["correct"] and yes["stage_after"] == 3
    no = client.post(f"{W}/answers", json={**base, "self_grade": "no"}).json()
    assert not no["correct"] and no["expected"][0] == "difficult"
    shown = client.post(f"{W}/answers", json={**base, "revealed": True}).json()
    assert not shown["correct"] and shown["note"] == "revealed" and not shown["can_accept"]
    # reviews of words stay typed: no self-grading, no reveal
    assert client.post(f"{W}/answers", json={**base, "session_type": "review", "self_grade": "yes"}).status_code == 422
    assert client.post(f"{W}/answers", json={**base, "session_type": "review", "revealed": True}).status_code == 409
    # grammar may be self-graded in any session
    g = add(client, GRAMMAR)
    set_item(g["id"], stage=1, next_review_at=datetime.now(UTC) - timedelta(minutes=1))
    r = client.post(f"{W}/answers", json={"item_id": g["id"], "session_type": "review", "direction": "to_meaning",
                                           "question_kind": "name_pattern", "example_index": 0,
                                           "self_grade": "yes"}).json()
    assert r["correct"] and r["stage_after"] == 2


def test_practice_without_stage_filter_includes_new_items(client):
    add(client, VERB)
    assert client.get(f"{W}/practice/count").json() == {"count": 1}
    assert client.get(f"{W}/practice/count", params={"stages": "1,2"}).json() == {"count": 0}


def test_regrade_self_graded_card(client):
    g = add(client, GRAMMAR)
    set_item(g["id"], stage=3, next_review_at=datetime.now(UTC) - timedelta(minutes=1))
    body = {"item_id": g["id"], "session_type": "review", "direction": "to_meaning",
            "question_kind": "name_pattern", "example_index": 0, "self_grade": "yes"}
    r = client.post(f"{W}/answers", json=body).json()
    assert r["correct"] and r["stage_after"] == 4
    # "I was sure, but I was wrong": back to the old state, then the wrong-answer rule
    out = client.post(f"{W}/answers/{r['event_id']}/regrade", json={"correct": False}).json()
    assert out["stage_after"] == 2 and not out["correct"]
    out = client.post(f"{W}/answers/{r['event_id']}/regrade", json={"correct": True}).json()
    assert out["stage_after"] == 4
    # typed answers and answers that were followed by another answer can't be regraded
    r2 = client.post(f"{W}/answers", json=body).json()
    assert client.post(f"{W}/answers/{r['event_id']}/regrade", json={"correct": False}).status_code == 409
    assert client.post(f"{W}/answers/{r2['event_id']}/regrade", json={"correct": False}).status_code == 200


def test_regrade_lesson_pass(client):
    g = add(client, GRAMMAR)
    client.post(f"{W}/learn/start", json={"item_ids": [g["id"]]})
    base = {"item_id": g["id"], "session_type": "learn", "question_kind": "cloze", "example_index": 0, "self_grade": "yes"}
    a = client.post(f"{W}/answers", json={**base, "direction": "to_japanese"}).json()
    assert a["lesson"]["directions_done"] == ["to_japanese"]
    out = client.post(f"{W}/answers/{a['event_id']}/regrade", json={"correct": False}).json()
    assert out["lesson"]["directions_done"] == [] and out["lesson"]["passes"] == 0


def test_regrade_practice_has_no_side_effects(client):
    adj = add(client, ADJ)
    set_item(adj["id"], stage=2, next_review_at=datetime.now(UTC) + timedelta(days=1))
    base = {"item_id": adj["id"], "session_type": "practice", "direction": "to_meaning", "question_kind": "meaning"}
    r = client.post(f"{W}/answers", json={**base, "self_grade": "yes"}).json()
    out = client.post(f"{W}/answers/{r['event_id']}/regrade", json={"correct": False}).json()
    assert out["stage_after"] == 2 and not out["correct"]
    typed = client.post(f"{W}/answers", json={**base, "answer": "difficult"}).json()
    assert client.post(f"{W}/answers/{typed['event_id']}/regrade", json={"correct": False}).status_code == 409
