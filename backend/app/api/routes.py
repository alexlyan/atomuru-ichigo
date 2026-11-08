from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB, RNG, TZ, WS, CurrentUser, csv_list
from app.core import importer
from app.core.types import TYPES, Kind
from app.models import Language, Workspace
from app.schemas import (
    AcceptOut,
    AnswerIn,
    AnswerOut,
    ItemIn,
    ItemOut,
    ItemPatch,
    Question,
    WorkspaceSettings,
)
from app.services import imports as imp
from app.services import library, stats, study
from app.services.workspaces import due_count, settings_of, utcnow

router = APIRouter(prefix="/api")


def bad_request(exc: Exception) -> HTTPException:
    return HTTPException(422, str(exc))


# ---------- user, languages, workspaces ----------

@router.get("/me")
def me(db: DB, user: CurrentUser):
    now = utcnow()
    langs = {lang.code: lang for lang in db.scalars(select(Language)).all()}
    workspaces = []
    for ws in user.workspaces:
        lang = langs[ws.language_code]
        workspaces.append({
            "language": lang.code, "name": lang.name, "native_name": lang.native_name,
            "direction": lang.direction, "due": due_count(db, ws.id, now),
        })
    have = {w["language"] for w in workspaces}
    return {
        "user": {"id": user.id, "email": user.email, "name": user.name},
        "active_language": user.active_language,
        "workspaces": workspaces,
        "total_due": sum(w["due"] for w in workspaces),
        "available_languages": [
            {"language": lang.code, "name": lang.name, "native_name": lang.native_name, "supported": lang.supported}
            for lang in langs.values() if lang.code not in have
        ],
        "types": list(TYPES),
    }


class ActiveLanguage(BaseModel):
    language: str


@router.put("/me/active-language")
def set_active_language(body: ActiveLanguage, db: DB, user: CurrentUser):
    if body.language not in {w.language_code for w in user.workspaces}:
        raise HTTPException(404, "Add this language before switching to it.")
    user.active_language = body.language
    db.commit()
    return {"active_language": user.active_language}


@router.post("/workspaces", status_code=201)
def add_language(body: ActiveLanguage, db: DB, user: CurrentUser):
    lang = db.get(Language, body.language)
    if lang is None:
        raise HTTPException(404, "Unknown language.")
    if not lang.supported:
        raise HTTPException(409, f"{lang.name} is coming soon.")
    if any(w.language_code == lang.code for w in user.workspaces):
        raise HTTPException(409, f"You already have a {lang.name} workspace.")
    db.add(Workspace(user_id=user.id, language_code=lang.code, settings=WorkspaceSettings().model_dump()))
    user.active_language = lang.code
    db.commit()
    return {"language": lang.code}


# ---------- settings ----------

@router.get("/w/{lang}/settings", response_model=WorkspaceSettings)
def get_settings(ws: WS):
    return settings_of(ws)


@router.put("/w/{lang}/settings", response_model=WorkspaceSettings)
def put_settings(body: WorkspaceSettings, ws: WS, db: DB):
    ws.settings = body.model_dump(mode="json")
    db.commit()
    return body


# ---------- today and progress ----------

@router.get("/w/{lang}/today")
def get_today(ws: WS, db: DB, tz: TZ):
    return stats.today(db, ws, utcnow(), tz)


@router.get("/w/{lang}/progress")
def get_progress(ws: WS, db: DB, tz: TZ, period: Literal["7", "30", "all"] = "30"):
    return stats.progress(db, ws, utcnow(), tz, None if period == "all" else int(period))


# ---------- library and items ----------

@router.get("/w/{lang}/items")
def get_items(
    ws: WS, db: DB,
    tab: Literal["all", "vocabulary", "kanji", "grammar"] = "all",
    q: str = "",
    types: str | None = None,
    stages: str | None = None,
    sort: Literal["recent", "next_review", "most_missed", "az", "queue"] = "recent",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    categories: str | None = None,
):
    try:
        return library.list_items(db, ws, tab, q, csv_list(types), csv_list(stages), sort, limit, offset,
                                  csv_list(categories, sep="|"))
    except ValueError as exc:
        raise bad_request(exc) from exc


