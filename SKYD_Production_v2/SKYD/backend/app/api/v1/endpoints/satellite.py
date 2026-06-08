"""
Satellite Imagery endpoints — Sentinel-2 via Copernicus API.
Server-side only: API keys NEVER exposed to frontend.

GET  /satellite/ndvi?lat=&lon=&zone_id=   — fetch latest Sentinel-2 NDVI for a location
POST /satellite/analyze                   — analyze a zone and cache result
GET  /satellite/zones/{zone_id}/latest    — get latest cached satellite data for zone
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.websocket_manager import connection_manager
from app.services.satellite_service import satellite_service

logger = logging.getLogger("skyd.satellite")
router = APIRouter()


class SatelliteAnalyzeRequest(BaseModel):
    zone_id: str = Field(..., min_length=2, max_length=64)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    radius_m: float = Field(default=500.0, ge=50.0, le=10000.0)


class SatelliteDataResponse(BaseModel):
    zone_id: str
    lat: float
    lon: float
    ndvi: float
    evi: Optional[float] = None
    ndwi: Optional[float] = None
    ndre: Optional[float] = None
    cloud_cover_pct: float
    imagery_date: str
    source: str
    fetched_at: str
    health_status: str  # "Healthy" | "Stressed" | "Critical"
    health_ar: str


def _classify_health(ndvi: float) -> tuple[str, str]:
    if ndvi >= 0.6:
        return "Healthy", "سليم"
    elif ndvi >= 0.4:
        return "Moderate", "متوسط"
    elif ndvi >= 0.2:
        return "Stressed", "مجهد"
    else:
        return "Critical", "حرج"


@router.get(
    "/ndvi",
    response_model=SatelliteDataResponse,
    summary="Fetch Sentinel-2 NDVI for a GPS coordinate (server-side API key)",
)
async def get_ndvi(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    zone_id: str = Query(default="zone_default"),
    radius_m: float = Query(default=500.0, ge=50.0, le=10000.0),
) -> SatelliteDataResponse:
    """
    Fetches real Sentinel-2 satellite data via Copernicus API.
    API keys are loaded server-side from environment — never exposed to browser.
    """
    try:
        result = await satellite_service.fetch_ndvi(lat=lat, lon=lon, radius_m=radius_m)
    except Exception as exc:
        logger.error("Satellite fetch failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Satellite service unavailable: {exc}",
        )

    health_en, health_ar = _classify_health(result["ndvi"])

    response = SatelliteDataResponse(
        zone_id=zone_id,
        lat=lat,
        lon=lon,
        ndvi=result["ndvi"],
        evi=result.get("evi"),
        ndwi=result.get("ndwi"),
        ndre=result.get("ndre"),
        cloud_cover_pct=result.get("cloud_cover_pct", 0.0),
        imagery_date=result.get("imagery_date", datetime.now(tz=timezone.utc).isoformat()),
        source=result.get("source", "sentinel2"),
        fetched_at=datetime.now(tz=timezone.utc).isoformat(),
        health_status=health_en,
        health_ar=health_ar,
    )

    # Broadcast satellite update via WebSocket
    await connection_manager.broadcast({
        "event": "SATELLITE_UPDATE",
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "zone_id": zone_id,
        "ndvi": result["ndvi"],
        "health_status": health_en,
        "health_ar": health_ar,
        "imagery_date": response.imagery_date,
    })

    return response


@router.post(
    "/analyze",
    response_model=SatelliteDataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Analyze zone with Sentinel-2 satellite data",
)
async def analyze_zone(payload: SatelliteAnalyzeRequest) -> SatelliteDataResponse:
    return await get_ndvi(
        lat=payload.lat,
        lon=payload.lon,
        zone_id=payload.zone_id,
        radius_m=payload.radius_m,
    )


@router.get(
    "/health",
    summary="Check if Copernicus satellite credentials are configured",
)
async def satellite_health():
    configured = bool(settings.COPERNICUS_CLIENT_ID and settings.COPERNICUS_CLIENT_SECRET)
    return {
        "configured": configured,
        "message": "Satellite API ready" if configured else "Set COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET in .env",
        "source": "Copernicus/Sentinel-2",
    }
