"""Planner assignment minimizes makespan across compatible printers."""

from types import SimpleNamespace

from app.services.planner import _PrinterPlanState, _sort_items_for_planning, pick_printer_for_job


def _printer(
    pid: int,
    *,
    status: str = "ready",
    material: str = "PLA",
    color: str = "",
    filament: float = 10_000.0,
):
    return SimpleNamespace(
        id=pid,
        last_known_status=status,
        loaded_material=material,
        loaded_color=color,
        remaining_filament_grams=filament,
    )


def _job(
    *,
    print_time: int = 3780,
    material: str = "PLA",
    color: str | None = None,
    filament: float = 50.0,
):
    color_preset = SimpleNamespace(name=color) if color else None
    return SimpleNamespace(
        print_time_seconds=print_time,
        required_material=material,
        required_color=color,
        filament_mass_grams_estimate=filament,
        material_preset=SimpleNamespace(name=material),
        material_color_preset=color_preset,
    )


def _item(iid: int, *, priority: int = 0, material_preset_id=None, print_kit_id=None):
    return SimpleNamespace(
        id=iid,
        priority=priority,
        material_preset_id=material_preset_id,
        material_preset=None,
        print_kit_id=print_kit_id,
        gcode_file=_job(),
    )


def test_splits_jobs_across_least_busy_printers():
    printers = [_printer(1), _printer(2), _printer(3, status="offline")]
    states = [
        _PrinterPlanState(printer=p, remaining_filament_grams=float(p.remaining_filament_grams))
        for p in printers
    ]
    items = [_item(i) for i in range(1, 5)]

    assigned: dict[int, int] = {}
    for item in _sort_items_for_planning(items):
        chosen = pick_printer_for_job(states, item.gcode_file, item, 1.0)
        assert chosen is not None
        assigned[item.id] = chosen.printer.id

    assert assigned[1] == 1
    assert assigned[2] == 2
    assert assigned[3] == 1
    assert assigned[4] == 2
    assert states[0].queue_end_seconds == 3780 * 2
    assert states[1].queue_end_seconds == 3780 * 2


def test_skips_printer_without_filament_for_second_job():
    printers = [_printer(1, filament=60.0), _printer(2, filament=10_000.0)]
    states = [
        _PrinterPlanState(printer=p, remaining_filament_grams=float(p.remaining_filament_grams))
        for p in printers
    ]
    items = [_item(1), _item(2)]

    pick_printer_for_job(states, items[0].gcode_file, items[0], 1.0)
    chosen = pick_printer_for_job(states, items[1].gcode_file, items[1], 1.0)

    assert chosen is not None
    assert chosen.printer.id == 2


def test_constrained_color_job_scheduled_before_flexible_color():
    """Light-blue-only job on printer 1; flexible-color job should use printer 2 in parallel."""
    printers = [_printer(1, color="Light Blue"), _printer(2, color="")]
    states = [
        _PrinterPlanState(printer=p, remaining_filament_grams=float(p.remaining_filament_grams))
        for p in printers
    ]
    item_blue = SimpleNamespace(
        id=1,
        priority=0,
        material_preset_id=None,
        material_preset=None,
        print_kit_id=None,
        gcode_file=_job(print_time=63 * 60, color="Light Blue"),
    )
    item_any = SimpleNamespace(
        id=2,
        priority=0,
        material_preset_id=None,
        material_preset=None,
        print_kit_id=None,
        gcode_file=_job(print_time=91 * 60, color=None),
    )

    assigned: dict[int, int] = {}
    for item in _sort_items_for_planning([item_any, item_blue]):
        chosen = pick_printer_for_job(states, item.gcode_file, item, 1.0)
        assert chosen is not None
        assigned[item.id] = chosen.printer.id

    assert assigned[1] == 1
    assert assigned[2] == 2
    assert states[0].queue_end_seconds == 63 * 60
    assert states[1].queue_end_seconds == 91 * 60
