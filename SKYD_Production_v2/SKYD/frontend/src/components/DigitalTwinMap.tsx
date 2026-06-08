import React, { useState, useMemo, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import {
  Layers,
  Thermometer,
  Droplets,
  MapPin,
  Clock,
  User,
  Activity,
  AlertTriangle,
  Zap,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Zone } from '../types';

/* ================================================================
   INTERFACE — All data flows from parent App.tsx, no mock data
   ================================================================ */
interface DigitalTwinMapProps {
  isAr: boolean;
  savedGeoJSON?: any;
  userName?: string;
  userLocation?: string;
  zones: Zone[];
  sensors?: {
    sensorId: string;
    zoneId: number;
    type: string;
    lastValue: number;
    unit: string;
    lastSeen: string;
    battery: number;
    rssi: number;
    status: 'online' | 'stale' | 'offline';
  }[];
  dataStatus?: {
    weatherSource: 'live' | 'cached' | 'unavailable';
    satelliteSource: 'live' | 'cached' | 'unavailable';
    sensorsSource: 'mqtt' | 'rest' | 'unavailable';
    yoloSource: 'drone_auto' | 'manual_upload' | 'unavailable';
    lastFullUpdate: string;
  };
}

/* ================================================================
   CONSTANTS
   ================================================================ */
const ESRI_SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';
const WASIT_CENTER: [number, number] = [32.79, 45.32];
const DEFAULT_ZOOM = 18;
const MIN_ZOOM = 15;
const MAX_ZOOM = 20;

/* ================================================================
   HELPERS
   ================================================================ */

// Extract [lat, lng] ring from savedGeoJSON for Leaflet
function extractBoundary(geojson: any): [number, number][] {
  if (!geojson) return [];
  try {
    const geom = geojson.geometry || geojson;
    if (geom?.coordinates?.[0]) {
      const ring = geom.coordinates[0];
      if (Array.isArray(ring) && ring.length >= 3) {
        return ring.map((pt: number[]) => [pt[1], pt[0]] as [number, number]);
      }
    }
  } catch (e) {
    console.warn('Could not parse farm boundary GeoJSON:', e);
  }
  return [];
}

// Compute center from boundary for map initialization
function computeCenter(boundary: [number, number][]): [number, number] {
  if (boundary.length === 0) return WASIT_CENTER;
  const sumLat = boundary.reduce((s, pt) => s + pt[0], 0);
  const sumLng = boundary.reduce((s, pt) => s + pt[1], 0);
  return [sumLat / boundary.length, sumLng / boundary.length];
}

// NDVI health → fill color for thermal overlay
function getNdviColor(zone: Zone): string {
  const ndvi = zone.satellite?.ndvi;
  if (ndvi !== undefined) {
    if (ndvi >= 0.4) return '#10B981';
    if (ndvi >= 0.2) return '#F59E0B';
    return '#EF4444';
  }
  const healthScore = zone.healthy / (zone.total || 1);
  if (healthScore >= 0.8) return '#10B981';
  if (healthScore >= 0.5) return '#F59E0B';
  return '#EF4444';
}

// Distribute zone positions evenly inside the farm boundary
function distributeZonePositions(
  zones: Zone[],
  boundary: [number, number][]
): [number, number][] {
  if (boundary.length === 0 || zones.length === 0) return [];
  const [centerLat, centerLng] = computeCenter(boundary);
  const lats = boundary.map((p) => p[0]);
  const lngs = boundary.map((p) => p[1]);
  const latRange = (Math.max(...lats) - Math.min(...lats)) * 0.55 || 0.0015;
  const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 0.55 || 0.0015;
  const n = zones.length;
  return zones.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = 0.5 + (i % 3) * 0.12;
    return [
      centerLat + r * latRange * Math.sin(angle),
      centerLng + r * lngRange * Math.cos(angle),
    ] as [number, number];
  });
}

