from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.printer import Printer
from app.models.user import User
from app.models.gcode_file import GCodeFile
from app.models.material_preheat_preset import MaterialPreheatPreset
from app.models.print_kit import PrintKit, PrintKitItem
from app.schemas.queue import (
    GCodeFileBrief,
    PlanCommitRequest,
    PlanRequest,
    PrintQueueItemDetailOut,
    PrintQueueItemOut,
    QueueItemPatch,
    QueueItemsCreate,
    QueueItemsFromKitCreate,
)
from app.services.planner import suggest_assignments

router = APIRouter()


def _gcode_file_brief(gf: GCodeFile) -> GCodeFileBrief:
    preset = gf.material_preset
    return GCodeFileBrief(
        id=gf.id,
        original_filename=gf.original_filename,
        display_name=gf.display_name,
        filament_mass_grams_estimate=gf.filament_mass_grams_estimate,
        filament_length_mm=gf.filament_length_mm,
        print_time_seconds=gf.print_time_seconds,
        required_material=gf.required_material,
        required_color=gf.required_color,
        material_preset_id=gf.material_preset_id,
        material_preset_name=preset.name if preset else None,
    )


def _queue_item_detail(item: PrintQueueItem) -> PrintQueueItemDetailOut:
    gf = item.gcode_file
    printer_name = item.assigned_printer.name if item.assigned_printer else None
    preset = item.material_preset or gf.material_preset
    return PrintQueueItemDetailOut(
        id=item.id,
        gcode_file_id=item.gcode_file_id,
        copy_index=item.copy_index,
        priority=item.priority,
        assigned_printer_id=item.assigned_printer_id,
        status=item.status,
        print_kit_id=item.print_kit_id,
        kit_run_index=item.kit_run_index,
        created_at=item.created_at,
        updated_at=item.updated_at,
        gcode_file=_gcode_file_brief(gf),
        assigned_printer_name=printer_name,
        material_preset_id=item.material_preset_id,
        material_preset_name=preset.name if preset else None,
    )


_TIMELINE_STATUSES = (
    PrintQueueStatus.queued.value,
    PrintQueueStatus.printing.value,
    PrintQueueStatus.done.value,
)


