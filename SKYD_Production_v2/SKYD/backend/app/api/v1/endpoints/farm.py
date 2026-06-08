"""
Farm Registration Endpoint — accepts GeoJSON polygon boundaries
with any number of vertices (3, 4, 5, 6, 10, 20+) for all farm shapes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class GeoJSONGeometry(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str = "Polygon"
    coordinates: List[List[List[float]]]

    @field_validator("type")
    @classmethod
    def must_be_polygon(cls, v: str) -> str:
        if v != "Polygon":
            raise ValueError("Only Polygon geometry is supported")
        return v

    @field_validator("coordinates")
    @classmethod
    def validate_coordinate_ring(cls, v: List[List[List[float]]]) -> List[List[List[float]]]:
        if not v or len(v) == 0:
            raise ValueError("coordinates must contain at least one ring")
        ring = v[0]
        if len(ring) < 3:
            raise ValueError(f"Polygon ring must have ≥ 3 vertices, got {len(ring)}")
        # Each coordinate must be [lng, lat]
        for pt in ring:
            if len(pt) < 2:
                raise ValueError("Each coordinate must have at least [longitude, latitude]")
            lng, lat = pt[0], pt[1]
            if not (-180 <= lng <= 180):
                raise ValueError(f"Longitude {lng} out of range [-180, 180]")
            if not (-90 <= lat <= 90):
                raise ValueError(f"Latitude {lat} out of range [-90, 90]")
        return v


class GeoJSONFeature(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str = "Feature"
    geometry: GeoJSONGeometry


class FarmRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    geojson: GeoJSONFeature
    coordinates: Optional[List[List[float]]] = None
    point_count: Optional[int] = None
    area_acres: float = Field(default=0.0, ge=0.0)
    soil_type: str = Field(default="", max_length=200)
    timestamp: Optional[str] = None


class FarmRegisterResponse(BaseModel):
    success: bool
    farm_id: str
    point_count: int
    area_acres: float
    soil_type: str
    coordinates: List[List[float]]
    registered_at: str


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=FarmRegisterResponse)
async def register_farm(payload: FarmRegisterRequest):
    """
    Register farm boundary with GeoJSON polygon.
    Accepts any number of vertices (3, 4, 5, 6, 10, 20+)
    to support triangular, rectangular, and irregular farm shapes.
    """
    ring = payload.geojson.geometry.coordinates[0]
    point_count = len(ring)

    # Use client-provided coordinates array if available, else extract from GeoJSON
    coords = payload.coordinates if payload.coordinates else ring

    # Validate point_count matches if provided
    if payload.point_count is not None and payload.point_count != point_count:
        logger.warning(
            "Client point_count=%d doesn't match GeoJSON ring=%d, using GeoJSON",
            payload.point_count,
            point_count,
        )

    logger.info(
        "Farm registered: %d vertices, %.4f acres, soil=%s",
        point_count,
        payload.area_acres,
        payload.soil_type,
    )

    return FarmRegisterResponse(
        success=True,
        farm_id=f"farm_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{point_count}pts",
        point_count=point_count,
        area_acres=payload.area_acres,
        soil_type=payload.soil_type,
        coordinates=coords,
        registered_at=datetime.now(timezone.utc).isoformat(),
    )
