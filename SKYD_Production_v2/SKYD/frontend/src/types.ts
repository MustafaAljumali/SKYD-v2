/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WeatherData {
  temp: number;
  humidity: number;
  wind: number;
  solar: number;
  rain: number;
  source: 'openweathermap' | 'ground_sensor' | 'unknown';
  fetchedAt: string; // ISO timestamp
  locationName?: string;
}

export interface SatelliteData {
  ndvi: number;
  evi?: number;
  savi?: number;
  ndwi?: number;
  ndre?: number;
  source: 'sentinel2' | 'nasa_power';
  imageryDate: string; // image pass timestamp
  cloudCover?: number; // % cloud cover
}

export interface YOLODetection {
  class: string;
  class_ar: string;
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  treatment: string;
  treatment_ar: string;
}

export interface YOLOResult {
  zoneId: string;
  imageId: string;
  timestamp: string;
  summary: {
    total_plants: number;
    healthy: number;
    infected: number;
    dead: number;
    healthScore: number;
  };
  detections: YOLODetection[];
  ndvi_estimate?: number;
  model_version: string;
}

export interface Zone {
  id: number;
  nameAr: string;
  nameEn: string;
  total: number;
  healthy: number;
  infected: number;
  dead: number;
  moisture: number;
  temp: number;
  irrigation: boolean;
  cropType?: string; // 'rice' | 'wheat' | 'citrus' | 'vegetable'
  satellite?: SatelliteData;  // Sentinel-2 index
  lastYOLO?: YOLOResult;      // YOLOv8 finding
  lastSensorReading?: string; // Last updated timestamp
}

export interface LogEntry {
  msg: string;
  color: string;
  timestamp: string;
}

export interface SimData {
  tick: number;
  day: number;
  hour: number;
  temp: number;
  humidity: number;
  wind: number;
  solar: number;
  rain: number;
  soilMoisture: number;
  soilPH: number;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  ec: number;
  zones: Zone[];
  logs: LogEntry[];
  weather?: WeatherData;
  dataStatus?: {
    weatherSource: 'live' | 'cached' | 'unavailable';
    satelliteSource: 'live' | 'cached' | 'unavailable';
    sensorsSource: 'mqtt' | 'rest' | 'unavailable';
    yoloSource: 'drone_auto' | 'manual_upload' | 'unavailable';
    lastFullUpdate: string;
  };
}

export type Page = 
  | 'dashboard' 
  | 'digitaltwin' 
  | 'crophealth' 
  | 'predictions' 
  | 'analytics' 
  | 'mission' 
  | 'drones' 
  | 'irrigation' 
  | 'sensors' 
  | 'smartmission' 
  | 'liveops' 
  | 'settings'
  | 'geofence';

/* ================================================================
   HYBRID SENSOR FUSION ARCHITECTURE — Strict Interfaces
   Physical IoT nodes (ground truth) vs Virtual/AI sensing (computed)
   ================================================================ */

/** Deployed physical IoT hardware sensor — streams Moisture + Salinity only */
export interface PhysicalSensor {
  sensorId: string;
  zoneId: number;
  type: string;
  lastValue: number;
  unit: string;
  lastSeen: string;
  battery: number;
  rssi: number;
  status: 'online' | 'stale' | 'offline';
  gps?: { lat: number; lng: number };
}

/** AI/Satellite-derived virtual sensor node — NPK + interpolated moisture */
export interface VirtualNode {
  zoneId: number;
  zoneNameAr: string;
  zoneNameEn: string;
  estimatedMoisture: number;
  estimatedN: number;
  estimatedP: number;
  estimatedK: number;
  ndvi?: number;
  confidence: number;  // 0-100 %
  processedAt: string; // ISO timestamp
  source: 'sentinel2' | 'ai_interpolation';
}

/** GPS farm boundary polygon */
export interface FarmBoundary {
  type: 'Polygon';
  coordinates: number[][][];
  centroid: { lat: number; lng: number };
  areaAcres: number;
}

/** Unified hybrid telemetry payload */
export interface HybridTelemetry {
  physicalSensors: PhysicalSensor[];
  virtualNodes: VirtualNode[];
  weatherSource: 'live' | 'cached' | 'unavailable';
  satelliteSource: 'live' | 'cached' | 'unavailable';
  sensorsSource: 'mqtt' | 'rest' | 'unavailable';
  lastFullUpdate: string;
}
