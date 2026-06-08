/**
 * SKYD API Service — connects frontend to the SKYD FastAPI backend.
 * All satellite and AI keys are server-side. Frontend only calls /api/v1/*.
 *
 * Base URL resolution order:
 *   1. VITE_API_URL env var (configured in Render / production dashboard)
 *   2. VITE_SKYD_API_URL env var (legacy / alternative key)
 *   3. Development: localhost:8000
 */

export const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_SKYD_API_URL ||
  'http://localhost:8000'
) as string;
// Strip any trailing slash to prevent double-slash routing (e.g. http://host:8000//api/v1)
const API_V1 = `${API_BASE.replace(/\/$/, '')}/api/v1`;

// ── WebSocket ─────────────────────────────────────────────────────────────────

const WS_MAX_RETRIES = 10;
const WS_BASE_DELAY_MS = 3000;
const WS_MAX_DELAY_MS = 60000;

export function connectSKYDWebSocket(
  onMessage: (event: SKYDWebSocketEvent) => void,
  onStatus: (connected: boolean) => void,
  _retryCount = 0
): WebSocket {
  const wsBase = API_BASE.replace(/^http/, 'ws');
  const ws = new WebSocket(`${wsBase}/api/v1/ws/skyd`);

  ws.onopen = () => {
    onStatus(true);
    _retryCount = 0; // Reset retries on successful connection
    console.log('[SKYD WS] Connected');
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SKYDWebSocketEvent;
      onMessage(data);
    } catch {
      console.warn('[SKYD WS] Non-JSON message received');
    }
  };

  ws.onerror = () => onStatus(false);
  ws.onclose = () => {
    onStatus(false);
    // Auto-reconnect with exponential backoff and retry limit
    if (_retryCount < WS_MAX_RETRIES) {
      const delay = Math.min(WS_BASE_DELAY_MS * Math.pow(2, _retryCount), WS_MAX_DELAY_MS);
      console.log(`[SKYD WS] Reconnecting in ${delay / 1000}s (attempt ${_retryCount + 1}/${WS_MAX_RETRIES})`);
      setTimeout(() => connectSKYDWebSocket(onMessage, onStatus, _retryCount + 1), delay);
    } else {
      console.warn('[SKYD WS] Max reconnection attempts reached. Giving up.');
    }
  };

  return ws;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SKYDWebSocketEvent {
  event: 'TELEMETRY' | 'SPRAY_ALERT' | 'IRRIGATION_COMMAND' | 'SATELLITE_UPDATE' | 'HEARTBEAT' | 'CONNECTED' | 'PONG' | 'ERROR';
  timestamp: string;
  drone_id?: string;
  zone_id?: string;
  [key: string]: any;
}

export interface SatelliteData {
  zone_id: string;
  lat: number;
  lon: number;
  ndvi: number;
  evi?: number;
  ndwi?: number;
  ndre?: number;
  cloud_cover_pct: number;
  imagery_date: string;
  source: string;
  fetched_at: string;
  health_status: string;
  health_ar: string;
}

export interface AdviceResponse {
  directiveAr: string[];
  directiveEn: string[];
  summaryAr: string;
  summaryEn: string;
}

export interface DiagnoseResponse {
  diagnosisAr: string;
  diagnosisEn: string;
  healthStatus: 'Healthy' | 'Warning' | 'Infected';
  typeOfInjuryAr: string;
  typeOfInjuryEn: string;
  recommendationAr: string;
  recommendationEn: string;
}

export interface DroneTelemetryResponse {
  id: string;
  drone_id: string;
  recorded_at: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  battery_pct: number;
  speed_ms: number;
  status: string;
}

export interface DetectionResponse {
  id: string;
  drone_id: string;
  detected_at: string;
  latitude: number;
  longitude: number;
  disease_label: string;
  confidence: number;
  bounding_boxes: any[];
  affected_area_m2: number;
  spray_dispatched: boolean;
  inference_ms: number;
}

export interface IrrigationResponse {
  command_id: string;
  zone_id: string;
  action: string;
  duration_min: number;
  moisture_target_pct: number;
  potassium_boost: boolean;
  issued_at: string;
  status: string;
}

