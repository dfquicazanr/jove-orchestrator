from datetime import datetime

from pydantic import BaseModel, Field


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
        description="Multiply estimated job grams for feasibility checks",
    )
