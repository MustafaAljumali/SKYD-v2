"""
Predictive Irrigation endpoints.

POST /irrigation/command       — manual irrigation command
POST /irrigation/auto-decide   — autonomous edge-AI decision
"""

import logging

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.core.websocket_manager import connection_manager
from app.db.session import get_db
from app.schemas.schemas import IrrigationCommandCreate, IrrigationCommandResponse
from app.services.irrigation_service import irrigation_engine

logger = logging.getLogger("skyd.irrigation")
router = APIRouter()


@router.post(
    "/command",
    response_model=IrrigationCommandResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Issue manual irrigation command",
)
async def issue_command(payload: IrrigationCommandCreate) -> IrrigationCommandResponse:
    response = irrigation_engine.build_response(payload)
    await connection_manager.broadcast_irrigation_command(
        zone_id=payload.zone_id,
        moisture_pct=payload.moisture_target_pct,
        salinity_ds_m=0.0,
        action=payload.action,
        duration_min=payload.duration_min,
    )
    logger.info("Manual irrigation command issued: zone=%s action=%s", payload.zone_id, payload.action)
    return response


class AutoDecideRequest(BaseModel):
    zone_id: str = Field(..., min_length=2, max_length=64)
    moisture_pct: float = Field(..., ge=0.0, le=100.0)
    salinity_ds_m: float = Field(..., ge=0.0, le=50.0)
    temperature_c: float = Field(..., ge=-40.0, le=80.0)
    heat_wave_in_48h: bool = Field(default=False)
    ndvi: float | None = Field(default=None, ge=-1.0, le=1.0)


@router.post(
    "/auto-decide",
    response_model=IrrigationCommandResponse,
    summary="Autonomous edge-AI irrigation decision (Agricultural Vaccine Protocol)",
)
async def auto_decide(req: AutoDecideRequest) -> IrrigationCommandResponse:
    """
    SKYD edge-AI evaluates current sensor data and decides the optimal
    irrigation action — including the 'Agricultural Vaccine' K⁺ pre-boost
    if a heat wave is predicted within 48 hours.
    """
    command = irrigation_engine.decide(
        zone_id=req.zone_id,
        moisture_pct=req.moisture_pct,
        salinity_ds_m=req.salinity_ds_m,
        temperature_c=req.temperature_c,
        heat_wave_in_48h=req.heat_wave_in_48h,
        ndvi=req.ndvi,
    )
    response = irrigation_engine.build_response(command)

    if command.action != "STOP":
        await connection_manager.broadcast_irrigation_command(
            zone_id=command.zone_id,
            moisture_pct=req.moisture_pct,
            salinity_ds_m=req.salinity_ds_m,
            action=command.action,
            duration_min=command.duration_min,
        )

    return response
