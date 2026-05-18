from pydantic import BaseModel, Field, field_validator


class MaterialColorPresetOut(BaseModel):
    id: int
    material_preset_id: int
    name: str
    hex: str | None
    is_default: bool
    notes: str | None
    sort_order: int

    model_config = {"from_attributes": True}


class MaterialColorPresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    hex: str | None = Field(default=None, max_length=7)
    is_default: bool = False
    notes: str | None = Field(default=None, max_length=256)
    sort_order: int = Field(default=0, ge=0, le=10_000)

    @field_validator("hex")
    @classmethod
    def normalize_hex(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if not s.startswith("#"):
            s = f"#{s}"
        if len(s) != 7:
            raise ValueError("hex must be #RRGGBB")
        return s.upper()


class MaterialColorPresetsUpdate(BaseModel):
    colors: list[MaterialColorPresetIn] = Field(max_length=64)


class MaterialPreheatPresetOut(BaseModel):
    id: int
    name: str
    hotend_c: float
    bed_c: float
    default_density_g_cm3: float | None = None
    sort_order: int
    color_presets: list[MaterialColorPresetOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class MaterialPreheatPresetIn(BaseModel):
    id: int | None = None
    name: str = Field(min_length=1, max_length=64)
    hotend_c: float = Field(ge=0, le=400)
    bed_c: float = Field(ge=0, le=150)
    default_density_g_cm3: float | None = Field(default=None, gt=0, le=10)
    sort_order: int = Field(default=0, ge=0, le=10_000)


class MaterialPreheatPresetsUpdate(BaseModel):
    presets: list[MaterialPreheatPresetIn] = Field(min_length=1, max_length=32)
