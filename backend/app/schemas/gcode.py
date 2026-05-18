from datetime import datetime

from pydantic import BaseModel, Field


class GCodeUploadMetadata(BaseModel):
    display_name: str | None = Field(default=None, max_length=256)
    required_material: str | None = Field(default=None, max_length=64)
    required_color: str | None = Field(default=None, max_length=128)
    material_preset_id: int | None = None
    material_color_preset_id: int | None = None
    copies: int = Field(default=1, ge=1, le=10_000)
    """When true, create draft queue rows immediately (legacy batch flow)."""

    enqueue: bool = False


class GCodeFilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=256)
    required_material: str | None = Field(default=None, max_length=64)
    required_color: str | None = Field(default=None, max_length=128)
    material_preset_id: int | None = None
    material_color_preset_id: int | None = None
    total_copies_requested: int | None = Field(default=None, ge=1, le=10_000)
    print_time_seconds: int | None = Field(default=None, ge=1, le=7 * 24 * 3600)


class GCodeFileOut(BaseModel):
    id: int
    original_filename: str
    display_name: str
    filament_mass_grams_estimate: float | None
    filament_length_mm: float | None
    print_time_seconds: int | None
    required_material: str | None
    required_color: str | None
    material_preset_id: int | None
    material_preset_name: str | None = None
    material_color_preset_id: int | None = None
    material_color_preset_name: str | None = None
    total_copies_requested: int
    queue_item_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}
