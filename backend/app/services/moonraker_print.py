"""Upload G-code to Moonraker and optionally start a print."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import httpx

from app.services.moonraker_url import (
    format_moonraker_connection_error,
    normalize_moonraker_base_url,
)

_SAFE_FILENAME = re.compile(r"[^a-zA-Z0-9._\- ]+")


def sanitize_gcode_filename(name: str) -> str:
    """Keep a safe basename for Moonraker's ``gcodes`` root."""
    base = Path(name or "job.gcode").name.strip()
    if not base:
        base = "job.gcode"
    cleaned = _SAFE_FILENAME.sub("_", base).strip(" .")
    if not cleaned:
        cleaned = "job.gcode"
    lower = cleaned.lower()
    if not (lower.endswith(".gcode") or lower.endswith(".gco") or lower.endswith(".bgcode")):
        cleaned = f"{cleaned}.gcode"
    return cleaned[:200]


async def upload_gcode_to_moonraker(
    base_url: str,
    api_key: str | None,
    filename: str,
    content: bytes,
    *,
    start_print: bool = True,
) -> tuple[bool, str | None, dict[str, Any] | None]:
    """
    POST ``/server/files/upload`` (multipart).

    Returns ``(ok, error_message, moonraker_response_dict)``.
    """
    base = normalize_moonraker_base_url(base_url)
    url = f"{base}/server/files/upload"
    headers: dict[str, str] = {}
    if api_key:
        headers["X-Api-Key"] = api_key

    safe_name = sanitize_gcode_filename(filename)
    data: dict[str, str] = {"root": "gcodes"}
    if start_print:
        data["print"] = "true"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            r = await client.post(
                url,
                headers=headers,
                data=data,
                files={"file": (safe_name, content, "application/octet-stream")},
            )
    except Exception as e:  # noqa: BLE001
        return False, format_moonraker_connection_error(e, base_url=base), None

    if r.status_code not in (200, 201):
        detail = r.text
        try:
            body = r.json()
            if isinstance(body, dict) and "error" in body:
                err = body["error"]
                detail = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            elif isinstance(body, dict):
                detail = body.get("message", detail)
        except Exception:
            pass
        return False, detail or f"Moonraker returned HTTP {r.status_code}", None

    try:
        payload = r.json()
    except Exception:
        return True, None, {"raw": r.text}

    if not isinstance(payload, dict):
        return True, None, None

    if start_print and not payload.get("print_started"):
        item = payload.get("item")
        path = item.get("path") if isinstance(item, dict) else safe_name
        return (
            True,
            f"Uploaded to Moonraker as “{path}”, but the print did not start "
            "(is Klipper ready and the bed clear?)",
            payload,
        )

    return True, None, payload