// ── API Helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_V1}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  } catch (networkErr) {
    // ERR_CONNECTION_REFUSED, DNS failure, CORS block, etc.
    throw new Error(`Network error calling ${path}: ${networkErr instanceof Error ? networkErr.message : 'unreachable'}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  // Guard against empty / malformed JSON bodies
  try {
    return await res.json() as T;
  } catch {
    throw new Error(`Invalid JSON response from ${path}`);
  }
}

// ── Satellite ─────────────────────────────────────────────────────────────────

/**
 * Direct NASA POWER API fallback — works without the SKYD backend.
 * Fetches real temperature, precipitation, and solar radiation data
 * from NASA's POWER (Prediction Of Worldwide Energy Resources) API.
 * Computes approximate NDVI proxy from environmental factors.
 * Free, no API key required.
 */
export async function fetchNasaPowerFallback(
  lat: number,
  lon: number,
  zoneId: string
): Promise<SatelliteData> {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 7);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const url = (
    `https://power.larc.nasa.gov/api/temporal/daily/point` +
    `?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN` +
    `&community=AG&longitude=${lon}&latitude=${lat}` +
    `&start=${fmt(start)}&end=${fmt(today)}&format=JSON`
  );

  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA POWER HTTP ${res.status}`);
  const json = await res.json();

  const params = json?.properties?.parameter ?? {};
  // Filter out NASA POWER fill values (-999, -999.0) for missing data
  const FILL = -999;
  const filterFill = (obj: any): number[] => {
    const vals = Object.values(obj ?? {});
    const result: number[] = [];
    for (const v of vals) {
      if (typeof v === 'number' && v !== FILL) result.push(v);
    }
    return result;
  };
  const tempVals: number[] = filterFill(params.T2M);
  const rainVals: number[] = filterFill(params.PRECTOTCORR);
  const solarVals: number[] = filterFill(params.ALLSKY_SFC_SW_DWN);

  const avgTemp = tempVals.length ? tempVals.reduce((a, b) => a + b, 0) / tempVals.length : 25;
  const avgRain = rainVals.length ? rainVals.reduce((a, b) => a + b, 0) / rainVals.length : 1;
  const avgSolar = solarVals.length ? solarVals.reduce((a, b) => a + b, 0) / solarVals.length : 200;

  // Approximate NDVI proxy from environmental factors (temperature + rain + solar)
  const ndviApprox = Math.max(0.1, Math.min(0.85,
    0.5 + (avgRain / 10) * 0.2 - Math.max(0, avgTemp - 35) * 0.01
  ));

  return {
    zone_id: zoneId,
    lat,
    lon,
    ndvi: Math.round(ndviApprox * 1000) / 1000,
    evi: Math.round(ndviApprox * 0.85 * 1000) / 1000,
    ndwi: Math.round((-0.1 + avgRain / 50) * 1000) / 1000,
    ndre: Math.round(ndviApprox * 0.9 * 1000) / 1000,
    cloud_cover_pct: 0,
    imagery_date: today.toISOString(),
    source: 'nasa_power',
    fetched_at: new Date().toISOString(),
    health_status: ndviApprox >= 0.4 ? 'Healthy' : ndviApprox >= 0.2 ? 'Stressed' : 'Critical',
    health_ar: ndviApprox >= 0.4 ? '\u0633\u0644\u064a\u0645' : ndviApprox >= 0.2 ? '\u0645\u062c\u0647\u062f' : '\u062d\u0631\u062c',
  };
}

export async function fetchSatelliteNDVI(
  lat: number,
  lon: number,
  zoneId: string,
  radiusM = 500
): Promise<SatelliteData> {
  // Try backend first (Copernicus Sentinel-2 with NASA POWER fallback)
  try {
    return await apiFetch<SatelliteData>(
      `/satellite/ndvi?lat=${lat}&lon=${lon}&zone_id=${zoneId}&radius_m=${radiusM}`
    );
  } catch (backendErr) {
    console.warn('[Satellite] Backend unreachable, trying NASA POWER directly:', backendErr);
  }

  // Direct NASA POWER fallback when backend is down
  return fetchNasaPowerFallback(lat, lon, zoneId);
}

export async function checkSatelliteHealth(): Promise<{ configured: boolean; message: string }> {
  return apiFetch('/satellite/health');
}

// ── AI Advice ─────────────────────────────────────────────────────────────────

export async function getAIAdvice(
  telemetry: { temp: number; humidity: number; wind: number; solar: number; soilPH?: number; soilMoisture?: number },
  zones: { nameEn: string; nameAr: string; cropType?: string; healthy: number; infected: number; moisture: number }[]
): Promise<AdviceResponse> {
  return apiFetch<AdviceResponse>('/ai/advice', {
    method: 'POST',
    body: JSON.stringify({ telemetry, zones }),
  });
}

export async function diagnoseCropImage(base64Image: string, zoneId?: string, cropType?: string): Promise<DiagnoseResponse> {
  return apiFetch<DiagnoseResponse>('/ai/diagnose', {
    method: 'POST',
    body: JSON.stringify({ base64Image, zoneId, cropType }),
  });
}

// ── Drone Telemetry ───────────────────────────────────────────────────────────

export async function postDroneTelemetry(payload: {
  drone_id: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  battery_pct: number;
  speed_ms: number;
  status: string;
}): Promise<DroneTelemetryResponse> {
  return apiFetch<DroneTelemetryResponse>('/drones/telemetry', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getDroneTelemetry(droneId: string, limit = 100): Promise<{ total: number; items: DroneTelemetryResponse[] }> {
  return apiFetch(`/drones/${droneId}/telemetry?limit=${limit}`);
}

// ── Disease Detection ─────────────────────────────────────────────────────────

export async function analyzeDroneImage(
  file: File | Blob,
  droneId: string,
  lat: number,
  lon: number,
  altitudeM = 30,
  fieldAreaM2 = 100
): Promise<DetectionResponse> {
  const form = new FormData();
  form.append('drone_id', droneId);
  form.append('latitude', lat.toString());
  form.append('longitude', lon.toString());
  form.append('altitude_m', altitudeM.toString());
  form.append('field_area_m2', fieldAreaM2.toString());
  form.append('image', file);

  const res = await fetch(`${API_V1}/detections/analyze`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Detection API error ${res.status}`);
  }
  return res.json();
}

