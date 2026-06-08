"""
Central configuration — all settings read from environment / .env file.
All references updated to SKYD branding.
"""
import os
from functools import lru_cache 
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Project ───────────────────────────────────────────────────────────
    PROJECT_NAME: str = "SKYD — Smart Field Intelligence Platform"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = False

    # ── Security ──────────────────────────────────────────────────────────
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALLOWED_ORIGINS: List[str] = ["*"]

    # ── Database ─────────────────────────────────────────────────────
    POSTGRES_USER: str = "skyd"
    POSTGRES_PASSWORD: str = "skyd_secret"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "skyd_db"

    @property
    def DATABASE_URL(self) -> str:
        # يقرأ الرابط المباشر من متغيرات البيئة إن وجد، وإلا يبنيه تلقائياً
        env_url = os.environ.get("DATABASE_URL")
        if env_url:
            # Ensure asyncpg driver prefix for async SQLAlchemy
            if env_url.startswith("postgresql://"):
                return env_url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return env_url
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    # ── AI / YOLOv8 ───────────────────────────────────────────────────────
    YOLO_MODEL_PATH: str = "models/skyd_crop_disease_v8.pt"
    YOLO_CONFIDENCE_THRESHOLD: float = 0.45
    YOLO_IOU_THRESHOLD: float = 0.45
    MAX_IMAGE_SIZE_MB: int = 10

    # ── WebSocket ─────────────────────────────────────────────────────────
    WS_HEARTBEAT_INTERVAL: int = 30   # seconds

    # ── Satellite (Copernicus / Sentinel-2) — server-side only ────────────
    COPERNICUS_CLIENT_ID: str = ""
    COPERNICUS_CLIENT_SECRET: str = ""

    # ── AI Advice (Gemini) ────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""

    # ── Weather API (for backend weather proxy if needed) ─────────────────
    WEATHER_API_KEY: str = ""

    # ── Twilio SMS / Voice Calls ───
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # ── Logging ───
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/skyd.log"

    # ── Uvicorn workers (used by Docker CMD) ──────────────────────────────
    WORKERS: int = 4


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()# 