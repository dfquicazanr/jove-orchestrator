"""Greedy v1 print planner: assign draft queue items to compatible printers."""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models.gcode_file import GCodeFile
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.printer import Printer, PrinterStatus


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _printer_ready(p: Printer) -> bool:
    return p.last_known_status in (
        PrinterStatus.ready.value,
        PrinterStatus.finished_awaiting_cleanup.value,
    )


def _compatible(printer: Printer, job: GCodeFile, waste_factor: float) -> bool:
    if not _printer_ready(printer):
        return False
    req_m = _norm(job.required_material)
    req_c = _norm(job.required_color)
    if req_m and _norm(printer.loaded_material) != req_m:
        return False
    if req_c and _norm(printer.loaded_color) != req_c:
        return False
    est = job.filament_mass_grams_estimate
    if est is not None:
        need = float(est) * waste_factor
        if printer.remaining_filament_grams < need:
            return False
    return True


def suggest_assignments(
    db: Session,
    *,
    queue_item_ids: list[int] | None,
    waste_factor: float,
) -> list[PrintQueueItem]:
    q = db.query(PrintQueueItem).options(joinedload(PrintQueueItem.gcode_file)).filter(
        PrintQueueItem.status == PrintQueueStatus.draft.value
    )
    if queue_item_ids:
        q = q.filter(PrintQueueItem.id.in_(queue_item_ids))
    items = q.order_by(PrintQueueItem.priority.desc(), PrintQueueItem.id.asc()).all()
    printers = db.query(Printer).order_by(Printer.id.asc()).all()

    for item in items:
        job = item.gcode_file
        chosen: Printer | None = None
        for p in printers:
            if _compatible(p, job, waste_factor):
                chosen = p
                break
        if chosen is not None:
            item.assigned_printer_id = chosen.id
            item.status = PrintQueueStatus.queued.value
        # else leave draft for operator to fix filament or requirements

    db.flush()
    return items
