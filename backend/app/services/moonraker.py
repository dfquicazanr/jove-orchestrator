from datetime import datetime, timezone
from typing import Any

import httpx

from app.models.printer import Printer, PrinterStatus
from app.services.moonraker_url import format_moonraker_connection_error, normalize_moonraker_base_url


async def moonraker_get_json(base_url: str, path: str, api_key: str | None = None) -> Any:
    url = base_url.rstrip("/") + path
    headers: dict[str, str] = {}
    if api_key:
        headers["X-Api-Key"] = api_key
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        return r.json()


def derive_printer_status_from_status(status: dict[str, Any]) -> str | None:
    """Map Klipper object status (``print_stats``, ``webhooks``, …) to ``PrinterStatus`` value.

    Moonraker keeps ``print_stats.state`` (e.g. ``standby``) across Klipper restarts; when Klipper
    shuts down, ``webhooks.state`` becomes ``shutdown`` / ``startup`` while ``print_stats`` may still
    look idle. Always consult ``webhooks`` first for those host states.
    """
    wh = status.get("webhooks")
    if isinstance(wh, dict):
        wh_raw = str(wh.get("state") or "").lower().strip()
        if wh_raw in ("startup", "shutdown"):
            return PrinterStatus.offline.value
        if wh_raw == "error":
            return PrinterStatus.error.value

    ps = status.get("print_stats")
    if isinstance(ps, dict):
        raw = str(ps.get("state") or "").lower().strip()
        if raw == "standby":
            return PrinterStatus.ready.value
        if raw == "paused":
            return PrinterStatus.paused.value
        if raw == "printing":
            return PrinterStatus.printing.value
        if raw == "complete":
            return PrinterStatus.finished_awaiting_cleanup.value
        if raw == "cancelled":
            return PrinterStatus.ready.value
        if raw == "error":
            return PrinterStatus.error.value

    if isinstance(wh, dict):
        wh_raw = str(wh.get("state") or "").lower().strip()
        if wh_raw == "ready":
            return PrinterStatus.ready.value

    return None


def extract_webhooks_summary_from_object_status(status: dict[str, Any]) -> tuple[str | None, str | None]:
    """Raw Klipper ``webhooks.state`` and short ``state_message`` (for UI / SSE)."""
    wh = status.get("webhooks")
    if not isinstance(wh, dict):
        return None, None
    raw = str(wh.get("state") or "").strip()
    if not raw:
        return None, None
    msg = wh.get("state_message")
    msg_s = str(msg).strip()[:400] if msg else None
    return (raw, msg_s)


def derive_printer_status_from_moonraker(data: Any) -> str | None:
    """Map Moonraker /printer/objects/query or subscribe response to ``last_known_status``."""
    if not isinstance(data, dict):
        return None
    result = data.get("result")
    if not isinstance(result, dict):
        return None
    status = result.get("status")
    if not isinstance(status, dict):
        return None
    return derive_printer_status_from_status(status)


def merge_printer_status_objects(
    accumulated: dict[str, Any], delta: dict[str, Any]
) -> dict[str, Any]:
    """Merge a ``notify_status_update`` delta into accumulated Klipper object state."""
    for obj_name, fields in delta.items():
        if not isinstance(fields, dict):
            continue
        bucket = accumulated.setdefault(obj_name, {})
        if isinstance(bucket, dict):
            bucket.update(fields)
    return accumulated


def moonraker_error_from_status(status: dict[str, Any]) -> str | None:
    """Best-effort human-readable error from subscribed Klipper objects."""
    wh = status.get("webhooks")
    if isinstance(wh, dict):
        state = str(wh.get("state") or "").lower().strip()
        msg = wh.get("state_message")
        if state in ("error", "shutdown") and msg:
            return str(msg)
        if state == "startup":
            return str(msg) if msg else "Klipper is starting"
    ps = status.get("print_stats")
    if isinstance(ps, dict) and str(ps.get("state") or "").lower().strip() == "error":
        msg = ps.get("message")
        if msg:
            return str(msg)
    return None


def moonraker_http_to_ws_url(base_url: str) -> str:
    base = normalize_moonraker_base_url(base_url)
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :] + "/websocket"
    return "ws://" + base[len("http://") :] + "/websocket"


async def ping_moonraker_at(
    base_url: str, api_key: str | None = None
) -> tuple[bool, str | None, str | None, str | None, str | None]:
    """Ping Moonraker at a URL without a ``Printer`` row (e.g. add-printer form test).

    Returns ``(ok, error_message, derived_status_if_ok, webhooks_state_if_any, webhooks_message_if_any)``.
    """
    try:
        base = normalize_moonraker_base_url(base_url)
    except ValueError as e:
        return False, str(e), None, None, None
    try:
        data = await moonraker_get_json(
            base,
            "/printer/objects/query?webhooks&print_stats",
            api_key,
        )
        if "result" not in data:
            return False, "Unexpected Moonraker response", None, None, None
        derived = derive_printer_status_from_moonraker(data)
        result = data.get("result")
        status = result.get("status") if isinstance(result, dict) else None
        wh_st: str | None = None
        wh_msg: str | None = None
        if isinstance(status, dict):
            wh_st, wh_msg = extract_webhooks_summary_from_object_status(status)
        return True, None, derived, wh_st, wh_msg
    except Exception as e:  # noqa: BLE001 — surface to operator
        return False, format_moonraker_connection_error(e, base_url=base), None, None, None


async def ping_printer(printer: Printer) -> tuple[bool, str | None, str | None, str | None, str | None]:
    """Return (ok, error_message, derived_status_if_ok, webhooks_state, webhooks_message)."""
    return await ping_moonraker_at(printer.moonraker_base_url, printer.moonraker_api_key)


def apply_ping_to_printer(
    printer: Printer,
    ok: bool,
    err: str | None,
    derived_status: str | None = None,
) -> None:
    printer.last_moonraker_check_at = datetime.now(timezone.utc)
    if ok:
        printer.last_moonraker_error = None
        printer.last_known_status = (
            derived_status if derived_status else PrinterStatus.ready.value
        )
    else:
        printer.last_moonraker_error = err
        printer.last_known_status = PrinterStatus.offline.value
