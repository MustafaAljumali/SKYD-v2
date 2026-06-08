"""
ASFS Backend — Async test suite.
Uses pytest-asyncio + httpx AsyncClient (no running server needed).
"""

from __future__ import annotations

import json
import os
from io import BytesIO
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ── In-memory SQLite for tests (no Postgres needed) ──────────────────────────
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")

from app.db.session import Base, get_db
from app.main import app

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False, future=True)
    async with engine.begin() as conn:
        from app.models import drone, sensor, detection  # noqa
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(test_engine, expire_on_commit=False, autoflush=False)
    async with factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


# ═════════════════════════════════════════════════════════════════════════════
# Health
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("healthy", "degraded")
    assert "version" in data
    assert "ws_connections" in data


# ═════════════════════════════════════════════════════════════════════════════
# Drone Telemetry
# ═════════════════════════════════════════════════════════════════════════════

VALID_TELEMETRY = {
    "drone_id": "ASFS-DRONE-01",
    "latitude": 33.3406,
    "longitude": 44.4009,
    "altitude_m": 25.0,
    "battery_pct": 87.5,
    "speed_ms": 5.2,
    "status": "SCANNING",
}


@pytest.mark.asyncio
async def test_ingest_telemetry(client: AsyncClient):
    resp = await client.post("/api/v1/drones/telemetry", json=VALID_TELEMETRY)
    assert resp.status_code == 201
    data = resp.json()
    assert data["drone_id"] == "ASFS-DRONE-01"
    assert data["battery_pct"] == 87.5
    assert data["status"] == "SCANNING"
    assert "id" in data


@pytest.mark.asyncio
async def test_telemetry_invalid_status(client: AsyncClient):
    bad = {**VALID_TELEMETRY, "status": "FLYING_TO_THE_MOON"}
    resp = await client.post("/api/v1/drones/telemetry", json=bad)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_telemetry_invalid_lat(client: AsyncClient):
    bad = {**VALID_TELEMETRY, "latitude": 999.0}
    resp = await client.post("/api/v1/drones/telemetry", json=bad)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_telemetry_extra_field_rejected(client: AsyncClient):
    bad = {**VALID_TELEMETRY, "secret_field": "hacked"}
    resp = await client.post("/api/v1/drones/telemetry", json=bad)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_drone_telemetry(client: AsyncClient):
    # Insert first
    await client.post("/api/v1/drones/telemetry", json=VALID_TELEMETRY)
    resp = await client.get("/api/v1/drones/ASFS-DRONE-01/telemetry")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_get_unknown_drone_404(client: AsyncClient):
    resp = await client.get("/api/v1/drones/NONEXISTENT-DRONE/telemetry")
    assert resp.status_code == 404


# ═════════════════════════════════════════════════════════════════════════════
# Sensor Readings
# ═════════════════════════════════════════════════════════════════════════════

VALID_SENSOR = {
    "zone_id": "ZONE-A1",
    "moisture_pct": 42.5,
    "salinity_ds_m": 1.8,
    "temperature_c": 28.3,
    "latitude": 33.34,
    "longitude": 44.40,
}


@pytest.mark.asyncio
async def test_ingest_sensor_reading(client: AsyncClient):
    resp = await client.post("/api/v1/sensors/readings", json=VALID_SENSOR)
    assert resp.status_code == 201
    data = resp.json()
    assert data["zone_id"] == "ZONE-A1"
    assert data["moisture_pct"] == 42.5


