from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.print_queue import PrintQueueItem
    from app.models.user import User


class GCodeFile(Base):
    __tablename__ = "gcode_files"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    stored_path: Mapped[str] = mapped_column(String(1024))
    original_filename: Mapped[str] = mapped_column(String(512))
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    filament_mass_grams_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_material: Mapped[str | None] = mapped_column(String(64), nullable=True)
    required_color: Mapped[str | None] = mapped_column(String(128), nullable=True)

    total_copies_requested: Mapped[int] = mapped_column(Integer, default=1)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    uploader: Mapped[User] = relationship("User", foreign_keys=[uploaded_by_id])
    queue_items: Mapped[list[PrintQueueItem]] = relationship(
        "PrintQueueItem", back_populates="gcode_file", cascade="all, delete-orphan"
    )
