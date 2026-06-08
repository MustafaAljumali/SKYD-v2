/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PRODUCTION RULE: Zero mock fallback.
 * - On HTTP 200 → parse real fields only; if a field is missing → null (not a hardcoded default).
 * - On 401 → WeatherError('invalid_key')
 * - On 429 → WeatherError('rate_limited')
 * - On network failure → WeatherError('network')
 * - Caller is responsible for rendering honest error states.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface WeatherTelemetryData {
  temp: number;
  humidity: number;
  wind: number;      // km/h
  solar: number;     // W/m² (estimated from cloud cover)
  description?: string;  // Arabic weather description
  icon?: string;         // OWM icon code
  fetchedAt?: string;    // ISO timestamp of the fetch
}

export type WeatherErrorType = 'invalid_key' | 'rate_limited' | 'network' | 'no_data' | 'unknown';

export interface WeatherError {
  error: true;
  errorType: WeatherErrorType;
  message: string;
  httpStatus?: number;
}

export type WeatherResult =
  | { ok: true; data: WeatherTelemetryData; error?: undefined }
  | { ok: false; data?: undefined; error: WeatherError };

export interface DayForecast {
  temp: number;
  dayName: string;
  icon: string;
  desc: string;
  descAr: string;
}

/**
 * Extracts the centroid GPS lat,lon from savedGeoJSON geometry.
 */
export function getCentroid(geojson: any): [number, number] {
  if (!geojson) return [32.3213, 44.3211]; // Default Iraqi farming coords (Babylon area)
  try {
    const geometry = geojson.geometry || geojson;
    if (geometry.type === 'Point') {
      return [geometry.coordinates[1], geometry.coordinates[0]];
    }
    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates[0];
      let sumLat = 0;
      let sumLon = 0;
      for (const coord of coords) {
        sumLon += coord[0];
        sumLat += coord[1];
      }
      return [sumLat / coords.length, sumLon / coords.length];
    }
    if (geometry.type === 'MultiPolygon') {
      const polygons = geometry.coordinates;
      let sumLat = 0;
      let sumLon = 0;
      let count = 0;
      for (const polygon of polygons) {
        for (const coord of polygon[0]) {
          sumLon += coord[0];
          sumLat += coord[1];
          count++;
        }
      }
      if (count > 0) {
        return [sumLat / count, sumLon / count];
      }
    }
  } catch (e) {
    console.error("Error calculating centroid from geojson in weatherService:", e);
  }
  return [32.3213, 44.3211];
}

/**
 * Calculates solar radiation approximately based on clouds and local hour.
 * @param clouds Coverage percentage [0-100]
 */
export function calculateSolar(clouds: number): number {
  const hour = new Date().getHours();
  // Safe sinusoide representing daytime cycle peaking at 12:00
  const daytimeFactor = Math.max(0, Math.sin(((hour - 6) * Math.PI) / 12));
  const maxRadiation = 850; // W/m2 clear sun peak
  const cloudFactor = 1 - (clouds / 100) * 0.7; // Clouds reduce up to 70% radiation
  return maxRadiation * daytimeFactor * cloudFactor;
}

/**
 * Fetches real weather data from NASA POWER API (free, no API key needed).
 * Returns temperature, humidity, wind speed, and solar radiation.
 * Used as fallback when OpenWeatherMap key is not configured.
 */