@router.get("/w/{lang}/categories")
def get_categories(ws: WS, db: DB, stages: str | None = None):
    """Categories in use (lesson labels and topics) with item counts. stages=new limits to not-started items."""
    return library.categories(db, ws, csv_list(stages))


@router.get("/w/{lang}/items/{item_id}", response_model=ItemOut)
def get_item(item_id: uuid.UUID, ws: WS, db: DB):
    item = library.get_item(db, ws, item_id)
    if item is None:
        raise HTTPException(404, "Item not found.")
    return library.item_detail(db, ws, item)


@router.post("/w/{lang}/items", response_model=ItemOut, status_code=201)
def create_item(body: ItemIn, ws: WS, db: DB,
                on_duplicate: Literal["error", "update", "keep_both"] = "error"):
    dup = library.find_duplicate(db, ws, body.kind.value, body.text.strip())
    if dup and on_duplicate == "error":
        raise HTTPException(409, {"message": f"{body.text} is already in your library.", "existing_id": str(dup.id)})
    try:
        item = library.update_item(dup, body) if dup and on_duplicate == "update" else library.create_item(db, ws, body)
    except ValueError as exc:
        raise bad_request(exc) from exc
    db.commit()
    return library.item_detail(db, ws, item)


@router.patch("/w/{lang}/items/{item_id}", response_model=ItemOut)
def patch_item(item_id: uuid.UUID, body: ItemPatch, ws: WS, db: DB):
    item = library.get_item(db, ws, item_id)
    if item is None:
        raise HTTPException(404, "Item not found.")
    try:
        library.update_item(item, body)
    except ValueError as exc:
        raise bad_request(exc) from exc
    db.commit()
    return library.item_detail(db, ws, item)


@router.delete("/w/{lang}/items/{item_id}", status_code=204)
def delete_item(item_id: uuid.UUID, ws: WS, db: DB):
    item = library.get_item(db, ws, item_id)
    if item is None:
        raise HTTPException(404, "Item not found.")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


class SynonymIn(BaseModel):
    text: str


@router.post("/w/{lang}/items/{item_id}/synonyms", response_model=ItemOut)
def add_synonym(item_id: uuid.UUID, body: SynonymIn, ws: WS, db: DB):
    item = library.get_item(db, ws, item_id)
    if item is None:
        raise HTTPException(404, "Item not found.")
    text = body.text.strip()
    if text and text not in (item.user_synonyms or []):
        item.user_synonyms = [*(item.user_synonyms or []), text]
        db.commit()
    return library.item_detail(db, ws, item)


# ---------- learn ----------

@router.get("/w/{lang}/learn/queue")
def get_learn_queue(ws: WS, db: DB, tz: TZ, types: str | None = None, more: int = Query(0, ge=0, le=100),
                    categories: str | None = None):
    data = study.learn_queue(db, ws, utcnow(), tz, csv_list(types), more, csv_list(categories, sep="|"))
    return {
        **{k: v for k, v in data.items() if k not in ("in_progress", "new")},
        "in_progress": [library.item_detail(db, ws, i) for i in data["in_progress"]],
        "new": [library.item_detail(db, ws, i) for i in data["new"]],
    }


class ItemIds(BaseModel):
    item_ids: list[uuid.UUID]


@router.post("/w/{lang}/learn/prioritize")
def prioritize_lessons(body: ItemIds, ws: WS, db: DB):
    """Move the chosen not-started items to the front of the learn queue, in the given order."""
    return {"moved": study.prioritize(db, ws, body.item_ids)}


@router.post("/w/{lang}/learn/start")
def start_lessons(body: ItemIds, ws: WS, db: DB):
    return {"started": study.start_lessons(db, ws, body.item_ids, utcnow())}


@router.post("/w/{lang}/learn/questions", response_model=list[Question])
def learn_questions(body: ItemIds, ws: WS, db: DB, rng: RNG):
    return study.lesson_questions(db, ws, body.item_ids, rng)


# ---------- review ----------

@router.get("/w/{lang}/review/queue", response_model=list[Question])
def get_review_queue(ws: WS, db: DB, rng: RNG, types: str | None = None, limit: int | None = Query(None, ge=1, le=500)):
    try:
        return study.review_queue(db, ws, utcnow(), csv_list(types), limit, rng)
    except ValueError as exc:
        raise bad_request(exc) from exc


