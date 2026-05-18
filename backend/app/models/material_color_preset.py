from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.material_preheat_preset import MaterialPreheatPreset


class MaterialColorPreset(Base):
    __tablename__ = "material_color_presets"
    __table_args__ = (
        UniqueConstraint("material_preset_id", "name", name="uq_material_color_presets_material_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    material_preset_id: Mapped[int] = mapped_column(
        ForeignKey("material_preheat_presets.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    hex: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material: Mapped[MaterialPreheatPreset] = relationship(
        "MaterialPreheatPreset", back_populates="color_presets"
    )
