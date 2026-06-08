import type { ComponentType } from 'react';
import { Sun, Wind, Cloud, CloudRain, CloudLightning, Snowflake, Globe, AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import type { DayForecast, WeatherErrorType } from '../services/weatherService';

export type WeatherSource = 'api' | 'no_key' | 'no_boundary' | 'loading' | 'error';

interface WeatherPanelProps {
  isAr: boolean;
  forecast: DayForecast[];
  isWeatherLoading: boolean;
  weatherSource: WeatherSource;
  weatherErrorType?: WeatherErrorType | null;
  weatherDescription?: string | null;
  weatherFetchedAt?: string | null;
  gpsCoords?: { lat: number; lng: number };
  onRetry?: () => void;
}

const WEATHER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  Snowflake,
  Wind,
};

/**
 * WeatherPanel — Live OpenWeatherMap 5-day forecast with dynamic GPS.
 *
 * PRODUCTION RULE: Zero mock fallback.
 * - 'api' → renders real forecast data
 * - 'no_key' → "مفتاح الطقس غير مُهيأ" with configuration link
 * - 'no_boundary' → "حدد حدود المزرعة أولاً" prompt
 * - 'error' → specific error message + retry button
 * - 'loading' → skeleton loader
 */
export function WeatherPanel({
  isAr,
  forecast,
  isWeatherLoading,
  weatherSource,
  weatherErrorType,
  weatherDescription,
  weatherFetchedAt,
  gpsCoords,
  onRetry,
}: WeatherPanelProps) {
  const isLive = weatherSource === 'api' && forecast.length > 0;

  // Map error type to user-facing message
  const getErrorMessage = (): { ar: string; en: string } => {
    switch (weatherErrorType) {
      case 'invalid_key':
        return {
          ar: 'مفتاح OpenWeatherMap API غير صالح. تحقق من الإعدادات.',
          en: 'Invalid OpenWeatherMap API key. Check your settings.',
        };
      case 'rate_limited':
        return {
          ar: 'تم تجاوز الحد الأقصى لطلبات الطقس. حاول بعد 10 دقائق.',
          en: 'Weather API rate limit exceeded. Try again in 10 minutes.',
        };
      case 'network':
        return {
          ar: 'تعذر الاتصال بخدمة الطقس. تحقق من اتصال الإنترنت.',
          en: 'Could not connect to weather service. Check your internet connection.',
        };
      case 'no_data':
        return {
          ar: 'لم تُرجع خدمة الطقس أي بيانات للموقع الحالي.',
          en: 'Weather service returned no data for this location.',
        };
      default:
        return {
          ar: 'فشل تحميل بيانات الطقس. حاول مرة أخرى.',
          en: 'Failed to load weather data. Please try again.',
        };
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-black shadow-xs font-sans">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-5">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-600 shrink-0" />
          <h4 className="text-sm font-bold uppercase tracking-wider text-black">
            {isAr
              ? 'الرادار الفلكي: توقعات الطقس لخمسة أيام القادمة (Satellite Radar GPS)'
              : 'Satellite Weather Forecast Radar (5-Day Outlook)'}
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md uppercase flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          {weatherSource === 'error' && (
            <span className="text-[9px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-md uppercase flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              ERROR
            </span>
          )}
          <span className="text-[9px] font-bold text-slate-400">OWM Integrated Hub</span>
        </div>
      </div>

      {/* GPS Coordinates display */}
      {gpsCoords && (
        <div className="flex items-center gap-2 mb-4 text-[10px] text-slate-400 font-mono">
          <span className="text-emerald-600">GPS:</span>
          <span>{gpsCoords.lat.toFixed(4)}°N, {gpsCoords.lng.toFixed(4)}°E</span>
        </div>
      )}

      {/* Loading skeleton */}
      {(isWeatherLoading || weatherSource === 'loading') ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl animate-pulse space-y-2 text-center">
              <div className="h-3 w-12 bg-slate-200 rounded-full mx-auto" />
              <div className="h-6 w-10 bg-slate-200 rounded-md mx-auto" />
              <div className="h-2 w-16 bg-slate-200 rounded-full mx-auto" />
            </div>
          ))}
        </div>

      ) : forecast.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {forecast.map((fc, i) => {
              const IconComponent = WEATHER_ICONS[fc.icon] ?? Sun;
              return (
                <div key={i} className="p-4 bg-slate-50/60 hover:bg-emerald-50/40 border border-slate-150 rounded-2xl text-center transition-all">
                  <span className="text-[10px] uppercase font-extrabold text-slate-400 block tracking-tight">
                    {fc.dayName}
                  </span>
                  <div className="my-3 flex justify-center text-emerald-600">
                    <IconComponent className="w-8 h-8 text-amber-500" />
                  </div>
                  <strong className="text-xl font-mono font-black text-slate-800">
                    {fc.temp.toFixed(1)}°C
                  </strong>
                  <span className="text-[9px] text-slate-500 font-bold block mt-1 tracking-tight">
                    {isAr ? fc.descAr : fc.desc}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Current conditions bar */}
          {weatherDescription && (
            <div className="mt-3 p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-[11px] text-emerald-800 font-medium">
                {isAr ? `الآن: ${weatherDescription}` : `Current: ${weatherDescription}`}
              </span>
            </div>
          )}
        </>

      ) : weatherSource === 'no_key' ? (
        /* No API key configured */
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" strokeWidth={1.5} />
          <h5 className="text-xs font-bold text-amber-800">
            {isAr ? 'مفتاح الطقس غير مُهيأ' : 'Weather API Key Not Configured'}
          </h5>
          <p className="text-[11px] text-amber-600 max-w-sm mx-auto">
            {isAr
              ? 'يرجى إدخال مفتاح OpenWeatherMap API في صفحة الإعدادات لتفعيل التنبؤات الحقيقية. يمكنك الحصول على مفتاح مجاني من:'
              : 'Enter your OpenWeatherMap API key in Settings to enable live forecasts. Get a free key at:'}
          </p>
          <a
            href="https://openweathermap.org/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold underline break-all"
          >
            openweathermap.org/api
          </a>
        </div>

      ) : weatherSource === 'no_boundary' ? (
        /* No farm boundary selected yet */
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-3">
          <Globe className="w-8 h-8 text-slate-300 mx-auto" strokeWidth={1.5} />
          <h5 className="text-xs font-bold text-slate-600">
            {isAr ? 'حدد حدود المزرعة أولاً' : 'Define Farm Boundary First'}
          </h5>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            {isAr
              ? 'يحتاج الطقس إلى إحداثيات GPS للمزرعة. انتقل إلى صفحة "تحديد حدود المزرعة" وارسم الحدود.'
              : 'Weather requires farm GPS coordinates. Go to the Geofencing page and draw your farm boundary.'}
          </p>
        </div>

      ) : weatherSource === 'error' ? (
        /* Specific error with retry */
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-3">
          {weatherErrorType === 'network'
            ? <WifiOff className="w-8 h-8 text-red-400 mx-auto" strokeWidth={1.5} />
            : <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" strokeWidth={1.5} />}
          <h5 className="text-xs font-bold text-red-700">
            {isAr ? getErrorMessage().ar : getErrorMessage().en}
          </h5>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 text-[11px] font-bold rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {isAr ? 'إعادة المحاولة' : 'Retry'}
            </button>
          )}
        </div>

      ) : (
        /* Honest empty state — no data available */
        <div className="p-6 bg-slate-50 border border-slate-150 rounded-2xl text-center space-y-2">
          <Sun className="w-8 h-8 text-slate-300 mx-auto" strokeWidth={1.5} />
          <h5 className="text-xs font-bold text-slate-600">
            {isAr ? 'لا توجد بيانات طقس متاحة' : 'No Weather Data Available'}
          </h5>
          <p className="text-[11px] text-slate-400">
            {isAr
              ? 'لم يتم استلام أي بيانات من خدمة الطقس بعد. تأكد من إعداد المفتاح وتحديد الحدود.'
              : 'No weather data received yet. Verify your API key and farm boundary.'}
          </p>
        </div>
      )}

      {/* Data lineage footer */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400 font-mono">
        <span>
          {isAr ? 'المصدر' : 'Source'}: OpenWeatherMap API
        </span>
        <span>
          {isAr ? 'آخر تحديث' : 'Last update'}:{' '}
          {weatherFetchedAt
            ? new Date(weatherFetchedAt).toLocaleString(isAr ? 'ar-IQ' : 'en-US', { hour: '2-digit', minute: '2-digit' })
            : '--'}
        </span>
      </div>
    </div>
  );
}
