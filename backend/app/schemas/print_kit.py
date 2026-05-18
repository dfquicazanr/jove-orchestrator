from datetime import datetime

from pydantic import BaseModel, Field


class PrintKitItemIn(BaseModel):
    gcode_file_id: int
    material_preset_id: int
    material_color_preset_id: int | None = None
    quantity: int = Field(default=1, ge=1, le=10_000)
    sort_order: int = Field(default=0, ge=0, le=10_000)


class PrintKitItemOut(BaseModel):
    id: int
    gcode_file_id: int
    gcode_filename: str
    gcode_display_name: str
    material_preset_id: int
    material_preset_name: str
    material_color_preset_id: int | None = None
    material_color_preset_name: str | None = None
    quantity: int
    sort_order: int

    model_config = {"from_attributes": True}


class PrintKitOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    items: list[PrintKitItemOut] = Field(default_factory=list)


class PrintKitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    items: list[PrintKitItemIn] = Field(min_length=1, max_length=256)


class PrintKitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    items: list[PrintKitItemIn] | None = Field(default=None, min_length=1, max_length=256)


class PrintKitEnqueue(BaseModel):
    kit_copies: int = Field(default=1, ge=1, le=10_000)
    priority: int = 0