// Aggregate sensor readings per zone (from sensorStatusLog shape)
function aggregateSensorsByZone(
  sensors: DigitalTwinMapProps['sensors']
): Record<number, { moisture?: number; temp?: number; n?: number; p?: number; k?: number; ec?: number; lastSeen?: string; battery?: number }> {
  const map: Record<number, any> = {};
  if (!sensors) return map;
  for (const s of sensors) {
    if (!map[s.zoneId]) map[s.zoneId] = {};
    if (s.type === 'soil_moisture') map[s.zoneId].moisture = s.lastValue;
    if (s.type === 'soil_temp') map[s.zoneId].temp = s.lastValue;
    if (s.type === 'soil_nitrogen') map[s.zoneId].n = s.lastValue;
    if (s.type === 'soil_phosphorus') map[s.zoneId].p = s.lastValue;
    if (s.type === 'soil_potassium') map[s.zoneId].k = s.lastValue;
    if (s.type === 'soil_ec') map[s.zoneId].ec = s.lastValue;
    if (s.battery !== undefined) map[s.zoneId].battery = s.battery;
    map[s.zoneId].lastSeen = s.lastSeen;
  }
  return map;
}

/* ================================================================
   FIT-BOUNDS HELPER COMPONENT
   ================================================================ */
function FitBounds({ boundary }: { boundary: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (boundary.length >= 3) {
      map.fitBounds(boundary, { padding: [40, 40], maxZoom: DEFAULT_ZOOM });
    }
  }, [boundary, map]);
  return null;
}

/* ================================================================
   PHYSICAL IoT GLASSMORPHISM POPUP
   Label: "حساس أرضي فيزيائي" — Ground Truth Hardware
   ================================================================ */
