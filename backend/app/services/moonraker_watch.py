"""Background Moonraker WebSocket subscriptions and live status broadcast."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import websockets

from app.config import get_settings
from app.database import SessionLocal
from app.models.printer import Printer, PrinterStatus
from app.services.moonraker import (
    apply_ping_to_printer,
    derive_printer_status_from_status,
    extract_live_heater_temperatures,
    extract_webhooks_summary_from_object_status,
    merge_printer_status_objects,
    moonraker_error_from_status,
    moonraker_get_json,
    moonraker_http_to_ws_url,
    ping_moonraker_at,
)
from app.services.moonraker_url import format_moonraker_connection_error

log = logging.getLogger(__name__)

SUBSCRIBE_OBJECTS = {
    "print_stats": None,
    "webhooks": None,
    "extruder": None,
    "heater_bed": None,
}
RELOAD_PRINTERS_SEC = 30.0
RECONNECT_BASE_SEC = 2.0
RECONNECT_MAX_SEC = 60.0
DB_PERSIST_MIN_INTERVAL_SEC = 1.0
WS_STALE_SEC = 20.0
LIVE_REFRESH_INTERVAL_SEC = 10.0
# When HTTP liveness marks a printer reachable but WS never attached, retry WS at most this often.
HTTP_WS_PROMOTE_COOLDOWN_SEC = 15.0
OBJECTS_QUERY_PATH = "/printer/objects/query?extruder&heater_bed&print_stats&webhooks"


@dataclass
class PrinterLiveUpdate:
    printer_id: int
    last_known_status: str
    last_moonraker_error: str | None
    connected: bool
    extruder_actual_c: float | None = None
    extruder_target_c: float | None = None
    bed_actual_c: float | None = None
    bed_target_c: float | None = None
    moonraker_ws_connected: bool = False
    last_ws_status: str | None = None
    last_ws_at: str | None = None
    last_http_probe_at: str | None = None
    last_http_probe_ok: bool | None = None
    last_http_probe_source: str | None = None
    http_liveness_interval_sec: float = 0.0
    klipper_webhooks_state: str | None = None
    klipper_state_message: str | None = None

    def to_json(self) -> str:
        # Keep SSE payload small; heaters only update over the Moonraker WebSocket merge path.
        return json.dumps(
            {
                "printer_id": self.printer_id,
                "last_known_status": self.last_known_status,
                "last_moonraker_error": self.last_moonraker_error,
                "connected": self.connected,
                "extruder_actual_c": self.extruder_actual_c,
                "extruder_target_c": self.extruder_target_c,
                "bed_actual_c": self.bed_actual_c,
                "bed_target_c": self.bed_target_c,
                "ts": time.time(),
                "ws_live": self.moonraker_ws_connected,
            }
        )


class MoonrakerWatchService:
    def __init__(self) -> None:
        self._running = False
        self._coordinator_task: asyncio.Task[None] | None = None
        self._http_liveness_task: asyncio.Task[None] | None = None
        self._live_refresh_task: asyncio.Task[None] | None = None
        self._last_ws_message_at: dict[int, float] = {}
        self._printer_tasks: dict[int, asyncio.Task[None]] = {}
        self._printer_targets: dict[int, tuple[str, str | None]] = {}
        self._live: dict[int, PrinterLiveUpdate] = {}
        # Merged Klipper objects for the active WS session (deltas + notify_klippy_*).
        self._ws_object_state: dict[int, dict[str, Any]] = {}
        self._subscribers: list[asyncio.Queue[str | None]] = []
        self._lock = asyncio.Lock()
        self._last_db_persist: dict[int, float] = {}
        self._last_ws_promote_at: dict[int, float] = {}

    def subscribe(self) -> asyncio.Queue[str | None]:
        q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=64)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str | None]) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    def snapshot(self) -> list[PrinterLiveUpdate]:
        return list(self._live.values())

    async def _record_klippy_notice(
        self,
        printer_id: int,
        method: str,
        params: Any,
    ) -> None:
        """Apply Moonraker ``notify_klippy_*`` to merged object state and publish."""
        if not isinstance(method, str) or not method.startswith("notify_klippy_"):
            return
        accumulated = self._ws_object_state.setdefault(printer_id, {})
        if method == "notify_klippy_ready":
            if not isinstance(accumulated.get("webhooks"), dict):
                accumulated["webhooks"] = {}
            accumulated["webhooks"]["state"] = "ready"
            accumulated["webhooks"].pop("state_message", None)
            await self._publish_from_status(printer_id, accumulated, connected=True)
        elif method == "notify_klippy_shutdown":
            if not isinstance(accumulated.get("webhooks"), dict):
                accumulated["webhooks"] = {}
            accumulated["webhooks"]["state"] = "shutdown"
            await self._publish_from_status(printer_id, accumulated, connected=True)
        elif method == "notify_klippy_disconnected":
            accumulated["webhooks"] = {"state": "startup"}
            await self._publish_from_status(printer_id, accumulated, connected=True)
        else:
            log.debug("ignoring unknown klippy notify %s params=%r", method, params)

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._coordinator_task = asyncio.create_task(self._coordinator_loop(), name="moonraker-watch")
        if get_settings().moonraker_http_liveness_interval_sec > 0:
            self._http_liveness_task = asyncio.create_task(
                self._http_liveness_loop(), name="moonraker-http-liveness"
            )
        self._live_refresh_task = asyncio.create_task(
            self._live_refresh_loop(), name="moonraker-live-refresh"
        )

    async def stop(self) -> None:
        self._running = False
        if self._http_liveness_task:
            self._http_liveness_task.cancel()
            try:
                await self._http_liveness_task
            except asyncio.CancelledError:
                pass
            self._http_liveness_task = None
        if self._live_refresh_task:
            self._live_refresh_task.cancel()
            try:
                await self._live_refresh_task
            except asyncio.CancelledError:
                pass
            self._live_refresh_task = None
        if self._coordinator_task:
            self._coordinator_task.cancel()
            try:
                await self._coordinator_task
            except asyncio.CancelledError:
                pass
            self._coordinator_task = None
        for task in list(self._printer_tasks.values()):
            task.cancel()
        if self._printer_tasks:
            await asyncio.gather(*self._printer_tasks.values(), return_exceptions=True)
        self._printer_tasks.clear()
        self._printer_targets.clear()
        self._ws_object_state.clear()
        self._last_ws_message_at.clear()
        self._last_ws_promote_at.clear()
        for q in self._subscribers:
            await q.put(None)
        self._subscribers.clear()

    async def _coordinator_loop(self) -> None:
        while self._running:
            try:
                await self._sync_printer_watchers()
            except Exception:
                log.exception("moonraker watch coordinator error")
            await asyncio.sleep(RELOAD_PRINTERS_SEC)

    async def _live_refresh_loop(self) -> None:
        """Recover stuck UI when the WS stops sending ``notify_status_update``."""
        await asyncio.sleep(5.0)
        while self._running:
            try:
                await self._refresh_stale_live_printers()
            except Exception:
                log.exception("moonraker live refresh error")
            await asyncio.sleep(LIVE_REFRESH_INTERVAL_SEC)

    async def _refresh_stale_live_printers(self) -> None:
        loop = asyncio.get_running_loop()
        now = loop.time()
        for printer_id, spec in list(self._printer_targets.items()):
            if not self._running or printer_id not in self._printer_targets:
                break
            live = self._live.get(printer_id)
            if live is None or not live.connected:
                continue
            if not live.moonraker_ws_connected:
                await self._maybe_promote_to_websocket(printer_id, spec)
                continue
            last = self._last_ws_message_at.get(printer_id, 0.0)
            if last <= 0 or (now - last) < WS_STALE_SEC:
                continue
            base_url, api_key = spec
            log.info(
                "moonraker printer %s: no ws activity %.0fs — http refresh",
                printer_id,
                now - last,
            )
            await self._refresh_printer_via_http(printer_id, base_url, api_key)
            last_after = self._last_ws_message_at.get(printer_id, 0.0)
            if (now - last_after) >= WS_STALE_SEC:
                log.info("moonraker printer %s: still stale after http refresh — restarting ws", printer_id)
                await self._restart_printer_task(printer_id, spec)

    async def _refresh_printer_via_http(
        self, printer_id: int, base_url: str, api_key: str | None
    ) -> None:
        try:
            data = await moonraker_get_json(base_url, OBJECTS_QUERY_PATH, api_key)
        except Exception as exc:
            log.debug("moonraker http refresh printer %s failed: %s", printer_id, exc)
            return
        if not isinstance(data, dict):
            return
        result = data.get("result")
        if not isinstance(result, dict):
            return
        status = result.get("status")
        if not isinstance(status, dict):
            return
        accumulated = self._ws_object_state.setdefault(printer_id, {})
        for key, value in status.items():
            if isinstance(value, dict):
                accumulated[key] = dict(value)
        loop = asyncio.get_running_loop()
        self._last_ws_message_at[printer_id] = loop.time()
        await self._publish_from_status(printer_id, accumulated, connected=True)

    def _touch_ws_activity(self, printer_id: int) -> None:
        loop = asyncio.get_running_loop()
        self._last_ws_message_at[printer_id] = loop.time()

    async def _http_liveness_loop(self) -> None:
        """HTTP fallback when the WebSocket is down — same truth as manual Sync (ping)."""
        await asyncio.sleep(3.0)
        while self._running:
            interval = get_settings().moonraker_http_liveness_interval_sec
            if interval <= 0:
                return
            try:
                await self._run_http_liveness_round()
            except Exception:
                log.exception("moonraker HTTP liveness round error")
            await asyncio.sleep(interval)

    async def _run_http_liveness_round(self) -> None:
        targets = self._printer_targets.copy()
        for printer_id, (base_url, api_key) in targets.items():
            if not self._running or printer_id not in self._printer_targets:
                break
            live = self._live.get(printer_id)
            if live is not None and live.connected and live.moonraker_ws_connected:
                continue
            ok, err, derived, wh_st, wh_msg = await ping_moonraker_at(base_url, api_key)
            if not self._running or printer_id not in self._printer_targets:
                break
            live2 = self._live.get(printer_id)
            if live2 is not None and live2.connected and live2.moonraker_ws_connected:
                continue
            if ok:
                st = derived if derived else PrinterStatus.ready.value
                await self._publish(
                    printer_id,
                    st,
                    None,
                    connected=True,
                    transport="http_liveness",
                    http_klipper_snapshot=(wh_st, wh_msg),
                )
                if printer_id in self._printer_targets:
                    spec = self._printer_targets[printer_id]
                    await self._maybe_promote_to_websocket(printer_id, spec)
            else:
                await self._publish(
                    printer_id,
                    PrinterStatus.offline.value,
                    err,
                    connected=False,
                    transport="http_liveness",
                    http_klipper_snapshot=(wh_st, wh_msg),
                )

    async def _sync_printer_watchers(self) -> None:
        rows = await asyncio.to_thread(self._load_printer_targets)
        target_ids = set(rows.keys())
        for pid, spec in rows.items():
            prev = self._printer_targets.get(pid)
            if prev != spec:
                await self._restart_printer_task(pid, spec)
            elif pid not in self._printer_tasks:
                await self._restart_printer_task(pid, spec)
        for pid in list(self._printer_tasks):
            if pid not in target_ids:
                await self._stop_printer_task(pid)

    def _load_printer_targets(self) -> dict[int, tuple[str, str | None]]:
        db = SessionLocal()
        try:
            out: dict[int, tuple[str, str | None]] = {}
            for p in db.query(Printer).order_by(Printer.id.asc()).all():
                out[p.id] = (p.moonraker_base_url.rstrip("/"), p.moonraker_api_key)
            return out
        finally:
            db.close()

    async def _maybe_promote_to_websocket(
        self, printer_id: int, spec: tuple[str, str | None]
    ) -> None:
        """HTTP knows the printer is up but we are not on a live WS — (re)start the watcher."""
        live = self._live.get(printer_id)
        if live is not None and live.moonraker_ws_connected:
            return
        loop = asyncio.get_running_loop()
        now = loop.time()
        last = self._last_ws_promote_at.get(printer_id, 0.0)
        if (now - last) < HTTP_WS_PROMOTE_COOLDOWN_SEC:
            return
        self._last_ws_promote_at[printer_id] = now
        log.info(
            "moonraker printer %s: reachable via http but no live ws — restarting ws task",
            printer_id,
        )
        await self._restart_printer_task(printer_id, spec)

    async def _restart_printer_task(self, printer_id: int, spec: tuple[str, str | None]) -> None:
        await self._stop_printer_task(printer_id)
        self._printer_targets[printer_id] = spec
        base_url, api_key = spec
        self._printer_tasks[printer_id] = asyncio.create_task(
            self._watch_printer_loop(printer_id, base_url, api_key),
            name=f"moonraker-ws-{printer_id}",
        )

    async def _stop_printer_task(self, printer_id: int) -> None:
        task = self._printer_tasks.pop(printer_id, None)
        self._printer_targets.pop(printer_id, None)
        self._ws_object_state.pop(printer_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _watch_printer_loop(self, printer_id: int, base_url: str, api_key: str | None) -> None:
        backoff = RECONNECT_BASE_SEC
        while self._running and printer_id in self._printer_targets:
            session_failed = False
            try:
                await self._watch_printer_session(printer_id, base_url, api_key)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                session_failed = True
                log.warning("moonraker ws printer %s: %s", printer_id, exc)
                await self._publish(
                    printer_id,
                    PrinterStatus.offline.value,
                    format_moonraker_connection_error(exc, base_url=base_url),
                    connected=False,
                    transport="ws_session_lost",
                )
            else:
                # Connection closed cleanly (Moonraker or network dropped TCP) — still offline until reconnect.
                log.info("moonraker ws printer %s: session closed, reconnecting", printer_id)
                await self._publish(
                    printer_id,
                    PrinterStatus.offline.value,
                    None,
                    connected=False,
                    transport="ws_session_lost",
                )
            if not self._running or printer_id not in self._printer_targets:
                break
            if session_failed:
                backoff = min(backoff * 1.5, RECONNECT_MAX_SEC)
            else:
                backoff = RECONNECT_BASE_SEC
            await asyncio.sleep(backoff)

    async def _watch_printer_session(
        self, printer_id: int, base_url: str, api_key: str | None
    ) -> None:
        ws_url = moonraker_http_to_ws_url(base_url)
        headers: dict[str, str] = {}
        if api_key:
            headers["X-Api-Key"] = api_key

        async with websockets.connect(
            ws_url,
            additional_headers=headers or None,
            open_timeout=10,
            close_timeout=5,
            ping_interval=20,
            ping_timeout=20,
        ) as ws:
            accumulated = self._ws_object_state.setdefault(printer_id, {})
            accumulated.clear()
            await self._ws_send_identify(ws, api_key)
            sub_id = 1
            await ws.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "printer.objects.subscribe",
                        "params": {"objects": SUBSCRIBE_OBJECTS},
                        "id": sub_id,
                    }
                )
            )

            async for raw in ws:
                self._touch_ws_activity(printer_id)
                data = json.loads(raw)
                method = data.get("method")
                if isinstance(method, str) and method.startswith("notify_klippy_"):
                    await self._record_klippy_notice(printer_id, method, data.get("params"))
                    continue
                if method == "notify_status_update":
                    params = data.get("params")
                    if isinstance(params, list) and params and isinstance(params[0], dict):
                        merge_printer_status_objects(accumulated, params[0])
                        await self._publish_from_status(printer_id, accumulated, connected=True)
                    continue

                if data.get("id") == sub_id and "result" in data:
                    result = data["result"]
                    if isinstance(result, dict) and isinstance(result.get("status"), dict):
                        accumulated.clear()
                        for k, v in result["status"].items():
                            if isinstance(v, dict):
                                accumulated[k] = dict(v)
                        await self._publish_from_status(printer_id, accumulated, connected=True)
                    continue

                if "error" in data:
                    err = data["error"]
                    msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                    raise RuntimeError(msg)

    async def _ws_send_identify(self, ws: Any, api_key: str | None) -> None:
        # Moonraker rejects a duplicate agent client_name on the same server; use a
        # stable prefix for logs/UIs plus a per-session suffix (reconnect overlap,
        # two DB rows pointing at one Moonraker, or a second Jove process).
        params: dict[str, Any] = {
            "client_name": f"Jove-{uuid.uuid4().hex[:8]}",
            "version": "0.1.0",
            "type": "agent",
            "url": "https://github.com/jove",
        }
        if api_key:
            params["api_key"] = api_key
        await ws.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "server.connection.identify",
                    "params": params,
                    "id": 9001,
                }
            )
        )

    async def _publish_from_status(
        self, printer_id: int, status: dict[str, Any], *, connected: bool
    ) -> None:
        self._touch_ws_activity(printer_id)
        derived = derive_printer_status_from_status(status)
        if derived is None:
            derived = PrinterStatus.offline.value if not connected else PrinterStatus.ready.value
        err = moonraker_error_from_status(status)
        if derived not in (PrinterStatus.error.value, PrinterStatus.offline.value):
            err = None
        wh_st, wh_msg = extract_webhooks_summary_from_object_status(status)
        heater_temps = extract_live_heater_temperatures(status)
        await self._publish(
            printer_id,
            derived,
            err,
            connected=connected,
            transport="websocket",
            klipper_webhooks_state=wh_st,
            klipper_state_message=wh_msg,
            ws_heater_temps=heater_temps,
        )

    async def _publish(
        self,
        printer_id: int,
        status: str,
        error: str | None,
        *,
        connected: bool,
        persist: bool = True,
        transport: str,
        klipper_webhooks_state: str | None = None,
        klipper_state_message: str | None = None,
        http_klipper_snapshot: tuple[str | None, str | None] | None = None,
        ws_heater_temps: tuple[float | None, float | None, float | None, float | None] | None = None,
    ) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        http_interval = get_settings().moonraker_http_liveness_interval_sec
        async with self._lock:
            prev = self._live.get(printer_id)
            if transport == "websocket":
                moonraker_ws_connected = bool(connected)
                if connected:
                    last_ws_status = status
                    last_ws_at = now_iso
                else:
                    last_ws_status = prev.last_ws_status if prev else None
                    last_ws_at = prev.last_ws_at if prev else None
                last_http_probe_at = prev.last_http_probe_at if prev else None
                last_http_probe_ok = prev.last_http_probe_ok if prev else None
                last_http_probe_source = prev.last_http_probe_source if prev else None
                k_ws = (
                    klipper_webhooks_state
                    if klipper_webhooks_state is not None
                    else (prev.klipper_webhooks_state if prev else None)
                )
                k_msg = (
                    klipper_state_message
                    if klipper_state_message is not None
                    else (prev.klipper_state_message if prev else None)
                )
            elif transport == "ws_session_lost":
                moonraker_ws_connected = False
                last_ws_status = prev.last_ws_status if prev else None
                last_ws_at = prev.last_ws_at if prev else None
                last_http_probe_at = prev.last_http_probe_at if prev else None
                last_http_probe_ok = prev.last_http_probe_ok if prev else None
                last_http_probe_source = prev.last_http_probe_source if prev else None
                k_ws = prev.klipper_webhooks_state if prev else None
                k_msg = prev.klipper_state_message if prev else None
            elif transport == "http_liveness":
                moonraker_ws_connected = False
                last_http_probe_at = now_iso
                last_http_probe_ok = connected
                last_http_probe_source = "liveness"
                if http_klipper_snapshot is not None:
                    k_ws, k_msg = http_klipper_snapshot
                    last_ws_status = status
                    last_ws_at = now_iso
                else:
                    k_ws = prev.klipper_webhooks_state if prev else None
                    k_msg = prev.klipper_state_message if prev else None
                    last_ws_status = prev.last_ws_status if prev else None
                    last_ws_at = prev.last_ws_at if prev else None
            elif transport == "manual_ping":
                moonraker_ws_connected = bool(prev.moonraker_ws_connected) if prev else False
                last_http_probe_at = now_iso
                last_http_probe_ok = connected
                last_http_probe_source = "manual"
                if http_klipper_snapshot is not None:
                    k_ws, k_msg = http_klipper_snapshot
                    last_ws_status = status
                    last_ws_at = now_iso
                else:
                    k_ws = prev.klipper_webhooks_state if prev else None
                    k_msg = prev.klipper_state_message if prev else None
                    last_ws_status = prev.last_ws_status if prev else None
                    last_ws_at = prev.last_ws_at if prev else None
            else:
                moonraker_ws_connected = bool(prev.moonraker_ws_connected) if prev else False
                last_ws_status = prev.last_ws_status if prev else None
                last_ws_at = prev.last_ws_at if prev else None
                last_http_probe_at = prev.last_http_probe_at if prev else None
                last_http_probe_ok = prev.last_http_probe_ok if prev else None
                last_http_probe_source = prev.last_http_probe_source if prev else None
                k_ws = prev.klipper_webhooks_state if prev else None
                k_msg = prev.klipper_state_message if prev else None

            if moonraker_ws_connected and connected:
                if ws_heater_temps is not None:
                    ex_a, ex_t, bd_a, bd_t = ws_heater_temps
                elif prev:
                    ex_a = prev.extruder_actual_c
                    ex_t = prev.extruder_target_c
                    bd_a = prev.bed_actual_c
                    bd_t = prev.bed_target_c
                else:
                    ex_a = ex_t = bd_a = bd_t = None
            else:
                ex_a = ex_t = bd_a = bd_t = None

            update = PrinterLiveUpdate(
                printer_id=printer_id,
                last_known_status=status,
                last_moonraker_error=error,
                connected=connected,
                extruder_actual_c=ex_a,
                extruder_target_c=ex_t,
                bed_actual_c=bd_a,
                bed_target_c=bd_t,
                moonraker_ws_connected=moonraker_ws_connected,
                last_ws_status=last_ws_status,
                last_ws_at=last_ws_at,
                last_http_probe_at=last_http_probe_at,
                last_http_probe_ok=last_http_probe_ok,
                last_http_probe_source=last_http_probe_source,
                http_liveness_interval_sec=http_interval,
                klipper_webhooks_state=k_ws,
                klipper_state_message=k_msg,
            )
            self._live[printer_id] = update
            changed = (
                prev is None
                or prev.last_known_status != update.last_known_status
                or prev.last_moonraker_error != update.last_moonraker_error
                or prev.connected != update.connected
                or prev.moonraker_ws_connected != update.moonraker_ws_connected
                or prev.last_ws_status != update.last_ws_status
                or prev.last_ws_at != update.last_ws_at
                or prev.last_http_probe_at != update.last_http_probe_at
                or prev.last_http_probe_ok != update.last_http_probe_ok
                or prev.last_http_probe_source != update.last_http_probe_source
                or prev.http_liveness_interval_sec != update.http_liveness_interval_sec
                or prev.klipper_webhooks_state != update.klipper_webhooks_state
                or prev.klipper_state_message != update.klipper_state_message
                or prev.extruder_actual_c != update.extruder_actual_c
                or prev.extruder_target_c != update.extruder_target_c
                or prev.bed_actual_c != update.bed_actual_c
                or prev.bed_target_c != update.bed_target_c
            )
        if changed:
            payload = update.to_json()
            for q in list(self._subscribers):
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        q.put_nowait(payload)
                    except asyncio.QueueFull:
                        pass
            if persist:
                await self._maybe_persist(printer_id, status, error, connected)

    async def broadcast_printer_state(
        self,
        printer_id: int,
        *,
        last_known_status: str,
        last_moonraker_error: str | None,
        connected: bool,
        persist: bool = True,
        http_klipper_snapshot: tuple[str | None, str | None] | None = None,
    ) -> None:
        """Publish a snapshot to SSE clients (optional DB write via ``persist``)."""
        await self._publish(
            printer_id,
            last_known_status,
            last_moonraker_error,
            connected=connected,
            persist=persist,
            transport="manual_ping",
            http_klipper_snapshot=http_klipper_snapshot,
        )

    async def _maybe_persist(
        self, printer_id: int, status: str, error: str | None, connected: bool
    ) -> None:
        loop = asyncio.get_running_loop()
        now = loop.time()
        last = self._last_db_persist.get(printer_id, 0.0)
        if now - last < DB_PERSIST_MIN_INTERVAL_SEC:
            return
        self._last_db_persist[printer_id] = now
        await asyncio.to_thread(self._persist_printer_status, printer_id, status, error, connected)

    def _persist_printer_status(
        self, printer_id: int, status: str, error: str | None, connected: bool
    ) -> None:
        db = SessionLocal()
        try:
            p = db.get(Printer, printer_id)
            if p is None:
                return
            if connected:
                apply_ping_to_printer(p, True, None, status)
                if status == PrinterStatus.error.value and error:
                    p.last_moonraker_error = error
            else:
                apply_ping_to_printer(p, False, error, None)
            p.updated_at = datetime.now(timezone.utc)
            db.commit()
        except Exception:
            db.rollback()
            log.exception("failed to persist live status for printer %s", printer_id)
        finally:
            db.close()


moonraker_watch = MoonrakerWatchService()
