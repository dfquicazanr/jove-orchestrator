"""Parse common slicer metadata from G-code comment headers/footers."""

from __future__ import annotations

import re
from dataclasses import dataclass

_FILAMENT_USED_G = re.compile(
    r";\s*filament\s+used\s*\[g\]\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
_FILAMENT_USED_G_COLON = re.compile(
    r";\s*filament\s+used\s*\[g\]:\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
_FILAMENT_USED_MM = re.compile(
    r";\s*total\s+filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
_FILAMENT_USED_MM_ALT = re.compile(
    r";\s*filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
# Cura / Creality Print: ``;Filament used:6.21m`` (meters, often no space after colon)
_FILAMENT_USED_M = re.compile(
    r";\s*filament\s+used:\s*([0-9]+(?:\.[0-9]+)?)\s*m\b",
    re.IGNORECASE,
)
_FILAMENT_WEIGHT = re.compile(
    r";\s*filament\s+weight\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*g",
    re.IGNORECASE,
)
# Cura / Creality: ``;TIME:3708.97`` (seconds, may be fractional)
_TIME_SECONDS = re.compile(r";\s*time:\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
_EST_PRINT_TIME = re.compile(
    r";\s*(?:total\s+)?estimated\s+printing\s+time.*?(?:[:=])\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
_BUILD_TIME = re.compile(
    r";\s*build\s+time:\s*(\d+:\d{2}(?::\d{2})?)",
    re.IGNORECASE,
)
_TOTAL_EST_TIME = re.compile(
    r";\s*total\s+estimated\s+time:\s*(.+?)(?:;|$)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class GcodeMetadata:
    filament_mass_grams: float | None
    filament_length_mm: float | None
    print_time_seconds: int | None


def _parse_duration_token(text: str) -> int | None:
    """Parse Cura/Prusa-style durations: ``1h 2m 3s``, ``1:02:03``, ``45m 12s``."""

    t = text.strip().lower()
    if not t:
        return None

    m = re.match(r"^(\d+):(\d{2})(?::(\d{2}))?$", t)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        return h * 3600 + mi * 60 + s

    total = 0
    found = False
    for part in re.finditer(r"(\d+)\s*([dhms])", t):
        found = True
        n = int(part.group(1))
        unit = part.group(2)
        if unit == "d":
            total += n * 86400
        elif unit == "h":
            total += n * 3600
        elif unit == "m":
            total += n * 60
        elif unit == "s":
            total += n
    return total if found else None


def _print_time_seconds_from_text(chunk: str) -> int | None:
    m = _TIME_SECONDS.search(chunk)
    if m:
        return int(round(float(m.group(1))))

    for pat in (_EST_PRINT_TIME, _BUILD_TIME, _TOTAL_EST_TIME):
        m = pat.search(chunk)
        if m:
            sec = _parse_duration_token(m.group(1))
            if sec is not None:
                return sec
    return None


def estimate_filament_grams_from_gcode(text: str, max_scan_bytes: int = 512_000) -> float | None:
    return parse_gcode_metadata(text, max_scan_bytes=max_scan_bytes).filament_mass_grams


def parse_gcode_metadata(
    text: str,
    *,
    tail: str | None = None,
    max_scan_bytes: int = 512_000,
) -> GcodeMetadata:
    head = text[:max_scan_bytes]
    combined = head if not tail else f"{head}\n{tail[-max_scan_bytes:]}"

    grams: float | None = None
    for pat in (_FILAMENT_USED_G, _FILAMENT_USED_G_COLON, _FILAMENT_WEIGHT):
        m = pat.search(combined)
        if m:
            grams = float(m.group(1))
            break

    length_mm: float | None = None
    for pat in (_FILAMENT_USED_MM, _FILAMENT_USED_MM_ALT):
        m = pat.search(combined)
        if m:
            length_mm = float(m.group(1))
            break
    if length_mm is None:
        m = _FILAMENT_USED_M.search(combined)
        if m:
            length_mm = float(m.group(1)) * 1000.0

    if grams is None and length_mm is not None:
        grams = round(length_mm * (2.4 / 1000.0), 2)

    print_sec = _print_time_seconds_from_text(combined)
    if print_sec is None and tail:
        print_sec = _print_time_seconds_from_text(tail)

    return GcodeMetadata(
        filament_mass_grams=grams,
        filament_length_mm=length_mm,
        print_time_seconds=print_sec,
    )
