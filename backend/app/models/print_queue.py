from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.gcode_file import GCodeFile
    from app.models.material_preheat_preset import MaterialPreheatPreset
    from app.models.printer import Printer


class PrintQueueStatus(enum.StrEnum):
    draft = "draft"
    queued = "queued"
    printing = "printing"
    done = "done"
    cancelled = "cancelled"
    error = "error"


class PrintQueueItem(Base):
    __tablename__ = "print_queue_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gcode_file_id: Mapped[int] = mapped_column(ForeignKey("gcode_files.id"), index=True)
    copy_index: Mapped[int] = mapped_column(Integer, default=0, doc="0-based copy number")

    priority: Mapped[int] = mapped_column(Integer, default=0, index=True)
    assigned_printer_id: Mapped[int | None] = mapped_column(
        ForeignKey("printers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default=PrintQueueStatus.draft.value, index=True)
    print_kit_id: Mapped[int | None] = mapped_column(
        ForeignKey("print_kits.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    kit_run_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    material_preset_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_preheat_presets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    gcode_file: Mapped[GCodeFile] = relationship("GCodeFile", back_populates="queue_items")
    material_preset: Mapped[MaterialPreheatPreset | None] = relationship("MaterialPreheatPreset")
    assigned_printer: Mapped[Printer | None] = relationship(
        "Printer", back_populates="queue_items", foreign_keys=[assigned_printer_id]
    )
