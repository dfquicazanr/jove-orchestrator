from datetime import datetime

from pydantic import BaseModel, Field


class GCodeUploadMetadata(BaseModel):
    required_material: str | None = Field(default=None, max_length=64)
    required_color: str | None = Field(default=None, max_length=128)
    copies: int = Field(default=1, ge=1, le=10_000)


class GCodeFileOut(BaseModel):
    id: int
    original_filename: str
    filament_mass_grams_estimate: float | None
    required_material: str | None
    required_color: str | None
    total_copies_requested: int
    created_at: datetime

    model_config = {"from_attributes": True}
