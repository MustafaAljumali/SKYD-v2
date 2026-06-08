"""
Drone telemetry endpoints.

POST /drones/telemetry        — ingest live telemetry from a drone
GET  /drones/{drone_id}/telemetry — query historical records
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.websocket_manager import connection_manager
from app.db.session import get_db
from app.models.drone import DroneTelemetry
from app.schemas.schemas import TelemetryCreate, TelemetryListResponse, TelemetryResponse

logger = logging.getLogger("skyd.drones")
router = APIRouter()


@router.post(
    "/telemetry",
    response_model=TelemetryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest drone telemetry",
)
async def ingest_telemetry(
    payload: TelemetryCreate,
    db: AsyncSession = Depends(get_db),
) -> TelemetryResponse:
    """
    Called every ~1 s by each active drone.
    Persists the telemetry record and broadcasts GPS position via WebSocket.
    """
    record = DroneTelemetry(
        drone_id=payload.drone_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        altitude_m=payload.altitude_m,
        battery_pct=payload.battery_pct,
        speed_ms=payload.speed_ms,
        status=payload.status,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    # Real-time broadcast to dashboards
    await connection_manager.broadcast_telemetry(
        drone_id=payload.drone_id,
        lat=payload.latitude,
        lon=payload.longitude,
        altitude=payload.altitude_m,
        battery_pct=payload.battery_pct,
        speed_ms=payload.speed_ms,
        status=payload.status,
    )

    logger.debug("Telemetry stored for drone=%s", payload.drone_id)
    return TelemetryResponse.model_validate(record)


@router.get(
    "/{drone_id}/telemetry",
    response_model=TelemetryListResponse,
    summary="Query drone telemetry history",
)
async def get_drone_telemetry(
    drone_id: str,
    limit: int = Query(default=100, ge=1, le=1_000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> TelemetryListResponse:
    stmt = (
        select(DroneTelemetry)
        .where(DroneTelemetry.drone_id == drone_id)
        .order_by(DroneTelemetry.recorded_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No telemetry found for drone '{drone_id}'",
        )

    return TelemetryListResponse(
        total=len(rows),
        items=[TelemetryResponse.model_validate(r) for r in rows],
    )


# ── Drone Registration (pairing by MAC Address / IP) ────────────────────────

class DroneRegisterRequest(BaseModel):
    drone_id: str
    mac_address: Optional[str] = None
    ip_address: Optional[str] = None
    model: Optional[str] = None
    zone_id: Optional[str] = None
    firmware_version: Optional[str] = None


class DroneRegisterResponse(BaseModel):
    success: bool
    drone_id: str
    mac_address: Optional[str]
    ip_address: Optional[str]
    registered_at: str
    websocket_url: str
    telemetry_endpoint: str
    spray_command_topic: str
    message: str


@router.post(
    "/register",
    response_model=DroneRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register drone by MAC address or IP for pairing",
)
async def register_drone(payload: DroneRegisterRequest):
    """
    Pair a physical drone with the SKYD platform.
    Send MAC address or IP to link hardware to a drone_id.
    Returns WebSocket URL and telemetry endpoints.
    """
    logger.info(
        "Drone registered: id=%s mac=%s ip=%s model=%s zone=%s",
        payload.drone_id, payload.mac_address, payload.ip_address,
        payload.model, payload.zone_id,
    )
    return DroneRegisterResponse(
        success=True,
        drone_id=payload.drone_id,
        mac_address=payload.mac_address,
        ip_address=payload.ip_address,
        registered_at=datetime.now(timezone.utc).isoformat(),
        websocket_url="ws://localhost:8000/api/v1/ws/skyd",
        telemetry_endpoint="POST /api/v1/drones/telemetry",
        spray_command_topic=f"skyd/drones/{payload.drone_id}/commands",
        message=f"Drone '{payload.drone_id}' paired successfully. Send telemetry to POST /api/v1/drones/telemetry",
    )
