from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.material_color_preset import MaterialColorPreset
from app.models.material_preheat_preset import MaterialPreheatPreset


def resolve_material_fields(
    db: Session,
    *,
    material_preset_id: int | None,
    required_material: str | None,
) -> tuple[int | None, str | None]:
    if material_preset_id is None:
        return None, required_material.strip() if required_material and required_material.strip() else None
    preset = db.get(MaterialPreheatPreset, material_preset_id)
    if preset is None:
        raise HTTPException(status_code=400, detail="Material preset not found")
    mat_name = required_material.strip() if required_material and required_material.strip() else preset.name
    return material_preset_id, mat_name


def resolve_color_fields(
    db: Session,
    *,
    material_preset_id: int | None,
    material_color_preset_id: int | None,
) -> tuple[int | None, str | None]:
    if material_color_preset_id is None:
        return None, None
    color = db.get(MaterialColorPreset, material_color_preset_id)
    if color is None:
        raise HTTPException(status_code=400, detail="Color preset not found")
    if material_preset_id is not None and color.material_preset_id != material_preset_id:
        raise HTTPException(status_code=400, detail="Color preset does not belong to the selected material")
    return color.id, color.name
