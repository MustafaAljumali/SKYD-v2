/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { 
  Download, 
  TrendingUp, 
  Thermometer, 
  Droplets, 
  Activity, 
  Sparkles,
  Calendar,
  Layers
} from 'lucide-react';

interface HistoryRecord {
  id: string;
  temp: number;
  humidity: number;
  wind: number;
  solar: number;
  soilMoisture: number;
  soilPH: number;
  nitrogen?: number;
  phosphorus?: number;
  potassium?: number;
  ec?: number;
  tick?: number;
  hour?: number;
  day?: number;
  createdAt: Date;
}

interface AnalyticsChartsProps {
  isAr: boolean;
  history: HistoryRecord[];
}

type MetricType = 'temp' | 'soilMoisture' | 'humidity' | 'nutrients';

export function AnalyticsCharts({ isAr, history }: AnalyticsChartsProps) {
  const [activeMetric, setActiveMetric] = useState<MetricType>('soilMoisture');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // If empty or loading, show placeholder data
  const data = history.length > 0 ? history : [];

  // Function to export currently displayed history to CSV
  const handleExportCSV = () => {
    if (data.length === 0) {
      alert(isAr ? 'لا توجد بيانات متاحة للتصدير حالياً.' : 'No data available for export right now.');
      return;
    }

    // Header values
    const headers = isAr 
      ? ['السجل', 'تاريخ القياس', 'درجة الحرارة (C)', 'الرطوبة (%)', 'سرعة الرياح (كم/س)', 'رطوبة التربة (%)', 'الحموضة (pH)', 'النيتروجين (N)', 'الفوسفور (P)', 'البوتاسيوم (K)', 'الموصلية الكهربائية (EC)']
      : ['Record ID', 'Timestamp', 'Temp (C)', 'Humidity (%)', 'Wind (km/h)', 'Soil Moisture (%)', 'Soil pH', 'Nitrogen (N)', 'Phosphorus (P)', 'Potassium (K)', 'EC'];

    // Map rows
    const rows = data.map((item, idx) => [
      item.id || `rec_${idx}`,
      item.createdAt instanceof Date ? item.createdAt.toLocaleString(isAr ? 'ar-IQ' : 'en-US') : String(item.createdAt),
      item.temp?.toFixed(1) ?? '0.0',
      item.humidity?.toFixed(0) ?? '0',
      item.wind?.toFixed(1) ?? '0.0',
      item.soilMoisture?.toFixed(1) ?? '0.0',
      item.soilPH?.toFixed(1) ?? '0.0',
      (item.nitrogen ?? 0).toFixed(0),
      (item.phosphorus ?? 0).toFixed(0),
      (item.potassium ?? 0).toFixed(0),
      (item.ec ?? 0).toFixed(1)
    ]);

    // Build CSV contents (with BOM for Excel Arabic layout alignment compatibility)
    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `skyd_farm_analytics_report_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (data.length < 2) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-4">
        <Activity className="w-12 h-12 text-slate-300 mx-auto animate-pulse" />
        <h4 className="text-sm font-black text-slate-800">
          {isAr ? 'جمع القراءات لتنشيط الرسوم البيانية' : 'Gathering Data for Visual Analytics'}
        </h4>
        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
          {isAr 
            ? 'بانتظار مزيد من السجلات الزمنية. ستظهر الرسوم البيانية بمجرد تشغيل دورات الري أو تقدم خطى الوقت.' 
            : 'Awaiting consecutive historical data snapshots to build dynamic line path vectors.'}
        </p>
      </div>
    );
  }

  // Find mins and maxes to scale SVG plotting correctly
  let minVal = 0;
  let maxVal = 100;

  if (activeMetric === 'temp') {
    const temps = data.map(d => d.temp);
    minVal = Math.floor(Math.min(...temps) - 2);
    maxVal = Math.ceil(Math.max(...temps) + 2);
  } else if (activeMetric === 'soilMoisture' || activeMetric === 'humidity') {
    const values = data.map(d => activeMetric === 'soilMoisture' ? d.soilMoisture : d.humidity);
    minVal = Math.max(0, Math.floor(Math.min(...values) - 5));
    maxVal = Math.min(100, Math.ceil(Math.max(...values) + 5));
  } else if (activeMetric === 'nutrients') {
    minVal = 0;
    maxVal = 100; // Nitrogen, Phosphorus, Potassium percentages
  }

  if (maxVal === minVal) {
    maxVal += 10;
    minVal -= 10;
  }

  // Dimensions of SVG canvas
  const width = 600;
  const height = 240;
  const paddingX = 40;
  const paddingY = 30;

  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  // Map coordinate helpers
  const getX = (index: number) => {
    return paddingX + (index * chartWidth) / (data.length - 1);
  };

  const getY = (val: number) => {
    const ratio = (val - minVal) / (maxVal - minVal);
    return paddingY + chartHeight * (1 - ratio);
  };

  // SVG lines coordinates generator helper
  const pointsList = (metricKey: 'temp' | 'soilMoisture' | 'humidity' | 'nitrogen' | 'phosphorus' | 'potassium') => {
    return data.map((d, i) => {
      let val = 0;
      if (metricKey === 'temp') val = d.temp;
      else if (metricKey === 'soilMoisture') val = d.soilMoisture;
      else if (metricKey === 'humidity') val = d.humidity;
      else if (metricKey === 'nitrogen') val = d.nitrogen ?? 0;
      else if (metricKey === 'phosphorus') val = d.phosphorus ?? 0;
      else if (metricKey === 'potassium') val = d.potassium ?? 0;
      return { x: getX(i), y: getY(val) };
    });
  };

  const buildPath = (pts: { x: number; y: number }[]) => {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  };

  const buildAreaPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    const pathStr = buildPath(pts);
    return `${pathStr} L ${pts[pts.length - 1].x.toFixed(1)} ${(height - paddingY).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(height - paddingY).toFixed(1)} Z`;
  };

  // Primary active targets
  const mainPoints = activeMetric === 'nutrients' 
    ? pointsList('nitrogen') 
    : pointsList(activeMetric as any);

  // Secondary sub-nutrient points
  const pPoints = activeMetric === 'nutrients' ? pointsList('phosphorus') : [];
  const kPoints = activeMetric === 'nutrients' ? pointsList('potassium') : [];

  const activeRecord = hoveredIndex !== null ? data[hoveredIndex] : null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-black shadow-xs font-sans">
      
      {/* Top Header Row with Export Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider text-black">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            {isAr ? 'التحليلات البيانية والاتجاهات الزمنية المعمقة' : 'Dynamic Land Analytics & Vector Trends'}
          </h3>
          <p className="text-[11px] text-slate-500 block mt-0.5">
            {isAr 
              ? 'مراقبة زمنية دقيقة لنسب الرطوبة والمغذيات العضوية والحرارة في حقل المزرعة.' 
              : 'Detailed chronological metrics and sensor profiles synced instantly with remote satellite indicators.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className="px-4 py-2 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 text-[11px] font-bold rounded-lg border border-slate-200 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shadow-xs"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          {isAr ? 'تصدير التقرير كملف CSV' : 'Export Datalogs (.CSV)'}
        </button>
      </div>

      {/* Metric selection bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {[
          { id: 'soilMoisture', labelAr: '💧 رطوبة الأرض', labelEn: '💧 Ground Moisture', color: 'border-blue-500 text-blue-600 bg-blue-50/20' },
          { id: 'temp', labelAr: '🌡️ درجة الحرارة', labelEn: '🌡️ Atmosphere Temp', color: 'border-orange-500 text-orange-600 bg-orange-50/20' },
          { id: 'humidity', labelAr: '☁️ رطوبة الجو', labelEn: '☁️ Gas Humidity', color: 'border-teal-500 text-teal-600 bg-teal-50/20' },
          { id: 'nutrients', labelAr: '🧪 مغذيات التربة (NPK)', labelEn: '🧪 Nutrients Index (NPK)', color: 'border-emerald-500 text-emerald-600 bg-emerald-50/20' },
        ].map((btn) => (
          <button
            key={btn.id}
            onClick={() => {
              setActiveMetric(btn.id as MetricType);
              setHoveredIndex(null);
            }}
            className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              activeMetric === btn.id 
                ? `${btn.color} border-2 scale-[1.02]` 
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
            }`}
          >
            {isAr ? btn.labelAr : btn.labelEn}
          </button>
        ))}
      </div>

      {/* SVG Vector Chart Container */}
      <div className="relative w-full overflow-hidden bg-slate-50/40 rounded-xl p-4 border border-slate-150">
        
        {/* Dynamic Tooltip overlay */}
        {hoveredIndex !== null && activeRecord && (
          <div className="absolute top-4 left-4 right-4 bg-white/95 backdrop-blur-xs text-xs p-3 rounded-xl border border-slate-200/80 shadow-md flex justify-between items-center gap-4 z-10 animate-fade-in text-black">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-bold text-slate-600">
                {isAr ? 'تاريخ السجل:' : 'Time:'}{' '}
                <strong className="text-black font-semibold">
                  {new Date(activeRecord.createdAt).toLocaleTimeString(isAr ? 'ar-IQ' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono font-extrabold text-sm text-[13px]">
              {activeMetric === 'soilMoisture' && (
                <span className="text-blue-600">
                  {isAr ? 'رطوبة الأرض:' : 'Moisture:'} {activeRecord.soilMoisture.toFixed(1)}%
                </span>
              )}
              {activeMetric === 'temp' && (
                <span className="text-orange-600">
                  {isAr ? 'الحرارة:' : 'Temp:'} {activeRecord.temp.toFixed(1)}°C
                </span>
              )}
              {activeMetric === 'humidity' && (
                <span className="text-teal-600">
                  {isAr ? 'الرطوبة:' : 'Air Hum:'} {activeRecord.humidity.toFixed(0)}%
                </span>
              )}
              {activeMetric === 'nutrients' && (
                <div className="flex gap-3 text-[11px] font-sans font-bold">
                  <span className="text-emerald-700">N: {(activeRecord.nitrogen ?? 0).toFixed(0)}%</span>
                  <span className="text-indigo-700">P: {(activeRecord.phosphorus ?? 0).toFixed(0)}%</span>
                  <span className="text-amber-600">K: {(activeRecord.potassium ?? 0).toFixed(0)}%</span>
                  <span className="text-slate-600">EC: {(activeRecord.ec ?? 0).toFixed(1)} dS/m</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scaled Responsive SVG viewport viewbox */}
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none max-h-72">
          <defs>
            {/* Gradients */}
            <linearGradient id="blueAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="orangeAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="tealAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="emeraldAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid Lines */}
          {Array.from({ length: 5 }).map((_, i) => {
            const hVal = minVal + (i * (maxVal - minVal)) / 4;
            const y = getY(hVal);
            return (
              <g key={i}>
                <line 
                  x1={paddingX} 
                  y1={y} 
                  x2={width - paddingX} 
                  y2={y} 
                  stroke="#e2e8f0" 
                  strokeWidth="1" 
                  strokeDasharray="4 6" 
                />
                <text 
                  x={isAr ? width - paddingX + 8 : paddingX - 8} 
                  y={y + 4} 
                  fontSize="8" 
                  fontWeight="bold"
                  fill="#94a3b8" 
                  textAnchor={isAr ? "start" : "end"}
                  className="font-mono"
                >
                  {hVal.toFixed(0)}
                  {activeMetric === 'temp' ? '°' : activeMetric === 'nutrients' ? '%' : ''}
                </text>
              </g>
            );
          })}

          {/* Horizontal Timestamps Axis Labels */}
          {data.map((d, i) => {
            if (i % 2 !== 0 && data.length > 6) return null; // Avoid timeline cluttering
            const x = getX(i);
            const timeStr = d.createdAt instanceof Date 
              ? d.createdAt.toLocaleTimeString(isAr ? 'ar-IQ' : 'en-US', { hour: '2-digit', minute: '2-digit' })
              : '';
            return (
              <text 
                key={i} 
                x={x} 
                y={height - paddingY + 16} 
                fontSize="8" 
                fontWeight="extrabold"
                fill="#64748b" 
                textAnchor="middle"
                className="font-mono"
              >
                {timeStr}
              </text>
            );
          })}

          {/* Vector Area Shades */}
          {activeMetric === 'soilMoisture' && (
            <path d={buildAreaPath(mainPoints)} fill="url(#blueAreaGrad)" />
          )}
          {activeMetric === 'temp' && (
            <path d={buildAreaPath(mainPoints)} fill="url(#orangeAreaGrad)" />
          )}
          {activeMetric === 'humidity' && (
            <path d={buildAreaPath(mainPoints)} fill="url(#tealAreaGrad)" />
          )}
          {activeMetric === 'nutrients' && (
            <path d={buildAreaPath(mainPoints)} fill="url(#emeraldAreaGrad)" />
          )}

          {/* Core Vector Lines */}
          {activeMetric === 'soilMoisture' && (
            <path d={buildPath(mainPoints)} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {activeMetric === 'temp' && (
            <path d={buildPath(mainPoints)} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {activeMetric === 'humidity' && (
            <path d={buildPath(mainPoints)} fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* NPK Multilines representing primary nutrients in parallel */}
          {activeMetric === 'nutrients' && (
            <>
              {/* Nitrogen line (N) */}
              <path d={buildPath(mainPoints)} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* Phosphorus line (P) */}
              <path d={buildPath(pPoints)} fill="none" stroke="#6366f1" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" />
              {/* Potassium line (K) */}
              <path d={buildPath(kPoints)} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Hover interactive coordinate trackers */}
          {hoveredIndex !== null && (
            <line 
              x1={getX(hoveredIndex)} 
              y1={paddingY} 
              x2={getX(hoveredIndex)} 
              y2={height - paddingY} 
              stroke="#64748b" 
              strokeWidth="1.5" 
            />
          )}

          {/* Interactive Mouse Capture Points */}
          {data.map((d, i) => {
            const x = getX(i);
            const mainY = mainPoints[i]?.y || 0;
            return (
              <g 
                key={i}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer"
              >
                {/* Invisible wide vertical hitbar */}
                <rect 
                  x={x - (chartWidth / (data.length - 1)) / 2} 
                  y={paddingY} 
                  width={chartWidth / (data.length - 1)} 
                  height={chartHeight} 
                  fill="transparent" 
                />
                
                {/* Anchored Circular markers */}
                {(hoveredIndex === i || data.length < 15) && (
                  <circle 
                    cx={x} 
                    cy={mainY} 
                    r={hoveredIndex === i ? 5 : 3.5} 
                    fill={activeMetric === 'soilMoisture' ? '#3b82f6' : activeMetric === 'temp' ? '#f97316' : activeMetric === 'humidity' ? '#14b8a6' : '#10b981'} 
                    stroke="white" 
                    strokeWidth="1.5" 
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Dynamic legend showing metric averages and details */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
        {[
          { label: isAr ? 'أعلى قيمة مُسجّلة' : 'Recorded Peak', value: `${activeMetric === 'nutrients' ? Math.max(...data.map(e => e.nitrogen ?? 0)).toFixed(0) : Math.max(...data.map(e => (e as any)[activeMetric])).toFixed(1)}${activeMetric === 'temp' ? '°C' : activeMetric === 'nutrients' ? '% N' : '%'}`, desc: isAr ? 'المستوى الأقصى' : 'Peak limit reached' },
          { label: isAr ? 'أدنى قيمة مُسجّلة' : 'Recorded Bottom', value: `${activeMetric === 'nutrients' ? Math.min(...data.map(e => e.nitrogen ?? 0)).toFixed(0) : Math.min(...data.map(e => (e as any)[activeMetric])).toFixed(1)}${activeMetric === 'temp' ? '°C' : activeMetric === 'nutrients' ? '% N' : '%'}`, desc: isAr ? 'المستوى الأدنى' : 'Standard low cycle' },
          { label: isAr ? 'المعدّل الحسابي العام' : 'Average Baseline', value: `${activeMetric === 'nutrients' ? (data.reduce((acc, z) => acc + (z.nitrogen ?? 0), 0) / data.length).toFixed(0) : (data.reduce((acc, z) => acc + (z as any)[activeMetric], 0) / data.length).toFixed(1)}${activeMetric === 'temp' ? '°C' : activeMetric === 'nutrients' ? '% N' : '%'}`, desc: isAr ? 'متوسط الفوج الحالي' : 'Mean ambient value' },
          { label: isAr ? 'سلامة الاتصال التاريخي' : 'Storage Integrity', value: '100%', desc: isAr ? 'قنوات اتصال مشفرة' : 'Encrypted telemetry' }
        ].map((item, index) => (
          <div key={index} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wide">{item.label}</span>
            <strong className="text-lg font-black text-slate-800 mt-1 font-mono">{item.value}</strong>
            <span className="text-[9px] text-slate-400 font-medium block mt-1">{item.desc}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