function PhysicalIoTPopup({
  zone,
  sensorData,
  isAr,
}: {
  zone: Zone;
  sensorData: { moisture?: number; temp?: number; ec?: number; lastSeen?: string; battery?: number };
  isAr: boolean;
}) {
  const isOffline = sensorData.battery !== undefined && sensorData.battery <= 5;
  const isStale = sensorData.lastSeen
    ? Math.floor((Date.now() - new Date(sensorData.lastSeen).getTime()) / 60000) > 30
    : false;

  return (
    <div className={`p-4 rounded-2xl backdrop-blur-md bg-slate-900/60 border border-white/10 shadow-2xl text-slate-50 min-w-[240px] ${isAr ? 'rtl-popup' : ''}`}>
      {/* Header — Physical IoT label */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-emerald-500/30">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isOffline || isStale ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
            {isAr ? 'حساس أرضي فيزيائي' : 'PHYSICAL IoT SENSOR'}
          </span>
        </div>
        <span className="text-[9px] font-mono text-slate-500">
          Z-{String(zone.id).padStart(3, '0')}
        </span>
      </div>

      {/* Zone name + node ID */}
      <h4 className="text-sm font-black text-white mb-1 leading-tight">
        {isAr ? zone.nameAr : zone.nameEn}
      </h4>

      {/* Offline indicator */}
      {(isOffline || isStale) && (
        <div className="mb-3 p-2 bg-red-500/15 border border-red-500/30 rounded-lg">
          <span className="text-[9px] text-red-400 font-bold flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            {isAr
              ? `غير متصل — آخر حالة محفوظة: ${sensorData.lastSeen ?? '—'}`
              : `OFFLINE — Last known state: ${sensorData.lastSeen ?? '—'}`}
          </span>
        </div>
      )}

      {/* Ground Truth metrics — Moisture + Salinity only */}
      <div className="space-y-2 mt-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Droplets className="w-3 h-3 text-blue-400" />
            {isAr ? 'رطوبة التربة (IoT)' : 'Soil Moisture (IoT)'}
          </span>
          <strong className="font-mono font-black text-white">
            {(sensorData.moisture ?? zone.moisture).toFixed(1)}%
          </strong>
        </div>
        {sensorData.ec !== undefined && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-yellow-400" />
              {isAr ? 'ملوحة التربة (IoT)' : 'Soil Salinity (IoT)'}
            </span>
            <strong className="font-mono font-black text-white">{sensorData.ec.toFixed(2)} dS/m</strong>
          </div>
        )}
        {sensorData.temp !== undefined && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Thermometer className="w-3 h-3 text-orange-400" />
              {isAr ? 'درجة الحرارة' : 'Temperature'}
            </span>
            <strong className="font-mono font-black text-white">{sensorData.temp.toFixed(1)}°C</strong>
          </div>
        )}
      </div>

      {/* Disease / Infection Status */}
      {zone.infected > 0 && (
        <div className="mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold">
            <AlertTriangle className="w-3 h-3" />
            {isAr ? `إصابة: ${zone.infected} من ${zone.total}` : `Infected: ${zone.infected}/${zone.total}`}
          </div>
        </div>
      )}

      {/* Battery + Last Updated */}
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between">
        <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {isAr ? 'آخر تحديث' : 'Updated'}: {sensorData.lastSeen ?? '—'}
        </span>
        {sensorData.battery !== undefined && (
          <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1">
            {sensorData.battery > 20 ? (
              <Wifi className="w-2.5 h-2.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-2.5 h-2.5 text-red-400" />
            )}
            {sensorData.battery}%
          </span>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   VIRTUAL / AI SATELLITE POPUP
   Label: "مستشعر افتراضي (AI / Satellite Analysis)" — Computed
   ================================================================ */
function VirtualAIPopup({
  zone,
  isAr,
}: {
  zone: Zone;
  isAr: boolean;
}) {
  const ndvi = zone.satellite?.ndvi;
  const ndviColor = ndvi !== undefined
    ? ndvi >= 0.4 ? 'text-emerald-400' : ndvi >= 0.2 ? 'text-amber-400' : 'text-red-400'
    : 'text-slate-400';

  return (
    <div className={`p-4 rounded-2xl backdrop-blur-md bg-slate-900/60 border border-white/10 shadow-2xl text-slate-50 min-w-[240px] ${isAr ? 'rtl-popup' : ''}`}>
      {/* Header — Virtual/AI label */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-indigo-500/30">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400">
            {isAr ? 'مستشعر افتراضي (AI / Satellite)' : 'VIRTUAL SENSOR (AI / SATELLITE)'}
          </span>
        </div>
        <span className="text-[9px] font-mono text-slate-500">
          Z-{String(zone.id).padStart(3, '0')}
        </span>
      </div>

      {/* Zone name */}
      <h4 className="text-sm font-black text-white mb-1 leading-tight">
        {isAr ? zone.nameAr : zone.nameEn}
      </h4>
      <p className="text-[9px] text-indigo-300/60 mb-3">
        {isAr
          ? 'القيم المُقدَّرة من تحليل Sentinel-2 الفضائي — ليست قراءات أجهزة فعلية'
          : 'Estimated from Sentinel-2 satellite spectral analysis — not hardware readings'}
      </p>

      {/* AI-Estimated metrics */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Droplets className="w-3 h-3 text-blue-400/60" />
            {isAr ? 'رطوبة مُقدَّرة (AI)' : 'Est. Moisture (AI)'}
          </span>
          <strong className="font-mono font-black text-indigo-200">{zone.moisture.toFixed(1)}%</strong>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Thermometer className="w-3 h-3 text-orange-400/60" />
            {isAr ? 'حرارة مُقدَّرة' : 'Est. Temperature'}
          </span>
          <strong className="font-mono font-black text-indigo-200">{zone.temp.toFixed(1)}°C</strong>
        </div>
        {ndvi !== undefined && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-emerald-400/60" />
              NDVI
            </span>
            <strong className={`font-mono font-black ${ndviColor}`}>{ndvi.toFixed(3)}</strong>
          </div>
        )}
      </div>

      {/* Confidence + processing timestamp */}
      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between">
        <span className="text-[9px] text-slate-500 font-mono">
          {isAr ? 'معالجة' : 'Processed'}: {zone.lastSensorReading ?? zone.satellite?.imageryDate ?? '—'}
        </span>
        <span className="text-[9px] text-indigo-400/60 font-mono flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          {zone.satellite?.source === 'sentinel2' ? 'S2' : 'AI'}
        </span>
      </div>
    </div>
  );
}

/* ================================================================
   THERMAL NDVI SVG OVERLAY — CSS blur(6px) on SVG container
   Colors derived from real zone sensor/NDVI data, no static values
   ================================================================ */
function ThermalNDVIOverlay({
  zones,
  zonePositions,
  boundary,
  map,
}: {
  zones: Zone[];
  zonePositions: [number, number][];
  boundary: [number, number][];
  map: L.Map;
}) {
  const [svgContent, setSvgContent] = useState<React.ReactNode>(null);

  useEffect(() => {
    if (!map || boundary.length < 3 || zones.length === 0) {
      setSvgContent(null);
      return;
    }

    const updateSVG = () => {
      const size = map.getSize();
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();

      const boundaryScreen = boundary.map((ll) => {
        const pt = map.latLngToContainerPoint(ll);
        return [pt.x, pt.y];
      });

      const zoneScreen = zonePositions.map((ll) => {
        const pt = map.latLngToContainerPoint(ll);
        return [pt.x, pt.y];
      });

      // Build boundary path string
      const pathD = boundaryScreen
        .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`)
        .join(' ') + ' Z';

      setSvgContent(
        <svg
          width={size.x}
          height={size.y}
          className="absolute top-0 left-0 thermal-ndvi-layer pointer-events-none"
          style={{ zIndex: 450 }}
        >
          <defs>
            <clipPath id="farm-boundary-clip">
              <path d={pathD} />
            </clipPath>
            {zones.map((zone, i) => (
              <radialGradient key={`grad-${zone.id}`} id={`ndvi-grad-${zone.id}`}>
                <stop offset="0%" stopColor={getNdviColor(zone)} stopOpacity={0.7} />
                <stop offset="55%" stopColor={getNdviColor(zone)} stopOpacity={0.3} />
                <stop offset="100%" stopColor={getNdviColor(zone)} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>

          <g clipPath="url(#farm-boundary-clip)">
            {zones.map((zone, i) => {
              if (!zoneScreen[i]) return null;
              const [cx, cy] = zoneScreen[i];
              const radius = 50 + (zone.total || 30) * 0.6;
              return (
                <circle
                  key={zone.id}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={`url(#ndvi-grad-${zone.id})`}
                />
              );
            })}
          </g>
        </svg>
      );
    };

    updateSVG();
    map.on('move', updateSVG);
    map.on('zoom', updateSVG);
    map.on('resize', updateSVG);

    return () => {
      map.off('move', updateSVG);
      map.off('zoom', updateSVG);
      map.off('resize', updateSVG);
    };
  }, [map, boundary, zones, zonePositions]);

  return <>{svgContent}</>;
}

