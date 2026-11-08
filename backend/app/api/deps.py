from __future__ import annotations

import random
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Path
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, Workspace
from app.services.workspaces import get_or_create_dev_user, get_workspace, zone

DB = Annotated[Session, Depends(get_db)]


def current_user(db: DB) -> User:
    # Single-user mode. Google sign-in replaces this dependency later.
    return get_or_create_dev_user(db)


CurrentUser = Annotated[User, Depends(current_user)]


def workspace(db: DB, user: CurrentUser, lang: Annotated[str, Path(min_length=2, max_length=8)]) -> Workspace:
    ws = get_workspace(db, user, lang)
    if ws is None:
        raise HTTPException(404, f"You have no {lang} workspace. Add the language first.")
    return ws


WS = Annotated[Workspace, Depends(workspace)]


def timezone(x_timezone: Annotated[str | None, Header()] = None):
    """The browser sends its IANA time zone so "today" means the user's day."""
    return zone(x_timezone)


TZ = Annotated[object, Depends(timezone)]


def rng() -> random.Random:
    return random.Random()


RNG = Annotated[random.Random, Depends(rng)]


def csv_list(value: str | None, sep: str = ",") -> list[str] | None:
    """Split a query parameter list. Categories use "|" because their names may contain commas."""
    if not value:
        return None
    return [v.strip() for v in value.split(sep) if v.strip()]
