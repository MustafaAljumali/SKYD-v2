"""
Pydantic v2 schemas — strict validation for all SKYD API contracts.
Zero tolerance for malformed data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Dict, List, Optional
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


# ── Shared config ─────────────────────────────────────────────────────────────
class _StrictBase(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid",          # reject unknown fields
        frozen=False,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Drone Telemetry
# ═════════════════════════════════════════════════════════════════════════════

DRONE_STATUSES = {"IDLE", "SCANNING", "SPRAYING", "RETURNING", "CHARGING", "ERROR"}


class TelemetryCreate(_StrictBase):
    drone_id: str = Field(..., min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    altitude_m: float = Field(default=0.0, ge=0.0, le=5_000.0)
    battery_pct: float = Field(..., ge=0.0, le=100.0)
    speed_ms: float = Field(default=0.0, ge=0.0, le=50.0)
    status: str = Field(default="IDLE")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        v = v.upper()
        if v not in DRONE_STATUSES:
            raise ValueError(f"status must be one of {DRONE_STATUSES}")
        return v


class TelemetryResponse(_StrictBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    drone_id: str
    recorded_at: datetime
    latitude: float
    longitude: float
    altitude_m: float
    battery_pct: float
    speed_ms: float
    status: str


class TelemetryListResponse(_StrictBase):
    total: int
    items: List[TelemetryResponse]


# ═════════════════════════════════════════════════════════════════════════════
# Sensor Readings
# ═════════════════════════════════════════════════════════════════════════════

class SensorReadingCreate(_StrictBase):
    zone_id: str = Field(..., min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    moisture_pct: float = Field(..., ge=0.0, le=100.0)
    salinity_ds_m: float = Field(..., ge=0.0, le=50.0, description="Electrical conductivity dS/m")
    temperature_c: float = Field(..., ge=-40.0, le=80.0)
    latitude: float = Field(default=0.0, ge=-90.0, le=90.0)
    longitude: float = Field(default=0.0, ge=-180.0, le=180.0)
    is_virtual: bool = Field(default=False)
    inference_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    ndvi: Optional[float] = Field(default=None, ge=-1.0, le=1.0)


class SensorReadingResponse(_StrictBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    zone_id: str
    recorded_at: datetime
    moisture_pct: float
    salinity_ds_m: float
    temperature_c: float
    latitude: float
    longitude: float
    is_virtual: bool
    inference_confidence: float
    ndvi: Optional[float]


class SensorListResponse(_StrictBase):
    total: int
    zone_id: str
    items: List[SensorReadingResponse]


# ═════════════════════════════════════════════════════════════════════════════
# Virtual Sensor Inference Request / Response
# ═════════════════════════════════════════════════════════════════════════════

class VirtualSensorRequest(_StrictBase):
    zone_id: str = Field(..., min_length=2, max_length=64)
    anchor_readings: List[SensorReadingCreate] = Field(
        ..., min_length=1, max_length=10,
        description="Physical sensor readings used as anchors for inference"
    )
    target_lats: List[float] = Field(..., min_length=1, max_length=500)
    target_lons: List[float] = Field(..., min_length=1, max_length=500)
    soil_type: str = Field(default="loam", pattern=r"^(sand|loam|clay|silt|peat)$")
    ndvi_hint: Optional[float] = Field(default=None, ge=-1.0, le=1.0)

    @model_validator(mode="after")
    def check_lat_lon_match(self) -> "VirtualSensorRequest":
        if len(self.target_lats) != len(self.target_lons):
            raise ValueError("target_lats and target_lons must have equal length")
        return self


class VirtualSensorPoint(_StrictBase):
    latitude: float
    longitude: float
    inferred_moisture_pct: float
    inferred_salinity_ds_m: float
    inferred_temperature_c: float
    confidence: float


class VirtualSensorResponse(_StrictBase):
    zone_id: str
    soil_type: str
    anchor_count: int
    inferred_points: List[VirtualSensorPoint]
    inference_model: str = "ASFS-VSE-v1"


# ═════════════════════════════════════════════════════════════════════════════
# Disease Detection (YOLOv8)
# ═════════════════════════════════════════════════════════════════════════════

class BoundingBox(_StrictBase):
    x1: float
    y1: float
    x2: float
    y2: float
    label: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class DetectionResponse(_StrictBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    drone_id: str
    detected_at: datetime
    latitude: float
    longitude: float
    disease_label: str
    confidence: float
    bounding_boxes: List[Dict[str, Any]]
    affected_area_m2: float
    spray_dispatched: bool
    inference_ms: int


# ═════════════════════════════════════════════════════════════════════════════
# Irrigation Command
# ═════════════════════════════════════════════════════════════════════════════

IRRIGATION_ACTIONS = {"START", "STOP", "PULSE", "VACCINE_BOOST"}


class IrrigationCommandCreate(_StrictBase):
    zone_id: str = Field(..., min_length=2, max_length=64)
    action: str = Field(...)
    duration_min: int = Field(default=30, ge=0, le=480)
    moisture_target_pct: float = Field(default=65.0, ge=10.0, le=100.0)
    potassium_boost: bool = Field(
        default=False, description="Agricultural Vaccine mode: pre-boost K⁺ before heat wave"
    )

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        v = v.upper()
        if v not in IRRIGATION_ACTIONS:
            raise ValueError(f"action must be one of {IRRIGATION_ACTIONS}")
        return v


class IrrigationCommandResponse(_StrictBase):
    command_id: str
    zone_id: str
    action: str
    duration_min: int
    moisture_target_pct: float
    potassium_boost: bool
    issued_at: datetime
    status: str = "QUEUED"


# ═════════════════════════════════════════════════════════════════════════════
# Generic
# ═════════════════════════════════════════════════════════════════════════════

class HealthResponse(_StrictBase):
    status: str
    version: str
    db_connected: bool
    ws_connections: int
    timestamp: datetime


class ErrorResponse(_StrictBase):
    detail: str
    error_code: Optional[str] = None
