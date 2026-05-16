"""Singleton row (id=1) for Home Assistant API credentials editable from the Farm UI."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

SINGLETON_ID = 1


class FarmHomeAssistantSetting(Base):
    __tablename__ = "farm_home_assistant_setting"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    token: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
