import {
  FlaskConical,
  BrainCircuit,
  Droplets,
  Zap,
  Activity,
  Wifi,
  WifiOff,
  Battery,
  Satellite,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import type { PhysicalSensor, VirtualNode } from '../types';

interface HybridTelemetryPanelProps {
  isAr: boolean;
  physicalSensors: PhysicalSensor[];
  virtualNodes: VirtualNode[];
  soilType?: string;
  lastSyncAt?: string | null;
  onSync?: () => void;
  isSyncing?: boolean;
  dataStatus?: {
    sensorsSource: 'mqtt' | 'rest' | 'unavailable';
    satelliteSource: 'live' | 'cached' | 'unavailable';
  };
}

/**
 * HybridTelemetryPanel — Dual-input sensor grid.
 * Clearly distinguishes Physical IoT ground truth (Moisture + Salinity)
 * from Virtual/AI computed metrics (NPK from Sentinel-2).
 */
export function HybridTelemetryPanel({
  isAr,
  physicalSensors,
  virtualNodes,
  soilType,
  lastSyncAt,
  onSync,
  isSyncing,
  dataStatus,
}: HybridTelemetryPanelProps) {
  const hasPhysicalSensors = physicalSensors.length > 0;
  const hasVirtualNodes = virtualNodes.length > 0;

  // Aggregate physical sensor data by zone
  const physicalByZone: Record<number, { moisture?: number; salinity?: number; battery?: number; status: string; lastSeen?: string }> = {};
  for (const s of physicalSensors) {
    if (!physicalByZone[s.zoneId]) physicalByZone[s.zoneId] = { status: s.status };
    if (s.type === 'soil_moisture') physicalByZone[s.zoneId].moisture = s.lastValue;
    if (s.type === 'soil_ec') physicalByZone[s.zoneId].salinity = s.lastValue;
    if (s.battery !== undefined) physicalByZone[s.zoneId].battery = s.battery;
    physicalByZone[s.zoneId].status = s.status;
    physicalByZone[s.zoneId].lastSeen = s.lastSeen;
  }

  return (
    <div className="space-y-6">
      {/* ===== SECTION HEADER ===== */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-5 rounded-3xl border border-slate-700 shadow-2xl text-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-black uppercase tracking-widest">
              {isAr ? 'محرك الاستشعار الهجين' : 'Hybrid Sensing Engine'}
            </h2>
          </div>
          <div className="flex gap-2">
            {hasPhysicalSensors && (
              <span className="text-[9px] font-bold bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 px-2.5 py-1 rounded-lg uppercase flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                {isAr ? 'IoT فعلي' : 'IoT Ground Truth'}
              </span>
            )}
            {hasVirtualNodes && (
              <span className="text-[9px] font-bold bg-indigo-950/60 border border-indigo-800/50 text-indigo-400 px-2.5 py-1 rounded-lg uppercase flex items-center gap-1">
                <Satellite className="w-3 h-3" />
                {isAr ? 'استشعار افتراضي' : 'Virtual / AI'}
              </span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-slate-400 font-medium">
          {isAr
            ? 'بيانات IoT الفعلية (رطوبة + ملوحة) هي الحقيقة الأرضية. قيم NPK والمؤشرات المحسوبة مستمدة من تحليل الأقمار الصناعية Sentinel-2 ونماذج الذكاء الاصطناعي.'
            : 'Physical IoT data (Moisture + Salinity) is ground truth. NPK and computed metrics are derived from Sentinel-2 satellite analytics and AI models.'}
        </p>
      </div>

      {/* ===== PHYSICAL IOT GROUND TRUTH PANEL ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-black">
            <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
            {isAr ? 'حساسات IoT الفعلية (الحقيقة الأرضية)' : 'Physical IoT Sensors (Ground Truth)'}
          </h3>
          <div className="flex items-center gap-1.5">
            {dataStatus?.sensorsSource === 'mqtt' ? (
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md uppercase flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                MQTT LIVE
              </span>
            ) : dataStatus?.sensorsSource === 'rest' ? (
              <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md uppercase">REST API</span>
            ) : (
              <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md uppercase">
                {isAr ? 'لا مجسات متصلة' : 'No Sensors Connected'}
              </span>
            )}
          </div>
        </div>

        <p className="text-[11px] text-slate-500 mb-5">
          {isAr
            ? 'قراءات مباشرة من مجسات IoT ميدانية فعلية: رطوبة التربة (%) والملوحة الكهربائية (EC). هذه هي الحقيقة الأرضية المؤكدة.'
            : 'Live readings from deployed field IoT hardware: Soil Moisture (%) and Electrical Conductivity (EC). This is confirmed ground truth.'}
        </p>

        {!hasPhysicalSensors ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-1.5 animate-pulse">
                <div className="flex justify-between items-center text-xs">
                  <div className="h-3 w-28 bg-slate-200 rounded-full" />
                  <div className="h-3 w-14 bg-slate-200 rounded-full" />
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full" />
              </div>
            ))}
            <div className="text-center space-y-3 pt-2">
              <p className="text-[10px] text-slate-400 italic">
                {isAr
                  ? 'لم تُجرَ عملية مزامنة مع مجسات IoT بعد. اتصل بمجسات MQTT أو REST للحصول على قراءات حقيقية.'
                  : 'No IoT sensor sync has run yet. Connect via MQTT or REST to receive real readings.'}
              </p>
              {onSync && (
                <button
                  onClick={onSync}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-xl transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isAr ? 'تشغيل المزامنة' : 'Run Sync'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(physicalByZone).map(([zoneId, data]) => (
              <div key={zoneId} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-700 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${data.status === 'online' ? 'bg-emerald-500 animate-pulse' : data.status === 'stale' ? 'bg-amber-500' : 'bg-red-500'}`} />
                    {isAr ? `المنطقة ${zoneId}` : `Zone ${zoneId}`}
                  </span>
                  <div className="flex items-center gap-2 text-[9px] text-slate-400">
                    {data.battery !== undefined && (
                      <span className="flex items-center gap-1">
                        <Battery className="w-3 h-3" />
                        {data.battery}%
                      </span>
                    )}
                    {data.lastSeen && (
                      <span className="font-mono">{data.lastSeen}</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {data.moisture !== undefined && (
                    <div className="flex items-center justify-between text-[11px] bg-white p-2.5 rounded-lg border border-slate-100">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Droplets className="w-3 h-3 text-blue-400" />
                        {isAr ? 'رطوبة' : 'Moisture'}
                      </span>
                      <strong className="font-mono font-black text-slate-800">{data.moisture.toFixed(1)}%</strong>
                    </div>
                  )}
                  {data.salinity !== undefined && (
                    <div className="flex items-center justify-between text-[11px] bg-white p-2.5 rounded-lg border border-slate-100">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-yellow-500" />
                        {isAr ? 'ملوحة' : 'Salinity'}
                      </span>
                      <strong className="font-mono font-black text-slate-800">{data.salinity.toFixed(2)} dS/m</strong>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== VIRTUAL SENSING ENGINE (AI / Sentinel-2) ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-black">
            <FlaskConical className="w-4 h-4 text-indigo-600 shrink-0" />
            {isAr ? 'محرك الاستشعار الافتراضي (AI / Sentinel-2)' : 'Virtual Sensing Engine (AI / Sentinel-2)'}
          </h3>
          <div className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold uppercase tracking-tight flex items-center gap-1">
            <BrainCircuit className="w-3 h-3" />
            {soilType || (isAr ? 'لا نوع تربة محدد' : 'No Soil Type')}
          </div>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl mb-5">
          <p className="text-[10px] text-amber-800 font-bold flex items-start gap-1.5">
            <Satellite className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {isAr
              ? 'جميع القيم التالية مُقدَّرة من خوارزميات الذكاء الاصطناعي وتحليل طيف الأقمار الصناعية Sentinel-2. هذه ليست قراءات أجهزة فعلية.'
              : 'All values below are estimated by AI algorithms and Sentinel-2 satellite spectral analysis. These are NOT physical hardware readings.'}
          </p>
        </div>

        {!hasVirtualNodes ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5 animate-pulse">
                <div className="flex justify-between items-center text-xs">
                  <div className="h-3 w-28 bg-slate-200 rounded-full" />
                  <div className="h-3 w-14 bg-slate-200 rounded-full" />
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full" />
              </div>
            ))}
            <p className="text-[10px] text-slate-400 text-center pt-2 italic">
              {isAr
                ? 'لا توجد بيانات أقمار صناعية بعد. حدد حدود المزرعة وانتظر مزامنة Sentinel-2.'
                : 'No satellite data available yet. Define farm boundary and await Sentinel-2 sync.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {virtualNodes.map((node) => (
              <div key={node.zoneId} className="p-4 bg-indigo-50/30 border border-indigo-100 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-indigo-800">
                    {isAr ? node.zoneNameAr : node.zoneNameEn}
                  </span>
                  <div className="flex items-center gap-2 text-[9px] text-indigo-400">
                    <span className="font-bold">{node.confidence}% {isAr ? 'ثقة' : 'conf'}</span>
                    <span className="font-mono">{node.source === 'sentinel2' ? 'S2' : 'AI'}</span>
                  </div>
                </div>

                {/* NPK Progress Bars */}
                {[
                  { label: isAr ? 'نيتروجين (N)' : 'Nitrogen (N)', value: node.estimatedN, color: 'bg-emerald-600' },
                  { label: isAr ? 'فوسفور (P)' : 'Phosphorus (P)', value: node.estimatedP, color: 'bg-indigo-600' },
                  { label: isAr ? 'بوتاسيوم (K)' : 'Potassium (K)', value: node.estimatedK, color: 'bg-amber-500' },
                  { label: isAr ? 'رطوبة مُقدَّرة' : 'Est. Moisture', value: node.estimatedMoisture, color: 'bg-blue-500' },
                ].map((metric, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-slate-600">{metric.label}</span>
                      <strong className="font-mono font-black text-slate-800">{metric.value.toFixed(1)}%</strong>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${metric.color} rounded-full transition-all duration-1000`}
                        style={{ width: `${Math.min(100, metric.value)}%` }}
                      />
                    </div>
                  </div>
                ))}

                {node.ndvi !== undefined && (
                  <div className="flex items-center justify-between text-[10px] pt-1">
                    <span className="text-slate-500">NDVI</span>
                    <span className={`font-mono font-black ${node.ndvi >= 0.4 ? 'text-emerald-600' : node.ndvi >= 0.2 ? 'text-amber-600' : 'text-red-600'}`}>
                      {node.ndvi.toFixed(3)}
                    </span>
                  </div>
                )}
                <div className="text-[9px] text-slate-400 font-mono text-right pt-1">
                  {isAr ? 'معالجة' : 'Processed'}: {node.processedAt}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data lineage footer */}
      <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 flex items-center justify-between text-[9px] text-slate-400 font-mono">
        <span>
          {isAr ? 'المصدر' : 'Source'}: {dataStatus?.sensorsSource === 'mqtt' ? 'MQTT IoT' : dataStatus?.sensorsSource === 'rest' ? 'REST API' : isAr ? 'غير متصل' : 'Not Connected'}
          {dataStatus?.satelliteSource === 'live' ? ' + Sentinel-2' : dataStatus?.satelliteSource === 'cached' ? ' + S2 (cached)' : ''}
        </span>
        <span>
          {isAr ? 'آخر مزامنة' : 'Last sync'}:{' '}
          {lastSyncAt
            ? new Date(lastSyncAt).toLocaleString(isAr ? 'ar-IQ' : 'en-US', { hour: '2-digit', minute: '2-digit' })
            : '--'}
        </span>
      </div>
    </div>
  );
}
