from pydantic import BaseModel, ConfigDict, Field


class HomeAssistantSettingsOut(BaseModel):
    """Managers only; raw token is never returned."""

    model_config = ConfigDict(from_attributes=False)

    base_url: str | None
    token_configured: bool
    effective_configured: bool
    credentials_source: str | None = Field(
        default=None,
        description="'database', 'environment', or null when printer power cannot call HA",
    )


class HomeAssistantSettingsPut(BaseModel):
    """Update stored credentials (singleton row). Omit ``token`` to leave it unchanged."""

    model_config = ConfigDict(extra="forbid")

    base_url: str | None = Field(default=None, max_length=512)
    token: str | None = Field(default=None, max_length=8192)
    revoke_token: bool = False


class HomeAssistantEntitiesOut(BaseModel):
    """Entity ids from HA ``/api/states`` filtered to domains Jove uses for ``turn_on`` / ``turn_off``."""

    model_config = ConfigDict(from_attributes=False)

    entity_ids: list[str]


class HomeAssistantTestResult(BaseModel):
    ok: bool
    message: str | None = None


class HomeAssistantTestBody(BaseModel):
    """Optional URL/token for **Test connection** (not persisted). Omitted fields use saved/env values."""

    model_config = ConfigDict(extra="forbid")

    base_url: str | None = Field(default=None, max_length=512)
    token: str | None = Field(default=None, max_length=8192)
