from typing import Any

import httpx

from app.config import get_settings


class HomeAssistantError(Exception):
    pass


async def call_service(domain: str, service: str, entity_id: str) -> dict[str, Any]:
    s = get_settings()
    if not s.home_assistant_base_url or not s.home_assistant_token:
        raise HomeAssistantError("HOME_ASSISTANT_BASE_URL and HOME_ASSISTANT_TOKEN must be set")
    url = s.home_assistant_base_url.rstrip("/") + f"/api/services/{domain}/{service}"
    headers = {
        "Authorization": f"Bearer {s.home_assistant_token}",
        "Content-Type": "application/json",
    }
    body = {"entity_id": entity_id}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            raise HomeAssistantError(f"HA {r.status_code}: {r.text}")
        try:
            return r.json()
        except Exception:
            return {}


async def turn_switch_on(entity_id: str) -> dict[str, Any]:
    return await call_service("switch", "turn_on", entity_id)


async def turn_switch_off(entity_id: str) -> dict[str, Any]:
    return await call_service("switch", "turn_off", entity_id)
