from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.gcode_file import GCodeFile
    from app.models.material_color_preset import MaterialColorPreset
    from app.models.material_preheat_preset import MaterialPreheatPreset


class PrintKit(Base):
    __tablename__ = "print_kits"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list[PrintKitItem]] = relationship(
        "PrintKitItem", back_populates="kit", cascade="all, delete-orphan", order_by="PrintKitItem.sort_order"
    )


class PrintKitItem(Base):
    __tablename__ = "print_kit_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kit_id: Mapped[int] = mapped_column(ForeignKey("print_kits.id", ondelete="CASCADE"), index=True)
    gcode_file_id: Mapped[int] = mapped_column(ForeignKey("gcode_files.id", ondelete="CASCADE"))
    material_preset_id: Mapped[int] = mapped_column(ForeignKey("material_preheat_presets.id", ondelete="RESTRICT"))
    material_color_preset_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_color_presets.id", ondelete="SET NULL"),
        nullable=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    kit: Mapped[PrintKit] = relationship("PrintKit", back_populates="items")
    gcode_file: Mapped[GCodeFile] = relationship("GCodeFile")
    material_preset: Mapped[MaterialPreheatPreset] = relationship("MaterialPreheatPreset")
    material_color_preset: Mapped[MaterialColorPreset | None] = relationship("MaterialColorPreset")
