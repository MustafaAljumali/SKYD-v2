"""
SKYD API v1 Router — aggregates all endpoint modules.

Fixed: Added missing satellite and ai_advice routers.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    detections,
    drones,
    farm,
    health,
    irrigation,
    sensors,
    websocket,
    satellite,
    ai_advice,
    notifications,
)

api_router = APIRouter()

api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(farm.router, prefix="/farm", tags=["Farm Geo-Boundary"])
api_router.include_router(drones.router, prefix="/drones", tags=["Drone Telemetry"])
api_router.include_router(sensors.router, prefix="/sensors", tags=["Sensors & VSE"])
api_router.include_router(detections.router, prefix="/detections", tags=["AI Disease Detection"])
api_router.include_router(irrigation.router, prefix="/irrigation", tags=["Predictive Irrigation"])
api_router.include_router(websocket.router, prefix="/ws", tags=["WebSocket"])
api_router.include_router(satellite.router, prefix="/satellite", tags=["Satellite Imagery"])
api_router.include_router(ai_advice.router, prefix="/ai", tags=["AI Agricultural Advice"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["SMS Notifications"])
