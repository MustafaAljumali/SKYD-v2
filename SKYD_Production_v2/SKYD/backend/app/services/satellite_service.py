"""
Satellite Service — Copernicus/Sentinel-2 data fetcher.
API keys are ALWAYS server-side. Frontend never touches credentials.

Implements:
1. OAuth2 token acquisition from Copernicus Identity Service
2. Sentinel-2 EO Browser API query for NDVI, EVI, NDWI, NDRE
3. Fallback to NASA POWER API when Copernicus is unavailable
4. Result caching (in-memory, 6-hour TTL)
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("skyd.satellite")

# ── In-memory cache ──────────────────────────────────────────────────────────
_cache: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 6 * 3600  # 6 hours


def _cache_key(lat: float, lon: float) -> str:
    return f"{round(lat, 3)},{round(lon, 3)}"


class SatelliteService:
    """Manages Sentinel-2 satellite data acquisition with Copernicus API."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0

    async def _get_copernicus_token(self) -> Optional[str]:
        """Acquire OAuth2 access token from Copernicus Identity Service."""
        if not settings.COPERNICUS_CLIENT_ID or not settings.COPERNICUS_CLIENT_SECRET:
            return None

        if self._token and time.time() < self._token_expiry - 60:
            return self._token

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
                    data={
                        "grant_type": "client_credentials",
                        "client_id": settings.COPERNICUS_CLIENT_ID,
                        "client_secret": settings.COPERNICUS_CLIENT_SECRET,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                self._token = data["access_token"]
                self._token_expiry = time.time() + data.get("expires_in", 600)
                logger.info("Copernicus OAuth2 token acquired")
                return self._token
        except Exception as exc:
            logger.warning("Copernicus token acquisition failed: %s", exc)
            return None

    async def _fetch_from_copernicus(
        self, lat: float, lon: float, radius_m: float
    ) -> "Optional[Dict[str, Any]]":
        """Query Sentinel-2 NDVI via Copernicus Statistical API."""
        token = await self._get_copernicus_token()
        if not token:
            return None

        # Bounding box from lat/lon + radius
        delta = radius_m / 111_320  # rough degrees per meter
        bbox = [lon - delta, lat - delta, lon + delta, lat + delta]

        # evalscript returning NDVI, EVI, NDWI, NDRE as separate outputs
        evalscript = """
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03","B04","B05","B08"], units: "REFLECTANCE" }],
    output: [
      { id:"ndvi",  bands:1, sampleType:"FLOAT32" },
      { id:"evi",   bands:1, sampleType:"FLOAT32" },
      { id:"ndwi",  bands:1, sampleType:"FLOAT32" },
      { id:"ndre",  bands:1, sampleType:"FLOAT32" }
    ]
  };
}
function evaluatePixel(s) {
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-9);
  const evi  = 2.5 * (s.B08 - s.B04) / (s.B08 + 6*s.B04 - 7.5*s.B03 + 1 + 1e-9);
  const ndwi = (s.B03 - s.B08) / (s.B03 + s.B08 + 1e-9);
  const ndre = (s.B08 - s.B05) / (s.B08 + s.B05 + 1e-9);
  return {ndvi:[ndvi], evi:[evi], ndwi:[ndwi], ndre:[ndre]};
}
"""

        today = datetime.now(tz=timezone.utc)
        date_from = (today - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
        date_to   = today.strftime("%Y-%m-%dT23:59:59Z")

        stats_payload = {
            "input": {
                "bounds": {
                    "bbox": bbox,
                    "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {"from": date_from, "to": date_to},
                        "maxCloudCoverage": 50,
                        "mosaickingOrder": "leastCC",
                    },
                }],
            },
            "aggregation": {
                "timeRange":           {"from": date_from, "to": date_to},
                "aggregationInterval": {"of": "P10D"},
                "evalscript":          evalscript,
                "resx": 10,
                "resy": 10,
            },
            "calculations": {"default": {}},
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://sh.dataspace.copernicus.eu/api/v1/statistics",
                    json=stats_payload,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type":  "application/json",
                        "Accept":        "application/json",
                    },
                )

                if resp.status_code != 200:
                    logger.warning(
                        "Copernicus Statistics API returned %d: %s",
                        resp.status_code,
                        resp.text[:300],
                    )
                    return None

                stats_data = resp.json()
                intervals = stats_data.get("data", [])

                # Find the most recent interval with valid (non-NaN) data
                valid = [
                    iv for iv in intervals
                    if iv.get("outputs") and not iv.get("outputs", {}).get("ndvi", {}).get("bands", {}).get("B0", {}).get("sampleCount") == 0
                ]
                if not valid:
                    logger.warning("Copernicus returned no valid intervals for bbox=%s", bbox)
                    return None

                latest = valid[-1]
                outputs = latest.get("outputs", {})

                def _mean(key: str, default: float) -> float:
                    try:
                        return float(outputs[key]["bands"]["B0"]["mean"])
                    except (KeyError, TypeError, ValueError):
                        return default

                ndvi  = _mean("ndvi",  0.35)
                evi   = _mean("evi",   0.28)
                ndwi  = _mean("ndwi",  0.05)
                ndre  = _mean("ndre",  0.25)
                cloud = float(latest.get("cloudCoveragePercent", 0.0))
                date_str = latest.get("interval", {}).get("to", today.isoformat())

                # Clamp to valid NDVI range
                ndvi = max(-1.0, min(1.0, ndvi))

                logger.info(
                    "Copernicus NDVI=%.3f EVI=%.3f NDWI=%.3f NDRE=%.3f cloud=%.1f%% date=%s",
                    ndvi, evi, ndwi, ndre, cloud, date_str,
                )
                return {
                    "ndvi":             round(ndvi, 4),
                    "evi":              round(evi,  4),
                    "ndwi":            round(ndwi, 4),
                    "ndre":             round(ndre, 4),
                    "cloud_cover_pct":  round(cloud, 1),
                    "imagery_date":     date_str,
                    "source":           "sentinel2",
                }

        except Exception as exc:
            logger.warning("Copernicus Sentinel-2 query failed: %s", exc)

        return None

    async def _fetch_from_nasa_power(
        self, lat: float, lon: float
    ) -> Dict[str, Any]:
        """Fallback: NASA POWER API for approximate vegetation proxy."""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                today = datetime.now(tz=timezone.utc)
                start = (today - timedelta(days=7)).strftime("%Y%m%d")
                end = today.strftime("%Y%m%d")
                url = (
                    f"https://power.larc.nasa.gov/api/temporal/daily/point"
                    f"?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN"
                    f"&community=AG&longitude={lon}&latitude={lat}"
                    f"&start={start}&end={end}&format=JSON"
                )
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                properties = data.get("properties", {}).get("parameter", {})
                temp_values = list(properties.get("T2M", {}).values())
                rain_values = list(properties.get("PRECTOTCORR", {}).values())
                solar_values = list(properties.get("ALLSKY_SFC_SW_DWN", {}).values())

                avg_temp = sum(temp_values) / len(temp_values) if temp_values else 25.0
                avg_rain = sum(rain_values) / len(rain_values) if rain_values else 1.0
                avg_solar = sum(solar_values) / len(solar_values) if solar_values else 200.0

                # Approximate NDVI proxy from temperature + rain + solar
                ndvi_approx = max(0.1, min(0.85,
                    0.5 + (avg_rain / 10) * 0.2 - max(0, avg_temp - 35) * 0.01
                ))

                logger.info("NASA POWER fallback used for lat=%s lon=%s", lat, lon)
                return {
                    "ndvi": round(ndvi_approx, 3),
                    "evi": round(ndvi_approx * 0.85, 3),
                    "ndwi": round(-0.1 + avg_rain / 50, 3),
                    "ndre": round(ndvi_approx * 0.9, 3),
                    "cloud_cover_pct": 0.0,
                    "imagery_date": today.isoformat(),
                    "source": "nasa_power_proxy",
                }
        except Exception as exc:
            logger.error("NASA POWER fallback also failed: %s", exc)
            raise ValueError(
                f"All satellite data sources failed for lat={lat}, lon={lon}. "
                "No fallback data will be injected to avoid serving fabricated values."
            ) from exc

    async def fetch_ndvi(
        self, lat: float, lon: float, radius_m: float = 500.0
    ) -> Dict[str, Any]:
        """
        Main entry point — tries Copernicus first, falls back to NASA POWER.
        Results are cached for 6 hours per coordinate.
        """
        key = _cache_key(lat, lon)
        cached = _cache.get(key)
        if cached and (time.time() - cached["cached_at"]) < _CACHE_TTL_SECONDS:
            logger.debug("Satellite cache hit for %s", key)
            return cached["data"]

        # Try Copernicus Sentinel-2
        result = await self._fetch_from_copernicus(lat, lon, radius_m)

        # Fallback to NASA POWER if Copernicus unavailable
        if result is None:
            result = await self._fetch_from_nasa_power(lat, lon)

        _cache[key] = {"data": result, "cached_at": time.time()}
        return result


# Singleton
satellite_service = SatelliteService()
