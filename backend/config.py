from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = Field(..., description="PostgreSQL async connection string (postgresql+asyncpg://...)")
    redis_url: Optional[str] = Field(None, description="Redis URL — omit to disable run-state cache")

    # AI Providers
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None

    # Search
    search_provider: str = "tavily"
    tavily_api_key: Optional[str] = None
    brave_api_key: Optional[str] = None
    serpapi_api_key: Optional[str] = None

    # App
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


settings = Settings()
