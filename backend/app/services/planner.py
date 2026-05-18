"""Print planner: assign jobs to printers to minimize total completion time."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, joinedload

from app.models.gcode_file import GCodeFile
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.printer import Printer, PrinterStatus

DEFAULT_PRINT_TIME_SECONDS = 30 * 60


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _printer_ready(p: Printer) -> bool:
    return p.last_known_status in (
        PrinterStatus.ready.value,
        PrinterStatus.finished_awaiting_cleanup.value,
    )


def _effective_material(job: GCodeFile, item: PrintQueueItem) -> str | None:
    if item.material_preset is not None:
        return item.material_preset.name
    if item.material_preset_id and job.material_preset is not None:
        return job.material_preset.name
    return job.required_material


def _effective_color(job: GCodeFile, item: PrintQueueItem) -> str | None:
    if item.print_kit_id is not None and item.material_preset_id is not None:
        return None
    preset = job.material_color_preset
    if preset is not None:
        return preset.name
    return job.required_color


def _filament_need(job: GCodeFile, waste_factor: float) -> float | None:
    est = job.filament_mass_grams_estimate
    if est is None:
        return None
    return float(est) * waste_factor


def job_duration_seconds(job: GCodeFile) -> int:
    if job.print_time_seconds is not None and job.print_time_seconds > 0:
        return int(job.print_time_seconds)
    return DEFAULT_PRINT_TIME_SECONDS


@dataclass
class _PrinterPlanState:
    printer: Printer
    queue_end_seconds: float = 0.0
    remaining_filament_grams: float = 0.0


def _compatible_state(
    state: _PrinterPlanState,
    job: GCodeFile,
    item: PrintQueueItem,
    waste_factor: float,
) -> bool:
    p = state.printer
    if not _printer_ready(p):
        return False
    if not _norm(p.loaded_material):
        return False
    req_m = _norm(_effective_material(job, item))
    if req_m and _norm(p.loaded_material) != req_m:
        return False
    req_c = _norm(_effective_color(job, item))
    if req_c and _norm(p.loaded_color) != req_c:
        return False
    need = _filament_need(job, waste_factor)
    if need is not None and state.remaining_filament_grams < need:
        return False
    return True


def _sort_items_for_planning(items: list[PrintQueueItem]) -> list[PrintQueueItem]:
    """Higher priority first; longer jobs first within the same priority (LPT)."""

    def sort_key(item: PrintQueueItem) -> tuple:
        job = item.gcode_file
        dur = job_duration_seconds(job)
        return (-item.priority, -dur, item.id)

    return sorted(items, key=sort_key)


def pick_printer_for_job(
    states: list[_PrinterPlanState],
    job: GCodeFile,
    item: PrintQueueItem,
    waste_factor: float,
) -> _PrinterPlanState | None:
    """Assign to the compatible printer that finishes this job soonest."""
    duration = job_duration_seconds(job)
    best: _PrinterPlanState | None = None
    best_finish = float("inf")

    for state in sorted(states, key=lambda s: s.printer.id):
        if not _compatible_state(state, job, item, waste_factor):
            continue
        finish = state.queue_end_seconds + duration
        if finish < best_finish:
            best_finish = finish
            best = state

    if best is None:
        return None

    best.queue_end_seconds = best_finish
    need = _filament_need(job, waste_factor)
    if need is not None:
        best.remaining_filament_grams = max(0.0, best.remaining_filament_grams - need)
    return best


def suggest_assignments(
    db: Session,
    *,
    queue_item_ids: list[int] | None,
    waste_factor: float,
) -> list[PrintQueueItem]:
    q = (
        db.query(PrintQueueItem)
        .options(
            joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_preset),
            joinedload(PrintQueueItem.gcode_file).joinedload(GCodeFile.material_color_preset),
            joinedload(PrintQueueItem.material_preset),
        )
        .filter(PrintQueueItem.status == PrintQueueStatus.draft.value)
    )
    if queue_item_ids:
        q = q.filter(PrintQueueItem.id.in_(queue_item_ids))
    items = q.all()
    printers = db.query(Printer).order_by(Printer.id.asc()).all()

    states = [
        _PrinterPlanState(
            printer=p,
            remaining_filament_grams=float(p.remaining_filament_grams),
        )
        for p in printers
    ]

    for item in _sort_items_for_planning(items):
        job = item.gcode_file
        chosen = pick_printer_for_job(states, job, item, waste_factor)
        if chosen is not None:
            item.assigned_printer_id = chosen.printer.id
            item.status = PrintQueueStatus.queued.value

    db.flush()
    return items
