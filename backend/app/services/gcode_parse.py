"""Estimate filament mass (grams) from common slicer G-code comments."""

import re

_FILAMENT_USED_G = re.compile(
    r";\s*filament\s+used\s*\[g\]\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
_FILAMENT_USED_MM = re.compile(
    r";\s*total\s+filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
_FILAMENT_WEIGHT = re.compile(
    r";\s*filament\s+weight\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*g",
    re.IGNORECASE,
)


def estimate_filament_grams_from_gcode(text: str, max_scan_bytes: int = 512_000) -> float | None:
    chunk = text[:max_scan_bytes]
    m = _FILAMENT_USED_G.search(chunk)
    if m:
        return float(m.group(1))
    m = _FILAMENT_WEIGHT.search(chunk)
    if m:
        return float(m.group(1))
    m = _FILAMENT_USED_MM.search(chunk)
    if m:
        # Rough PLA density ~1.24 g/cm³, 1.75mm ~ 2.4 g/m — highly approximate; prefer [g] lines.
        mm = float(m.group(1))
        grams = mm * (2.4 / 1000.0)
        return round(grams, 2)
    return None
