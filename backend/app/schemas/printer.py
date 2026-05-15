from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PrinterBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    moonraker_base_url: str = Field(
        max_length=512,
        description="Full base URL, e.g. http://printer.local:7125",
    )
    moonraker_api_key: str | None = Field(default=None, max_length=512)
    ha_power_entity_id: str | None = Field(default=None, max_length=256)


class PrinterCreate(PrinterBase):
    loaded_material: str = Field(default="", max_length=64)
    loaded_color: str = Field(default="", max_length=128)
    remaining_filament_grams: float = Field(default=0.0, ge=0)


class PrinterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    moonraker_base_url: str | None = Field(default=None, max_length=512)
    moonraker_api_key: str | None = None
    ha_power_entity_id: str | None = Field(default=None, max_length=256)


class LoadedFilamentUpdate(BaseModel):
    """Single flow: material + color + remaining weight together."""

    loaded_material: str = Field(max_length=64)
    loaded_color: str = Field(max_length=128)
    remaining_filament_grams: float = Field(ge=0)


class RollReplacement(BaseModel):
    loaded_material: str = Field(max_length=64)
    loaded_color: str = Field(max_length=128)
    remaining_filament_grams: float = Field(ge=0, description="Full spool weight after change")


class PrinterOut(BaseModel):
    id: int
    name: str
    moonraker_base_url: str
    moonraker_api_key_present: bool = False
    ha_power_entity_id: str | None
    loaded_material: str
    loaded_color: str
    remaining_filament_grams: float
    last_known_status: str
    last_moonraker_check_at: datetime | None
    last_moonraker_error: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MoonrakerPingResult(BaseModel):
    ok: bool
    message: str | None = None


class PrinterTestConnectionBody(BaseModel):
    moonraker_base_url: str = Field(max_length=512)
    moonraker_api_key: str | None = Field(default=None, max_length=512)


class PrinterPrintGcodeResult(BaseModel):
    ok: bool
    message: str | None = None
    moonraker_path: str | None = None
    print_started: bool = False
    print_queued: bool = False


class PrinterControlResult(BaseModel):
    ok: bool
    message: str | None = None


class PrinterHomeBody(BaseModel):
    axes: Literal["all", "xy"] = "all"


class PrinterPreheatBody(BaseModel):
    hotend_c: float = Field(default=200, ge=0, le=400)
    bed_c: float = Field(default=60, ge=0, le=150)
