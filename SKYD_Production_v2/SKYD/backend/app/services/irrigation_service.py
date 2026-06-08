"""
Predictive Irrigation & Agricultural Vaccine Protocol

SKYD implements "agricultural vaccination": 48 h before a heat-wave,
the system pre-boosts soil moisture and potassium concentration so
the crop faces stress at peak resilience — not at depletion.

Irrigation decisions are made at the EDGE (no cloud latency).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.schemas.schemas import IrrigationCommandCreate, IrrigationCommandResponse

logger = logging.getLogger("skyd.irrigation")

# ── Thresholds ────────────────────────────────────────────────────────────────
CRITICAL_MOISTURE_PCT = 30.0     # Start irrigation immediately
OPTIMAL_MOISTURE_PCT = 65.0      # Target for normal operation
VACCINE_MOISTURE_PCT = 78.0      # Pre-boost target before heat wave
SALINE_LOCKOUT_DS_M = 8.0        # Do NOT irrigate if salinity this high (flush needed)
MAX_SAFE_SALINITY_DS_M = 4.0     # Acceptable salinity upper bound


class IrrigationDecisionEngine:
    """
    Edge-AI decision engine for autonomous irrigation.

    Returns an IrrigationCommandCreate based on current sensor readings
    and optional weather forecast context.
    """

    def decide(
        self,
        zone_id: str,
        moisture_pct: float,
        salinity_ds_m: float,
        temperature_c: float,
        heat_wave_in_48h: bool = False,
        ndvi: Optional[float] = None,
    ) -> IrrigationCommandCreate:
        """
        Autonomous irrigation decision.

        Priority:
        1. Salinity lockout — soil too saline, halt irrigation
        2. Agricultural Vaccine — pre-boost before predicted heat wave
        3. Critical moisture — emergency irrigation
        4. Optimal maintenance — scheduled pulse
        5. Sufficient moisture — do nothing (STOP)
        """

        # 1. Salinity lockout
        if salinity_ds_m >= SALINE_LOCKOUT_DS_M:
            logger.warning(
                "Zone %s: salinity %.2f dS/m ABOVE LOCKOUT. Halting irrigation.", zone_id, salinity_ds_m
            )
            return IrrigationCommandCreate(
                zone_id=zone_id,
                action="STOP",
                duration_min=0,
                moisture_target_pct=OPTIMAL_MOISTURE_PCT,
                potassium_boost=False,
            )

        # 2. Agricultural vaccine — 48 h pre-heat-wave boost
        if heat_wave_in_48h and moisture_pct < VACCINE_MOISTURE_PCT:
            logger.info(
                "Zone %s: VACCINE_BOOST initiated — heat wave predicted in 48 h. "
                "Target moisture %.0f%%, K⁺ supplement ON.",
                zone_id, VACCINE_MOISTURE_PCT,
            )
            return IrrigationCommandCreate(
                zone_id=zone_id,
                action="VACCINE_BOOST",
                duration_min=60,
                moisture_target_pct=VACCINE_MOISTURE_PCT,
                potassium_boost=True,
            )

        # 3. Critical moisture — emergency pulse
        if moisture_pct < CRITICAL_MOISTURE_PCT:
            logger.warning("Zone %s: CRITICAL moisture %.1f%% — emergency START", zone_id, moisture_pct)
            return IrrigationCommandCreate(
                zone_id=zone_id,
                action="START",
                duration_min=45,
                moisture_target_pct=OPTIMAL_MOISTURE_PCT,
                potassium_boost=False,
            )

        # 4. Maintenance pulse
        if moisture_pct < OPTIMAL_MOISTURE_PCT:
            duration = _compute_duration_min(moisture_pct, OPTIMAL_MOISTURE_PCT)
            logger.info("Zone %s: maintenance PULSE %d min", zone_id, duration)
            return IrrigationCommandCreate(
                zone_id=zone_id,
                action="PULSE",
                duration_min=duration,
                moisture_target_pct=OPTIMAL_MOISTURE_PCT,
                potassium_boost=False,
            )

        # 5. Sufficient moisture — no action
        logger.debug("Zone %s: moisture %.1f%% — no irrigation needed", zone_id, moisture_pct)
        return IrrigationCommandCreate(
            zone_id=zone_id,
            action="STOP",
            duration_min=0,
            moisture_target_pct=OPTIMAL_MOISTURE_PCT,
            potassium_boost=False,
        )

    def build_response(self, cmd: IrrigationCommandCreate) -> IrrigationCommandResponse:
        return IrrigationCommandResponse(
            command_id=str(uuid.uuid4()),
            zone_id=cmd.zone_id,
            action=cmd.action,
            duration_min=cmd.duration_min,
            moisture_target_pct=cmd.moisture_target_pct,
            potassium_boost=cmd.potassium_boost,
            issued_at=datetime.now(tz=timezone.utc),
            status="QUEUED",
        )


def _compute_duration_min(current: float, target: float) -> int:
    """Simple linear model: 1 min irrigation ≈ 0.5% moisture increase."""
    deficit = max(0.0, target - current)
    return max(5, min(int(deficit / 0.5), 120))


# Singleton
irrigation_engine = IrrigationDecisionEngine()
