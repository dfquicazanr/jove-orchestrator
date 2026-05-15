from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PrinterStatus(str, enum.Enum):
    offline = "offline"
    powered_off = "powered_off"
    ready = "ready"
    printing = "printing"
    paused = "paused"
    finished_awaiting_cleanup = "finished_awaiting_cleanup"
    error = "error"


class Printer(Base):
    __tablename__ = "printers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), index=True)

    moonraker_base_url: Mapped[str] = mapped_column(String(512))
    moonraker_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    ha_power_entity_id: Mapped[str | None] = mapped_column(
        String(256), nullable=True, doc="Home Assistant entity_id for power switch"
    )

    loaded_material: Mapped[str] = mapped_column(String(64), default="")
    loaded_color: Mapped[str] = mapped_column(String(128), default="")
    remaining_filament_grams: Mapped[float] = mapped_column(Float, default=0.0)

    last_known_status: Mapped[str] = mapped_column(
        String(64), default=PrinterStatus.offline.value, index=True
    )
    last_moonraker_check_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_moonraker_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    queue_items: Mapped[list["PrintQueueItem"]] = relationship(
        "PrintQueueItem", back_populates="assigned_printer"
    )