# ---------- practice ----------

PracticeSource = Literal["all", "most_missed", "recent", "missed_7d"]


@router.get("/w/{lang}/practice/count")
def get_practice_count(ws: WS, db: DB, types: str | None = None, stages: str | None = None,
                       source: PracticeSource = "all", categories: str | None = None):
    try:
        return {"count": study.practice_count(db, ws, csv_list(types), csv_list(stages), source, utcnow(),
                                              csv_list(categories, sep="|"))}
    except ValueError as exc:
        raise bad_request(exc) from exc


@router.get("/w/{lang}/practice/queue", response_model=list[Question])
def get_practice_queue(ws: WS, db: DB, rng: RNG, types: str | None = None, stages: str | None = None,
                       source: PracticeSource = "all",
                       direction: Literal["both", "to_meaning", "to_japanese"] = "both",
                       count: int | None = Query(20, ge=1, le=500), categories: str | None = None):
    try:
        return study.practice_queue(db, ws, csv_list(types), csv_list(stages), source, direction, count, utcnow(), rng,
                                    csv_list(categories, sep="|"))
    except ValueError as exc:
        raise bad_request(exc) from exc


# ---------- answers ----------

@router.post("/w/{lang}/answers", response_model=AnswerOut)
def post_answer(body: AnswerIn, ws: WS, db: DB):
    try:
        return study.answer(db, ws, body, utcnow())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except study.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise bad_request(exc) from exc


@router.post("/w/{lang}/answers/{event_id}/accept", response_model=AcceptOut)
def accept_answer(event_id: int, ws: WS, db: DB):
    try:
        return study.accept(db, ws, event_id, utcnow())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except study.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc


# ---------- imports ----------

@router.get("/w/{lang}/imports/template")
def import_template(kind: Literal["vocabulary", "kanji"] = "vocabulary"):
    return Response(importer.template_csv(Kind(kind)), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="ichigo-{kind}-template.csv"'})


@router.get("/w/{lang}/imports")
def list_imports(ws: WS, db: DB):
    from app.models import ImportBatch

    batches = db.scalars(select(ImportBatch).where(ImportBatch.workspace_id == ws.id)
                         .order_by(ImportBatch.created_at.desc()).limit(50)).all()
    return [{k: v for k, v in imp.summary(b).items() if k != "rows"} for b in batches]


@router.post("/w/{lang}/imports", status_code=201)
async def upload_import(ws: WS, db: DB, file: Annotated[UploadFile, File()],
                        kind: Annotated[Literal["vocabulary", "kanji"], Form()] = "vocabulary"):
    content = await file.read()
    try:
        batch = imp.stage(db, ws, Kind(kind), file.filename or "upload.csv", content)
    except importer.FileError as exc:
        raise bad_request(exc) from exc
    return imp.summary(batch)


def _batch(db, ws, batch_id):
    batch = imp.get(db, ws, batch_id)
    if batch is None:
        raise HTTPException(404, "Import not found.")
    return batch


@router.get("/w/{lang}/imports/{batch_id}")
def get_import(batch_id: uuid.UUID, ws: WS, db: DB):
    return imp.summary(_batch(db, ws, batch_id))


@router.post("/w/{lang}/imports/{batch_id}/commit")
def commit_import(batch_id: uuid.UUID, ws: WS, db: DB):
    try:
        return imp.commit(db, ws, _batch(db, ws, batch_id), utcnow())
    except imp.ImportConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.delete("/w/{lang}/imports/{batch_id}", status_code=204)
def cancel_import(batch_id: uuid.UUID, ws: WS, db: DB):
    try:
        imp.cancel(db, _batch(db, ws, batch_id))
    except imp.ImportConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    return Response(status_code=204)


@router.post("/w/{lang}/imports/{batch_id}/undo")
def undo_import(batch_id: uuid.UUID, ws: WS, db: DB):
    try:
        return {"removed": imp.undo(db, ws, _batch(db, ws, batch_id))}
    except imp.ImportConflict as exc:
        raise HTTPException(409, str(exc)) from exc
