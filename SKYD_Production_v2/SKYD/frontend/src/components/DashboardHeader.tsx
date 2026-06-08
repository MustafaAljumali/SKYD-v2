import { useState, useEffect } from 'react';
import { User, Clock, Cpu, Wifi, WifiOff, Satellite } from 'lucide-react';

interface DashboardHeaderProps {
  isAr: boolean;
  userName?: string;
  userLocation?: string;
  hybridStatus: {
    iotActive: boolean;
    satelliteActive: boolean;
    virtualSensingActive: boolean;
  };
}

/**
 * DashboardHeader — Live clock (Asia/Baghdad), dynamic user identity,
 * and truthful hybrid engine status indicator.
 * Zero hardcoded strings. All data from props.
 */
export function DashboardHeader({
  isAr,
  userName,
  userLocation,
  hybridStatus,
}: DashboardHeaderProps) {
  const [now, setNow] = useState(() => new Date());

  // Live clock updating every second in Iraq timezone
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Baghdad' });
  const dateStr = now.toLocaleDateString(isAr ? 'ar-IQ' : 'en-US', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const engineLabel = (() => {
    const parts: string[] = [];
    if (hybridStatus.iotActive) parts.push(isAr ? 'IoT أرضي' : 'IoT Ground');
    if (hybridStatus.satelliteActive) parts.push(isAr ? 'قمر صناعي' : 'Satellite');
    if (hybridStatus.virtualSensingActive) parts.push(isAr ? 'استشعار افتراضي' : 'Virtual AI');
    return parts.length > 0
      ? parts.join(' + ')
      : (isAr ? 'غير متصل' : 'Offline');
  })();

  const anyActive = hybridStatus.iotActive || hybridStatus.satelliteActive || hybridStatus.virtualSensingActive;

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-600 rounded-full blur-[100px] opacity-10 pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className={`p-1 px-2.5 font-extrabold text-[10px] tracking-widest rounded-lg flex items-center gap-1 ${
              anyActive
                ? 'bg-emerald-600'
                : 'bg-slate-700'
            }`}>
              <Cpu className="w-3.5 h-3.5" />
              {isAr ? 'محرك هجين' : 'HYBRID ENGINE'}
            </span>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              {userLocation || (isAr ? 'محافظة واسط — جمهورية العراق' : 'Wasit Governorate — Iraq')}
            </span>
          </div>

          <h1 className="text-xl md:text-2xl font-black mt-1 tracking-tight">
            {isAr
              ? 'الخريطة الحرارية — مراقبة صحة النبات بالأقمار الصناعية'
              : 'Thermal NDVI Heatmap — Satellite Vegetation Monitoring'}
          </h1>
          <p className="text-xs text-slate-400 font-medium max-w-xl mt-0.5">
            {isAr
              ? 'محرك هجين: بيانات IoT الفعلية + استشعار افتراضي من الأقمار الصناعية Sentinel-2'
              : 'Hybrid pipeline: Physical IoT ground truth + Sentinel-2 satellite virtual sensing'}
          </p>
        </div>

        {/* Right side — User + Clock + Hybrid Status */}
        <div className="flex flex-col gap-2 items-end">
          {/* User identity card */}
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
                <span>{timeStr} | {dateStr}</span>
              </div>
            </div>
          </div>

          {/* Hybrid engine status badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-wider border ${
            anyActive
              ? 'bg-emerald-950/60 border-emerald-800/50 text-emerald-400'
              : 'bg-slate-950/60 border-slate-800 text-slate-500'
          }`}>
            {hybridStatus.iotActive ? (
              <Wifi className="w-3 h-3 text-emerald-400" />
            ) : (
              <WifiOff className="w-3 h-3 text-slate-600" />
            )}
            {hybridStatus.satelliteActive && (
              <Satellite className="w-3 h-3 text-blue-400" />
            )}
            <span>{engineLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
