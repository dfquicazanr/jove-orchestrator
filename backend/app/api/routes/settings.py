from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.config import get_settings
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
    MaterialPreheatPresetOut,
    MaterialPreheatPresetsUpdate,
)
from app.services import homeassistant as ha_svc
from app.services import ha_integration_settings as ha_integration
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

