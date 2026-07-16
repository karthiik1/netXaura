"""Application configuration, loaded from environment (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # mysql+asyncmy://user:pass@host:3306/netxaura  (see §2 — asyncmy, not aiomysql)
    database_url: str = "mysql+asyncmy://netxaura:netxaura@localhost:3306/netxaura"

    # Comma-separated list of allowed CORS origins for the REST API.
    cors_origins: str = "http://localhost:5173"

    # Transfer state-machine tuning (§5). These are the process-wide defaults;
    # per-workspace overrides live in the app_settings table.
    transfer_ttl_seconds: int = 10
    gesture_cooldown_ms: int = 800
    confidence_threshold: float = 0.7

    # Workspaces auto-expire this many hours after the last activity (§3 policy).
    workspace_ttl_hours: int = 2

    # Expired workspaces are hard-deleted by a background sweep (§3). Workspaces
    # with a connected member are never swept, even past expires_at.
    cleanup_interval_seconds: int = 900

    # WebSocket hardening (§5.1): per-frame size cap and per-connection token
    # buckets. Telemetry = cursor_move / gesture_event (dropped when over
    # budget); control = everything else (rejected with `rate_limited`).
    ws_max_message_bytes: int = 262_144
    ws_telemetry_rate_per_sec: float = 40.0
    ws_telemetry_burst: int = 60
    ws_control_rate_per_sec: float = 5.0
    ws_control_burst: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
