"""
SMS Notification Service — Twilio integration for fire emergency alerts.
Sends bilingual SMS (Arabic + English) and initiates voice calls.

If Twilio credentials are not configured, logs a warning and returns False.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("skyd.sms")


class SMSService:
    """Manages SMS and voice call notifications via Twilio."""

    def __init__(self) -> None:
        self._client = None
        self._from_number: Optional[str] = None
        self._init_client()

    def _init_client(self) -> None:
        """Initialize Twilio client if credentials are configured."""
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
            logger.warning(
                "Twilio credentials not configured. SMS alerts will be disabled."
            )
            return

        try:
            from twilio.rest import Client
            self._client = Client(
                settings.TWILIO_ACCOUNT_SID,
                settings.TWILIO_AUTH_TOKEN,
            )
            self._from_number = settings.TWILIO_FROM_NUMBER
            logger.info("Twilio SMS service initialized successfully")
        except ImportError:
            logger.error(
                "twilio package not installed. Run: pip install twilio==9.0.0"
            )
        except Exception as exc:
            logger.error("Twilio client initialization failed: %s", exc)

    def send_fire_alert(
        self, phone: str, temp: float, zone_name: str
    ) -> bool:
        """
        Send a bilingual fire alert SMS via Twilio.
        Returns True if sent successfully, False otherwise.
        """
        if not self._client or not self._from_number:
            logger.warning(
                "Cannot send SMS: Twilio not configured. Phone=%s, Temp=%.1f",
                phone,
                temp,
            )
            return False

        body = (
            f"[SKYD FIRE ALERT] 🚨\n"
            f"⚠️ حريق! درجة الحرارة {temp:.1}°C في {zone_name}\n"
            f"⚠️ FIRE! Temperature {temp:.1}°C in {zone_name}. "
            f"Urgent firefighting required immediately."
        )

        try:
            message = self._client.messages.create(
                to=phone,
                from_=self._from_number,
                body=body,
            )
            logger.info(
                "Fire alert SMS sent to %s (SID: %s)", phone, message.sid
            )
            return True
        except Exception as exc:
            logger.error("Failed to send SMS to %s: %s", phone, exc)
            return False

    def make_emergency_call(self, phone: str, message: str) -> bool:
        """
        Initiate a Twilio voice call with TTS message.
        Returns True if call initiated successfully, False otherwise.
        """
        if not self._client or not self._from_number:
            logger.warning(
                "Cannot make call: Twilio not configured. Phone=%s", phone
            )
            return False

        try:
            # Use TwiML for TTS message
            twiml = (
                f"<Response><Say voice='alice' language='en-US'>"
                f"{message}"
                f"</Say></Response>"
            )
            call = self._client.calls.create(
                to=phone,
                from_=self._from_number,
                twiml=twiml,
            )
            logger.info(
                "Emergency call initiated to %s (SID: %s)", phone, call.sid
            )
            return True
        except Exception as exc:
            logger.error("Failed to initiate call to %s: %s", phone, exc)
            return False


# Singleton
sms_service = SMSService()