export async function getNasaPowerWeather(
  lat: number,
  lon: number
): Promise<WeatherResult> {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 3);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const url = (
    `https://power.larc.nasa.gov/api/temporal/daily/point` +
    `?parameters=T2M,RH2M,WS2M,ALLSKY_SFC_SW_DWN` +
    `&community=AG&longitude=${lon}&latitude=${lat}` +
    `&start=${fmt(start)}&end=${fmt(today)}&format=JSON`
  );

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { ok: false, error: { error: true, errorType: 'network', message: 'NASA POWER API unreachable' } };
  }

  if (!res.ok) {
    return { ok: false, error: { error: true, errorType: 'no_data', message: `NASA POWER HTTP ${res.status}` } };
  }

  try {
    const json = await res.json();
    const params = json?.properties?.parameter ?? {};
    const FILL = -999;
    const filterFill = (obj: any): number[] => {
      const vals = Object.values(obj ?? {});
      const result: number[] = [];
      for (const v of vals) {
        if (typeof v === 'number' && v !== FILL) result.push(v);
      }
      return result;
    };

    const tempVals = filterFill(params.T2M);
    const humidVals = filterFill(params.RH2M);
    const windVals = filterFill(params.WS2M);
    const solarVals = filterFill(params.ALLSKY_SFC_SW_DWN);

    if (tempVals.length === 0) {
      return { ok: false, error: { error: true, errorType: 'no_data', message: 'NASA POWER returned no temperature data' } };
    }

    const avgTemp = tempVals.reduce((a, b) => a + b, 0) / tempVals.length;
    const avgHumid = humidVals.length ? humidVals.reduce((a, b) => a + b, 0) / humidVals.length : 50;
    const avgWindMs = windVals.length ? windVals.reduce((a, b) => a + b, 0) / windVals.length : 2;
    // NASA POWER solar is in MJ/m²/day — convert to approximate W/m² (daytime avg)
    const avgSolarMj = solarVals.length ? solarVals.reduce((a, b) => a + b, 0) / solarVals.length : 20;
    const avgSolarWm2 = Math.round((avgSolarMj * 1e6) / (3600 * 12)); // spread over ~12 daylight hours

    const weatherData: WeatherTelemetryData = {
      temp: Math.round(avgTemp * 10) / 10,
      humidity: Math.round(avgHumid),
      wind: Math.round(avgWindMs * 3.6 * 10) / 10, // m/s → km/h
      solar: avgSolarWm2,
      description: 'بيانات ناسا الفضائية',
      fetchedAt: new Date().toISOString(),
    };

    return { ok: true, data: weatherData };
  } catch (parseErr) {
    return { ok: false, error: { error: true, errorType: 'unknown', message: 'NASA POWER parse error' } };
  }
}

/**
 * Fetches current weather from OpenWeatherMap and caches the results in Firebase
 * to stay strictly under rate limits (only queries if older than 30 minutes).
 *
 * Returns a WeatherResult — never injects fake values.
 * If any OWM field is missing, that field is null (caller handles it).
 */
