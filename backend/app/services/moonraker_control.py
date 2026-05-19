"""Send control commands to Moonraker (G-code scripts and print job APIs)."""

from __future__ import annotations

from typing import Literal

import httpx

from app.services.moonraker_url import (
    format_moonraker_connection_error,
    normalize_moonraker_base_url,
)

AxesHome = Literal["all", "xy"]


def build_home_script(axes: AxesHome = "all") -> str:
    if axes == "xy":
        return "G28 X Y"
    return "G28"


def build_preheat_script(hotend_c: float, bed_c: float) -> str:
    hot = int(round(hotend_c))
    bed = int(round(bed_c))
    return f"M140 S{bed}\nM104 S{hot}"


def build_cooldown_script() -> str:
    return "M104 S0\nM140 S0"


async def run_gcode_script(
    base_url: str,
    api_key: str | None,
    script: str,
) -> tuple[bool, str | None]:
    """POST ``/printer/gcode/script``."""
    base = normalize_moonraker_base_url(base_url)
    url = f"{base}/printer/gcode/script"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["X-Api-Key"] = api_key

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            r = await client.post(url, headers=headers, json={"script": script})
    except Exception as e:  # noqa: BLE001
        return False, format_moonraker_connection_error(e, base_url=base)

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
        return False, detail or f"Moonraker returned HTTP {r.status_code}"

    return True, None


async def moonraker_print_action(
    base_url: str,
    api_key: str | None,
    action: Literal["cancel", "pause", "resume"],
) -> tuple[bool, str | None]:
    """POST ``/printer/print/{cancel|pause|resume}``."""
    base = normalize_moonraker_base_url(base_url)
    url = f"{base}/printer/print/{action}"
    headers: dict[str, str] = {}
    if api_key:
        headers["X-Api-Key"] = api_key

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=15.0)) as client:
            r = await client.post(url, headers=headers)
    except Exception as e:  # noqa: BLE001
        return False, format_moonraker_connection_error(e, base_url=base)

    if r.status_code not in (200, 201):
        detail = r.text
        try:
            body = r.json()
            if isinstance(body, dict):
                detail = body.get("message", detail)
        except Exception:
            pass
        return False, detail or f"Moonraker returned HTTP {r.status_code}"

    return True, None