@pytest.mark.asyncio
async def test_sensor_salinity_out_of_range(client: AsyncClient):
    bad = {**VALID_SENSOR, "salinity_ds_m": -1.0}
    resp = await client.post("/api/v1/sensors/readings", json=bad)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_zone_readings(client: AsyncClient):
    await client.post("/api/v1/sensors/readings", json=VALID_SENSOR)
    resp = await client.get("/api/v1/sensors/ZONE-A1/readings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["zone_id"] == "ZONE-A1"
    assert data["total"] >= 1


# ═════════════════════════════════════════════════════════════════════════════
# Virtual Sensing Engine
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_virtual_sensor_inference(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-B2",
        "anchor_readings": [
            {**VALID_SENSOR, "zone_id": "ZONE-B2", "latitude": 33.340, "longitude": 44.400},
            {**VALID_SENSOR, "zone_id": "ZONE-B2", "latitude": 33.342, "longitude": 44.402, "moisture_pct": 55.0},
            {**VALID_SENSOR, "zone_id": "ZONE-B2", "latitude": 33.344, "longitude": 44.404, "moisture_pct": 38.0},
        ],
        "target_lats": [33.341, 33.343],
        "target_lons": [44.401, 44.403],
        "soil_type": "loam",
    }
    resp = await client.post("/api/v1/sensors/virtual/infer", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["zone_id"] == "ZONE-B2"
    assert len(data["inferred_points"]) == 2
    for pt in data["inferred_points"]:
        assert 0.0 <= pt["inferred_moisture_pct"] <= 100.0
        assert 0.5 <= pt["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_virtual_sensor_lat_lon_mismatch(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-C3",
        "anchor_readings": [{**VALID_SENSOR, "zone_id": "ZONE-C3"}],
        "target_lats": [33.341, 33.342],
        "target_lons": [44.401],          # mismatch!
        "soil_type": "clay",
    }
    resp = await client.post("/api/v1/sensors/virtual/infer", json=payload)
    assert resp.status_code == 422


# ═════════════════════════════════════════════════════════════════════════════
# Irrigation Decision Engine
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_auto_decide_vaccine_boost(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-W1",
        "moisture_pct": 60.0,
        "salinity_ds_m": 1.5,
        "temperature_c": 35.0,
        "heat_wave_in_48h": True,
    }
    resp = await client.post("/api/v1/irrigation/auto-decide", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "VACCINE_BOOST"
    assert data["potassium_boost"] is True


@pytest.mark.asyncio
async def test_auto_decide_critical_moisture(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-W2",
        "moisture_pct": 18.0,
        "salinity_ds_m": 1.0,
        "temperature_c": 30.0,
        "heat_wave_in_48h": False,
    }
    resp = await client.post("/api/v1/irrigation/auto-decide", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "START"


@pytest.mark.asyncio
async def test_auto_decide_salinity_lockout(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-W3",
        "moisture_pct": 20.0,
        "salinity_ds_m": 9.5,   # above lockout threshold
        "temperature_c": 30.0,
        "heat_wave_in_48h": False,
    }
    resp = await client.post("/api/v1/irrigation/auto-decide", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "STOP"


@pytest.mark.asyncio
async def test_auto_decide_sufficient_moisture(client: AsyncClient):
    payload = {
        "zone_id": "ZONE-W4",
        "moisture_pct": 70.0,
        "salinity_ds_m": 1.0,
        "temperature_c": 25.0,
        "heat_wave_in_48h": False,
    }
    resp = await client.post("/api/v1/irrigation/auto-decide", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "STOP"


# ═════════════════════════════════════════════════════════════════════════════
# Disease Detection (YOLOv8 mocked)
# ═════════════════════════════════════════════════════════════════════════════

def _make_fake_jpeg() -> bytes:
    """Create a minimal valid JPEG-like byte string for tests."""
    import struct
    # A 1x1 white JPEG (minimal valid)
    return (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e!"
        b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
        b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00"
        b"\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
        b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04"
        b"\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa"
        b'\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd2\x8a(\x00\xff\xd9'
    )


@pytest.mark.asyncio
async def test_analyze_image_mock(client: AsyncClient):
    """Test the detection endpoint using the built-in mock inference."""
    fake_image = _make_fake_jpeg()
    files = {"image": ("test.jpg", BytesIO(fake_image), "image/jpeg")}
    data = {
        "drone_id": "ASFS-DRONE-02",
        "latitude": "33.3406",
        "longitude": "44.4009",
        "altitude_m": "30.0",
        "field_area_m2": "150.0",
    }
    resp = await client.post("/api/v1/detections/analyze", data=data, files=files)
    assert resp.status_code == 201
    body = resp.json()
    assert body["drone_id"] == "ASFS-DRONE-02"
    assert "disease_label" in body
    assert "confidence" in body
    assert "inference_ms" in body


@pytest.mark.asyncio
async def test_analyze_image_wrong_type(client: AsyncClient):
    files = {"image": ("test.pdf", BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
    data = {
        "drone_id": "ASFS-DRONE-03",
        "latitude": "33.34",
        "longitude": "44.40",
    }
    resp = await client.post("/api/v1/detections/analyze", data=data, files=files)
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_get_recent_detections(client: AsyncClient):
    resp = await client.get("/api/v1/detections/recent")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