@router.get("/timeline", response_model=list[PrintQueueItemDetailOut])
def list_timeline_items(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    """Scheduled / active / completed jobs for the farm dashboard timeline."""
    rows = (
        db.query(PrintQueueItem)
        .options(
            joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
            joinedload(PrintQueueItem.material_preset),
            joinedload(PrintQueueItem.assigned_printer),
        )
        .filter(PrintQueueItem.status.in_(_TIMELINE_STATUSES))
        .order_by(PrintQueueItem.priority.desc(), PrintQueueItem.id.asc())
        .all()
    )
    return [_queue_item_detail(row) for row in rows]


@router.get("/items", response_model=list[PrintQueueItemDetailOut])
def list_queue_items(
    status_filter: str | None = None,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    q = (
        db.query(PrintQueueItem)
        .options(
            joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
            joinedload(PrintQueueItem.material_preset),
            joinedload(PrintQueueItem.assigned_printer),
        )
    )
    if status_filter:
        q = q.filter(PrintQueueItem.status == status_filter)
    rows = q.order_by(PrintQueueItem.priority.desc(), PrintQueueItem.id.asc()).all()
    return [_queue_item_detail(row) for row in rows]


@router.post("/items", response_model=list[PrintQueueItemDetailOut], status_code=status.HTTP_201_CREATED)
def create_queue_items(
    body: QueueItemsCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    gf = (
        db.query(GCodeFile)
        .options(joinedload(GCodeFile.material_preset))
        .filter(GCodeFile.id == body.gcode_file_id)
        .first()
    )
    if gf is None:
        raise HTTPException(status_code=404, detail="G-code file not found")

    max_copy = (
        db.query(func.max(PrintQueueItem.copy_index))
        .filter(PrintQueueItem.gcode_file_id == gf.id)
        .scalar()
    )
    start = 0 if max_copy is None else int(max_copy) + 1

    created: list[PrintQueueItem] = []
    for i in range(body.copies):
        item = PrintQueueItem(
            gcode_file_id=gf.id,
            copy_index=start + i,
            priority=body.priority,
            status=PrintQueueStatus.draft.value,
        )
        db.add(item)
        created.append(item)

    db.flush()
    db.commit()

    out: list[PrintQueueItemDetailOut] = []
    for item in created:
        row = (
            db.query(PrintQueueItem)
            .options(
                joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
                joinedload(PrintQueueItem.material_preset),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == item.id)
            .one()
        )
        out.append(_queue_item_detail(row))
    return out


@router.post(
    "/items/from-kit",
    response_model=list[PrintQueueItemDetailOut],
    status_code=status.HTTP_201_CREATED,
)
def create_queue_items_from_kit(
    body: QueueItemsFromKitCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    kit = (
        db.query(PrintKit)
        .options(joinedload(PrintKit.items).joinedload(PrintKitItem.gcode_file))
        .filter(PrintKit.id == body.kit_id)
        .first()
    )
    if kit is None:
        raise HTTPException(status_code=404, detail="Kit not found")
    if not kit.items:
        raise HTTPException(status_code=422, detail="Kit has no files")

    created: list[PrintQueueItem] = []
    for run_idx in range(body.kit_copies):
        for kit_item in kit.items:
            max_copy = (
                db.query(func.max(PrintQueueItem.copy_index))
                .filter(PrintQueueItem.gcode_file_id == kit_item.gcode_file_id)
                .scalar()
            )
            start = 0 if max_copy is None else int(max_copy) + 1
            for q in range(kit_item.quantity):
                item = PrintQueueItem(
                    gcode_file_id=kit_item.gcode_file_id,
                    copy_index=start + q,
                    priority=body.priority,
                    status=PrintQueueStatus.draft.value,
                    print_kit_id=kit.id,
                    kit_run_index=run_idx,
                    material_preset_id=kit_item.material_preset_id,
                )
                db.add(item)
                created.append(item)

    db.flush()
    db.commit()

    out: list[PrintQueueItemDetailOut] = []
    for item in created:
        row = (
            db.query(PrintQueueItem)
            .options(
                joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
                joinedload(PrintQueueItem.material_preset),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == item.id)
            .one()
        )
        out.append(_queue_item_detail(row))
    return out


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


@router.post("/plan/preview", response_model=list[PrintQueueItemDetailOut])
def preview_plan(
    body: PlanRequest,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Dry-run planner: returns assignments without saving."""
    items = suggest_assignments(
        db,
        queue_item_ids=body.queue_item_ids,
        waste_factor=body.waste_factor,
    )
    out: list[PrintQueueItemDetailOut] = []
    for it in items:
        db.refresh(it)
        item = (
            db.query(PrintQueueItem)
            .options(
                joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
                joinedload(PrintQueueItem.material_preset),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == it.id)
            .one()
        )
        out.append(_queue_item_detail(item))
    db.rollback()
    return out


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
                joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
                joinedload(PrintQueueItem.material_preset),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == it.id)
            .one()
        )
        out.append(_queue_item_detail(item))
    return out


@router.post("/plan/commit", response_model=list[PrintQueueItemDetailOut], status_code=status.HTTP_201_CREATED)
def commit_plan(
    body: PlanCommitRequest,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Create queued jobs from a planner session (no draft rows left behind)."""
    created: list[PrintQueueItem] = []
    for row in body.items:
        gf = (
            db.query(GCodeFile)
            .options(joinedload(GCodeFile.material_preset))
            .filter(GCodeFile.id == row.gcode_file_id)
            .first()
        )
        if gf is None:
            raise HTTPException(status_code=404, detail=f"G-code file {row.gcode_file_id} not found")
        if row.assigned_printer_id is not None and db.get(Printer, row.assigned_printer_id) is None:
            raise HTTPException(status_code=400, detail=f"Printer {row.assigned_printer_id} not found")

        max_copy = (
            db.query(func.max(PrintQueueItem.copy_index))
            .filter(PrintQueueItem.gcode_file_id == gf.id)
            .scalar()
        )
        start = 0 if max_copy is None else int(max_copy) + 1

        status_val = (
            PrintQueueStatus.queued.value
            if row.assigned_printer_id is not None
            else PrintQueueStatus.draft.value
        )
        item = PrintQueueItem(
            gcode_file_id=gf.id,
            copy_index=start,
            priority=row.priority,
            assigned_printer_id=row.assigned_printer_id,
            status=status_val,
            print_kit_id=row.print_kit_id,
            kit_run_index=row.kit_run_index,
            material_preset_id=row.material_preset_id,
        )
        db.add(item)
        created.append(item)

    db.flush()
    db.commit()

    out: list[PrintQueueItemDetailOut] = []
    for item in created:
        row = (
            db.query(PrintQueueItem)
            .options(
                joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
                joinedload(PrintQueueItem.material_preset),
                joinedload(PrintQueueItem.assigned_printer),
            )
            .filter(PrintQueueItem.id == item.id)
            .one()
        )
        out.append(_queue_item_detail(row))
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
        .options(joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset))
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
