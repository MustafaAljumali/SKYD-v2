"""
AI Agricultural Advice endpoint — Gemini server-side proxy.
Frontend calls /api/v1/ai/advice  — server holds GEMINI_API_KEY.

POST /ai/advice   — farm telemetry → expert recommendations
POST /ai/diagnose — base64 image → crop disease diagnosis
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger("skyd.ai_advice")
router = APIRouter()


class FarmTelemetry(BaseModel):
    temp: float
    humidity: float
    wind: float
    solar: float
    soilPH: Optional[float] = 7.0
    soilMoisture: Optional[float] = 50.0


class ZoneSummary(BaseModel):
    nameEn: str
    nameAr: str
    cropType: Optional[str] = "wheat"
    healthy: int = 0
    infected: int = 0
    moisture: float = 50.0


class AdviceRequest(BaseModel):
    telemetry: FarmTelemetry
    zones: List[ZoneSummary] = []
    language: str = Field(default="ar", pattern=r"^(ar|en|both)$")


class DiagnoseRequest(BaseModel):
    base64Image: str = Field(..., min_length=100)
    zoneId: Optional[str] = None
    cropType: Optional[str] = None


class AdviceResponse(BaseModel):
    directiveAr: List[str]
    directiveEn: List[str]
    summaryAr: str
    summaryEn: str


class DiagnoseResponse(BaseModel):
    diagnosisAr: str
    diagnosisEn: str
    healthStatus: str   # "Healthy" | "Warning" | "Infected"
    typeOfInjuryAr: str
    typeOfInjuryEn: str
    recommendationAr: str
    recommendationEn: str


def _get_gemini_client():
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY not configured on server. Contact administrator.",
        )
    try:
        from google.genai import Client  # type: ignore
        return Client(api_key=settings.GEMINI_API_KEY)
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google-genai package not installed. Run: pip install google-genai",
        )


@router.post(
    "/advice",
    response_model=AdviceResponse,
    summary="Get AI-powered agricultural recommendations from farm telemetry",
)
async def get_advice(req: AdviceRequest) -> AdviceResponse:
    """
    Sends farm telemetry to Gemini and returns expert agricultural advice.
    GEMINI_API_KEY stays server-side — never exposed to browser.
    """
    client = _get_gemini_client()

    zones_text = "; ".join(
        f"{z.nameEn} ({z.cropType}): {z.infected} infected"
        for z in req.zones[:4]
    )

    prompt = f"""You are a professional agricultural expert specializing in Iraqi and Middle Eastern farming.
Analyze this farm state and provide exactly 3 tailored smart recommendations:

Telemetry: Temp={req.telemetry.temp}°C, Humidity={req.telemetry.humidity}%, Wind={req.telemetry.wind}km/h, Solar={req.telemetry.solar}W/m², pH={req.telemetry.soilPH}, Moisture={req.telemetry.soilMoisture}%.
Zones: {zones_text or "No zone data provided"}.

Return JSON only with keys: directiveAr (array of 3), directiveEn (array of 3), summaryAr, summaryEn."""

    try:
        import json
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        data = json.loads(response.text)
        return AdviceResponse(**data)
    except Exception as exc:
        logger.error("Gemini advice request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI service error: {exc}",
        )


@router.post(
    "/diagnose",
    response_model=DiagnoseResponse,
    summary="Diagnose crop disease from drone image via Gemini Vision",
)
async def diagnose_image(req: DiagnoseRequest) -> DiagnoseResponse:
    """
    Runs Gemini Vision on a base64 crop image to detect diseases/pests.
    API key is server-side only.
    """
    client = _get_gemini_client()

    prompt_text = """Diagnose this agricultural plant/field aerial photograph.
Identify: diseases (leaf rust, root rot, mildew), pest infestation, nutrient deficiency (N/P/K), water stress, or healthy.
Return JSON with keys: diagnosisAr, diagnosisEn, healthStatus (Healthy|Warning|Infected), typeOfInjuryAr, typeOfInjuryEn, recommendationAr, recommendationEn."""

    try:
        import json

        # Strip data URL prefix if present
        b64 = req.base64Image
        if "," in b64:
            b64 = b64.split(",", 1)[1]

        from google.genai import types as genai_types  # type: ignore
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                genai_types.Part.from_bytes(
                    data=__import__("base64").b64decode(b64),
                    mime_type="image/jpeg",
                ),
                prompt_text,
            ],
            config={"response_mime_type": "application/json"},
        )
        data = json.loads(response.text)
        return DiagnoseResponse(**data)
    except Exception as exc:
        logger.error("Gemini diagnose request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI diagnosis error: {exc}",
        )
