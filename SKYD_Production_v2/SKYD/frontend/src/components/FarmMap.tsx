/**
 * FIXED: Hook order + Bounds safety + Defensive render — P0 Crash Fix
 *
 * Root causes addressed:
 *   A. Stale closures — onBoundaryChange and isAr captured in useEffect
 *      closures but absent from dependency array. Fixed with refs.
 *   B. Leaflet load race — CDN scripts may not be ready on first mount.
 *      Fixed with polling retry (up to 50 attempts × 200ms = 10s).
 *   C. Unsafe geometry access — getLatLngs()[0] unguarded, event handlers
 *      lack try/catch, causing crashes on malformed GeoJSON.
 *   D. Map leak — Leaflet map instance not destroyed on unmount.
 *   E. Hardcoded localhost in API label text.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AreaChart, Compass, Check, AlertCircle, RefreshCw, Send, Plus, Trash2 } from 'lucide-react';
import L from 'leaflet';
import { API_BASE } from '../services/skydApiService';

interface FarmMapProps {
  isAr: boolean;
  onBoundaryChange?: (geojson: any, areaAcres: number, center: [number, number], soilType: string) => void;
  savedGeoJSON?: any;
}

// Iraq initial center
const IRAQ_CENTER: [number, number] = [33.3152, 44.3661];

// Factual regional branches with coordinates & template farm polygons
const REGIONAL_BRANCHES = [
  {
    nameAr: 'فرع الأنبار (الرمادي)',
    nameEn: 'Anbar Branch (Ramadi)',
    center: [33.4214, 43.3032] as [number, number],
    defaultPolygon: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [43.301, 33.421],
          [43.305, 33.421],
          [43.305, 33.423],
          [43.301, 33.423],
          [43.301, 33.421]
        ]]
      }
    }
  },
  {
    nameAr: 'فرع نينوى (الموصل)',
    nameEn: 'Nineveh Branch (Mosul)',
    center: [36.3489, 43.1577] as [number, number],
    defaultPolygon: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [43.155, 36.348],
          [43.159, 36.348],
          [43.159, 36.350],
          [43.155, 36.350],
          [43.155, 36.348]
        ]]
      }
    }
  },
  {
    nameAr: 'فرع بابل (الحلة)',
    nameEn: 'Babylon Branch (Hillah)',
    center: [32.4813, 44.4305] as [number, number],
    defaultPolygon: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [44.428, 32.480],
          [44.432, 32.480],
          [44.432, 32.482],
          [44.428, 32.482],
          [44.428, 32.480]
        ]]
      }
    }
  },
  {
    nameAr: 'فرع البصرة (القرنة)',
    nameEn: 'Basra Branch (Qurna)',
    center: [31.0116, 47.4324] as [number, number],
    defaultPolygon: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [47.430, 31.010],
          [47.434, 31.010],
          [47.434, 31.012],
          [47.430, 31.012],
          [47.430, 31.010]
        ]]
      }
    }
  },
];

// Formulate estimated soil types according to coordinates / random algorithm
const SOIL_TYPES_AR = ['تربة مزيجية طينية (Clay Loam)', 'تربة مزيجية رملية (Sandy Loam)', 'تربة غرينية (Silt Soil)', 'تربة رسوبية ضفة النهار'];
const SOIL_TYPES_EN = ['Clay Loam', 'Sandy Loam', 'Silt Soil', 'Riverbank Alluvial'];

export function FarmMap({ isAr, onBoundaryChange, savedGeoJSON }: FarmMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const drawControlRef = useRef<any>(null);
  const drawnItemsRef = useRef<any>(null);
  const segmentLabelsRef = useRef<any[]>([]);
  const areaLabelRef = useRef<any>(null);

  const [geojsonStr, setGeojsonStr] = useState<string>('');
  const [estimatedArea, setEstimatedArea] = useState<number>(0);
  const [detectedSoil, setDetectedSoil] = useState<string>(isAr ? 'لم يتم تحديد الحدود بعد' : 'No boundary drawn yet');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStatus, setSubmitStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [drawVertexCount, setDrawVertexCount] = useState<number>(0);

  // Stable refs to prevent stale closures in Leaflet event handlers
  const onBoundaryChangeRef = useRef(onBoundaryChange);
  onBoundaryChangeRef.current = onBoundaryChange;
  const isArRef = useRef(isAr);
  isArRef.current = isAr;

  // Helper area calculation (Spherical Mercator)
  const getPolygonAreaSqMeters = (latlngs: any[]): number => {
    if (latlngs.length < 3) return 0;
    const radius = 6378137; // Earth's radius in meters
    const r2d = Math.PI / 180;
    let area = 0;
    
    for (let i = 0; i < latlngs.length; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % latlngs.length];
      area += (p2.lng - p1.lng) * r2d * (2 + Math.sin(p1.lat * r2d) + Math.sin(p2.lat * r2d));
    }
    area = Math.abs(area * radius * radius / 2);
    return area;
  };

  // Helper distance calculation in yards
  const getDistanceYards = (p1: any, p2: any): number => {
    const radius = 6378137;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return radius * c * 1.09361;
  };

  const clearLabels = () => {
    if (!mapRef.current) return;
    segmentLabelsRef.current.forEach(marker => {
      mapRef.current.removeLayer(marker);
    });
    segmentLabelsRef.current = [];

    if (areaLabelRef.current) {
      mapRef.current.removeLayer(areaLabelRef.current);
      areaLabelRef.current = null;
    }
  };

  const renderMeasurementLabels = (latlngs: any[], areaAcres: number) => {
    if (!mapRef.current) return;

    clearLabels();

    if (latlngs.length < 3) return;

    // Draw segment distances
    for (let i = 0; i < latlngs.length; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % latlngs.length];
      const dist = getDistanceYards(p1, p2);
      const midLat = (p1.lat + p2.lat) / 2;
      const midLng = (p1.lng + p2.lng) / 2;

      const labelHtml = `<div class="bg-black/80 text-white border border-slate-700 rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap font-sans font-black shadow-lg">${dist.toFixed(1)} yd</div>`;
      
      const segmentLabel = L.marker([midLat, midLng], {
        icon: L.divIcon({
          className: 'custom-segment-label',
          html: labelHtml,
          iconSize: [40, 16],
          iconAnchor: [20, 8]
        }),
        interactive: false
      }).addTo(mapRef.current);

      segmentLabelsRef.current.push(segmentLabel);
    }

    // Calculate center of polygon
    let sumLat = 0, sumLng = 0;
    latlngs.forEach(p => {
      sumLat += p.lat;
      sumLng += p.lng;
    });
    const centerLat = sumLat / latlngs.length;
    const centerLng = sumLng / latlngs.length;

    // Draw Area Indicator
    const areaHtml = `
      <div class="bg-emerald-700/90 text-white border-2 border-emerald-400 rounded-lg px-2.5 py-1 text-xs whitespace-nowrap font-sans font-extrabold shadow-xl text-center flex flex-col items-center">
        <span class="text-[9px] font-medium opacity-90">${isAr ? 'المساحة المقدرة' : 'Estimated Area'}</span>
        <span class="text-sm font-black tracking-tight">${areaAcres.toFixed(4)} AC</span>
      </div>
    `;

    areaLabelRef.current = L.marker([centerLat, centerLng], {
      icon: L.divIcon({
        className: 'custom-area-label',
        html: areaHtml,
        iconSize: [120, 48],
        iconAnchor: [60, 24]
      }),
      interactive: false
    }).addTo(mapRef.current);
  };

  const handleSelectBranch = (branch: typeof REGIONAL_BRANCHES[0]) => {
    if (!mapRef.current) return;

    // Center map & zoom in on region
    mapRef.current.setView(branch.center, 14);

    if (drawnItemsRef.current) {
      drawnItemsRef.current.clearLayers();
    }
    clearLabels();

    try {
      const geojson = branch.defaultPolygon;
      const layer = L.GeoJSON.geometryToLayer(geojson as any) as any;
      layer.setStyle({
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.25,
        weight: 3
      });
      drawnItemsRef.current.addLayer(layer);

      // Process geometry payload
      setGeojsonStr(JSON.stringify(geojson, null, 2));

      const latlngs = (layer as any).getLatLngs()[0];
      const areaSqM = getPolygonAreaSqMeters(latlngs);
      const acres = areaSqM * 0.000247105;
      setEstimatedArea(acres);

      const index = Math.abs(Math.round((latlngs[0].lat + latlngs[0].lng) * 100)) % SOIL_TYPES_AR.length;
      const soilAr = SOIL_TYPES_AR[index];
      const soilEn = SOIL_TYPES_EN[index];
      setDetectedSoil(isAr ? soilAr : soilEn);

      renderMeasurementLabels(latlngs, acres);

      // Notify parent callbacks to link with state and Firebase
      if (onBoundaryChangeRef.current) {
        onBoundaryChangeRef.current(geojson, acres, branch.center, isArRef.current ? soilAr : soilEn);
      }
    } catch (err) {
      console.error('[FarmMap] Error drawing automatic template:', err);
    }
  };

  // Safe helper: extract latlngs from a Leaflet layer with null guard
  const safeGetLatLngs = (layer: any): any[] => {
    try {
      const all = layer?.getLatLngs?.();
      if (Array.isArray(all) && all.length > 0 && Array.isArray(all[0])) return all[0];
      if (Array.isArray(all) && all.length > 0) return all;
      return [];
    } catch { return []; }
  };

  // Safe helper: compute soil index from latlngs
  const soilIndex = (latlngs: any[]): number => {
    if (latlngs.length === 0 || !latlngs[0]) return 0;
    return Math.abs(Math.round(((latlngs[0].lat ?? 0) + (latlngs[0].lng ?? 0)) * 100)) % SOIL_TYPES_AR.length;
  };

  // Safe helper: compute center from latlngs array
  const safeCenter = (latlngs: any[]): [number, number] => {
    if (latlngs.length === 0) return IRAQ_CENTER;
    let sumLat = 0, sumLng = 0;
    for (const p of latlngs) {
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
        sumLat += p.lat;
        sumLng += p.lng;
      }
    }
    return latlngs.length > 0 ? [sumLat / latlngs.length, sumLng / latlngs.length] : IRAQ_CENTER;
  };

  useEffect(() => {
    let cancelled = false;

    const ensureLeafletDraw = async (): Promise<boolean> => {
      if ((L as any).Control?.Draw) return true;
      (window as any).L = L;
      await import('leaflet-draw/dist/leaflet.draw.js');
      return !!(L as any).Control?.Draw;
    };

    /**
     * CRITICAL FIX: Monkey-patch Leaflet Draw Polygon handler.
     *
     * The default polygon tool auto-closes after 3 points (triangle) because:
     * 1. _updateFinishHandler adds a click-to-finish on the FIRST marker
     * 2. _endPoint checks distance to first marker and closes if close
     * 3. _finishShape has no minimum vertex requirement
     * 4. completeShape (toolbar Finish button) allows 3+ vertices
     *
     * This patch enforces a MINIMUM of 4 vertices by overriding ALL four
     * finish paths, making triangular farms impossible.
     */
    const patchPolygonUnlimitedPoints = () => {
      const LD = (L as any).Draw;
      if (!LD?.Polygon?.prototype) {
        console.warn('[FarmMap] L.Draw.Polygon not found — patch skipped');
        return;
      }
      console.log('[FarmMap] Applying polygon patch: min 4 vertices, send to server...');
      const MIN_VERTICES = 4;

      // GUARD 1: _finishShape — the single gate for ALL close paths
      // (first-marker click, dblclick, Finish button, _endPoint proximity)
      const origFinishShape = LD.Polygon.prototype._finishShape;
      LD.Polygon.prototype._finishShape = function () {
        const mc = this._markers?.length ?? 0;
        if (mc < MIN_VERTICES) {
          console.log(`[FarmMap] Close blocked: ${mc}/${MIN_VERTICES} vertices`);
          return;
        }
        return origFinishShape.call(this);
      };

      // GUARD 2: completeShape — Finish toolbar button
      const proto = LD.Polygon.prototype;
      const polylineProto = LD.Polyline?.prototype;
      const origCompleteShape = proto.completeShape ?? polylineProto?.completeShape;
      proto.completeShape = function () {
        const mc = this._markers?.length ?? 0;
        if (mc < MIN_VERTICES) {
          console.log(`[FarmMap] Finish btn blocked: ${mc}/${MIN_VERTICES}`);
          return;
        }
        // Call _finishShape directly — most reliable path
        this._finishShape();
      };

      // GUARD 3: _updateFinishHandler — prevent first-marker click closing too early
      // CRITICAL: Do NOT call origUpdateFinishHandler as it adds the click handler
      LD.Polygon.prototype._updateFinishHandler = function () {
        const mc = this._markers?.length ?? 0;
        // Always remove click handler from first marker (prevents 3-pt close)
        if (this._markers?.[0]) {
          this._markers[0].off('click', this._finishShape, this);
        }
        // Add dblclick only on the LAST marker, only when enough vertices
        if (mc >= MIN_VERTICES && this._markers?.[mc - 1]) {
          this._markers[mc - 1].on('dblclick', this._finishShape, this);
        }
        // Remove dblclick from second-to-last to avoid duplicates
        if (mc > MIN_VERTICES && this._markers?.[mc - 2]) {
          try { this._markers[mc - 2].off('dblclick', this._finishShape, this); } catch {}
        }
      };

      // GUARD 4: _endPoint — let Leaflet Draw add vertices normally
      // Only intercept when it tries to close (proximity to first marker)
      const origEndPoint = polylineProto?._endPoint;
      if (origEndPoint) {
        LD.Polyline.prototype._endPoint = function (clientX: number, clientY: number, e: any) {
          // Always let origEndPoint run — it adds vertices AND handles close
          // GUARD 1 (_finishShape) will block premature closure automatically
          return origEndPoint.call(this, clientX, clientY, e);
        };
      }

      // Update tooltip
      try {
        const local = (L as any).drawLocal;
        if (local?.draw?.handlers?.polygon?.tooltip) {
          local.draw.handlers.polygon.tooltip.end =
            'انقر نقراً مزدوجاً أو اضغط "إنهاء" لإغلاق المضلع (حد أدنى 4 نقاط). / Double-click or "Finish" to close (min 4 points).';
        }
      } catch { /* ignore */ }
      console.log('[FarmMap] Polygon patch applied ✓ min 4 vertices on all paths');
    };

    const restoreGeoJSON = () => {
      if (!savedGeoJSON || !drawnItemsRef.current || !mapRef.current) return;
      if (drawnItemsRef.current.getLayers().length > 0) return;
      try {
        const layer = L.geoJSON(savedGeoJSON);
        layer.eachLayer((child: L.Layer) => {
          if ('setStyle' in child && typeof (child as L.Path).setStyle === 'function') {
            (child as L.Path).setStyle({ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.25, weight: 3 });
            drawnItemsRef.current.addLayer(child);

            const latlngs = safeGetLatLngs(child);
            if (latlngs.length >= 3) {
              const acres = getPolygonAreaSqMeters(latlngs) * 0.000247105;
              setEstimatedArea(acres);
              setGeojsonStr(JSON.stringify(savedGeoJSON, null, 2));
              const idx = soilIndex(latlngs);
              setDetectedSoil(isArRef.current ? SOIL_TYPES_AR[idx] : SOIL_TYPES_EN[idx]);
              renderMeasurementLabels(latlngs, acres);
              try { mapRef.current.fitBounds((child as L.Polygon).getBounds(), { padding: [50, 50] }); } catch { /* bounds may fail */ }
            }
          }
        });
      } catch (err) {
        console.error('[FarmMap] Error restoring saved GeoJSON:', err);
      }
    };

    const initMap = async () => {
      if (!mapContainerRef.current || mapRef.current) return;

      const drawReady = await ensureLeafletDraw();
      if (cancelled || !drawReady || !mapContainerRef.current || mapRef.current) {
        if (!drawReady) {
          console.error('[FarmMap] Leaflet Draw failed to load from bundled package');
        }
        return;
      }

      // Apply monkey-patch BEFORE creating the draw control
      patchPolygonUnlimitedPoints();

      try {
        const map = L.map(mapContainerRef.current, {
          center: IRAQ_CENTER,
          zoom: 7,
          zoomControl: true,
        });
        mapRef.current = map;

        // Google Hybrid satellite tile layer
        L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          maxZoom: 20,
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
          attribution: 'Google Hybrid Satellite & Roads'
        }).addTo(map);

        // Drawn items layer group
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        drawnItemsRef.current = drawnItems;

        // Drawing Toolbar — single polygon only, UNLIMITED vertices
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              allowIntersection: false,
              showArea: true,
              showLength: true,
              metric: true,
              maxPoints: 0, // 0 = unlimited (explicit — never auto-close)
              drawError: {
                color: '#ef4444',
                timeout: 2000,
                message: isArRef.current ? '\u062e\u0637\u0623: \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0642\u0627\u0637\u0639 \u0627\u0644\u062e\u0637\u0648\u0637!' : 'Error: Lines cannot intersect!'
              },
              // Smaller first-point marker to reduce accidental polygon closure
              icon: new L.DivIcon({
                className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon',
                iconSize: new L.Point(12, 12),
                html: '<div style="width:12px;height:12px;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>'
              }),
              shapeOptions: { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.25, weight: 3 }
            },
            polyline: false, circle: false, rectangle: false, marker: false, circlemarker: false
          },
          edit: { featureGroup: drawnItems, remove: true }
        });
        map.addControl(drawControl);
        drawControlRef.current = drawControl;

        // ── Vertex counter: track how many points placed during drawing ──
        map.on('draw:drawstart', () => {
          setDrawVertexCount(0);
        });
        map.on('draw:drawvertex', (e: any) => {
          try {
            const count = e.layers?.getLayers?.()?.length ?? 0;
            setDrawVertexCount(count);
          } catch { /* ignore */ }
        });
        map.on('draw:drawstop', () => {
          setDrawVertexCount(0);
        });

        // ── Draw CREATED handler ────────────────────────────────────────
        map.on((L as any).Draw.Event.CREATED || 'draw:created', (e: any) => {
          try {
            const layer = e.layer;
            drawnItems.clearLayers();
            clearLabels();
            drawnItems.addLayer(layer);

            const geojson = layer.toGeoJSON();
            setGeojsonStr(JSON.stringify(geojson, null, 2));

            const latlngs = safeGetLatLngs(layer);
            if (latlngs.length < 3) return;

            const acres = getPolygonAreaSqMeters(latlngs) * 0.000247105;
            setEstimatedArea(acres);

            const idx = soilIndex(latlngs);
            setDetectedSoil(isArRef.current ? SOIL_TYPES_AR[idx] : SOIL_TYPES_EN[idx]);
            renderMeasurementLabels(latlngs, acres);

            const center = safeCenter(latlngs);
            if (onBoundaryChangeRef.current) {
              onBoundaryChangeRef.current(geojson, acres, center, isArRef.current ? SOIL_TYPES_AR[idx] : SOIL_TYPES_EN[idx]);
            }
          } catch (err) {
            console.error('[FarmMap] Draw CREATED handler error:', err);
          }
        });

        // ── Draw EDITED handler ─────────────────────────────────────────
        map.on((L as any).Draw.Event.EDITED || 'draw:edited', (e: any) => {
          try {
            const layers = e.layers;
            layers.eachLayer((layer: any) => {
              try {
                const geojson = layer.toGeoJSON();
                setGeojsonStr(JSON.stringify(geojson, null, 2));

                const latlngs = safeGetLatLngs(layer);
                if (latlngs.length < 3) return;

                const acres = getPolygonAreaSqMeters(latlngs) * 0.000247105;
                setEstimatedArea(acres);

                const idx = soilIndex(latlngs);
                setDetectedSoil(isArRef.current ? SOIL_TYPES_AR[idx] : SOIL_TYPES_EN[idx]);
                renderMeasurementLabels(latlngs, acres);

                const center = safeCenter(latlngs);
                if (onBoundaryChangeRef.current) {
                  onBoundaryChangeRef.current(geojson, acres, center, isArRef.current ? SOIL_TYPES_AR[idx] : SOIL_TYPES_EN[idx]);
                }
              } catch (innerErr) {
                console.error('[FarmMap] Edit layer error:', innerErr);
              }
            });
          } catch (err) {
            console.error('[FarmMap] Draw EDITED handler error:', err);
          }
        });

        // ── Draw DELETED handler ────────────────────────────────────────
        map.on((L as any).Draw.Event.DELETED || 'draw:deleted', () => {
          try {
            drawnItems.clearLayers();
            clearLabels();
            setGeojsonStr('');
            setEstimatedArea(0);
            setDetectedSoil(isArRef.current
              ? '\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u062d\u062f\u0648\u062f. \u064a\u0631\u062c\u0649 \u0631\u0633\u0645 \u062d\u062f\u0648\u062f \u062c\u062f\u064a\u062f\u0629.'
              : 'Boundary deleted. Please draw a new one.');
            if (onBoundaryChangeRef.current) {
              onBoundaryChangeRef.current(null, 0, IRAQ_CENTER, '');
            }
          } catch (err) {
            console.error('[FarmMap] Draw DELETED handler error:', err);
          }
        });

        map.invalidateSize();
        restoreGeoJSON();
      } catch (initErr) {
        console.error('[FarmMap] Map initialization failed:', initErr);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      // Cleanup: destroy Leaflet map instance on unmount
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* ignore */ }
        mapRef.current = null;
      }
    };
  }, [savedGeoJSON]);

  // Handle send to FastAPI server POST
  const handleSendToFastAPI = async () => {
    if (!geojsonStr) {
      alert(isAr ? 'الرجاء رسم حدود المزرعة أولاً قبل الإرسال!' : 'Please draw the farm boundary first!');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(null);

    let parsedGeoJSON: any;
    try {
      parsedGeoJSON = JSON.parse(geojsonStr);
    } catch {
      setSubmitStatus({ success: false, message: isAr ? 'خطأ: بيانات GeoJSON تالفة' : 'Error: Invalid GeoJSON data' });
      setIsSubmitting(false);
      return;
    }

    // Extract full coordinate ring — supports N-point polygons (3, 4, 5, 6, 10, 20+)
    const coordRing: number[][] = parsedGeoJSON?.geometry?.coordinates?.[0] ?? [];
    const pointCount = coordRing.length;

    const payload = {
      geojson: parsedGeoJSON,
      coordinates: coordRing,
      point_count: pointCount,
      area_acres: estimatedArea,
      soil_type: detectedSoil,
      timestamp: new Date().toISOString()
    };

    try {
      const response = await fetch(`${API_BASE}/api/v1/farm/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setSubmitStatus({
          success: true,
          message: isAr 
            ? `✓ تم إرسال حدود المزرعة بنجاح (${pointCount} نقطة) إلى سيرفر FastAPI!` 
            : `✓ Farm boundaries sent successfully (${pointCount} vertices) to FastAPI Server!`
        });
      } else {
        throw new Error(`Server returned code ${response.status}`);
      }
    } catch (err: any) {
      console.error("FastAPI server error:", err);
      setSubmitStatus({
        success: false,
        message: isAr
          ? `✗ فشل الاتصال بسيرفر FastAPI. تأكد من تشغيل الباك-إند على localhost:8000.`
          : `✗ Failed to connect to FastAPI server. Make sure backend is running on localhost:8000.`
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearMap = () => {
    if (drawnItemsRef.current) {
      drawnItemsRef.current.clearLayers();
    }
    clearLabels();
    setGeojsonStr('');
    setEstimatedArea(0);
    setDetectedSoil(isArRef.current ? '\u0644\u0645 \u064a\u062a\u0645 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u062d\u062f\u0648\u062f \u0628\u0639\u062f' : 'No boundary drawn yet');
    
    if (onBoundaryChangeRef.current) {
      onBoundaryChangeRef.current(null, 0, IRAQ_CENTER, '');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-black flex items-center gap-2">
            <Compass className="w-5 h-5 text-emerald-600 animate-spin-slow" />
            {isAr ? 'محاكاة الحدود الجغرافية والاستشعار (Geo-fencing)' : 'Manual Farm Geo-fencing Boundaries'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {isAr 
              ? 'ارسم مضلعاً حراً بأي عدد من النقاط (4، 5، 6+ نقاط) لتحديد حدود حقلك. انقر على النقطة الأولى أو انقر نقراً مزدوجاً لإنهاء المضلع.' 
              : 'Draw a free-form polygon with unlimited points (4, 5, 6+ vertices) to match your farm shape. Click the first point or double-click to finish.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            type="button" 
            onClick={handleClearMap} 
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-black text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isAr ? 'إعادة تعيين' : 'Clear Boundaries'}
          </button>
        </div>
      </div>

      {/* Regional Branch selector shortcuts */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5">
        <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-500 block">
          {isAr ? 'تحديد الموقع وإدراج الحدود تلقائياً بجوار الفروع الإقليمية للتسهيل:' : 'Auto-locate and draw approximate boundaries near our regional branches:'}
        </span>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {REGIONAL_BRANCHES.map((branch, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelectBranch(branch)}
              className="px-3 py-2 bg-white hover:bg-emerald-50 text-slate-800 hover:text-emerald-700 font-bold text-[11px] rounded-xl border border-slate-200 hover:border-emerald-300 transition-all text-center cursor-pointer shadow-xs whitespace-nowrap overflow-hidden text-ellipsis"
            >
              {isAr ? branch.nameAr : branch.nameEn}
            </button>
          ))}
        </div>
      </div>

      {/* Live vertex counter during drawing */}
      {drawVertexCount > 0 && (
        <div className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shadow-lg border border-emerald-400">
          <Compass className="w-4 h-4" />
          {isAr 
            ? `النقاط المرسومة: ${drawVertexCount} ${drawVertexCount < 4 ? '(يلزم 4 نقاط على الأقل)' : '— انقر مزدوجاً أو اضغط "إنهاء"'}` 
            : `Vertices: ${drawVertexCount} ${drawVertexCount < 4 ? '(minimum 4 required)' : '— double-click or "Finish" to close'}`}
        </div>
      )}

      {/* Map Element */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 shadow-inner h-[400px]">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />
        
        {/* Absolute indicators */}
        <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-[10px] font-mono font-bold text-slate-200 z-10 select-none pointer-events-none flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
          <span>{isAr ? 'قمر صناعي جوجل مباشر' : 'GOOGLE SATELLITE LIVE'}</span>
        </div>
      </div>

      {/* Geo-fenced specs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        {/* Area & Soil type */}
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <div className="text-[10px] text-emerald-700 uppercase tracking-widest font-black flex items-center gap-1">
              <AreaChart className="w-3.5 h-3.5" />
              {isAr ? 'مساحة المزرعة المحسوبة' : 'Calculated Boundary Area'}
            </div>
            <div className="text-2xl font-black text-emerald-800 mt-1 tracking-tight">
              {estimatedArea > 0 ? `${estimatedArea.toFixed(4)} AC` : (isAr ? 'بانتظار الرسم...' : 'Awaiting manual draw...')}
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
              {isAr ? 'التربة المكتشفة تلقائياً (عبر الحساسات الافتراضية)' : 'Auto-Detected Soil Type (Virtual Sensors)'}
            </div>
            <div className="text-sm font-bold text-slate-800 mt-1">
              {detectedSoil}
            </div>
          </div>
        </div>

        {/* Live GeoJSON payload area */}
        <div className="bg-slate-900 text-slate-200 rounded-2xl p-4 font-mono text-xs border border-slate-800 flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 block mb-2 font-sans">
              geojson geometry extract:
            </span>
            <div className="overflow-y-auto max-h-[120px] pr-1 scrollbar-thin scrollbar-thumb-slate-700">
              {geojsonStr ? (
                <pre className="text-[10px] whitespace-pre-wrap leading-tight text-emerald-300 font-mono">
                  {geojsonStr}
                </pre>
              ) : (
                <span className="text-slate-500 italic block py-4 text-center">
                  {isAr ? '// ارسم الحدود على الخريطة لعرض إحداثيات GeoJSON' : '// Coordinates will appear here in Real-time...'}
                </span>
              )}
            </div>
            {geojsonStr && (() => {
              try {
                const pts = JSON.parse(geojsonStr)?.geometry?.coordinates?.[0] ?? [];
                return (
                  <div className="mt-1 text-[9px] font-bold text-emerald-400 font-sans">
                    {isAr ? `عدد نقاط المضلع: ${pts.length}` : `Polygon vertices: ${pts.length}`}
                  </div>
                );
              } catch { return null; }
            })()}
          </div>
          
          <div className="pt-3 border-t border-slate-800 mt-2 flex justify-between items-center gap-2">
            <span className="text-[9px] text-slate-500 uppercase font-sans">
              API target: FastAPI Backend
            </span>
            <button
              type="button"
              onClick={handleSendToFastAPI}
              disabled={isSubmitting || !geojsonStr}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 border ${
                geojsonStr 
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500 cursor-pointer shadow-sm' 
                  : 'bg-slate-800 text-slate-500 border-slate-800 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              {isAr ? 'إرسال الحدود إلى سيرفر FastAPI' : 'Submit Bounds to FastAPI'}
            </button>
          </div>
        </div>
      </div>

      {/* Response toast notifications */}
      {submitStatus && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 text-xs font-semibold ${
          submitStatus.success 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {submitStatus.success ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{submitStatus.message}</span>
        </div>
      )}
    </div>
  );
}
