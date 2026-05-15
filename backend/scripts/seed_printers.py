#!/usr/bin/env python3
"""Insert demo printers if their Moonraker base URLs are not already registered.

Includes RFC 5737 mock hosts (192.0.2.x) with varied ``last_known_status`` and
``remaining_filament_grams`` for Farm UI demos (status colors + filament spiral).

Run from `backend/` with the app on PYTHONPATH and DATABASE_URL set, e.g.:

  cd backend && source .venv/bin/activate
  export DATABASE_URL=postgresql+psycopg://jove:jove@127.0.0.1:5432/jove
  python scripts/seed_printers.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import SessionLocal  # noqa: E402
from app.models.printer import Printer, PrinterStatus  # noqa: E402

# RFC 5737 TEST-NET-1 (192.0.2.0/24): safe documentation addresses; nothing should answer there.
# Use for UI demos of status labels + filament spiral at different remaining weights.
# Real LAN printers can stay in additional rows with your 192.168.x.x URLs.
SEEDS: list[dict[str, str | float]] = [
    {
        "name": "Demo · Ready to print",
        "moonraker_base_url": "http://192.0.2.1:7101",
        "loaded_material": "PLA",
        "loaded_color": "matte white",
        "remaining_filament_grams": 1000.0,
        "last_known_status": PrinterStatus.ready.value,
    },
    {
        "name": "Demo · Offline",
        "moonraker_base_url": "http://192.0.2.1:7102",
        "loaded_material": "PETG",
        "loaded_color": "clear",
        "remaining_filament_grams": 720.0,
        "last_known_status": PrinterStatus.offline.value,
    },
    {
        "name": "Demo · Powered off",
        "moonraker_base_url": "http://192.0.2.1:7103",
        "loaded_material": "PLA",
        "loaded_color": "black",
        "remaining_filament_grams": 380.0,
        "last_known_status": PrinterStatus.powered_off.value,
    },
    {
        "name": "Demo · Printing",
        "moonraker_base_url": "http://192.0.2.1:7104",
        "loaded_material": "PLA",
        "loaded_color": "red",
        "remaining_filament_grams": 540.0,
        "last_known_status": PrinterStatus.printing.value,
    },
    {
        "name": "Demo · Print finished",
        "moonraker_base_url": "http://192.0.2.1:7105",
        "loaded_material": "PLA",
        "loaded_color": "blue",
        "remaining_filament_grams": 45.0,
        "last_known_status": PrinterStatus.finished_awaiting_cleanup.value,
    },
    {
        "name": "Demo · Error",
        "moonraker_base_url": "http://192.0.2.1:7106",
        "loaded_material": "ABS",
        "loaded_color": "gray",
        "remaining_filament_grams": 0.0,
        "last_known_status": PrinterStatus.error.value,
    },
    {
        "name": "Demo · Full roll (spiral capped)",
        "moonraker_base_url": "http://192.0.2.1:7107",
        "loaded_material": "PLA",
        "loaded_color": "silk gold",
        "remaining_filament_grams": 1200.0,
        "last_known_status": PrinterStatus.ready.value,
    },
    {
        "name": "Printer 8011",
        "moonraker_base_url": "http://192.168.0.50:8011",
        "loaded_material": "PLA",
        "loaded_color": "—",
        "remaining_filament_grams": 1000.0,
        "last_known_status": PrinterStatus.offline.value,
    },
    {
        "name": "Printer 8021",
        "moonraker_base_url": "http://192.168.0.50:8021",
        "loaded_material": "PLA",
        "loaded_color": "—",
        "remaining_filament_grams": 1000.0,
        "last_known_status": PrinterStatus.offline.value,
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        for row in SEEDS:
            url = str(row["moonraker_base_url"]).rstrip("/")
            exists = db.query(Printer.id).filter(Printer.moonraker_base_url == url).first()
            if exists:
                print(f"skip (exists): {url}")
                continue
            status = row.get("last_known_status", PrinterStatus.offline.value)
            p = Printer(
                name=str(row["name"]),
                moonraker_base_url=url,
                moonraker_api_key=None,
                ha_power_entity_id=None,
                loaded_material=str(row["loaded_material"]),
                loaded_color=str(row["loaded_color"]),
                remaining_filament_grams=float(row["remaining_filament_grams"]),
                last_known_status=str(status),
            )
            db.add(p)
            print(f"inserted: {row['name']} -> {url}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
