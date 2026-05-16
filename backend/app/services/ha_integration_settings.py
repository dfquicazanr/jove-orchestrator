from __future__ import annotations

from typing import Literal

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.farm_home_assistant_setting import FarmHomeAssistantSetting, SINGLETON_ID


HaSource = Literal["database", "environment"]


def _row(db: Session) -> FarmHomeAssistantSetting | None:
    return db.get(FarmHomeAssistantSetting, SINGLETON_ID)


def get_singleton_row(db: Session) -> FarmHomeAssistantSetting:
    row = _row(db)
    if row is None:
        row = FarmHomeAssistantSetting(id=SINGLETON_ID, base_url=None, token=None)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def db_credentials_configured(db: Session) -> bool:
    row = _row(db)
    if row is None:
        return False
    bu = (row.base_url or "").strip()
    tok = (row.token or "").strip()
    return bool(bu and tok)


def env_credentials_configured() -> bool:
    s = get_settings()
    bu = (s.home_assistant_base_url or "").strip()
    tok = (s.home_assistant_token or "").strip()
    return bool(bu and tok)


def resolve_home_assistant_credentials(db: Session) -> tuple[str | None, str | None, HaSource | None]:
    """Return `(base_url, token, source)` for HA REST calls."""

    row = _row(db)
    if row:
        db_bu = (row.base_url or "").strip()
        db_tok = (row.token or "").strip()
        if db_bu and db_tok:
            return db_bu, db_tok, "database"

    s = get_settings()
    env_bu = (s.home_assistant_base_url or "").strip()
    env_tok = (s.home_assistant_token or "").strip()
    if env_bu and env_tok:
        return env_bu, env_tok, "environment"
    return None, None, None