/* ================================================================
   MAP EVENT BRIDGE — exposes map ref to parent ThermalNDVIOverlay
   ================================================================ */
function MapEventBridge({
  onMapReady,
}: {
  onMapReady: (map: L.Map) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);
  return null;
}

/* ================================================================
   MAIN COMPONENT EXPORT
   ================================================================ */
export function DigitalTwinMap({
  isAr,
  savedGeoJSON,
  userName,
  userLocation,
  zones,
  sensors = [],
  dataStatus,
}: DigitalTwinMapProps) {
  const [viewMode, setViewMode] = useState<'satellite' | 'thermal'>('satellite');
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // Parse boundary coordinates — null-safe
  const boundary = useMemo(() => {
    try { return extractBoundary(savedGeoJSON); }
    catch { return []; }
  }, [savedGeoJSON]);
  const mapCenter = useMemo(() => {
    try { return computeCenter(boundary); }
    catch { return WASIT_CENTER; }
  }, [boundary]);

  // Distribute zone positions within boundary — null-safe
  const safeZones = zones ?? [];
  const zonePositions = useMemo(
    () => {
      try { return distributeZonePositions(safeZones, boundary); }
      catch { return []; }
    },
    [safeZones, boundary]
  );

  // Aggregate sensor readings by zone — null-safe
  const sensorMap = useMemo(
    () => {
      try { return aggregateSensorsByZone(sensors); }
      catch { return {}; }
    },
    [sensors]
  );

  return (
    <div className="space-y-6 text-black animate-fade-in font-sans">
      {/* ================= HEADER ================= */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-600 rounded-full blur-[100px] opacity-10 pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-1 px-2.5 bg-emerald-600 font-extrabold text-[10px] tracking-widest rounded-lg flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                GIS CONTROL CENTER
              </span>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                {userLocation || (isAr ? 'محافظة واسط — جمهورية العراق' : 'Wasit Governorate — Republic of Iraq')}
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black mt-1 tracking-tight">
              {isAr
                ? 'الخريطة الحرارية — مراقبة صحة النبات بالأقمار الصناعية'
                : 'Thermal NDVI Heatmap — Satellite Vegetation Monitoring'}
            </h1>
            <p className="text-xs text-slate-400 font-medium max-w-xl mt-0.5">
              {isAr
                ? 'جميع البيانات مستمدة حصرياً من مستشعرات حقيقية وصور الأقمار الصناعية. لا توجد بيانات وهمية.'
                : 'All data sourced exclusively from real ground sensors and satellite imagery. No mock data.'}
            </p>
          </div>
          <div className="bg-slate-950/80 p-3 px-4 rounded-2xl border border-slate-800 flex items-center gap-3.5">
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end text-xs font-black text-white">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {isAr
                    ? `المستخدم: ${userName ?? 'ضيف'}`
                    : `User: ${userName ?? 'Guest'}`}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5 justify-end mt-0.5">
                <Clock className="w-3 h-3 text-red-400" />
                <span>
                  {new Date().toLocaleTimeString('en-GB')} |{' '}
                  {new Date().toLocaleDateString(isAr ? 'ar-IQ' : 'en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= MAP + SIDEBAR GRID ================= */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* ===== MAP CONTAINER (3 cols) ===== */}
        <div className="xl:col-span-3 bg-slate-950 rounded-3xl border border-slate-800 relative shadow-2xl overflow-hidden min-h-[600px]">
          {/* View Mode Toggle — z-index 1000 overlay */}
          <div className="absolute top-4 right-4 z-[1000] flex bg-slate-950/70 backdrop-blur-sm border border-slate-700/50 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setViewMode('satellite')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition-all duration-200 cursor-pointer ${
                viewMode === 'satellite'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/50'
                  : 'bg-slate-800/40 text-slate-400 border border-slate-600 hover:text-white'
              }`}
            >
              {isAr ? 'قمر صناعي' : 'Satellite'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('thermal')}
              className={`px-4 py-2 text-xs font-black rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'thermal'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/50'
                  : 'bg-slate-800/40 text-slate-400 border border-slate-600 hover:text-white'
              }`}
            >
              <Thermometer className="w-3.5 h-3.5" />
              {isAr ? 'حراري / NDVI' : 'Thermal / NDVI'}
            </button>
          </div>

          {/* Status Badges */}
          <div className="absolute top-4 left-4 z-[1000] flex flex-wrap gap-2 pointer-events-none">
            <span className="bg-slate-950/90 border border-slate-800 text-emerald-400 px-3 py-1 text-[9px] font-bold rounded-lg uppercase shadow-md flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              {boundary.length >= 3
                ? (isAr ? 'حدود GPS نشطة' : 'GPS BOUNDARY ACTIVE')
                : (isAr ? 'لا توجد حدود' : 'NO BOUNDARY')}
            </span>
            {dataStatus?.sensorsSource && (
              <span className={`bg-slate-950/90 border border-slate-800 px-3 py-1 text-[9px] font-bold rounded-lg uppercase shadow-md ${
                dataStatus.sensorsSource === 'unavailable' ? 'text-slate-500' : 'text-blue-400'
              }`}>
                {dataStatus.sensorsSource === 'mqtt' ? 'MQTT LIVE' : dataStatus.sensorsSource === 'rest' ? 'REST API' : (isAr ? 'لا مجسات' : 'NO SENSORS')}
              </span>
            )}
          </div>

          {/* Leaflet Map */}
          <MapContainer
            center={mapCenter}
            zoom={DEFAULT_ZOOM}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            zoomControl={false}
            className="w-full h-full absolute inset-0"
            style={{ background: '#0f172a' }}
            attributionControl={true}
          >
            <MapEventBridge onMapReady={setMapInstance} />
            {boundary.length >= 3 && <FitBounds boundary={boundary} />}

            {/* ESRI World Imagery — always active base */}
            <TileLayer url={ESRI_SATELLITE_URL} attribution={ESRI_ATTR} />

            {/* Farm Boundary Polygon */}
            {boundary.length >= 3 && (
              <Polygon
                positions={boundary}
                pathOptions={{
                  color: '#10B981',
                  weight: 2.5,
                  fillColor: '#10B981',
                  fillOpacity: viewMode === 'satellite' ? 0.04 : 0,
                  dashArray: '8 4',
                }}
              />
            )}

            {/* Zone Circle Markers with Differentiated Glassmorphism Popups */}
            {safeZones.map((zone, i) => {
              const pos = zonePositions[i];
              if (!pos) return null;
              const ndviColor = getNdviColor(zone);
              const zoneSensor = sensorMap[zone.id];
              const hasPhysicalSensor = !!zoneSensor;

              return (
                <CircleMarker
                  key={zone.id}
                  center={pos}
                  radius={Math.max(8, Math.min(20, (zone.total || 20) * 0.3))}
                  pathOptions={{
                    color: hasPhysicalSensor ? '#10B981' : '#818CF8',
                    weight: 2,
                    fillColor: hasPhysicalSensor ? ndviColor : '#818CF8',
                    fillOpacity: 0.35,
                  }}
                  eventHandlers={{
                    click: () => setSelectedZoneId(zone.id),
                  }}
                >
                  <Popup className="skyd-glass-popup" closeButton={false}>
                    {hasPhysicalSensor ? (
                      <PhysicalIoTPopup
                        zone={zone}
                        sensorData={zoneSensor}
                        isAr={isAr}
                      />
                    ) : (
                      <VirtualAIPopup zone={zone} isAr={isAr} />
                    )}
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* Thermal NDVI SVG Overlay — only in thermal mode */}
            {viewMode === 'thermal' && mapInstance && boundary.length >= 3 && (
              <ThermalNDVIOverlay
                zones={safeZones}
                zonePositions={zonePositions}
                boundary={boundary}
                map={mapInstance}
              />
            )}
          </MapContainer>
        </div>

        {/* ===== RIGHT SIDEBAR (1 col) ===== */}
        <div className="space-y-5">
          {/* Legend */}
          <div className="bg-gradient-to-br from-white to-slate-50 p-5 rounded-3xl border border-slate-200 shadow-md space-y-4">
            <div>
              <span className="p-1 px-2.5 bg-emerald-100 text-emerald-800 font-extrabold text-[9px] rounded-lg inline-block uppercase">
                {isAr ? 'دليل الألوان' : 'NDVI LEGEND'}
              </span>
              <h3 className="text-sm font-black text-slate-800 mt-1.5">
                {isAr ? 'مؤشر صحة الغطاء النباتي' : 'Vegetation Health Index'}
              </h3>
            </div>

            <div className="space-y-2.5">
              <div className="p-2.5 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow shadow-emerald-400/50 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-emerald-900">
                    {isAr ? 'صحي (NDVI ≥ 0.4)' : 'Healthy (NDVI ≥ 0.4)'}
                  </h4>
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    {isAr
                      ? 'نباتات سليمة — كلوروفيل نشط وري متوازن'
                      : 'Active photosynthesis — optimal growth'}
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-amber-500 border-2 border-white shadow shadow-amber-400/50 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-amber-900">
                    {isAr ? 'إجهاد (0.2 – 0.4)' : 'Stress (0.2 – 0.4)'}
                  </h4>
                  <p className="text-[10px] text-amber-700 mt-0.5">
                    {isAr
                      ? 'نقص رطوبة أو مغذيات — يحتاج متابعة'
                      : 'Moisture or nutrient deficit detected'}
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-red-50 rounded-2xl border border-red-100 flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow shadow-red-400/50 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-red-900 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-red-600 animate-pulse" />
                    {isAr ? 'تلف (NDVI < 0.2)' : 'Damage (NDVI < 0.2)'}
                  </h4>
                  <p className="text-[10px] text-red-700 mt-0.5">
                    {isAr
                      ? 'آفة نشطة أو جفاف حاد — تدخل فوري مطلوب'
                      : 'Active infestation or severe drought'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Zone Summary Cards */}
          <div className="bg-slate-950 text-white p-5 rounded-3xl border border-slate-800 shadow-lg space-y-3">
            <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-500" />
              {isAr ? `مناطق الحقل (${safeZones.length})` : `Field Zones (${safeZones.length})`}
            </h3>

            {safeZones.length === 0 ? (
              <div className="text-center py-4">
                <Activity className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-[11px] text-slate-500">
                  {isAr
                    ? 'لا توجد مناطق مسجلة بعد. أضف منطقة من لوحة التحكم.'
                    : 'No zones registered yet. Add zones from the dashboard.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {safeZones.map((zone, i) => {
                  const ndviColor = getNdviColor(zone);
                  const isSelected = selectedZoneId === zone.id;
                  const hasSensor = !!sensorMap[zone.id];

                  return (
                    <button
                      key={zone.id}
                      type="button"
                      onClick={() => setSelectedZoneId(zone.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-950/50 border-emerald-500/50'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: ndviColor }}
                          />
                          <span className="text-[11px] font-black text-white truncate max-w-[120px]">
                            {isAr ? zone.nameAr : zone.nameEn}
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono">
                          Z-{String(zone.id).padStart(3, '0')}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px]">
                        <span className="text-slate-400">
                          {isAr ? 'رطوبة' : 'Moist'}: <strong className="text-white">{zone.moisture}%</strong>
                        </span>
                        <span className="text-slate-400">
                          {isAr ? 'حرارة' : 'Temp'}: <strong className="text-white">{zone.temp}°</strong>
                        </span>
                        <span className="text-slate-400 flex items-center gap-0.5">
                          {hasSensor ? (
                            <Wifi className="w-2 h-2 text-emerald-400" />
                          ) : (
                            <WifiOff className="w-2 h-2 text-slate-600" />
                          )}
                          {isAr ? 'مجس' : 'Sensor'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* FLIR Color Scale */}
          <div className="bg-slate-900 text-white p-4 rounded-3xl border border-slate-800 shadow-sm space-y-2.5">
            <div className="flex justify-between items-center text-[10px] font-black uppercase text-slate-400">
              <span>{isAr ? 'مقياس NDVI' : 'NDVI SCALE'}</span>
              <span className="text-emerald-400">MAX 1.0</span>
            </div>
            <div className="h-4 w-full rounded bg-gradient-to-r from-red-600 via-amber-500 to-emerald-500 border border-slate-800" />
            <div className="flex justify-between text-[9px] font-mono text-slate-500 font-bold">
              <span>0.0 ({isAr ? 'تلف' : 'Damaged'})</span>
              <span>0.5 ({isAr ? 'إجهاد' : 'Stress'})</span>
              <span>1.0 ({isAr ? 'صحي' : 'Healthy'})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
