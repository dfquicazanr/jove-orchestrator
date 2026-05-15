from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://jove:jove@localhost:5432/jove"

    jwt_secret_key: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    gcode_upload_dir: str = "data/uploads"
    gcode_max_upload_mb: int = 256

    initial_admin_username: str | None = None
    initial_admin_password: str | None = None

    home_assistant_base_url: str | None = None
    home_assistant_token: str | None = None

    log_level: str = "INFO"

    moonraker_watch_enabled: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
