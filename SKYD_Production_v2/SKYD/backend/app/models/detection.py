"""
ORM model — YOLOv8 crop-disease detection events.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DiseaseDetection(Base):
    __tablename__ = "disease_detections"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    drone_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # Location where image was captured
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    # Inference results
    disease_label: Mapped[str] = mapped_column(String(128), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    bounding_boxes: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    affected_area_m2: Mapped[float] = mapped_column(Float, default=0.0)

    # Response
    spray_dispatched: Mapped[bool] = mapped_column(default=False)
    spray_dispatched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Image reference (S3 key or local path)
    image_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Processing metadata
    inference_ms: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        Index("ix_detection_drone_time", "drone_id", "detected_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<DiseaseDetection drone={self.drone_id} "
            f"disease='{self.disease_label}' conf={self.confidence:.2%}>"
        )
