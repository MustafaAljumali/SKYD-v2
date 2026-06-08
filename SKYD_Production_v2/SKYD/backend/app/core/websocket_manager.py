"""
WebSocket Connection Manager
Broadcasts live drone GPS, telemetry, and spray alerts to all connected dashboards.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Set

from fastapi import WebSocket

logger = logging.getLogger("skyd.websocket")


class ConnectionManager:
    """Thread-safe WebSocket hub for real-time SKYD dashboard updates."""

    def __init__(self) -> None:
        self._active: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    # ── Connection lifecycle ──────────────────────────────────────────────

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._active.add(websocket)
        logger.info(
            "Dashboard connected — total connections: %d", len(self._active)
        )

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._active.discard(websocket)
        logger.info(
            "Dashboard disconnected — total connections: %d", len(self._active)
        )

    # ── Broadcast helpers ─────────────────────────────────────────────────

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        """Send a JSON payload to every connected dashboard client."""
        if not self._active:
            return
        message = json.dumps(payload, default=str)
        dead: Set[WebSocket] = set()

        async with self._lock:
            clients = list(self._active)

        for ws in clients:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)

        if dead:
            async with self._lock:
                self._active -= dead
            logger.warning("Removed %d dead WebSocket connections", len(dead))

    async def broadcast_telemetry(
        self,
        drone_id: str,
        lat: float,
        lon: float,
        altitude: float,
        battery_pct: float,
        speed_ms: float,
        status: str,
    ) -> None:
        await self.broadcast(
            {
                "event": "TELEMETRY",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "drone_id": drone_id,
                "gps": {"lat": lat, "lon": lon, "altitude_m": altitude},
                "battery_pct": battery_pct,
                "speed_ms": speed_ms,
                "status": status,
            }
        )

    async def broadcast_spray_alert(
        self,
        drone_id: str,
        lat: float,
        lon: float,
        disease_label: str,
        confidence: float,
        area_m2: float,
    ) -> None:
        await self.broadcast(
            {
                "event": "SPRAY_ALERT",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "drone_id": drone_id,
                "location": {"lat": lat, "lon": lon},
                "disease": disease_label,
                "confidence": round(confidence, 4),
                "area_m2": area_m2,
                "action": "PRECISION_SPRAY_INITIATED",
            }
        )

    async def broadcast_irrigation_command(
        self,
        zone_id: str,
        moisture_pct: float,
        salinity_ds_m: float,
        action: str,
        duration_min: int,
    ) -> None:
        await self.broadcast(
            {
                "event": "IRRIGATION_COMMAND",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "zone_id": zone_id,
                "sensor_reading": {
                    "moisture_pct": moisture_pct,
                    "salinity_ds_m": salinity_ds_m,
                },
                "action": action,
                "duration_min": duration_min,
            }
        )

    @property
    def connection_count(self) -> int:
        return len(self._active)


# Singleton
connection_manager = ConnectionManager()
