from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.printer import Printer
from app.models.user import User
from app.schemas.queue import (
    GCodeFileBrief,
    PlanRequest,
    PrintQueueItemDetailOut,
    PrintQueueItemOut,
    QueueItemPatch,
)
from app.services.planner import suggest_assignments

router = APIRouter()


def _queue_item_detail(item: PrintQueueItem) -> PrintQueueItemDetailOut:
    gf = item.gcode_file
    printer_name = item.assigned_printer.name if item.assigned_printer else None
    return PrintQueueItemDetailOut(
        id=item.id,
        gcode_file_id=item.gcode_file_id,
        copy_index=item.copy_index,
        priority=item.priority,
        assigned_printer_id=item.assigned_printer_id,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        gcode_file=GCodeFileBrief.model_validate(gf),
        assigned_printer_name=printer_name,
    )


@router.get("/items", response_model=list[PrintQueueItemDetailOut])
def list_queue_items(
    status_filter: str | None = None,
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    q = (
        db.query(PrintQueueItem)
        .options(
            joinedload(PrintQueueItem.gcode_file),
            joinedload(PrintQueueItem.assigned_printer),
        )
    )
    if status_filter:
        q = q.filter(PrintQueueItem.status == status_filter)
    rows = q.order_by(PrintQueueItem.priority.desc(), PrintQueueItem.id.asc()).all()
    return [_queue_item_detail(row) for row in rows]


@router.patch("/items/{item_id}", response_model=PrintQueueItemOut)
def patch_queue_item(
    item_id: int,
    body: QueueItemPatch,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    item = db.get(PrintQueueItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Queue item not found")
    data = body.model_dump(exclude_unset=True)
    if "assigned_printer_id" in data and data["assigned_printer_id"] is not None:
        pid = data["assigned_printer_id"]
        if db.get(Printer, pid) is None:
            raise HTTPException(status_code=400, detail="Printer not found")
    for k, v in data.items():
        setattr(item, k, v)
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item


@router.post("/plan", response_model=list[PrintQueueItemDetailOut])
def generate_plan(
    body: PlanRequest,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    items = suggest_assignments(
        db,
        queue_item_ids=body.queue_item_ids,
        waste_factor=body.waste_factor,
    )
    db.commit()
    out: list[PrintQueueItemDetailOut] = []
    for it in items:
        db.refresh(it)
        item = (
            db.query(PrintQueueItem)
            .options(
                joinedload(PrintQueueItem.gcode_file),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == it.id)
            .one()
        )
        out.append(_queue_item_detail(item))
    return out


@router.post("/items/{item_id}/complete-success", response_model=PrintQueueItemOut)
def mark_print_completed(
    item_id: int,
    waste_factor: float = 1.0,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Mark a queue item done and subtract estimated filament from the assigned printer (v1 hook)."""

    item = (
        db.query(PrintQueueItem)
        .options(joinedload(PrintQueueItem.gcode_file))
        .filter(PrintQueueItem.id == item_id)
        .one_or_none()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if item.assigned_printer_id is None:
        raise HTTPException(status_code=400, detail="Item has no assigned printer")

    printer = db.get(Printer, item.assigned_printer_id)
    if printer is None:
        raise HTTPException(status_code=400, detail="Assigned printer missing")

    job = item.gcode_file
    est = job.filament_mass_grams_estimate
    if est is not None:
        grams = float(est) * waste_factor
        printer.remaining_filament_grams = max(0.0, printer.remaining_filament_grams - grams)
        printer.updated_at = datetime.now(timezone.utc)

    item.status = PrintQueueStatus.done.value
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item
