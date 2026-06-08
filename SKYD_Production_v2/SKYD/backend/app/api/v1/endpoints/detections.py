"""
AI Disease Detection endpoint.

POST /detections/analyze   — receive drone image, run YOLOv8, store result,
                             dispatch spray alert via WebSocket if disease found
GET  /detections/recent    — query latest detections
"""

import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.detection import DiseaseDetection
from app.schemas.schemas import DetectionResponse
from app.services.ai_service import ai_service

logger = logging.getLogger("skyd.detections")
router = APIRouter()

MAX_BYTES = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/tiff"}


@router.post(
    "/analyze",
    response_model=DetectionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Analyze drone image for crop disease (YOLOv8 + OpenCV)",
)
async def analyze_image(
    drone_id: str = Form(..., min_length=3, max_length=64),
    latitude: float = Form(..., ge=-90.0, le=90.0),
    longitude: float = Form(..., ge=-180.0, le=180.0),
    altitude_m: float = Form(default=30.0, ge=0.0),
    field_area_m2: float = Form(default=100.0, ge=1.0, description="Approximate area covered by image"),
    image: UploadFile = File(..., description="Drone camera frame (JPEG/PNG)"),
    db: AsyncSession = Depends(get_db),
) -> DetectionResponse:
    """
    Multipart endpoint called by drone after each scan pass.

    1. Validates image size and type (zero-tolerance for garbage data)
    2. Reads raw bytes → OpenCV preprocessing (CLAHE + denoise + resize)
    3. YOLOv8 inference → disease label + bounding boxes
    4. Persists result to PostgreSQL
    5. If disease found: broadcasts SPRAY_ALERT via WebSocket
    """

    # ── Validate content-type ─────────────────────────────────────────────
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported image type '{image.content_type}'. Allowed: {ALLOWED_CONTENT_TYPES}",
        )

    # ── Read and size-check ───────────────────────────────────────────────
    image_bytes = await image.read()
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image exceeds {settings.MAX_IMAGE_SIZE_MB} MB limit",
        )
    if len(image_bytes) < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image is too small — likely corrupt or empty",
        )

    # ── AI inference ──────────────────────────────────────────────────────
    try:
        disease_label, confidence, boxes, inference_ms = ai_service.infer(image_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Image processing error: {exc}",
        )

    # ── Persist ───────────────────────────────────────────────────────────
    record = DiseaseDetection(
        drone_id=drone_id,
        latitude=latitude,
        longitude=longitude,
        disease_label=disease_label,
        confidence=confidence,
        bounding_boxes=json.dumps(boxes),
        affected_area_m2=field_area_m2 if disease_label != "Healthy" else 0.0,
        inference_ms=inference_ms,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    # ── Dispatch spray alert ──────────────────────────────────────────────
    sprayed = await ai_service.dispatch_spray_if_needed(
        drone_id=drone_id,
        lat=latitude,
        lon=longitude,
        disease_label=disease_label,
        confidence=confidence,
        area_m2=field_area_m2,
    )
    if sprayed:
        record.spray_dispatched = True
        await db.flush()

    logger.info(
        "Detection id=%s drone=%s disease='%s' conf=%.2f spray=%s",
        record.id, drone_id, disease_label, confidence, sprayed,
    )

    return DetectionResponse(
        id=record.id,
        drone_id=record.drone_id,
        detected_at=record.detected_at,
        latitude=record.latitude,
        longitude=record.longitude,
        disease_label=record.disease_label,
        confidence=record.confidence,
        bounding_boxes=json.loads(record.bounding_boxes),
        affected_area_m2=record.affected_area_m2,
        spray_dispatched=record.spray_dispatched,
        inference_ms=record.inference_ms,
    )


@router.get(
    "/recent",
    response_model=list[DetectionResponse],
    summary="Get recent disease detections",
)
async def get_recent_detections(
    limit: int = 50,
    drone_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[DetectionResponse]:
    stmt = (
        select(DiseaseDetection)
        .order_by(DiseaseDetection.detected_at.desc())
        .limit(min(limit, 200))
    )
    if drone_id:
        stmt = stmt.where(DiseaseDetection.drone_id == drone_id)

    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        DetectionResponse(
            id=r.id,
            drone_id=r.drone_id,
            detected_at=r.detected_at,
            latitude=r.latitude,
            longitude=r.longitude,
            disease_label=r.disease_label,
            confidence=r.confidence,
            bounding_boxes=json.loads(r.bounding_boxes),
            affected_area_m2=r.affected_area_m2,
            spray_dispatched=r.spray_dispatched,
            inference_ms=r.inference_ms,
        )
        for r in rows
    ]
