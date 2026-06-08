"""
SKYD — Smart Field Intelligence Platform
Autonomous Agricultural Drone Backend Server
"""

import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import engine, init_db
from app.core.websocket_manager import connection_manager

# ── Logging ──────────────────────────────────────────────────────────────────
setup_logging()
logger = logging.getLogger("skyd.main")


# ── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("🚀 SKYD Backend starting up …")
    await init_db()
    logger.info("✅ Database initialised")
    yield
    logger.info("🛑 SKYD Backend shutting down …")
    await engine.dispose()


# ── App factory ───────────────────────────────────────────────────────────────
def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.PROJECT_NAME,
        description=(
            "SKYD Smart Field Intelligence Platform — "
            "YOLOv8 disease detection · WebSocket telemetry · "
            "Sentinel-2 satellite imagery · "
            "Predictive irrigation · Edge AI for Iraqi agriculture"
        ),
        version=settings.VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── Middleware ─────────────────────────────────────────────────────────
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(GZipMiddleware, minimum_size=1_000)

    # ── Routers ───────────────────────────────────────────────────────────
    application.include_router(api_router, prefix=settings.API_V1_STR)

    # ── Global exception handler ──────────────────────────────────────────
    @application.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error("Unhandled exception: %s", exc, exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "error": str(exc)},
        )

    return application


app = create_application()


# ── Dev / Production entrypoint ───────────────────────────────────────────────
if __name__ == "__main__":
    # Check if running in production on Render, otherwise default to local 8000
    is_prod = os.environ.get("RENDER") is not None
    port = int(os.environ.get("PORT", 8000))
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=not is_prod,  # Disable reload only in production
        log_level="info",
    )