import asyncio
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user_for_sse,
    get_db,
    require_manager,
    require_viewer_or_manager,
)
from app.config import get_settings
from app.models.printer import Printer
from app.models.user import User
from app.schemas.printer import (
    LoadedFilamentUpdate,
    MoonrakerPingResult,
    PrinterControlResult,
    PrinterCreate,
    PrinterHaPowerActionOut,
    PrinterHaPowerStatesOut,
    PrinterHomeBody,
    PrinterLivePatchOut,
    PrinterLiveSyncOut,
    PrinterOut,
    PrinterPreheatBody,
    PrinterPrintGcodeResult,
    PrinterTestConnectionBody,
    PrinterUpdate,
    RollReplacement,
)
from app.services import homeassistant as ha_svc
from app.services.moonraker import apply_ping_to_printer, ping_moonraker_at, ping_printer
from app.services.moonraker_control import (
    build_cooldown_script,
    build_home_script,
    build_preheat_script,
    moonraker_print_action,
    run_gcode_script,
)
from app.services.moonraker_print import upload_gcode_to_moonraker
from app.services.moonraker_url import MoonrakerUrlError, normalize_moonraker_base_url
from app.services.moonraker_watch import PrinterLiveUpdate, moonraker_watch

router = APIRouter()


def _live_patch_out(live: PrinterLiveUpdate) -> PrinterLivePatchOut:
    return PrinterLivePatchOut(
        printer_id=live.printer_id,
        last_known_status=live.last_known_status,
        last_moonraker_error=live.last_moonraker_error,
        connected=live.connected,
        extruder_actual_c=live.extruder_actual_c,
        extruder_target_c=live.extruder_target_c,
        bed_actual_c=live.bed_actual_c,
        bed_target_c=live.bed_target_c,
        ts=time.time(),
        ws_live=live.moonraker_ws_connected,
    )


