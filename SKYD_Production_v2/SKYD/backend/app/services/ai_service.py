"""
AI Inference Service — YOLOv8 crop-disease detection.

Pipeline:
  1. OpenCV preprocessing (resize, normalize, denoise)
  2. YOLOv8 inference (ultralytics)
  3. Post-processing: NMS, confidence filter, bounding-box extraction
  4. Dispatch spray alert via WebSocket if disease found

Returns honest empty result ("No_Model_Loaded", 0.0 confidence) when model file is absent.
Never injects fake disease detections.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import cv2
import numpy as np

from app.core.config import settings
from app.core.websocket_manager import connection_manager

logger = logging.getLogger("skyd.ai")

# ── Disease label map (matches YOLO class indices) ────────────────────────────
DISEASE_LABELS: Dict[int, str] = {
    0: "Healthy",
    1: "Leaf_Rust",           # Puccinia triticina — صدأ الأوراق
    2: "Yellow_Rust",         # Stripe rust — صدأ أصفر
    3: "Sunn_Pest",           # سونة القمح
    4: "Powdery_Mildew",      # البياض الدقيقي
    5: "Fusarium_Blight",     # لفحة الفيوزاريوم
    6: "Septoria_Leaf_Blotch",
    7: "Nutrient_Deficiency_N",
    8: "Nutrient_Deficiency_K",
    9: "Water_Stress",
}


class YOLOv8InferenceService:
    """Singleton YOLO inference service with lazy model loading."""

    _instance: "YOLOv8InferenceService | None" = None
    _model: Any = None

    def __new__(cls) -> "YOLOv8InferenceService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> None:
        """Load YOLOv8 model on first use."""
        if self._model is not None:
            return
        model_path = Path(settings.YOLO_MODEL_PATH)
        if not model_path.exists():
            logger.warning(
                "YOLOv8 model not found at '%s' — running in MOCK mode", model_path
            )
            return
        try:
            from ultralytics import YOLO  # type: ignore
            self._model = YOLO(str(model_path))
            logger.info("✅ YOLOv8 model loaded from '%s'", model_path)
        except Exception as exc:
            logger.error("Failed to load YOLOv8 model: %s", exc)

    # ── OpenCV preprocessing ──────────────────────────────────────────────

    @staticmethod
    def preprocess(image_bytes: bytes) -> np.ndarray:
        """
        Decode raw bytes → BGR → 640×640 YOLO input.
        Steps: decode → denoise → CLAHE equalisation → resize
        """
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("OpenCV could not decode image — unsupported format or corrupt data")

        # Denoise (fastNlMeansDenoisingColored is heavy; use a lighter bilateral for drones)
        denoised = cv2.bilateralFilter(img, d=5, sigmaColor=75, sigmaSpace=75)

        # CLAHE on L-channel (boosts contrast for disease spots under bright sunlight)
        lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        # Resize to YOLOv8 input size
        resized = cv2.resize(enhanced, (640, 640), interpolation=cv2.INTER_LINEAR)
        return resized

    # ── Inference ─────────────────────────────────────────────────────────

    def infer(
        self, image_bytes: bytes
    ) -> Tuple[str, float, List[Dict[str, Any]], int]:
        """
        Run full inference pipeline.

        Returns:
            (disease_label, best_confidence, bounding_boxes, inference_ms)
        """
        self._load_model()

        t0 = time.perf_counter()

        if self._model is None:
            ms = int((time.perf_counter() - t0) * 1000)
            logger.warning("No YOLOv8 model loaded — returning honest empty result (no mock data)")
            return "No_Model_Loaded", 0.0, [], ms

        img = self.preprocess(image_bytes)

        results = self._model.predict(
            source=img,
            conf=settings.YOLO_CONFIDENCE_THRESHOLD,
            iou=settings.YOLO_IOU_THRESHOLD,
            verbose=False,
        )

        ms = int((time.perf_counter() - t0) * 1000)
        boxes: List[Dict[str, Any]] = []
        best_label = "Healthy"
        best_conf = 0.0

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(float, box.xyxy[0])
                label = DISEASE_LABELS.get(cls_id, f"class_{cls_id}")
                boxes.append(
                    {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "label": label, "confidence": conf}
                )
                if conf > best_conf and label != "Healthy":
                    best_conf = conf
                    best_label = label

        if not boxes:
            best_label = "Healthy"
            best_conf = 1.0

        logger.info(
            "Inference completed in %d ms — label='%s' conf=%.2f boxes=%d",
            ms, best_label, best_conf, len(boxes),
        )
        return best_label, best_conf, boxes, ms

    # ── Dispatch spray ────────────────────────────────────────────────────

    async def dispatch_spray_if_needed(
        self,
        drone_id: str,
        lat: float,
        lon: float,
        disease_label: str,
        confidence: float,
        area_m2: float,
    ) -> bool:
        """Broadcast a spray alert via WebSocket if a real disease is detected."""
        if disease_label == "Healthy":
            return False
        if confidence < settings.YOLO_CONFIDENCE_THRESHOLD:
            return False
        await connection_manager.broadcast_spray_alert(
            drone_id=drone_id,
            lat=lat,
            lon=lon,
            disease_label=disease_label,
            confidence=confidence,
            area_m2=area_m2,
        )
        logger.info(
            "🚨 SPRAY ALERT dispatched — drone=%s disease='%s' conf=%.2f",
            drone_id, disease_label, confidence,
        )
        return True


# Singleton instance
ai_service = YOLOv8InferenceService()
