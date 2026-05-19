from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.config import get_settings
from app.models.material_color_preset import MaterialColorPreset
from app.models.material_preheat_preset import MaterialPreheatPreset
from app.models.user import User
from app.schemas.home_assistant_settings import (
    HomeAssistantEntitiesOut,
    HomeAssistantSettingsOut,
    HomeAssistantSettingsPut,
    HomeAssistantTestBody,
    HomeAssistantTestResult,
)
from app.schemas.material_preheat import (
    MaterialColorPresetOut,
    MaterialColorPresetsUpdate,
    MaterialPreheatPresetOut,
    MaterialPreheatPresetsUpdate,
)
from app.services import ha_integration_settings as ha_integration
from app.services import homeassistant as ha_svc
from app.services.material_preheat import ensure_default_preheat_presets


def _home_assistant_settings_out(db: Session) -> HomeAssistantSettingsOut:
    row = ha_integration.get_singleton_row(db)
    db_url = (row.base_url or "").strip() or None
    db_tok = bool((row.token or "").strip())
    s = get_settings()
    env_b = (s.home_assistant_base_url or "").strip() or None
    env_tok = bool((s.home_assistant_token or "").strip())
    bu_eff, tok_eff, src = ha_integration.resolve_home_assistant_credentials(db)

    form_url = db_url
    if not form_url and env_b and env_tok:
        form_url = env_b
    return HomeAssistantSettingsOut(
        base_url=form_url,
        token_configured=db_tok,
        effective_configured=bool(bu_eff and tok_eff),
        credentials_source=src,
    )


router = APIRouter()


def _load_material_presets(db: Session) -> list[MaterialPreheatPreset]:
    ensure_default_preheat_presets(db)
    return (
        db.query(MaterialPreheatPreset)
        .options(joinedload(MaterialPreheatPreset.color_presets))
        .order_by(MaterialPreheatPreset.sort_order, MaterialPreheatPreset.id)
        .all()
    )


@router.get("/material-preheat", response_model=list[MaterialPreheatPresetOut])
def list_material_preheat_presets(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    presets = _load_material_presets(db)
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

    keep_ids = {p.id for p in body.presets if p.id is not None}
    if keep_ids:
        db.query(MaterialPreheatPreset).filter(MaterialPreheatPreset.id.notin_(keep_ids)).delete(
            synchronize_session=False
        )
    else:
        db.query(MaterialPreheatPreset).delete(synchronize_session=False)
    db.flush()

    for i, item in enumerate(body.presets):
        order = item.sort_order if item.sort_order else i
        if item.id is not None:
            row = db.get(MaterialPreheatPreset, item.id)
            if row is None:
                raise HTTPException(status_code=422, detail=f"Material preset {item.id} not found")
            row.name = item.name.strip()
            row.hotend_c = item.hotend_c
            row.bed_c = item.bed_c
            row.default_density_g_cm3 = item.default_density_g_cm3
            row.sort_order = order
            db.add(row)
        else:
            db.add(
                MaterialPreheatPreset(
                    name=item.name.strip(),
                    hotend_c=item.hotend_c,
                    bed_c=item.bed_c,
                    default_density_g_cm3=item.default_density_g_cm3,
                    sort_order=order,
                )
            )

    db.commit()
    reloaded = _load_material_presets(db)
    return [MaterialPreheatPresetOut.model_validate(p) for p in reloaded]


@router.put(
    "/material-preheat/{preset_id}/colors",
    response_model=list[MaterialColorPresetOut],
)
def replace_material_color_presets(
    preset_id: int,
    body: MaterialColorPresetsUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    material = db.get(MaterialPreheatPreset, preset_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")

    names = [c.name.strip().lower() for c in body.colors]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Color names must be unique within the material")

    defaults = [c for c in body.colors if c.is_default]
    if len(defaults) > 1:
        raise HTTPException(status_code=422, detail="At most one default color per material")

    db.query(MaterialColorPreset).filter(MaterialColorPreset.material_preset_id == preset_id).delete()
    db.flush()

    out: list[MaterialColorPreset] = []
    for i, item in enumerate(body.colors):
        row = MaterialColorPreset(
            material_preset_id=preset_id,
            name=item.name.strip(),
            hex=item.hex,
            is_default=item.is_default,
            notes=item.notes.strip() if item.notes else None,
            sort_order=item.sort_order if item.sort_order else i,
        )
        db.add(row)
        out.append(row)

    db.commit()
    for row in out:
        db.refresh(row)
    out.sort(key=lambda r: (r.sort_order, r.id))
    return [MaterialColorPresetOut.model_validate(r) for r in out]


@router.get("/home-assistant", response_model=HomeAssistantSettingsOut)
def get_home_assistant_settings(
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    return _home_assistant_settings_out(db)


@router.put("/home-assistant", response_model=HomeAssistantSettingsOut)
def put_home_assistant_settings(
    body: HomeAssistantSettingsPut,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    row = ha_integration.get_singleton_row(db)
    payload = body.model_dump(exclude_unset=True)

    if body.revoke_token:
        row.token = None
    elif "token" in payload:
        if body.token is None:
            row.token = None
        else:
            row.token = body.token.strip() or None

    if "base_url" in payload:
        row.base_url = None if body.base_url is None else (body.base_url.strip() or None)

    db.add(row)
    db.commit()
    db.refresh(row)
    return _home_assistant_settings_out(db)


@router.post("/home-assistant/test", response_model=HomeAssistantTestResult)
async def test_home_assistant(
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
    body: HomeAssistantTestBody = Body(default_factory=HomeAssistantTestBody),
):
    raw = body.model_dump(exclude_unset=True)
    sbu, stok, _ = ha_integration.resolve_home_assistant_credentials(db)
    bu = (body.base_url.strip() or None) if "base_url" in raw else sbu
    tok = (body.token.strip() or None) if "token" in raw else stok
    if not bu or not tok:
        return HomeAssistantTestResult(
            ok=False,
            message="Home Assistant base URL or token missing — enter both in the form, or save stored "
            "credentials first (Test merges form fields with saved values).",
        )
    ok, detail = await ha_svc.ping_rest_api_with(bu, tok)
    return HomeAssistantTestResult(ok=ok, message=detail)


@router.get("/home-assistant/entities", response_model=HomeAssistantEntitiesOut)
async def list_home_assistant_power_entities(
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    """Entity ids suitable for printer power linking (domains with ``turn_on`` / ``turn_off`` services)."""

    try:
        entity_ids = await ha_svc.list_power_entity_ids(db)
    except ha_svc.HomeAssistantError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return HomeAssistantEntitiesOut(entity_ids=entity_ids)