def _printer_out(p: Printer) -> PrinterOut:
    return PrinterOut(
        id=p.id,
        name=p.name,
        moonraker_base_url=p.moonraker_base_url,
        moonraker_api_key_present=bool(p.moonraker_api_key),
        ha_power_entity_id=p.ha_power_entity_id,
        loaded_material=p.loaded_material,
        loaded_color=p.loaded_color,
        remaining_filament_grams=p.remaining_filament_grams,
        last_known_status=p.last_known_status,
        last_moonraker_check_at=p.last_moonraker_check_at,
        last_moonraker_error=p.last_moonraker_error,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("", response_model=list[PrinterOut])
def list_printers(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    return [_printer_out(p) for p in db.query(Printer).order_by(Printer.id.asc()).all()]


@router.get("/ha-power/states", response_model=PrinterHaPowerStatesOut)
async def list_printer_ha_power_states(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    """Current Home Assistant on/off for each printer with ``ha_power_entity_id``."""
    rows = db.query(Printer).order_by(Printer.id.asc()).all()
    entity_by_printer: dict[int, str] = {}
    entity_ids: list[str] = []
    for p in rows:
        eid = (p.ha_power_entity_id or "").strip()
        if not eid:
            continue
        entity_by_printer[p.id] = eid
        entity_ids.append(eid)
    ha_states = await ha_svc.get_power_states_for_entities(db, entity_ids)
    states: dict[int, bool | None] = {pid: ha_states.get(eid) for pid, eid in entity_by_printer.items()}
    return PrinterHaPowerStatesOut(states=states)


@router.post("", response_model=PrinterOut, status_code=status.HTTP_201_CREATED)
def create_printer(
    body: PrinterCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    try:
        moonraker_url = normalize_moonraker_base_url(body.moonraker_base_url)
    except MoonrakerUrlError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    p = Printer(
        name=body.name,
        moonraker_base_url=moonraker_url,
        moonraker_api_key=body.moonraker_api_key,
        ha_power_entity_id=body.ha_power_entity_id,
        loaded_material=body.loaded_material,
        loaded_color=body.loaded_color,
        remaining_filament_grams=body.remaining_filament_grams,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _printer_out(p)


@router.post("/test-connection", response_model=MoonrakerPingResult)
async def test_moonraker_connection(
    body: PrinterTestConnectionBody,
    _: User = Depends(require_manager),
):
    """Reachability check before saving a new printer or edited URL (does not persist)."""
    url = body.moonraker_base_url.strip().rstrip("/")
    ok, err, _, _, _ = await ping_moonraker_at(url, body.moonraker_api_key)
    return MoonrakerPingResult(ok=ok, message=err)


@router.get("/status/stream")
async def stream_printer_status(
    _: object = Depends(get_current_user_for_sse),
):
    """Server-Sent Events: live ``last_known_status`` from Moonraker WebSocket subscriptions."""

    async def event_generator():
        q = moonraker_watch.subscribe()
        try:
            for snap in moonraker_watch.snapshot():
                yield f"data: {snap.to_json()}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25.0)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if msg is None:
                    break
                yield f"data: {msg}\n\n"
        finally:
            moonraker_watch.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{printer_id}", response_model=PrinterOut)
def get_printer(
    printer_id: int,
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    return _printer_out(p)


@router.patch("/{printer_id}", response_model=PrinterOut)
def update_printer(
    printer_id: int,
    body: PrinterUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    data = body.model_dump(exclude_unset=True)
    if "moonraker_base_url" in data and data["moonraker_base_url"] is not None:
        try:
            data["moonraker_base_url"] = normalize_moonraker_base_url(data["moonraker_base_url"])
        except MoonrakerUrlError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    for k, v in data.items():
        setattr(p, k, v)
    p.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(p)
    return _printer_out(p)


@router.delete("/{printer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_printer(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    db.delete(p)
    db.commit()
    return None


@router.put("/{printer_id}/filament", response_model=PrinterOut)
def set_loaded_filament(
    printer_id: int,
    body: LoadedFilamentUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    p.loaded_material = body.loaded_material
    p.loaded_color = body.loaded_color
    p.remaining_filament_grams = body.remaining_filament_grams
    p.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(p)
    return _printer_out(p)


@router.put("/{printer_id}/roll", response_model=PrinterOut)
def replace_roll(
    printer_id: int,
    body: RollReplacement,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    p.loaded_material = body.loaded_material
    p.loaded_color = body.loaded_color
    p.remaining_filament_grams = body.remaining_filament_grams
    p.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(p)
    return _printer_out(p)


@router.post("/{printer_id}/gcode/print", response_model=PrinterPrintGcodeResult)
async def print_gcode_on_printer(
    printer_id: int,
    file: UploadFile = File(...),
    filament_used_grams: float | None = Form(default=None),
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Upload a G-code file to this printer's Moonraker and start printing."""
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")

    settings = get_settings()
    max_bytes = settings.gcode_max_upload_mb * 1024 * 1024
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status_code=413, detail="File too large")
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    ok, msg, payload = await upload_gcode_to_moonraker(
        p.moonraker_base_url,
        p.moonraker_api_key,
        file.filename or "job.gcode",
        content,
        start_print=True,
    )
    moonraker_path: str | None = None
    print_started = False
    print_queued = False
    if isinstance(payload, dict):
        print_started = bool(payload.get("print_started"))
        print_queued = bool(payload.get("print_queued"))
        item = payload.get("item")
        if isinstance(item, dict) and item.get("path"):
            moonraker_path = str(item["path"])

    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Moonraker upload failed")

    if get_settings().moonraker_watch_enabled:
        await moonraker_watch.ensure_websocket_watch(p.id)

    remaining: float | None = None
    if filament_used_grams is not None and filament_used_grams > 0:
        p.remaining_filament_grams = max(0.0, p.remaining_filament_grams - filament_used_grams)
        p.updated_at = datetime.now(UTC)
        remaining = float(p.remaining_filament_grams)
        db.commit()
        db.refresh(p)

    return PrinterPrintGcodeResult(
        ok=True,
        message=msg,
        moonraker_path=moonraker_path,
        print_started=print_started,
        print_queued=print_queued,
        remaining_filament_grams=remaining,
    )


def _get_printer_or_404(printer_id: int, db: Session) -> Printer:
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    return p


@router.post("/{printer_id}/control/home", response_model=PrinterControlResult)
async def control_home(
    printer_id: int,
    body: PrinterHomeBody | None = None,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    axes = body.axes if body else "all"
    ok, msg = await run_gcode_script(p.moonraker_base_url, p.moonraker_api_key, build_home_script(axes))
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Home failed")
    return PrinterControlResult(ok=True, message="Homing started")


@router.post("/{printer_id}/control/preheat", response_model=PrinterControlResult)
async def control_preheat(
    printer_id: int,
    body: PrinterPreheatBody | None = None,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    pre = body or PrinterPreheatBody()
    script = build_preheat_script(pre.hotend_c, pre.bed_c)
    ok, msg = await run_gcode_script(p.moonraker_base_url, p.moonraker_api_key, script)
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Preheat failed")
    return PrinterControlResult(
        ok=True,
        message=f"Heating hotend to {int(round(pre.hotend_c))}°C and bed to {int(round(pre.bed_c))}°C",
    )


@router.post("/{printer_id}/control/cooldown", response_model=PrinterControlResult)
async def control_cooldown(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    ok, msg = await run_gcode_script(
        p.moonraker_base_url, p.moonraker_api_key, build_cooldown_script()
    )
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Cooldown failed")
    return PrinterControlResult(ok=True, message="Heaters turned off")


@router.post("/{printer_id}/control/print/cancel", response_model=PrinterControlResult)
async def control_cancel_print(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    ok, msg = await moonraker_print_action(p.moonraker_base_url, p.moonraker_api_key, "cancel")
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Cancel failed")
    return PrinterControlResult(ok=True, message="Print cancelled")


@router.post("/{printer_id}/control/print/pause", response_model=PrinterControlResult)
async def control_pause_print(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    ok, msg = await moonraker_print_action(p.moonraker_base_url, p.moonraker_api_key, "pause")
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Pause failed")
    return PrinterControlResult(ok=True, message="Print paused")


@router.post("/{printer_id}/control/print/resume", response_model=PrinterControlResult)
async def control_resume_print(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = _get_printer_or_404(printer_id, db)
    ok, msg = await moonraker_print_action(p.moonraker_base_url, p.moonraker_api_key, "resume")
    if not ok:
        raise HTTPException(status_code=502, detail=msg or "Resume failed")
    return PrinterControlResult(ok=True, message="Print resumed")


@router.post("/{printer_id}/moonraker/ping", response_model=MoonrakerPingResult)
async def moonraker_ping(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    result = await _sync_printer_live_row(printer_id, db)
    return MoonrakerPingResult(ok=result.ok, message=result.message)


@router.post("/{printer_id}/live/sync", response_model=PrinterLiveSyncOut)
async def sync_printer_live(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Ping Moonraker, refresh live temps/status, ensure WS — returns data for Farm UI polling."""
    return await _sync_printer_live_row(printer_id, db)


async def _sync_printer_live_row(printer_id: int, db: Session) -> PrinterLiveSyncOut:
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    ok, err, derived, _wh_st, _wh_msg = await ping_printer(p)
    apply_ping_to_printer(p, ok, err, derived)
    p.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(p)
    if get_settings().moonraker_watch_enabled:
        # sync_printer_live already HTTP-refreshes and SSE-publishes; do not manual_ping
        # broadcast here — that transport clears temps when WS is still connecting.
        live = await moonraker_watch.sync_printer_live(p.id)
    else:
        live = PrinterLiveUpdate(
            printer_id=p.id,
            last_known_status=p.last_known_status,
            last_moonraker_error=p.last_moonraker_error,
            connected=ok,
        )
    return PrinterLiveSyncOut(
        ok=ok,
        message=err,
        printer=_printer_out(p),
        live=_live_patch_out(live),
    )


@router.post("/{printer_id}/power/on", response_model=PrinterHaPowerActionOut)
async def power_on(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not p.ha_power_entity_id:
        raise HTTPException(status_code=400, detail="Printer has no ha_power_entity_id configured")
    try:
        await ha_svc.turn_entity_on(p.ha_power_entity_id, db)
        power_on_state = await ha_svc.read_power_state_after_service(
            db, p.ha_power_entity_id, expected=True
        )
    except ha_svc.HomeAssistantError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return PrinterHaPowerActionOut(ok=True, power_on=power_on_state)


@router.post("/{printer_id}/power/off", response_model=PrinterHaPowerActionOut)
async def power_off(
    printer_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    p = db.get(Printer, printer_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not p.ha_power_entity_id:
        raise HTTPException(status_code=400, detail="Printer has no ha_power_entity_id configured")
    try:
        await ha_svc.turn_entity_off(p.ha_power_entity_id, db)
        power_on_state = await ha_svc.read_power_state_after_service(
            db, p.ha_power_entity_id, expected=False
        )
    except ha_svc.HomeAssistantError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return PrinterHaPowerActionOut(ok=True, power_on=power_on_state)
