"""
ORM model — Drone telemetry records.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DroneTelemetry(Base):
    __tablename__ = "drone_telemetry"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    drone_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # GPS
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    altitude_m: Mapped[float] = mapped_column(Float, default=0.0)

    # Status
    battery_pct: Mapped[float] = mapped_column(Float, default=100.0)
    speed_ms: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="IDLE")

    __table_args__ = (
        Index("ix_telemetry_drone_time", "drone_id", "recorded_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<DroneTelemetry drone={self.drone_id} "
            f"lat={self.latitude:.5f} lon={self.longitude:.5f} "
            f"batt={self.battery_pct}%>"
        )
