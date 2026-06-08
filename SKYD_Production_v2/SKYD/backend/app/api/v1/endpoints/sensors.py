"""
Sensor endpoints.

POST /sensors/readings          — ingest physical sensor data
GET  /sensors/{zone_id}/readings — query readings by zone
POST /sensors/virtual/infer     — Synthetic Virtual Sensing Engine
"""

import logging

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.sensor import SensorReading
from app.schemas.schemas import (
    SensorListResponse,
    SensorReadingCreate,
    SensorReadingResponse,
    VirtualSensorRequest,
    VirtualSensorResponse,
)
from app.services.virtual_sensor_service import virtual_sensing_engine

logger = logging.getLogger("skyd.sensors")
router = APIRouter()


@router.post(
    "/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest physical sensor reading",
)
async def ingest_sensor_reading(
    payload: SensorReadingCreate,
    db: AsyncSession = Depends(get_db),
) -> SensorReadingResponse:
    record = SensorReading(
        zone_id=payload.zone_id,
        moisture_pct=payload.moisture_pct,
        salinity_ds_m=payload.salinity_ds_m,
        temperature_c=payload.temperature_c,
        latitude=payload.latitude,
        longitude=payload.longitude,
        is_virtual=payload.is_virtual,
        inference_confidence=payload.inference_confidence,
        ndvi=payload.ndvi,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    logger.debug("Sensor reading stored for zone=%s", payload.zone_id)
    return SensorReadingResponse.model_validate(record)


@router.get(
    "/{zone_id}/readings",
    response_model=SensorListResponse,
    summary="Query sensor readings for a zone",
)
async def get_zone_readings(
    zone_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> SensorListResponse:
    stmt = (
        select(SensorReading)
        .where(SensorReading.zone_id == zone_id)
        .order_by(SensorReading.recorded_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return SensorListResponse(
        total=len(rows),
        zone_id=zone_id,
        items=[SensorReadingResponse.model_validate(r) for r in rows],
    )


@router.post(
    "/virtual/infer",
    response_model=VirtualSensorResponse,
    summary="Synthetic Virtual Sensing Engine — infer soil conditions at unmeasured GPS points",
)
async def infer_virtual_sensors(
    payload: VirtualSensorRequest,
) -> VirtualSensorResponse:
    """
    Core SKYD innovation: given 3–5 physical anchor readings,
    infer soil moisture / salinity / temperature at any number
    of target GPS coordinates using IDW interpolation + soil physics.
    """
    return virtual_sensing_engine.infer(payload)


# ── Sensor Registration (pairing by MAC Address) ────────────────────────────

from pydantic import BaseModel as _BaseModel
from datetime import datetime as _datetime, timezone as _timezone
from typing import Optional as _Optional, List as _List


class SensorRegisterRequest(_BaseModel):
    sensor_id: str
    mac_address: _Optional[str] = None
    ip_address: _Optional[str] = None
    zone_id: _Optional[str] = None
    sensor_type: str = "soil_moisture"  # soil_moisture, soil_temp, soil_ph, soil_ec, air_temp, etc.
    latitude: _Optional[float] = None
    longitude: _Optional[float] = None
    firmware_version: _Optional[str] = None


class SensorRegisterResponse(_BaseModel):
    success: bool
    sensor_id: str
    mac_address: _Optional[str]
    zone_id: _Optional[str]
    sensor_type: str
    registered_at: str
    rest_endpoint: str
    mqtt_topic: str
    payload_schema: dict
    pump_command_endpoint: str
    message: str


@router.post(
    "/register",
    response_model=SensorRegisterResponse,
    status_code=201,
    summary="Register ground sensor by MAC address for pairing",
)
async def register_sensor(payload: SensorRegisterRequest):
    """
    Pair a physical ground sensor (soil moisture, temp, EC, pH, NPK) with SKYD.
    Returns REST endpoint, MQTT topic, payload schema, and pump command endpoint.
    
    To send readings after pairing:
      POST /api/v1/sensors/readings
      {
        "zone_id": "zone_01",
        "moisture_pct": 45.2,
        "temperature_c": 28.5,
        "salinity_ds_m": 1.2,
        "latitude": 33.32,
        "longitude": 44.37,
        "is_virtual": false
      }
      
    To send water pump commands:
      POST /api/v1/irrigation/command
      { "zone_id": "zone_01", "action": "ON", "duration_minutes": 30 }
    """
    logger.info(
        "Sensor registered: id=%s mac=%s type=%s zone=%s",
        payload.sensor_id, payload.mac_address, payload.sensor_type, payload.zone_id,
    )
    return SensorRegisterResponse(
        success=True,
        sensor_id=payload.sensor_id,
        mac_address=payload.mac_address,
        zone_id=payload.zone_id,
        sensor_type=payload.sensor_type,
        registered_at=_datetime.now(_timezone.utc).isoformat(),
        rest_endpoint="POST /api/v1/sensors/readings",
        mqtt_topic=f"skyd/farm_01/sensors/{payload.sensor_id}/{payload.sensor_type}",
        payload_schema={
            "zone_id": "string",
            "moisture_pct": "float (0-100)",
            "temperature_c": "float",
            "salinity_ds_m": "float",
            "latitude": "float",
            "longitude": "float",
            "is_virtual": "bool (false for physical sensors)",
        },
        pump_command_endpoint="POST /api/v1/irrigation/command",
        message=f"Sensor '{payload.sensor_id}' paired successfully. Use REST or MQTT to send readings.",
    )
