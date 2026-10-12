from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "NEXUS Python API"
    app_env: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"
    database_url: str = Field(validation_alias="DATABASE_URL")
    database_schema: str = "nexus_python"
    redis_url: str = "redis://127.0.0.1:6380/0"
    jwt_secret: SecretStr = Field(validation_alias=AliasChoices("NEXUS_JWT_SECRET", "SESSION_SECRET"))
    jwt_algorithm: Literal["HS256"] = "HS256"
    jwt_access_minutes: int = Field(default=15, ge=1, le=120)
    jwt_refresh_days: int = Field(default=30, ge=1, le=365)
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-sonnet-5-5"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    workspace_path: str = "/tmp/nexus-workspace"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dimensions: int = 384
    default_rate_limit: int = Field(default=120, ge=1, le=10000)
    login_rate_limit: int = Field(default=8, ge=1, le=100)
    max_request_bytes: int = Field(default=15_000_000, ge=1024, le=20_000_000)
    access_token_audience: str = "nexus-api"
    refresh_token_audience: str = "nexus-refresh"

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("DATABASE_URL is required")
        url = value.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        parsed = make_url(url)
        query = dict(parsed.query)
        if "sslmode" in query:
            if "ssl" in query:
                raise ValueError("DATABASE_URL must not include both sslmode and ssl parameters")
            query["ssl"] = query.pop("sslmode")
            parsed = parsed.set(query=query)
        return parsed.render_as_string(hide_password=False)

    @field_validator("database_schema")
    @classmethod
    def validate_schema_identifier(cls, value: str) -> str:
        if not value or not value.replace("_", "").isalnum() or value[0].isdigit():
            raise ValueError("DATABASE_SCHEMA must be a valid PostgreSQL identifier")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.app_env == "production" and len(settings.jwt_secret.get_secret_value()) < 32:
        raise ValueError("SESSION_SECRET must contain at least 32 characters in production")
    return settings


settings = get_settings()
