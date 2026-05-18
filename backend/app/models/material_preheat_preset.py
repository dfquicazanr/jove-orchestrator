from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.material_color_preset import MaterialColorPreset


class MaterialPreheatPreset(Base):
    __tablename__ = "material_preheat_presets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hotend_c: Mapped[float] = mapped_column(Float, nullable=False)
    bed_c: Mapped[float] = mapped_column(Float, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    color_presets: Mapped[list[MaterialColorPreset]] = relationship(
        "MaterialColorPreset",
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="MaterialColorPreset.sort_order",
    )
