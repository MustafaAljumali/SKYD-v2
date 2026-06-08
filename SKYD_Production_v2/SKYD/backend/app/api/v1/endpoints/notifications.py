"""
SMS Notifications Endpoint — Fire alert dispatch via Twilio.

POST /notifications/fire-alert
Accepts phone, temp, zone_id, zone_name.
Sends SMS + voice call to farmer.
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.sms_service import sms_service

logger = logging.getLogger("skyd.notifications")

router = APIRouter()


class FireAlertRequest(BaseModel):
    phone: str = Field(..., description="Farmer phone number in E.164 format")
    temp: float = Field(..., description="Current temperature in Celsius")
    zone_id: str = Field(..., description="Zone identifier")
    zone_name: str = Field(..., description="Human-readable zone name")


class FireAlertResponse(BaseModel):
    sms_sent: bool
    call_initiated: bool


@router.post("/fire-alert", response_model=FireAlertResponse)
async def fire_alert(req: FireAlertRequest):
    """Send fire alert SMS and initiate emergency voice call."""
    if not req.phone or len(req.phone) < 5:
        raise HTTPException(status_code=400, detail="Invalid phone number")

    logger.info(
        "Fire alert requested: phone=%s, temp=%.1f, zone=%s",
        req.phone,
        req.temp,
        req.zone_name,
    )

    sms_sent = sms_service.send_fire_alert(
        phone=req.phone, temp=req.temp, zone_name=req.zone_name
    )

    call_message = (
        f"Immediate fire alert from Skyd platform: "
        f"sensor temperature reached {req.temp:.1} degrees Celsius "
        f"in zone {req.zone_name}. "
        f"Please respond instantly with firefighting."
    )
    call_initiated = sms_service.make_emergency_call(
        phone=req.phone, message=call_message
    )

    return FireAlertResponse(sms_sent=sms_sent, call_initiated=call_initiated)
