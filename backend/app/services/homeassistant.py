from typing import Any

import asyncio
import httpx
from sqlalchemy.orm import Session

from app.services import ha_integration_settings as ha_integration

# Domains whose primary service API uses ``turn_on`` / ``turn_off`` (same as printer power calls).
_POWER_ENTITY_DOMAINS = frozenset({"switch", "light", "input_boolean", "fan"})

_MAX_ENTITY_LIST = 6000


class HomeAssistantError(Exception):
    pass


def _domain_from_entity_id(entity_id: str) -> str:
    """First segment of ``entity_id`` (e.g. ``switch.plug`` → ``switch``)."""

    e = entity_id.strip()
    if "." not in e:
        raise HomeAssistantError(
            f"Invalid Home Assistant entity_id {entity_id!r} — expected ``domain.entity``."
        )
    dom, _, rest = e.partition(".")
    if not dom or not rest:
        raise HomeAssistantError(f"Invalid Home Assistant entity_id {entity_id!r}")
    return dom


async def call_service(entity_id: str, service: str, db: Session) -> dict[str, Any]:
    """POST ``/api/services/{domain}/{service}`` for the entity's native domain."""

    domain = _domain_from_entity_id(entity_id)
    base_url, token, _src = ha_integration.resolve_home_assistant_credentials(db)
    if not base_url or not token:
        raise HomeAssistantError(
            "Home Assistant is not configured. "
            "Set base URL + long-lived access token in Farm → Home Assistant… "
            "(or HOME_ASSISTANT_BASE_URL and HOME_ASSISTANT_TOKEN on the API server)."
        )
    url = base_url.rstrip("/") + f"/api/services/{domain}/{service}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {"entity_id": entity_id.strip()}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise HomeAssistantError(f"HA {r.status_code}: {r.text}")
        try:
            return r.json()
        except Exception:
            return {}


async def turn_entity_on(entity_id: str, db: Session) -> dict[str, Any]:
    return await call_service(entity_id, "turn_on", db)


async def turn_entity_off(entity_id: str, db: Session) -> dict[str, Any]:
    return await call_service(entity_id, "turn_off", db)


async def ping_rest_api_with(base_url: str, token: str) -> tuple[bool, str | None]:
    """GET ``/api/`` — validates URL + Bearer token (no DB)."""

    url = base_url.rstrip("/") + "/api/"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            return False, f"HA {r.status_code}: {r.text[:500]}"
        return True, None


async def ping_rest_api(db: Session) -> tuple[bool, str | None]:
    """GET ``/api/`` using saved or environment credentials."""

    base_url, token, _src = ha_integration.resolve_home_assistant_credentials(db)
    if not base_url or not token:
        return False, "Home Assistant base URL or token missing"
    return await ping_rest_api_with(base_url, token)


_ON_STATES = frozenset({"on", "true", "open", "locked", "playing"})
_OFF_STATES = frozenset({"off", "false", "closed", "unlocked", "idle", "standby"})


def parse_entity_power_on(state: str | None) -> bool | None:
    """Map HA entity ``state`` to mains on/off; ``None`` when unknown or unavailable."""

    if state is None:
        return None
    s = state.strip().casefold()
    if not s or s in {"unknown", "unavailable", "none"}:
        return None
    if s in _ON_STATES:
        return True
    if s in _OFF_STATES:
        return False
    return None


async def get_power_states_for_entities(
    db: Session, entity_ids: list[str]
) -> dict[str, bool | None]:
    """Read current on/off for linked HA entities via one ``GET /api/states`` round trip."""

    wanted = {e.strip() for e in entity_ids if e and e.strip()}
    if not wanted:
        return {}

    base_url, token, _src = ha_integration.resolve_home_assistant_credentials(db)
    if not base_url or not token:
        return {eid: None for eid in wanted}

    url = base_url.rstrip("/") + "/api/states"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            return {eid: None for eid in wanted}
        try:
            payload = r.json()
        except Exception:
            return {eid: None for eid in wanted}

    out: dict[str, bool | None] = {eid: None for eid in wanted}
    if not isinstance(payload, list):
        return out
    for row in payload:
        if not isinstance(row, dict):
            continue
        eid_raw = row.get("entity_id")
        if not isinstance(eid_raw, str):
            continue
        eid = eid_raw.strip()
        if eid not in wanted:
            continue
        state_raw = row.get("state")
        out[eid] = parse_entity_power_on(str(state_raw) if state_raw is not None else None)
    return out


async def get_entity_power_state(db: Session, entity_id: str) -> bool | None:
    """Read one entity via ``GET /api/states/{entity_id}``."""

    eid = entity_id.strip()
    if not eid:
        return None

    base_url, token, _src = ha_integration.resolve_home_assistant_credentials(db)
    if not base_url or not token:
        return None

    url = base_url.rstrip("/") + f"/api/states/{eid}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            return None
        try:
            row = r.json()
        except Exception:
            return None

    if not isinstance(row, dict):
        return None
    state_raw = row.get("state")
    return parse_entity_power_on(str(state_raw) if state_raw is not None else None)


async def read_power_state_after_service(
    db: Session,
    entity_id: str,
    *,
    expected: bool | None = None,
    attempts: int = 4,
) -> bool | None:
    """Poll entity state briefly after ``turn_on``/``turn_off`` — HA can lag a beat."""

    last: bool | None = None
    for i in range(max(1, attempts)):
        last = await get_entity_power_state(db, entity_id)
        if expected is None or last == expected:
            return last
        if i + 1 < attempts:
            await asyncio.sleep(0.2 * (i + 1))
    return last


async def list_power_entity_ids(db: Session) -> list[str]:
    """Fetch ``GET /api/states`` and return sorted ``entity_id`` values usable for mains power hooks."""

    base_url, token, _src = ha_integration.resolve_home_assistant_credentials(db)
    if not base_url or not token:
        raise HomeAssistantError(
            "Home Assistant is not configured. "
            "Set base URL + long-lived access token in Farm → Home Assistant… "
            "(or HOME_ASSISTANT_BASE_URL and HOME_ASSISTANT_TOKEN on the API server)."
        )
    url = base_url.rstrip("/") + "/api/states"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            raise HomeAssistantError(f"HA {r.status_code}: {r.text[:500]}")
        try:
            payload = r.json()
        except Exception as exc:
            raise HomeAssistantError("Unexpected HA response — could not decode JSON.") from exc
    if not isinstance(payload, list):
        raise HomeAssistantError("Unexpected HA /api/states response — expected a JSON array.")
    out: list[str] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        eid_raw = row.get("entity_id")
        if not isinstance(eid_raw, str):
            continue
        eid = eid_raw.strip()
        dom, _, tail = eid.partition(".")
        if not tail or dom not in _POWER_ENTITY_DOMAINS:
            continue
        out.append(eid)
    out.sort(key=str.casefold)
    if len(out) > _MAX_ENTITY_LIST:
        out = out[:_MAX_ENTITY_LIST]
    return out
