from pydantic import BaseModel, Field


class MaterialPreheatPresetOut(BaseModel):
    id: int
    name: str
    hotend_c: float
    bed_c: float
    sort_order: int

    model_config = {"from_attributes": True}


class MaterialPreheatPresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    hotend_c: float = Field(ge=0, le=400)
    bed_c: float = Field(ge=0, le=150)
    sort_order: int = Field(default=0, ge=0, le=10_000)


class MaterialPreheatPresetsUpdate(BaseModel):
    presets: list[MaterialPreheatPresetIn] = Field(min_length=1, max_length=32)