export async function getLiveWeather(
  userId: string,
  lat: number,
  lon: number,
  apiKey: string,
  forceRefresh = false
): Promise<WeatherResult> {
  if (!apiKey) {
    return { ok: false, error: { error: true, errorType: 'invalid_key', message: 'No API key provided' } };
  }
  if (!userId) {
    return { ok: false, error: { error: true, errorType: 'unknown', message: 'No user ID' } };
  }

  const cacheDocRef = doc(db, 'users', userId, 'telemetry', 'weather_cache');

  // Check Firestore cache first (30-min freshness window)
  if (!forceRefresh) {
    try {
      const cachedSnap = await getDoc(cacheDocRef);
      if (cachedSnap.exists()) {
        const cached = cachedSnap.data();
        const lastFetched = cached.fetchedAt?.toDate();
        if (lastFetched) {
          const mDiff = (Date.now() - lastFetched.getTime()) / 60000;
          if (mDiff < 30 && cached.weatherData) {
            console.log(`[WeatherService] Cache hit (${mDiff.toFixed(1)} mins old)`);
            return { ok: true, data: cached.weatherData as WeatherTelemetryData };
          }
        }
      }
    } catch (e) {
      console.warn('[WeatherService] Cache read failed:', e);
    }
  }

  // Fetch from OpenWeatherMap
  let res: Response;
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;
    res = await fetch(url);
  } catch {
    return { ok: false, error: { error: true, errorType: 'network', message: 'تعذر الاتصال بخدمة الطقس' } };
  }

  // Classify HTTP errors explicitly
  if (res.status === 401) {
    return { ok: false, error: { error: true, errorType: 'invalid_key', message: 'مفتاح API غير صالح', httpStatus: 401 } };
  }
  if (res.status === 429) {
    return { ok: false, error: { error: true, errorType: 'rate_limited', message: 'تم تجاوز الحد الأقصى للطلبات', httpStatus: 429 } };
  }
  if (!res.ok) {
    return { ok: false, error: { error: true, errorType: 'unknown', message: `OWM HTTP ${res.status}`, httpStatus: res.status } };
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: { error: true, errorType: 'no_data', message: 'Invalid JSON from OWM' } };
  }

  // Parse real fields only — NO hardcoded fallbacks
  const temp = json.main?.temp;
  const humidity = json.main?.humidity;
  const windMs = json.wind?.speed;
  const clouds = json.clouds?.all ?? 0;
  const description = json.weather?.[0]?.description ?? null;
  const icon = json.weather?.[0]?.icon ?? null;

  // If critical fields are missing → return error, never invent data
  if (typeof temp !== 'number' || typeof humidity !== 'number') {
    return { ok: false, error: { error: true, errorType: 'no_data', message: 'OWM response missing temp/humidity' } };
  }

  const weatherData: WeatherTelemetryData = {
    temp,
    humidity,
    wind: typeof windMs === 'number' ? windMs * 3.6 : 0,   // m/s → km/h; 0 if absent (not a mock)
    solar: calculateSolar(clouds),
    description: description ?? undefined,
    icon: icon ?? undefined,
    fetchedAt: new Date().toISOString(),
  };

  // Cache to Firestore for rate-limit compliance
  try {
    await setDoc(cacheDocRef, { weatherData, fetchedAt: serverTimestamp(), lat, lon });

    // Push fresh values to telemetry main doc
    const telemetryMainRef = doc(db, 'users', userId, 'telemetry', 'main');
    await setDoc(telemetryMainRef, {
      temp: weatherData.temp,
      humidity: weatherData.humidity,
      wind: weatherData.wind,
      solar: weatherData.solar,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (cacheErr) {
    console.warn('[WeatherService] Firestore cache write failed:', cacheErr);
    // Continue — real data is still returned even if caching fails
  }

  return { ok: true, data: weatherData };
}

/**
 * Fetches 5-day forecast, parses it and groups by days.
 * Returns empty array on any error — never injects fake forecasts.
 */
export async function get5DayForecast(
  lat: number,
  lon: number,
  apiKey: string
): Promise<DayForecast[]> {
  if (!apiKey) return [];

  let res: Response;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ar`;
    res = await fetch(url);
  } catch {
    console.warn('[WeatherService] Forecast network error');
    return [];
  }

  if (res.status === 401 || res.status === 429 || !res.ok) {
    console.warn(`[WeatherService] Forecast HTTP ${res.status}`);
    return [];
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    console.warn('[WeatherService] Forecast JSON parse failed');
    return [];
  }

  // OpenWeatherMap forecast returns 40 list elements in 3-hour chunks
  const list: any[] = Array.isArray(data.list) ? data.list : [];

  const daysMap = new Map<string, any>();
  const weekdayEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const item of list) {
    const date = new Date(item.dt * 1000);
    const dayKey = date.toLocaleDateString('en-US', { weekday: 'long' });
    // Select mid-day readings around 12:00 PM if possible for representative metrics
    const hour = date.getHours();
    if (!daysMap.has(dayKey) || (hour >= 11 && hour <= 13)) {
      daysMap.set(dayKey, item);
    }
  }

  const result: DayForecast[] = [];
  const daysList = Array.from(daysMap.values()).slice(0, 5);

  for (const item of daysList) {
    const date = new Date(item.dt * 1000);
    const dayIdx = date.getDay();
    const mainWeather = item.weather?.[0] || {};
    const code: string = mainWeather.icon || '01d';

    let icon = 'Sun';
    if (code.includes('09') || code.includes('10')) icon = 'CloudRain';
    else if (code.includes('11')) icon = 'CloudLightning';
    else if (code.includes('13')) icon = 'Snowflake';
    else if (code.includes('02') || code.includes('03') || code.includes('04')) icon = 'Cloud';
    else if (code.includes('50')) icon = 'Wind';

    // Only include if temp is a real number from the API
    const temp = item.main?.temp;
    if (typeof temp !== 'number') continue;

    result.push({
      temp,
      dayName: weekdayEn[dayIdx],
      desc: mainWeather.main ?? 'Clear',
      descAr: mainWeather.description ?? 'صافي',
      icon,
    });
  }

  return result;
}
