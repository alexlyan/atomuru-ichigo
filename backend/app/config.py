from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://ichigo:ichigo@localhost:5432/ichigo"
    # Single-user mode until Google sign-in lands: every request acts as this user.
    dev_user_email: str = "me@ichigo.local"
    dev_user_name: str = "Alex"
    content_dir: Path = Path(__file__).resolve().parents[2] / "content"
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
