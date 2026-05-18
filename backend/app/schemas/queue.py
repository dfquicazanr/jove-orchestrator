from datetime import datetime

from pydantic import BaseModel, Field


class GCodeFileBrief(BaseModel):
    id: int
    original_filename: str
    display_name: str
    filament_mass_grams_estimate: float | None
    filament_length_mm: float | None = None
    print_time_seconds: int | None = None
    required_material: str | None
    required_color: str | None
    material_preset_id: int | None = None
    material_preset_name: str | None = None

    model_config = {"from_attributes": True}


class QueueItemsCreate(BaseModel):
    gcode_file_id: int
    copies: int = Field(default=1, ge=1, le=10_000)
    priority: int = 0


class QueueItemsFromKitCreate(BaseModel):
    kit_id: int
    kit_copies: int = Field(default=1, ge=1, le=10_000)
    priority: int = 0


class PrintQueueItemOut(BaseModel):
    id: int
    gcode_file_id: int
    copy_index: int
    priority: int
    assigned_printer_id: int | None
    status: str
    print_kit_id: int | None = None
    kit_run_index: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PrintQueueItemDetailOut(PrintQueueItemOut):
    gcode_file: GCodeFileBrief
    assigned_printer_name: str | None = None
    material_preset_id: int | None = None
    material_preset_name: str | None = None


class QueueItemPatch(BaseModel):
    assigned_printer_id: int | None = None
    priority: int | None = Field(default=None)
    status: str | None = Field(
        default=None,
        pattern="^(draft|queued|printing|done|cancelled|error)$",
    )


class PlanRequest(BaseModel):
    """Plan all draft items, or only the given ids."""

    queue_item_ids: list[int] | None = None
    waste_factor: float = Field(
        default=1.0,
        ge=1.0,
        le=2.0,
        description=(
            "Filament headroom multiplier when checking spool remaining "
            "(required grams = estimate × waste_factor; 1.15 = 15% extra, 2.0 = 100% extra)"
        ),
    )


class PlanCommitItem(BaseModel):
    gcode_file_id: int
    assigned_printer_id: int | None = None
    priority: int = 0
    material_preset_id: int | None = None
    print_kit_id: int | None = None
    kit_run_index: int | None = None


class PlanCommitRequest(BaseModel):
    items: list[PlanCommitItem] = Field(min_length=1)