export async function getRecentDetections(limit = 50, droneId?: string): Promise<DetectionResponse[]> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (droneId) params.append('drone_id', droneId);
  return apiFetch<DetectionResponse[]>(`/detections/recent?${params}`);
}

// ── Sensors ───────────────────────────────────────────────────────────────────

export async function postSensorReading(payload: {
  zone_id: string;
  moisture_pct: number;
  salinity_ds_m: number;
  temperature_c: number;
  latitude?: number;
  longitude?: number;
  ndvi?: number;
}): Promise<any> {
  return apiFetch('/sensors/readings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getZoneSensorReadings(zoneId: string, limit = 50): Promise<any> {
  return apiFetch(`/sensors/${zoneId}/readings?limit=${limit}`);
}

// ── Irrigation ────────────────────────────────────────────────────────────────

export async function issueIrrigationCommand(payload: {
  zone_id: string;
  action: 'START' | 'STOP' | 'PULSE' | 'VACCINE_BOOST';
  duration_min: number;
  moisture_target_pct?: number;
  potassium_boost?: boolean;
}): Promise<IrrigationResponse> {
  return apiFetch<IrrigationResponse>('/irrigation/command', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function autoDecideIrrigation(payload: {
  zone_id: string;
  moisture_pct: number;
  salinity_ds_m: number;
  temperature_c: number;
  heat_wave_in_48h?: boolean;
  ndvi?: number;
}): Promise<IrrigationResponse> {
  return apiFetch<IrrigationResponse>('/irrigation/auto-decide', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Health Check ──────────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<{
  status: string;
  version: string;
  db_connected: boolean;
  ws_connections: number;
}> {
  return apiFetch('/health');
}

// ── SMS Fire Alert ────────────────────────────────────────────────────────────

export async function sendFireAlert(payload: {
  phone: string;
  temp: number;
  zone_id: string;
  zone_name: string;
}): Promise<{ sms_sent: boolean; call_initiated: boolean }> {
  return apiFetch('/notifications/fire-alert', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
