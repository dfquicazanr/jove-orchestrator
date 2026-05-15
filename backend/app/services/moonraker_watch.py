"""Background Moonraker WebSocket subscriptions and live status broadcast."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import websockets

from app.database import SessionLocal
from app.models.printer import Printer, PrinterStatus
from app.services.moonraker import (
    apply_ping_to_printer,
    derive_printer_status_from_status,
    merge_printer_status_objects,
    moonraker_error_from_status,
    moonraker_http_to_ws_url,
)
from app.services.moonraker_url import format_moonraker_connection_error

log = logging.getLogger(__name__)

SUBSCRIBE_OBJECTS = {"print_stats": None, "webhooks": None}
RELOAD_PRINTERS_SEC = 30.0
RECONNECT_BASE_SEC = 2.0
RECONNECT_MAX_SEC = 60.0
DB_PERSIST_MIN_INTERVAL_SEC = 1.0


@dataclass
class PrinterLiveUpdate:
    printer_id: int
    last_known_status: str
    last_moonraker_error: str | None
    connected: bool

    def to_json(self) -> str:
        return json.dumps(
            {
                "printer_id": self.printer_id,
                "last_known_status": self.last_known_status,
                "last_moonraker_error": self.last_moonraker_error,
                "connected": self.connected,
            }
        )


class MoonrakerWatchService:
    def __init__(self) -> None:
        self._running = False
        self._coordinator_task: asyncio.Task[None] | None = None
        self._printer_tasks: dict[int, asyncio.Task[None]] = {}
        self._printer_targets: dict[int, tuple[str, str | None]] = {}
        self._live: dict[int, PrinterLiveUpdate] = {}
        self._subscribers: list[asyncio.Queue[str | None]] = []
        self._lock = asyncio.Lock()
        self._last_db_persist: dict[int, float] = {}

    def subscribe(self) -> asyncio.Queue[str | None]:
        q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=64)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str | None]) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    def snapshot(self) -> list[PrinterLiveUpdate]:
        return list(self._live.values())

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._coordinator_task = asyncio.create_task(self._coordinator_loop(), name="moonraker-watch")

    async def stop(self) -> None:
        self._running = False
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
        if task:
            task.cancel()
            await asyncio.gather(task, return_exception=True)

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
                )
            else:
                # Connection closed cleanly (Moonraker or network dropped TCP) — still offline until reconnect.
                log.info("moonraker ws printer %s: session closed, reconnecting", printer_id)
                await self._publish(
                    printer_id,
                    PrinterStatus.offline.value,
                    None,
                    connected=False,
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
        accumulated: dict[str, Any] = {}
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
                data = json.loads(raw)
                method = data.get("method")
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
        params: dict[str, Any] = {
            "client_name": "Jove",
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
        derived = derive_printer_status_from_status(status)
        if derived is None:
            derived = PrinterStatus.offline.value if not connected else PrinterStatus.ready.value
        err = moonraker_error_from_status(status)
        if derived not in (PrinterStatus.error.value, PrinterStatus.offline.value):
            err = None
        await self._publish(printer_id, derived, err, connected=connected)

    async def _publish(
        self,
        printer_id: int,
        status: str,
        error: str | None,
        *,
        connected: bool,
        persist: bool = True,
    ) -> None:
        update = PrinterLiveUpdate(
            printer_id=printer_id,
            last_known_status=status,
            last_moonraker_error=error,
            connected=connected,
        )
        async with self._lock:
            prev = self._live.get(printer_id)
            self._live[printer_id] = update
            changed = (
                prev is None
                or prev.last_known_status != update.last_known_status
                or prev.last_moonraker_error != update.last_moonraker_error
                or prev.connected != update.connected
            )
        if changed:
            payload = update.to_json()
            for q in list(self._subscribers):
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
    ) -> None:
        """Publish a snapshot to SSE clients (optional DB write via ``persist``)."""
        await self._publish(
            printer_id,
            last_known_status,
            last_moonraker_error,
            connected=connected,
            persist=persist,
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
