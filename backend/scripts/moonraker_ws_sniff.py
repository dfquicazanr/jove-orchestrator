#!/usr/bin/env python3
"""
Sniff Moonraker WebSocket status traffic for a fixed duration (default 60s).

Mirrors Jove's identify + ``printer.objects.subscribe`` for ``webhooks`` and ``print_stats``,
logs merged state on each ``notify_status_update`` and the initial subscribe snapshot.

**Ubuntu / WSL:** system Python is PEP 668 locked — use a venv (needs ``ensurepip``):

  sudo apt install python3.12-venv
  cd backend && rm -rf .venv && python3 -m venv .venv
  .venv/bin/pip install websockets
  .venv/bin/python scripts/moonraker_ws_sniff.py 2>&1 | tee /tmp/moonraker-sniff.log

Use ``python3`` and ``.venv/bin/python`` (no ``python`` alias required).

**Docker (no venv on host):** from ``backend/``:

  docker run --rm --network host \\
    -v \"$PWD/scripts/moonraker_ws_sniff.py:/sniff.py:ro\" \\
    python:3.12-slim bash -lc \"pip install -q websockets && python3 /sniff.py\" \\
    2>&1 | tee /tmp/moonraker-sniff.log

**Options:**

  .venv/bin/python scripts/moonraker_ws_sniff.py --seconds 90 \\
    http://192.168.0.50:8011 http://192.168.0.50:8021 --api-key YOUR_KEY

Environment:
  MOONRAKER_API_KEY — used if ``--api-key`` is omitted (same key for all URLs).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    import websockets
except ImportError as e:
    print(
        "Missing package: websockets.\n"
        "  Ubuntu/WSL: sudo apt install python3.12-venv && cd backend && "
        "python3 -m venv .venv && .venv/bin/pip install websockets\n"
        "  Then: .venv/bin/python scripts/moonraker_ws_sniff.py",
        file=sys.stderr,
    )
    raise SystemExit(1) from e

SUBSCRIBE_OBJECTS = {"print_stats": None, "webhooks": None}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def http_to_ws_url(base_url: str) -> str:
    b = base_url.strip().rstrip("/")
    if b.startswith("https://"):
        return "wss://" + b[len("https://") :] + "/websocket"
    if b.startswith("http://"):
        return "ws://" + b[len("http://") :] + "/websocket"
    return "ws://" + b + "/websocket"


def merge_status(accumulated: dict[str, Any], delta: dict[str, Any]) -> None:
    for obj_name, fields in delta.items():
        if not isinstance(fields, dict):
            continue
        bucket = accumulated.setdefault(obj_name, {})
        if isinstance(bucket, dict):
            bucket.update(fields)


def summarize(accumulated: dict[str, Any]) -> str:
    parts: list[str] = []
    wh = accumulated.get("webhooks")
    if isinstance(wh, dict):
        st = str(wh.get("state") or "").strip()
        msg = wh.get("state_message")
        m = str(msg).strip()[:120] if msg else ""
        parts.append(f"webhooks.state={st!r}" + (f" msg={m!r}" if m else ""))
    ps = accumulated.get("print_stats")
    if isinstance(ps, dict):
        parts.append(f"print_stats.state={str(ps.get('state') or '').strip()!r}")
    return " | ".join(parts) if parts else "(no webhooks/print_stats yet)"


async def sniff_one(
    label: str,
    http_base: str,
    api_key: str | None,
    seconds: float,
    log: logging.Logger,
) -> None:
    ws_url = http_to_ws_url(http_base)
    headers: dict[str, str] = {}
    if api_key:
        headers["X-Api-Key"] = api_key

    accumulated: dict[str, Any] = {}
    sub_id = 1

    async def run_session() -> None:
        nonlocal accumulated
        log.info("[%s] connecting %s", label, ws_url)
        async with websockets.connect(
            ws_url,
            additional_headers=headers or None,
            open_timeout=10,
            close_timeout=5,
            ping_interval=20,
            ping_timeout=20,
        ) as ws:
            log.info("[%s] websocket open", label)
            identify = {
                "jsonrpc": "2.0",
                "method": "server.connection.identify",
                "params": {
                    "client_name": f"jove-ws-sniff-{uuid.uuid4().hex[:10]}",
                    "version": "0.0.1",
                    "type": "agent",
                    "url": "https://github.com/jove-orchestrator",
                },
                "id": 9001,
            }
            if api_key:
                identify["params"]["api_key"] = api_key
            await ws.send(json.dumps(identify))

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
                        merge_status(accumulated, params[0])
                        log.info("[%s] notify_status_update %s | %s", label, _now(), summarize(accumulated))
                    else:
                        log.warning("[%s] notify_status_update unexpected params %s", label, params)
                    continue

                if data.get("id") == sub_id and "result" in data:
                    result = data["result"]
                    if isinstance(result, dict) and isinstance(result.get("status"), dict):
                        accumulated.clear()
                        for k, v in result["status"].items():
                            if isinstance(v, dict):
                                accumulated[k] = dict(v)
                        log.info("[%s] subscribe snapshot %s | %s", label, _now(), summarize(accumulated))
                    continue

                if "error" in data:
                    err = data["error"]
                    msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                    log.error("[%s] jsonrpc error id=%s %s", label, data.get("id"), msg)
                    continue

                mid = data.get("method") or data.get("id")
                log.debug("[%s] other message: %s", label, json.dumps(data)[:500])

    try:
        await asyncio.wait_for(run_session(), timeout=seconds)
    except asyncio.TimeoutError:
        log.info("[%s] window elapsed (%.1fs); disconnecting.", label, seconds)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("[%s] session ended with error: %s", label, exc)


async def main_async(args: argparse.Namespace) -> None:
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("sniff")

    api_key = args.api_key or __import__("os").environ.get("MOONRAKER_API_KEY")

    tasks = [
        asyncio.create_task(
            sniff_one(f"p{i+1}", url, api_key, float(args.seconds), log),
            name=f"sniff-{i}",
        )
        for i, url in enumerate(args.urls)
    ]
    await asyncio.gather(*tasks)


def main() -> None:
    p = argparse.ArgumentParser(description="Moonraker WS status sniff (parallel targets).")
    p.add_argument(
        "urls",
        nargs="*",
        default=[
            "http://192.168.0.50:8011",
            "http://192.168.0.50:8021",
        ],
        help="Moonraker HTTP base URLs (default: .50:8011 and .50:8021)",
    )
    p.add_argument("--seconds", type=float, default=60.0, help="Listen duration per target (default 60)")
    p.add_argument("--api-key", default=None, help="Moonraker API key (or set MOONRAKER_API_KEY)")
    p.add_argument("-v", "--verbose", action="store_true", help="Log non-status JSON-RPC traffic at DEBUG")
    args = p.parse_args()
    if not args.urls:
        p.error("at least one URL required")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)


if __name__ == "__main__":
    main()
