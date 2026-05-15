from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.models.material_preheat_preset import MaterialPreheatPreset
from app.models.user import User
from app.schemas.material_preheat import (
    MaterialPreheatPresetOut,
    MaterialPreheatPresetsUpdate,
)
from app.services.material_preheat import ensure_default_preheat_presets

router = APIRouter()


@router.get("/material-preheat", response_model=list[MaterialPreheatPresetOut])
def list_material_preheat_presets(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    presets = ensure_default_preheat_presets(db)
    return [MaterialPreheatPresetOut.model_validate(p) for p in presets]


@router.put("/material-preheat", response_model=list[MaterialPreheatPresetOut])
def replace_material_preheat_presets(
    body: MaterialPreheatPresetsUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    names = [p.name.strip() for p in body.presets]
    if len(names) != len(set(n.lower() for n in names)):
        raise HTTPException(status_code=422, detail="Preset names must be unique")

    db.query(MaterialPreheatPreset).delete()
    db.flush()

    out: list[MaterialPreheatPreset] = []
    for i, item in enumerate(body.presets):
        row = MaterialPreheatPreset(
            name=item.name.strip(),
            hotend_c=item.hotend_c,
            bed_c=item.bed_c,
            sort_order=item.sort_order if item.sort_order else i,
        )
        db.add(row)
        out.append(row)

    db.commit()
    for row in out:
        db.refresh(row)
    out.sort(key=lambda r: (r.sort_order, r.id))
    return [MaterialPreheatPresetOut.model_validate(p) for p in out]
