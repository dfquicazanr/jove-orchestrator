from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.models.print_queue import PrintQueueItem
from app.models.printer import Printer
from app.models.user import User
from app.schemas.queue import PlanRequest, PrintQueueItemOut, QueueItemPatch
from app.services.planner import suggest_assignments

router = APIRouter()


@router.get("/items", response_model=list[PrintQueueItemOut])
def list_queue_items(
    status_filter: str | None = None,
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    q = db.query(PrintQueueItem)
    if status_filter:
        q = q.filter(PrintQueueItem.status == status_filter)
    return q.order_by(PrintQueueItem.priority.desc(), PrintQueueItem.id.asc()).all()


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


@router.post("/plan", response_model=list[PrintQueueItemOut])
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
    for it in items:
        db.refresh(it)
    return items


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
