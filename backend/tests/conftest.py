import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://ichigo:ichigo@localhost:5432/ichigo_test"
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import models  # noqa: F401
from app.db import Base, engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture()
def client():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE review_events, items, import_batches, workspaces, users, languages CASCADE"))
    with TestClient(app, headers={"X-Timezone": "Europe/Berlin"}) as c:
        yield c
