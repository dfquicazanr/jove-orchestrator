"""Default and bootstrap logic for material preheat presets."""

from sqlalchemy.orm import Session

from app.models.material_preheat_preset import MaterialPreheatPreset

DEFAULT_PRESETS: list[tuple[str, float, float, int]] = [
    ("PLA", 210, 60, 0),
    ("PETG", 240, 80, 1),
    ("ABS", 250, 100, 2),
    ("TPU", 220, 50, 3),
]


def ensure_default_preheat_presets(db: Session) -> list[MaterialPreheatPreset]:
    """Insert factory defaults when the table is empty."""
    existing = db.query(MaterialPreheatPreset).order_by(MaterialPreheatPreset.sort_order).all()
    if existing:
        return existing
    for name, hotend, bed, order in DEFAULT_PRESETS:
        db.add(
            MaterialPreheatPreset(
                name=name,
                hotend_c=hotend,
                bed_c=bed,
                sort_order=order,
            )
        )
    db.commit()
    return db.query(MaterialPreheatPreset).order_by(MaterialPreheatPreset.sort_order).all()
