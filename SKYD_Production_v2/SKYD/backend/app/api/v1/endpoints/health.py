"""
Health & readiness check.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.websocket_manager import connection_manager
from app.db.session import get_db
from app.schemas.schemas import HealthResponse

router = APIRouter()


@router.get("", response_model=HealthResponse, summary="System health check")
async def health_check(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    return HealthResponse(
        status="healthy" if db_ok else "degraded",
        version=settings.VERSION,
        db_connected=db_ok,
        ws_connections=connection_manager.connection_count,
        timestamp=datetime.now(tz=timezone.utc),
    )
