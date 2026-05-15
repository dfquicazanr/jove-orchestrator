from datetime import datetime

from pydantic import BaseModel, Field


class GCodeFileBrief(BaseModel):
    id: int
    original_filename: str
    filament_mass_grams_estimate: float | None
    required_material: str | None
    required_color: str | None

    model_config = {"from_attributes": True}


class PrintQueueItemOut(BaseModel):
    id: int
    gcode_file_id: int
    copy_index: int
    priority: int
    assigned_printer_id: int | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PrintQueueItemDetailOut(PrintQueueItemOut):
    gcode_file: GCodeFileBrief
    assigned_printer_name: str | None = None


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
