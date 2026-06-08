#!/usr/bin/env python3
"""Register Moria and Rivendell on this farm.

Run after the API database is up, e.g. from inside the api container:

  docker compose exec api python scripts/seed_farm_printers.py

Or locally from backend/ with DATABASE_URL set.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app.models  # noqa: E402, F401 — register all ORM mappers before queries

from app.database import SessionLocal  # noqa: E402
from app.models.printer import Printer, PrinterStatus  # noqa: E402

# Host IP reachable from the jove API container and Moonraker trusted_clients.
HOST = "192.168.0.50"

FARM_PRINTERS: list[dict[str, str | float | None]] = [
    {
        "name": "Moria",
        "moonraker_base_url": f"http://{HOST}:8011",
        "ha_power_entity_id": "switch.esp01_3d_printer_moria_moria_3d_printer",
        "loaded_material": "PLA",
        "loaded_color": "—",
        "remaining_filament_grams": 1000.0,
        "last_known_status": PrinterStatus.offline.value,
    },
    {
        "name": "Rivendell",
        "moonraker_base_url": f"http://{HOST}:8021",
        "ha_power_entity_id": "switch.esp01_3d_printer_rivendell_rivendell_3d_printer",
        "loaded_material": "PLA",
        "loaded_color": "—",
        "remaining_filament_grams": 1000.0,
        "last_known_status": PrinterStatus.offline.value,
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        for row in FARM_PRINTERS:
            url = str(row["moonraker_base_url"]).rstrip("/")
            existing = (
                db.query(Printer)
                .filter(Printer.moonraker_base_url == url)
                .first()
            )
            if existing:
                existing.name = str(row["name"])
                existing.ha_power_entity_id = row.get("ha_power_entity_id")  # type: ignore[assignment]
                print(f"updated: {row['name']} -> {url}")
                continue
            p = Printer(
                name=str(row["name"]),
                moonraker_base_url=url,
                moonraker_api_key=None,
                ha_power_entity_id=row.get("ha_power_entity_id"),  # type: ignore[arg-type]
                loaded_material=str(row["loaded_material"]),
                loaded_color=str(row["loaded_color"]),
                remaining_filament_grams=float(row["remaining_filament_grams"]),
                last_known_status=str(row.get("last_known_status", PrinterStatus.offline.value)),
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
