"""
ORM model — Ground-sensor readings (moisture, salinity, temperature).
Virtual sensor inference results are also stored here.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    zone_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # Physical sensor readings
    moisture_pct: Mapped[float] = mapped_column(Float, nullable=False)
    salinity_ds_m: Mapped[float] = mapped_column(Float, nullable=False)   # dS/m
    temperature_c: Mapped[float] = mapped_column(Float, nullable=False)

    # GPS position of the physical sensor
    latitude: Mapped[float] = mapped_column(Float, default=0.0)
    longitude: Mapped[float] = mapped_column(Float, default=0.0)

    # Virtual sensor inference
    is_virtual: Mapped[bool] = mapped_column(Boolean, default=False)
    inference_confidence: Mapped[float] = mapped_column(Float, default=1.0)

    # Derived NDVI (from satellite layer or pseudo-NDVI RGB processing)
    ndvi: Mapped[float | None] = mapped_column(Float, nullable=True)

    __table_args__ = (
        Index("ix_sensor_zone_time", "zone_id", "recorded_at"),
    )

    def __repr__(self) -> str:
        kind = "virtual" if self.is_virtual else "physical"
        return (
            f"<SensorReading zone={self.zone_id} [{kind}] "
            f"moisture={self.moisture_pct:.1f}% salt={self.salinity_ds_m:.2f}>"
        )
