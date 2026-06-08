"""
WebSocket endpoint — live drone telemetry & spray alerts for SKYD dashboard.

FIX: Path changed from /ws/dashboard to /ws/skyd to match frontend expectation.
     Added satellite_update event type.
     SKYD branding throughout.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.websocket_manager import connection_manager

logger = logging.getLogger("skyd.ws")
router = APIRouter()


@router.websocket("/skyd")
async def skyd_websocket(websocket: WebSocket) -> None:
    """
    Persistent WebSocket connection for SKYD dashboard.
    Path: /api/v1/ws/skyd

    Events pushed to client:
      • TELEMETRY           — live GPS + battery + speed for active drones
      • SPRAY_ALERT         — disease detected, precision spray initiated
      • IRRIGATION_COMMAND  — zone irrigation action triggered
      • SATELLITE_UPDATE    — new Sentinel-2 NDVI indices available
      • HEARTBEAT           — keep-alive ping every 30 s
      • CONNECTED           — initial connection confirmation
    """
    await connection_manager.connect(websocket)
    logger.info("SKYD Dashboard connected. Total: %d", connection_manager.connection_count)

    # Send initial greeting with server version and available event types
    await websocket.send_text(
        json.dumps(
            {
                "event": "CONNECTED",
                "message": "SKYD Dashboard WebSocket active — منصة سكاي متصلة",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "server_version": settings.VERSION,
                "events": [
                    "TELEMETRY",
                    "SPRAY_ALERT",
                    "IRRIGATION_COMMAND",
                    "SATELLITE_UPDATE",
                    "HEARTBEAT",
                ],
            }
        )
    )

    heartbeat_task = asyncio.create_task(_heartbeat_loop(websocket))
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                event = msg.get("event", "").upper()
                if event == "PING":
                    await websocket.send_text(
                        json.dumps(
                            {
                                "event": "PONG",
                                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                            }
                        )
                    )
                elif event == "SUBSCRIBE":
                    # Client can subscribe to specific drone_id or zone_id
                    logger.debug("Client subscription request: %s", msg)
                else:
                    logger.debug("WS message from client: %s", msg)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"event": "ERROR", "detail": "Invalid JSON"})
                )
    except WebSocketDisconnect:
        logger.info("SKYD Dashboard client disconnected normally")
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        heartbeat_task.cancel()
        await connection_manager.disconnect(websocket)


# Keep legacy path for backward compatibility
@router.websocket("/dashboard")
async def dashboard_websocket_legacy(websocket: WebSocket) -> None:
    """Legacy path — redirects to /ws/skyd for backward compatibility."""
    await skyd_websocket(websocket)


async def _heartbeat_loop(websocket: WebSocket) -> None:
    """Send a heartbeat every WS_HEARTBEAT_INTERVAL seconds."""
    interval = settings.WS_HEARTBEAT_INTERVAL
    while True:
        await asyncio.sleep(interval)
        try:
            await websocket.send_text(
                json.dumps(
                    {
                        "event": "HEARTBEAT",
                        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                        "active_connections": connection_manager.connection_count,
                    }
                )
            )
        except Exception:
            break
