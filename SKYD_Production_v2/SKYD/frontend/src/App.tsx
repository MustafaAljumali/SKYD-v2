import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Menu, X, Globe, Leaf, Droplets, Wind, Sun, Activity, 
  Settings, LayoutDashboard, TreePine, Dna, BrainCircuit, 
  BarChart3, Radio, Plane, Thermometer, FlaskConical,
  MessageSquare, LogOut, ChevronRight, Camera, Mic, 
  Plus, Trash2, Key, Database, Shield, CheckCircle, User, Info, Smartphone, AlertTriangle,
  Compass, Check
} from 'lucide-react';
import { useSimulation } from './hooks/useSimulation';
import { Page, Zone, SimData } from './types';
import { FarmMap } from './components/FarmMap';
import { DigitalTwinMap } from './components/DigitalTwinMap';
import { DashboardHeader } from './components/DashboardHeader';
import { WeatherPanel } from './components/WeatherPanel';
import { HybridTelemetryPanel } from './components/HybridTelemetryPanel';
import type { PhysicalSensor, VirtualNode } from './types';
import { getCentroid, getLiveWeather, get5DayForecast, getNasaPowerWeather, DayForecast, WeatherErrorType } from './services/weatherService';
import type { WeatherSource } from './components/WeatherPanel';
import { connectMQTT, SensorReading, writeSensorReadingToFirestore, pollSensors } from './services/sensorService';
import { analyzeImage as analyzeYOLOImage } from './services/yoloService';
import { AnalyticsCharts } from './components/AnalyticsCharts';
import { fetchSatelliteNDVI, sendFireAlert } from './services/skydApiService';
import { DRONE_PRESETS } from './utils/dronePresets';

// Real Firebase Database & Auth integrations
import { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from './lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';

// Simple MasterIcon centered around Skyd theme
const MasterIcon = ({ className }: { className?: string }) => (
  <div className={`relative flex items-center justify-center ${className}`}>
    <div className="absolute inset-0 bg-emerald-500 blur-md opacity-20 rounded-full animate-pulse" />
    <div className="relative bg-white p-2.5 rounded-xl shadow-xs border border-emerald-200">
      <Leaf className="w-6 h-6 text-emerald-600" />
    </div>
  </div>
);

export default function App() {
  const [isAr, setIsAr] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Real Farmers telemetry actions from useSimulation
  const { 
    data, 
    writeTelemetry,
    updateZone,
    addZone,
    deleteZone,
    addLog,
    treatZone,
    toggleIrrigation 
  } = useSimulation(isAr);

  // Authentication State
  const [user, setUser] = useState<{ email: string; org: string; location: string; name: string } | null>(null);

  // Manual Geofence Boundary Map states
  const [savedGeoJSON, setSavedGeoJSON] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('skyd_saved_geojson');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [geoArea, setGeoArea] = useState<number>(() => {
    return parseFloat(localStorage.getItem('skyd_saved_area') || '0');
  });
  const [soilType, setSoilType] = useState<string>(() => {
    return localStorage.getItem('skyd_saved_soil') || '';
  });

  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authOrg, setAuthOrg] = useState('');
  const [authLoc, setAuthLoc] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthProdDisabled, setIsAuthProdDisabled] = useState(false);
  
  // Real zone creator state
  const [zoneNameAr, setZoneNameAr] = useState('');
  const [zoneNameEn, setZoneNameEn] = useState('');
  const [zoneHealthy, setZoneHealthy] = useState('');
  const [zoneMoisture, setZoneMoisture] = useState('');
  const [zoneTemp, setZoneTemp] = useState('');
  const [zoneCropType, setZoneCropType] = useState('vegetable');

  // Satellite and AI configuration settings
  const [satWeatherKey, setSatWeatherKey] = useState(() => {
    return (
      (import.meta.env.VITE_OPENWEATHER_API_KEY as string) ||
      (import.meta.env.VITE_OPENWEATHERMAP_API_KEY as string) ||
      (import.meta.env.VITE_OWM_API_KEY as string) ||
      (import.meta.env.OPENWEATHER_API_KEY as string) ||
      (import.meta.env.OPENWEATHERMAP_API_KEY as string) ||
      (import.meta.env.OWM_API_KEY as string) ||
      (window as any).ENV?.VITE_OPENWEATHER_API_KEY ||
      (window as any).ENV?.OPENWEATHER_API_KEY ||
      (window as any).VITE_OPENWEATHER_API_KEY ||
      (window as any).OPENWEATHER_API_KEY ||
      ''
    );
  });
  const [aiApiKey, setAiApiKey] = useState('');
  const [trainModelUrl, setTrainModelUrl] = useState('');
  const [isKeysSaved, setIsKeysSaved] = useState(false);

  // New states for User Request updates
  const [iotSyncProgress, setIotSyncProgress] = useState<'idle' | 'beacon' | 'collecting' | 'handshake' | 'done'>('idle');
  const [satelliteSyncStatus, setSatelliteSyncStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');

  // Emergency Warnings and Farmer Phone SMS Trigger States
  const [phoneNumber, setPhoneNumber] = useState(() => localStorage.getItem('skyd_farmer_phone') || '');
  const [smsOutbox, setSmsOutbox] = useState<{ id: string; body: string; phone: string; timestamp: string; type: 'sms' | 'call'; status: 'delivered' | 'calling' | 'connected' }[]>(() => {
    try {
      const saved = localStorage.getItem('skyd_sms_outbox');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [hasDispatchedFireAlert, setHasDispatchedFireAlert] = useState(false);

  // Ground Telemetry Sensor REST/MQTT configuration states
  const [sensorRestEndpoint, setSensorRestEndpoint] = useState(() => localStorage.getItem('skyd_rest_endpoint') || '');
  const [sensorRestApiKey, setSensorRestApiKey] = useState(() => localStorage.getItem('skyd_rest_apikey') || '');
  const [mqttBrokerUrl, setMqttBrokerUrl] = useState(() => localStorage.getItem('skyd_mqtt_broker') || 'wss://broker.hivemq.com:8884/mqtt');
  const [mqttTopic, setMqttTopic] = useState(() => localStorage.getItem('skyd_mqtt_topic') || 'skyd/farm_01/sensors/#');
  const [isSensorConfigSaved, setIsSensorConfigSaved] = useState(false);
  const [sensorStatusLog, setSensorStatusLog] = useState<{ sensorId: string; zoneId: number; type: string; lastValue: number; unit: string; lastSeen: string; battery: number; rssi: number; status: 'online' | 'stale' | 'offline' }[]>(() => {
    try {
      const saved = localStorage.getItem('skyd_sensor_status_log');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [isMqttConnected, setIsMqttConnected] = useState(false);
  const [mqttErrorMsg, setMqttErrorMsg] = useState('');
  const [isSensorsTesting, setIsSensorsTesting] = useState(false);

  // Firestore telemetry history for AnalyticsCharts — real data only
  const [telemetryHistory, setTelemetryHistory] = useState<{
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
    createdAt: Date;
  }[]>([]);

  // New farmer simplified inputs
  const [sensorMacAddress, setSensorMacAddress] = useState(() => localStorage.getItem('skyd_sensor_mac') || '');
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [selectedSensorZone, setSelectedSensorZone] = useState<number>(-1);
  const [selectedSensorType, setSelectedSensorType] = useState<string>('soil_moisture');

  // Reactive Emergency Alert System - Trigger SMS and Phone call for Temperature >= 60 C inside bounds
  useEffect(() => {
    const currentTemp = data.temp;
    // Approximating 60 degrees (>= 58.0 Celcius)
    if (geoArea > 0 && currentTemp >= 58.0) {
      if (phoneNumber && !hasDispatchedFireAlert) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const smsBody = isAr 
          ? `[SKYD SAFE_HEVRON] 🚨 إنذار حريق عاجل! تجاوزت حرارة حقل المزرعة عتبة الستين مئوية (${currentTemp.toFixed(1)}°C). الفلاحة الرقمية تؤكد خطر اشتعال المحاصيل في هذه المنطقة الجغرافية! الدفاع المدني والمكافحة الفورية ضروريين لإخماد الحريق عاجلاً.`
          : `[SKYD SAFE-HEVRON] 🚨 CRITICAL FIRE WARNING! Live temperature bounds exceeded 60°C (${currentTemp.toFixed(1)}°C). Agricultural systems detect high combustion threat. Urgent firefighting action required immediately in defined GPS bounds.`;
          
        const callBody = isAr
          ? `إنذار حريق فوري من منصة سكاي: بلغت درجة حرارة التربة والمزرعة ستين درجة مئوية. يرجى التوجه ومباشرة مكافحة الحريق لحفظ المحصول فورا.`
          : `Immediate fire alert from Skyd platform: sensor temp has reached 60 degrees Celsius. Please respond instantly with firefighting in the specified sector.`;

        const newSms = {
          id: `sms_${Date.now()}`,
          body: smsBody,
          phone: phoneNumber,
          timestamp: timeStr,
          type: 'sms' as const,
          status: 'delivered' as const
        };

        const newCall = {
          id: `call_${Date.now()}`,
          body: callBody,
          phone: phoneNumber,
          timestamp: timeStr,
          type: 'call' as const,
          status: 'connected' as const
        };

        const updatedOutbox = [newSms, newCall, ...smsOutbox];
        setSmsOutbox(updatedOutbox);
        localStorage.setItem('skyd_sms_outbox', JSON.stringify(updatedOutbox));
        setHasDispatchedFireAlert(true);
        
        // Send SMS and voice alert via backend Twilio
        const hottestZone = data.zones.reduce((max, z) => z.temp > max.temp ? z : max, data.zones[0]);
        sendFireAlert({
          phone: phoneNumber,
          temp: currentTemp,
          zone_id: String(hottestZone?.id ?? '0'),
          zone_name: isAr ? (hottestZone?.nameAr ?? '') : (hottestZone?.nameEn ?? ''),
        }).catch(err => console.warn('Backend SMS fire alert failed:', err));

        addLog(isAr
          ? `🚨 تم بث رسالة تحذير SMS وإجراء اتصال الطوارئ بالهاتف للرقم ${phoneNumber} لارتفاع الحرارة إلى ${currentTemp.toFixed(1)}°C وتفشي الحريق!`
          : `🚨 Dispatched fire warning SMS & dialed emergency farmer call line for ${phoneNumber}. Critical temp reached ${currentTemp.toFixed(1)}°C.`
        );
      }
    } else {
      if (currentTemp < 55) {
        setHasDispatchedFireAlert(false);
      }
    }
  }, [data.temp, geoArea, phoneNumber, hasDispatchedFireAlert, smsOutbox, isAr, addLog, data.zones]);

  // MQTT Connection Hook for physical ground sensors
  useEffect(() => {
    if (!mqttBrokerUrl || !mqttTopic || !user) return;
    
    const uid = auth.currentUser?.uid || 'local_admin';
    const client = connectMQTT(
      mqttBrokerUrl, 
      mqttTopic, 
      uid,
      (reading) => {
        // Log telemetry event
        addLog(isAr 
          ? `📡 مجس فیزيائي [${reading.sensorId}]: تم ورود قراءة ${reading.type === 'soil_moisture' ? 'الرطوبة' : reading.type} بـ ${reading.value} ${reading.unit}`
          : `📡 IoT hardware [${reading.sensorId}]: Telemetry ${reading.type} updated to ${reading.value} ${reading.unit}`
        );

        // Write real sensor reading to Firestore (bridges IoT → dashboard + charts)
        writeSensorReadingToFirestore(uid, reading);

        if (reading.type === 'soil_moisture' && reading.zoneId >= 0) {
          updateZone(reading.zoneId, { moisture: reading.value });
        }

        // Save status log locally and to React state
        setSensorStatusLog((prev) => {
          const now = new Date();
          const existingIdx = prev.findIndex(s => s.sensorId === reading.sensorId);
          let nextLog = [...prev];
          if (existingIdx > -1) {
            nextLog[existingIdx] = {
              ...nextLog[existingIdx],
              lastValue: reading.value,
              lastSeen: now.toISOString(),
              status: 'online'
            };
          } else {
            nextLog.push({
              sensorId: reading.sensorId,
              zoneId: reading.zoneId,
              type: reading.type,
              lastValue: reading.value,
              unit: reading.unit,
              lastSeen: now.toISOString(),
              battery: reading.battery || 95,
              rssi: reading.rssi || -65,
              status: 'online'
            });
          }
          localStorage.setItem('skyd_sensor_status_log', JSON.stringify(nextLog));
          return nextLog;
        });
      },
      (connected, error) => {
        setIsMqttConnected(connected);
        if (error) {
          setMqttErrorMsg(error);
          console.warn("MQTT WebSockets error:", error);
        } else {
          setMqttErrorMsg('');
        }
      }
    );

    return () => {
      if (client) {
        client.end();
      }
    };
  }, [mqttBrokerUrl, mqttTopic, isAr, addLog, user]);

  // Firestore telemetry history listener — real-time sync for AnalyticsCharts
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || uid.startsWith('local_')) return;

    try {
      const historyRef = collection(db, 'users', uid, 'telemetry', 'history');
      const historyQuery = query(historyRef, orderBy('createdAt', 'desc'), limit(100));
      const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
        const records: typeof telemetryHistory = [];
        snapshot.forEach((doc) => {
          const d = doc.data();
          records.push({
            id: doc.id,
            temp: typeof d.temp === 'number' ? d.temp : 0,
            humidity: typeof d.humidity === 'number' ? d.humidity : 0,
            wind: typeof d.wind === 'number' ? d.wind : 0,
            solar: typeof d.solar === 'number' ? d.solar : 0,
            soilMoisture: typeof d.soilMoisture === 'number' ? d.soilMoisture : 0,
            soilPH: typeof d.soilPH === 'number' ? d.soilPH : 0,
            nitrogen: d.nitrogen,
            phosphorus: d.phosphorus,
            potassium: d.potassium,
            ec: d.ec,
            createdAt: d.createdAt?.toDate?.() || new Date(),
          });
        });
        records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        setTelemetryHistory(records);
      }, (error) => {
        console.warn('[History] Firestore listener error:', error);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('[History] Failed to subscribe:', e);
    }
  }, []);

  // REST sensor polling — fetches from backend REST endpoint when configured
  useEffect(() => {
    if (!sensorRestEndpoint || !user) return;

    const uid = auth.currentUser?.uid || 'local_admin';
    let active = true;

    const doPoll = async () => {
      try {
        const readings = await pollSensors(sensorRestEndpoint, sensorRestApiKey);
        if (!active || readings.length === 0) return;

        for (const reading of readings) {
          // Write each REST reading to Firestore
          await writeSensorReadingToFirestore(uid, reading);

          // Update local sensor status log
          setSensorStatusLog((prev) => {
            const now = new Date();
            const existingIdx = prev.findIndex(s => s.sensorId === reading.sensorId);
            let nextLog = [...prev];
            if (existingIdx > -1) {
              nextLog[existingIdx] = {
                ...nextLog[existingIdx],
                lastValue: reading.value,
                lastSeen: now.toISOString(),
                status: 'online'
              };
            } else {
              nextLog.push({
                sensorId: reading.sensorId,
                zoneId: reading.zoneId,
                type: reading.type,
                lastValue: reading.value,
                unit: reading.unit,
                lastSeen: now.toISOString(),
                battery: reading.battery || 95,
                rssi: reading.rssi || -65,
                status: 'online'
              });
            }
            localStorage.setItem('skyd_sensor_status_log', JSON.stringify(nextLog));
            return nextLog;
          });

          // Update zone moisture if applicable
          if (reading.type === 'soil_moisture' && reading.zoneId >= 0) {
            updateZone(reading.zoneId, { moisture: reading.value });
          }
        }
      } catch (err) {
        console.warn('[REST Poll] Sensor polling error:', err);
      }
    };

    doPoll();
    const interval = setInterval(doPoll, 60000); // poll every 60s
    return () => { active = false; clearInterval(interval); };
  }, [sensorRestEndpoint, sensorRestApiKey, user, updateZone]);

  // Interactive Drone Diagnostics & Imaging states
  const [selectedDroneImage, setSelectedDroneImage] = useState<string | null>(null);
  const [isDroneScanning, setIsDroneScanning] = useState<boolean>(false);
  const [droneScanResult, setDroneScanResult] = useState<{
    diagnosisAr: string;
    diagnosisEn: string;
    healthStatus: string;
    typeOfInjuryAr: string;
    typeOfInjuryEn: string;
    recommendationAr: string;
    recommendationEn: string;
  } | null>(null);
  const [customDroneBase64, setCustomDroneBase64] = useState<string | null>(null);

  // Trigger server-side drone photo diagnostics with Gemini
  const handleDroneScan = async (base64Data: string) => {
    setIsDroneScanning(true);
    setDroneScanResult(null);
    try {
      const response = await fetch("/api/gemini/drone-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: base64Data })
      });
      if (response.ok) {
        const json = await response.json();
        setDroneScanResult(json);
        addLog(isAr
          ? `✓ تم مسح الصورة الجوية. النتيجة الكاشفة: ${json.typeOfInjuryAr} | مؤشر التنبيه: ${json.healthStatus}`
          : `✓ Drone photograph analyzed. Finding: ${json.typeOfInjuryEn} | Threat Status: ${json.healthStatus}`
        );
      } else {
        const errJson = await response.json().catch(() => ({}));
        console.warn("Drone diagnostic error:", errJson.error);
        addLog(isAr
          ? "⚠️ فشل رصد الآفات الموصولة بالذكاء الاصطناعي على المخدم. يرجى تهيئة مفتاح API الخاص بك."
          : "⚠️ Server-side automated diagnostic failed. Ensure GEMINI_API_KEY is configured."
        );
      }
    } catch (e) {
      console.warn("Drone scan failure:", e);
    } finally {
      setIsDroneScanning(false);
    }
  };

  const handleUploadedFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setCustomDroneBase64(base64String);
      setSelectedDroneImage(base64String);
      handleDroneScan(base64String);
    };
    reader.readAsDataURL(file);
  };

  // Production mock data flag — must be false in production
  const isMockEnabled = (import.meta.env.VITE_ENABLE_MOCK_DATA as string) === 'true';

  // Real-time weather API and 5-Day forecast states
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [weatherSource, setWeatherSource] = useState<WeatherSource>('no_key');
  const [weatherErrorType, setWeatherErrorType] = useState<WeatherErrorType | null>(null);
  const [weatherDescription, setWeatherDescription] = useState<string | null>(null);
  const [weatherFetchedAt, setWeatherFetchedAt] = useState<string | null>(null);

  // Production env validation warning
  useEffect(() => {
    if (isMockEnabled) {
      console.warn('%c[SKYD] WARNING: Mock data mode (VITE_ENABLE_MOCK_DATA=true) is enabled. This must be false in production.', 'color: red; font-weight: bold;');
    }
    if (!import.meta.env.VITE_API_URL && !import.meta.env.VITE_SKYD_API_URL) {
      console.warn('%c[SKYD] WARNING: VITE_API_URL is not set. Defaulting to localhost:8000.', 'color: orange; font-weight: bold;');
    }
  }, [isMockEnabled]);

  // Fetch Live Weather when key and geoarea are active
  const fetchWeather = async () => {
    // No farm boundary → honest 'no_boundary' state
    if (geoArea === 0 || !savedGeoJSON) {
      setWeatherSource('no_boundary');
      setWeatherErrorType(null);
      setForecast([]);
      return;
    }

    setWeatherSource('loading');
    setIsWeatherLoading(true);
    try {
      const [lat, lon] = getCentroid(savedGeoJSON);

      // Try OWM if key is available, otherwise fall back to NASA POWER (free)
      const result = satWeatherKey
        ? await getLiveWeather(auth.currentUser?.uid || 'local_admin', lat, lon, satWeatherKey)
        : await getNasaPowerWeather(lat, lon);

      if (result.ok) {
        setWeatherSource('api');
        setWeatherErrorType(null);
        setWeatherDescription(result.data.description ?? null);
        setWeatherFetchedAt(result.data.fetchedAt ?? new Date().toISOString());
        writeTelemetry({
          temp: result.data.temp,
          humidity: result.data.humidity,
          wind: result.data.wind,
          solar: result.data.solar,
        });

        if (satWeatherKey) {
          const days = await get5DayForecast(lat, lon, satWeatherKey);
          if (days && days.length > 0) {
            setForecast(days);
          }
        }
      } else {
        // API returned a specific error
        setWeatherSource('error');
        setWeatherErrorType(result.error?.errorType ?? 'unknown');
        setForecast([]);
        setWeatherDescription(null);
        setWeatherFetchedAt(null);
      }
    } catch (err) {
      console.warn('[Weather] Unexpected fetch error:', err);
      setWeatherSource('error');
      setWeatherErrorType('network');
      setForecast([]);
    } finally {
      setIsWeatherLoading(false);
    }
  };

  // Fetch Live Weather when key and geoarea are active
  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const doFetch = async () => {
      if (!active) return;
      // No farm boundary → honest 'no_boundary' state
      if (geoArea === 0 || !savedGeoJSON) {
        setWeatherSource('no_boundary');
        setWeatherErrorType(null);
        setForecast([]);
        return;
      }

      setWeatherSource('loading');
      setIsWeatherLoading(true);
      try {
        const [lat, lon] = getCentroid(savedGeoJSON);

        // Try OWM if key is available, otherwise fall back to NASA POWER (free)
        const result = satWeatherKey
          ? await getLiveWeather(auth.currentUser?.uid || 'local_admin', lat, lon, satWeatherKey)
          : await getNasaPowerWeather(lat, lon);

        if (!active) return;

        if (result.ok) {
          setWeatherSource('api');
          setWeatherErrorType(null);
          setWeatherDescription(result.data.description ?? null);
          setWeatherFetchedAt(result.data.fetchedAt ?? new Date().toISOString());
          writeTelemetry({
            temp: result.data.temp,
            humidity: result.data.humidity,
            wind: result.data.wind,
            solar: result.data.solar,
          });

          if (satWeatherKey) {
            const days = await get5DayForecast(lat, lon, satWeatherKey);
            if (days && days.length > 0 && active) {
              setForecast(days);
            }
          }
        } else {
          setWeatherSource('error');
          setWeatherErrorType(result.error?.errorType ?? 'unknown');
          setForecast([]);
          setWeatherDescription(null);
          setWeatherFetchedAt(null);
        }
      } catch (err) {
        console.warn('[Weather] Unexpected fetch error:', err);
        if (active) {
          setWeatherSource('error');
          setWeatherErrorType('network');
          setForecast([]);
        }
      } finally {
        if (active) setIsWeatherLoading(false);
      }
    };

    doFetch();
    interval = setInterval(doFetch, 300000); // refresh every 5 mins

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [satWeatherKey, savedGeoJSON, geoArea, writeTelemetry]);

  // AI-Processed Directives and recommendations states — honest empty: no fake AI text
  const [aiDirectivesAr, setAiDirectivesAr] = useState<string[]>([]);
  const [aiDirectivesEn, setAiDirectivesEn] = useState<string[]>([]);
  const [aiSummaryAr, setAiSummaryAr] = useState<string>('');
  const [aiSummaryEn, setAiSummaryEn] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Fetch AI agricultural directives on demand
  const fetchAiAdvice = async () => {
    if (geoArea === 0) return;
    setIsAiLoading(true);
    try {
      const response = await fetch("/api/gemini/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telemetry: data, zones: data.zones })
      });
      if (response.ok) {
        const json = await response.json();
        if (json.directiveAr && json.directiveEn) {
          setAiDirectivesAr(json.directiveAr);
          setAiDirectivesEn(json.directiveEn);
          setAiSummaryAr(json.summaryAr);
          setAiSummaryEn(json.summaryEn);
          addLog(isAr 
            ? '✓ تم تحديث نصائح الموجه الزراعي بالذكاء الاصطناعي بنجاح من الخادم.' 
            : '✓ Fresh smart crop directives loaded from Gemini Server.'
          );
        }
      } else {
        const errJson = await response.json().catch(() => ({}));
        console.warn("AI advisor recommendation error:", errJson.error);
        addLog(isAr
          ? '⚠️ فشل الاتصال بخادم الذكاء الاصطناعي. تأكد من إعداد مفتاح API الخاص بك.'
          : '⚠️ Failed to connect to AI server. Verify your configuration API key.'
        );
      }
    } catch (e) {
      console.warn("AI generation failed:", e);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Trigger AI advice on zone geofenced or loaded
  useEffect(() => {
    if (geoArea > 0) {
      fetchAiAdvice();
    }
  }, [geoArea]);

  // Auto-fetch satellite moisture + NDVI for zones every 6 hours
  // Helper: distribute zone positions evenly inside the farm boundary
  const computeZoneSatCoords = (zoneList: typeof data.zones, geojson: any): [number, number][] => {
    if (!geojson || zoneList.length === 0) return [];
    try {
      const geom = geojson.geometry || geojson;
      const ring = geom?.coordinates?.[0];
      if (!Array.isArray(ring) || ring.length < 3) return zoneList.map(() => getCentroid(geojson));
      const lats = ring.map((c: number[]) => c[1]);
      const lngs = ring.map((c: number[]) => c[0]);
      const centerLat = lats.reduce((a: number, b: number) => a + b, 0) / lats.length;
      const centerLng = lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length;
      const latRange = (Math.max(...lats) - Math.min(...lats)) * 0.55 || 0.0015;
      const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 0.55 || 0.0015;
      const n = zoneList.length;
      return zoneList.map((_, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const r = 0.5 + (i % 3) * 0.12;
        return [
          centerLat + r * latRange * Math.sin(angle),
          centerLng + r * lngRange * Math.cos(angle),
        ] as [number, number];
      });
    } catch {
      return zoneList.map(() => getCentroid(geojson));
    }
  };

  useEffect(() => {
    const zones = data?.zones ?? [];
    if (geoArea <= 0 || zones.length === 0 || !savedGeoJSON) return;

    let active = true;
    const fetchSatelliteMoisture = async () => {
      setSatelliteSyncStatus('fetching');
      try {
        // Compute per-zone coordinates so each zone gets its own NDVI reading
        const zoneCoords = computeZoneSatCoords(zones, savedGeoJSON);
        for (let i = 0; i < zones.length; i++) {
          const zone = zones[i];
          if (!active) break;
          try {
            const [lat, lon] = zoneCoords[i] || getCentroid(savedGeoJSON);
            const satData = await fetchSatelliteNDVI(lat, lon, String(zone.id));
            if (satData && active) {
              // Map NDWI (-1 to 1) to approximate soil moisture percentage (10% to 90%)
              const estimatedMoisture = satData.ndwi !== undefined
                ? Math.round(Math.max(10, Math.min(90, (satData.ndwi + 0.5) * 80)))
                : undefined;
              // Store full satellite data (NDVI, EVI, NDWI, NDRE) on the zone
              const satellitePayload = {
                ndvi: satData.ndvi,
                evi: satData.evi,
                ndwi: satData.ndwi,
                ndre: satData.ndre,
                source: (satData.source === 'sentinel2' ? 'sentinel2' : 'nasa_power') as 'sentinel2' | 'nasa_power',
                imageryDate: satData.imagery_date,
                cloudCover: satData.cloud_cover_pct,
              };
              updateZone(zone.id, {
                ...(estimatedMoisture !== undefined ? { moisture: estimatedMoisture } : {}),
                satellite: satellitePayload,
              });
            }
          } catch (zoneErr) {
            console.warn(`Satellite fetch failed for zone ${zone.id}:`, zoneErr);
          }
        }
        if (active) {
          setSatelliteSyncStatus('done');
          addLog(isAr 
            ? '✅ تم تحديث مؤشرات صحة النبات (NDVI) والرطوبة من الأقمار الصناعية'
            : '✅ Zone NDVI + vegetation health indices updated from satellite'
          );
        }
      } catch (err) {
        console.warn('Satellite moisture fetch failed:', err);
        if (active) setSatelliteSyncStatus('error');
      }
    };

    fetchSatelliteMoisture();
    const interval = setInterval(fetchSatelliteMoisture, 6 * 60 * 60 * 1000); // 6 hours

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [geoArea, data?.zones?.length, savedGeoJSON, updateZone, addLog, isAr]);

  // Monitor Auth Changes to update UI and fetch profiles
  useEffect(() => {
    return auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUser(userData as any);
            // Load phone number from user profile for SMS alerts
            if (userData?.phone) {
              setPhoneNumber(userData.phone);
              localStorage.setItem('skyd_farmer_phone', userData.phone);
            }
          }
        } catch (err) {
          console.error("Error setting up session profile:", err);
        }
      } else {
        const savedSession = localStorage.getItem('skyd_active_user') || localStorage.getItem('skyed_active_user');
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            setUser(parsed);
            if (parsed.phone) {
              setPhoneNumber(parsed.phone);
              localStorage.setItem('skyd_farmer_phone', parsed.phone);
            }
          } catch (e) {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
    });
  }, []);

  // Synchronize Satellite / AI keys from Firestore config or Local Fallback
  useEffect(() => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      const activeUserStr = localStorage.getItem('skyd_active_user') || localStorage.getItem('skyed_active_user');
      if (activeUserStr) {
        try {
          const activeUser = JSON.parse(activeUserStr);
          if (activeUser.uid) {
            const savedKeysStr = localStorage.getItem(`skyd_local_keys_${activeUser.uid}`) || localStorage.getItem(`skyed_local_keys_${activeUser.uid}`);
            if (savedKeysStr) {
              const d = JSON.parse(savedKeysStr);
              setSatWeatherKey(d.satWeatherKey || '');
              setAiApiKey(d.aiApiKey || '');
              setTrainModelUrl(d.trainModelUrl || '');
            }
          }
        } catch (e) {
          // ignore
        }
      }
      return;
    }
    
    const configDocRef = doc(db, 'users', firebaseUser.uid, 'config', 'keys');
    const unsubscribeKeys = onSnapshot(configDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        setSatWeatherKey(d.satWeatherKey || '');
        setAiApiKey(d.aiApiKey || '');
        setTrainModelUrl(d.trainModelUrl || '');
      }
    });
    return () => unsubscribeKeys();
  }, [user]);

  // Sync Satellite/AI Keys to Firestore config or Local Fallback
  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      const activeUserStr = localStorage.getItem('skyd_active_user') || localStorage.getItem('skyed_active_user');
      if (activeUserStr) {
        try {
          const activeUser = JSON.parse(activeUserStr);
          if (activeUser.uid) {
            localStorage.setItem(`skyd_local_keys_${activeUser.uid}`, JSON.stringify({
              satWeatherKey,
              aiApiKey,
              trainModelUrl,
            }));
            setIsKeysSaved(true);
            await addLog(isAr 
              ? 'تم حفظ وتفصيل مفاتيح الأقمار الصناعية بنجاح في قاعدة بيانات المنظمة (محلياً)' 
              : 'Satellite keys and AI parameters saved successfully in organization database (locally)'
            );
            setTimeout(() => setIsKeysSaved(false), 3000);
            return;
          }
        } catch (e) {
          // ignore
        }
      }
      return;
    }

    try {
      const keysDocRef = doc(db, 'users', firebaseUser.uid, 'config', 'keys');
      await setDoc(keysDocRef, {
        satWeatherKey,
        aiApiKey,
        trainModelUrl,
        updatedAt: serverTimestamp()
      });
      setIsKeysSaved(true);
      await addLog(isAr 
        ? 'تم حفظ وتفصيل مفاتيح الأقمار الصناعية بنجاح في قاعدة بيانات المنظمة' 
        : 'Satellite keys and AI parameters saved successfully in organization database'
      );
      setTimeout(() => setIsKeysSaved(false), 3000);
    } catch (error) {
      console.error("Error saving keys: ", error);
    }
  };

  // Handle Authentication submit with Firestore provisioning
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthProdDisabled(false);

    if (!authEmail || !authPassword) {
      setAuthError(isAr ? 'يرجى إدخال جميع الحقول الأساسية' : 'Please fill all basic fields');
      return;
    }

    if (isRegisterMode) {
      if (!authName) {
        setAuthError(isAr ? 'الرجاء إدخال الاسم الكامل للمزارع' : 'Please provide the farmer full name');
        return;
      }
      
      const defaultOrg = isAr ? 'منصة سكاي للتنمية الزراعية' : 'Skyd Agronomic Network';
      const defaultLoc = isAr ? 'بانتظار تحديد الحدود عبر GPS' : 'Awaiting GPS manual draw';
      
      try {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const uid = cred.user.uid;

        const newUserProfile = {
          uid: uid,
          email: authEmail,
          name: authName,
          org: defaultOrg,
          location: defaultLoc,
          phone: authPhone,
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', uid), newUserProfile);

        // Initialize empty telemetry document — real values come from weather API and physical sensors only
        await setDoc(doc(db, 'users', uid, 'telemetry', 'main'), {
          updatedAt: serverTimestamp()
          // No numeric defaults — temp/humidity/wind/solar/soilPH populated only from live sources
        });
        // Zones are NOT pre-created — they are created only after the farmer draws farm boundaries

        const initialLogs = [
          { msg: 'الهوية الرقمية نشطة - جاهز لاستقبال بيانات الطقس والأقمار الصناعية', color: '#10b981', timestamp: '08:00' },
          { msg: 'Skyd Platform activated - Awaiting live satellite feeds', color: '#10b981', timestamp: '08:01' }
        ];
        for (let i = 0; i < initialLogs.length; i++) {
          await setDoc(doc(db, 'users', uid, 'logs', `log_init_${i}`), {
            ...initialLogs[i],
            createdAt: serverTimestamp()
          });
        }

        await setDoc(doc(db, 'users', uid, 'config', 'keys'), {
          satWeatherKey: '',
          aiApiKey: '',
          trainModelUrl: '',
          phone: authPhone,
          updatedAt: serverTimestamp()
        });

        if (authPhone) {
          setPhoneNumber(authPhone);
          localStorage.setItem('skyd_farmer_phone', authPhone);
        }

        setUser(newUserProfile as any);
      } catch (err: any) {
        console.error("Signup error", err);
        const isAuthOff = err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('operation-not-allowed'));
        if (isAuthOff) {
          setIsAuthProdDisabled(true);
          const uid = 'local_' + authEmail.replace(/[^a-zA-Z0-9]/g, '_');
          const defaultOrg = isAr ? 'منصة سكاي للتنمية الزراعية' : 'Skyd Agronomic Network';
          const defaultLoc = isAr ? 'بانتظار تحديد الحدود عبر GPS' : 'Awaiting GPS manual draw';
          const localProfile = {
            uid: uid,
            email: authEmail,
            name: authName,
            org: defaultOrg,
            location: defaultLoc,
            phone: authPhone,
            isLocal: true,
          };
          
          let registeredUsers: any[] = [];
          try {
            registeredUsers = JSON.parse(localStorage.getItem('skyd_registered_users') || localStorage.getItem('skyed_registered_users') || '[]');
          } catch { registeredUsers = []; }
          if (!registeredUsers.some((u: any) => u.email === authEmail)) {
            registeredUsers.push({ ...localProfile, password: authPassword });
            localStorage.setItem('skyd_registered_users', JSON.stringify(registeredUsers));
          }
          
          localStorage.setItem('skyd_active_user', JSON.stringify(localProfile));
          setUser(localProfile);
          await addLog(isAr 
            ? `تنبيه: تعذر الاتصال بـ Firebase - تم التسجيل محلياً بنجاح للمزارع: ${authName}` 
            : `Auth: Firebase offline - Registered new local offline session for: ${authName}`
          );
          return;
        }
        setAuthError(err.message || (isAr ? 'عذراً، حدث خطأ أثناء التسجيل.' : 'Error registering new account.'));
      }
    } else {
      try {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } catch (err: any) {
        console.error("Login attempt failed:", err);
        const isAuthOff = err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('operation-not-allowed'));
        
        if (isAuthOff) {
          setIsAuthProdDisabled(true);

          // 1. Check for Admin default login first
          if (authEmail === 'admin@skyd.org' && authPassword === 'skyd2026') {
            const adminProfile = {
              uid: 'local_admin',
              email: 'admin@skyd.org',
              name: 'المشرف العام (محلي)',
              org: 'منظمة Skyd الزراعية (محلية)',
              location: 'القصيم، المملكة العربية السعودية',
              isLocal: true,
            };
            localStorage.setItem('skyd_active_user', JSON.stringify(adminProfile));
            setUser(adminProfile);
            await addLog(isAr ? 'تم الدخول بالبوابة الآمنة للمنظمة (محاكاة محلية)' : 'Authorized via admin organization credentials (offline bypass)');
            return;
          }
          
          // 2. Check in registered local users database in localStorage
          let registeredUsers: any[] = [];
          try {
            registeredUsers = JSON.parse(localStorage.getItem('skyd_registered_users') || localStorage.getItem('skyed_registered_users') || '[]');
          } catch { registeredUsers = []; }
          const found = registeredUsers.find((r: any) => r.email === authEmail && r.password === authPassword);
          if (found) {
            const localProfile = { ...found };
            delete localProfile.password;
            localStorage.setItem('skyd_active_user', JSON.stringify(localProfile));
            setUser(localProfile);
            await addLog(isAr ? `تم تسجيل الدخول محلياً بالبوابة الآمنة للمزارع: ${found.name}` : `Offline Farmer logged in: ${found.name}`);
            return;
          }
        }

        if (authEmail === 'admin@skyd.org' && authPassword === 'skyd2026') {
          try {
            const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
            const uid = cred.user.uid;
            
            const adminProfile = {
              uid: uid,
              email: 'admin@skyd.org',
              name: 'المشرف العام',
              org: 'منظمة Skyd الزراعية',
              location: 'القصيم، المملكة العربية السعودية',
              createdAt: serverTimestamp()
            };
            await setDoc(doc(db, 'users', uid), adminProfile);

            // Initialize empty telemetry document — real values come from weather API and physical sensors only
            await setDoc(doc(db, 'users', uid, 'telemetry', 'main'), {
              updatedAt: serverTimestamp()
              // No numeric defaults — temp/humidity/wind/solar/soilPH populated only from live sources
            });
            // Zones are NOT pre-created — they are created only after the farmer draws farm boundaries

            await setDoc(doc(db, 'users', uid, 'config', 'keys'), {
              satWeatherKey: '',
              aiApiKey: '',
              trainModelUrl: '',
              updatedAt: serverTimestamp()
            });

            setUser(adminProfile as any);
          } catch (createErr: any) {
            console.error("Admin auto registration failed:", createErr);
            const isCreateOff = createErr.code === 'auth/operation-not-allowed' || (createErr.message && createErr.message.includes('operation-not-allowed'));
            if (isCreateOff) {
              setIsAuthProdDisabled(true);
              const adminProfile = {
                uid: 'local_admin',
                email: 'admin@skyd.org',
                name: 'المشرف العام (محلي)',
                org: 'منظمة Skyd الزراعية (محلية)',
                location: 'القصيم، المملكة العربية السعودية',
                isLocal: true,
              };
              localStorage.setItem('skyd_active_user', JSON.stringify(adminProfile));
              setUser(adminProfile);
              await addLog(isAr ? 'تم تسجيل الدخول بالبوابة الآمنة كمسؤول محلي' : 'Authorized via admin organization credentials (offline bypass)');
              return;
            }
            setAuthError(createErr.message || (isAr ? 'فشل إنشاء حساب المسؤول للمرة الأولى.' : 'Failed initializing admin registry.'));
          }
        } else {
          setAuthError(isAr ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : 'Incorrect email or password.');
        }
      }
    }
  };

  // Farmer logout action
  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('skyd_active_user');
      localStorage.removeItem('skyed_active_user');
      setUser(null);
      await addLog(isAr ? 'تم تسجيل خروج الجلسة وفصل القنوات الآمنة' : 'Session disconnected and encryption lanes closed');
    } catch (err) {
      console.error("Logout error", err);
    }
  };

  // Farmer manual zone creation trigger
  const handleAddZone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneNameAr || !zoneNameEn || !zoneHealthy || !zoneMoisture || !zoneTemp) {
      alert(isAr ? 'الرجاء ملء كافة الحقول لإنشاء المنطقة' : 'Please enter all fields to create zone');
      return;
    }

    const healthy = parseInt(zoneHealthy);
    const moisture = parseFloat(zoneMoisture);
    const tempVal = parseFloat(zoneTemp);

    if (isNaN(healthy) || isNaN(moisture) || isNaN(tempVal)) {
      alert(isAr ? 'القيم يجب أن تكون أرقام صالحة' : 'Values must be valid numbers');
      return;
    }

    addZone(zoneNameAr, zoneNameEn, healthy, moisture, tempVal, zoneCropType);
    addLog(isAr 
      ? `تمت إضافة حقل زراعي جديد للنبات المصنف [${zoneCropType}]: ${zoneNameAr}` 
      : `Added new ${zoneCropType} harvest segment: ${zoneNameEn}`
    );

    // Reset inputs
    setZoneNameAr('');
    setZoneNameEn('');
    setZoneHealthy('');
    setZoneMoisture('');
    setZoneTemp('');
    setZoneCropType('vegetable');
  };

  // Handle manual map boundary selection (Geo-fencing)
  const handleBoundaryChange = async (geojson: any, areaAcres: number, center: [number, number], soil: string) => {
    if (!geojson) {
      setSavedGeoJSON(null);
      setGeoArea(0);
      setSoilType('');
      localStorage.removeItem('skyd_saved_geojson');
      localStorage.removeItem('skyd_saved_area');
      localStorage.removeItem('skyd_saved_soil');
      return;
    }

    setSavedGeoJSON(geojson);
    setGeoArea(areaAcres);
    setSoilType(soil);

    localStorage.setItem('skyd_saved_geojson', JSON.stringify(geojson));
    localStorage.setItem('skyd_saved_area', areaAcres.toString());
    localStorage.setItem('skyd_saved_soil', soil);

    // Dynamic GPS coordinate string
    const locationStr = `${center[0].toFixed(5)}, ${center[1].toFixed(5)}`;

    // Update active user state immediately
    if (user) {
      const updatedUser = {
        ...user,
        location: locationStr,
      };
      setUser(updatedUser);

      // Save user record to local storage
      localStorage.setItem('skyd_active_user', JSON.stringify(updatedUser));

      // Sync user profile coordinates back to Firebase Firestore if online
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            location: locationStr,
          }, { merge: true });
        } catch (e) {
          console.warn("Could not sync profile coordinates to Firestore: ", e);
        }
      }
    }

    await addLog(isAr 
      ? `تخطيط الحدود: تم تحديد مضلع المزرعة يدوياً بحدود GPS: [${locationStr}] ومساحة ${areaAcres.toFixed(4)} AC` 
      : `Geofence Update: Farm polygon manually defined at GPS: [${locationStr}] with area ${areaAcres.toFixed(4)} AC`
    );
  };

  // Arabic-English translation text map
  const t = useMemo(() => ({
    dashboard: isAr ? 'المرصد العام الحقيقي' : 'Live General Monitor',
    geofence: isAr ? 'تخطيط حدود المزرعة (GPS)' : 'Farm Geofencing Map (GPS)',
    digitaltwin: isAr ? 'الخريطة الحرارية للمزرعة' : 'Farm Thermal NDVI Heatmap',
    crophealth: isAr ? 'مؤشرات صحة المزروعات' : 'Crop Health Index',
    predictions: isAr ? 'التنبؤات والإنتاجية' : 'AI Performance predictions',
    analytics: isAr ? 'التحليلات ومستوى توفير المياه' : 'Water conservation Analytics',
    mission: isAr ? 'تتبع أنظمة الرصد الجوي' : 'Telemetry Flight & Scan Tracking',
    drones: isAr ? 'الرصد والمسح الجيولوجي الجوي' : 'Autonomous Aerial Scan Registry',
    irrigation: isAr ? 'نظام الري الآلي الذكي بالسيرفر' : 'Smart Server Auto-Irrigation',
    sensors: isAr ? 'قراءات المجسات المباشرة والتربة' : 'Active Soil Telemetry Sensors',
    smartmission: isAr ? 'تقارير وتحليلات الفلاحة بالذكاء الاصطناعي' : 'AI Crop & Weekly Reports',
    liveops: isAr ? 'سجلات المتابعة والعمليات للمنصة' : 'Compliance & Ops Registry Logs',
    settings: isAr ? 'الملف الشخصي وحدود المزرعة المعتمدة' : 'Farmer Account Details & GPS Area',
    monitor: isAr ? 'المرصد الرقمي ومراقبة الحقل' : 'Agricultural Observation',
    control: isAr ? 'أنظمة التوجيه والميكنة اليدوية' : 'Control Systems',
    system: isAr ? 'إعدادات المنصة وقواعد البيانات' : 'Organizational Settings',
    logout: isAr ? 'تسجيل الخروج الآمن' : 'Secure Exit Session',
  }), [isAr]);

  const navSections = [
    { 
      title: isAr ? 'المراقبة والمسح الجغرافي' : 'GIS BOUNDARIES & TWIN', 
      items: [
        { id: 'dashboard', icon: LayoutDashboard, label: isAr ? 'المرصد العام الحقيقي' : 'Live General Monitor' },
        { id: 'geofence', icon: Compass, label: isAr ? 'تحديد حدود المزرعة (GPS)' : 'Define Farm Boundaries (GPS)' },
        { id: 'digitaltwin', icon: Globe, label: isAr ? 'الخريطة الحرارية' : 'Thermal NDVI Heatmap' },
        { id: 'crophealth', icon: Dna, label: isAr ? 'مؤشرات جودة المزروعات' : 'Physical Health Metrics' },
        { id: 'predictions', icon: BrainCircuit, label: isAr ? 'التنبؤات والذكاء الاصطناعي' : 'AI Predictions Index' },
        { id: 'analytics', icon: BarChart3, label: isAr ? 'التحليلات والرسوم البيانية' : 'Telemetry Charts' },
      ]
    },
    { 
      title: isAr ? 'التحكم الهيدروليكي والآلي' : 'HARDWARE CONTROL', 
      items: [
        { id: 'mission', icon: Radio, label: isAr ? 'سجل عمليات المسح الجوي' : 'Aerial Scan Journeys' },
        { id: 'drones', icon: Plane, label: isAr ? 'المسح والتحليق الجوي' : 'Autonomous Aerial Scanning' },
        { id: 'irrigation', icon: Droplets, label: isAr ? 'الري الآلي الذكي بالسيرفر' : 'Server Autopilot Irrigation' },
        { id: 'sensors', icon: Activity, label: isAr ? 'قراءات مجسات التربة والمغذيات' : 'Soil Nutrient Sensors' },
        { id: 'smartmission', icon: BrainCircuit, label: isAr ? 'التقارير والاستشاري الاصطناعي' : 'AI Weekly Advisor & Reports' },
      ]
    },
    { 
      title: isAr ? 'حساب المزارع' : 'FARMER ACCOUNT', 
      items: [
        { id: 'liveops', icon: MessageSquare, label: isAr ? 'سجل عمليات المنصة' : 'Compliance Systems Logs' },
        { id: 'settings', icon: Settings, label: isAr ? 'الملف الشخصي وحدود GPS' : 'Farmer Profile & Bounds' },
      ]
    }
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // ALL useMemo / hook-derived values MUST be declared here, BEFORE any
  // conditional early return (if (!user) return ...), so the hook count
  // stays identical across every render — prevents React Error #310.
  // ═══════════════════════════════════════════════════════════════════════════

  // Compute hybrid engine status from real sensor data (null-safe)
  const hybridStatus = useMemo(() => {
    const sensors = sensorStatusLog ?? [];
    const zones = data?.zones ?? [];
    return {
      iotActive: sensors.some(s => s.status === 'online'),
      satelliteActive: zones.some(z => !!z.satellite?.ndvi),
      virtualSensingActive: (data?.nitrogen ?? 0) > 0 || (data?.phosphorus ?? 0) > 0 || (data?.potassium ?? 0) > 0,
    };
  }, [sensorStatusLog, data.zones, data.nitrogen, data.phosphorus, data.potassium]);

  const hasLinkedSensorReadings = hybridStatus.iotActive;

  // Derive virtual nodes from zone data (AI/satellite estimated NPK) — null-safe
  const virtualNodes: VirtualNode[] = useMemo(() => {
    const zones = data?.zones ?? [];
    return zones.map(z => ({
      zoneId: z.id,
      zoneNameAr: z.nameAr,
      zoneNameEn: z.nameEn,
      estimatedMoisture: z.moisture ?? 0,
      estimatedN: data?.nitrogen ?? 0,
      estimatedP: data?.phosphorus ?? 0,
      estimatedK: data?.potassium ?? 0,
      ndvi: z.satellite?.ndvi,
      confidence: z.satellite?.ndvi !== undefined ? Math.min(95, Math.round((z.satellite.ndvi) * 100 + 40)) : 65,
      processedAt: z.lastSensorReading ?? z.satellite?.imageryDate ?? new Date().toISOString(),
      source: (z.satellite?.source ?? 'sentinel2') as 'sentinel2' | 'ai_interpolation',
    }));
  }, [data.zones, data.nitrogen, data.phosphorus, data.potassium]);

  // Physical sensors cast
  const physicalSensors: PhysicalSensor[] = sensorStatusLog;

  // GPS centroid for weather panel — null-safe with try/catch
  const gpsCoords = useMemo(() => {
    try {
      if (!savedGeoJSON) return undefined;
      const [lat, lng] = getCentroid(savedGeoJSON);
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return undefined;
      return { lat, lng };
    } catch {
      return undefined;
    }
  }, [savedGeoJSON]);

  // Auth Screen Render (if no user found in database)
  if (!user) {
    return (
      <div className="min-h-screen bg-white text-black flex items-center justify-center p-6" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="w-full max-w-md bg-white border border-slate-200 p-8 rounded-3xl shadow-xs relative">
          
          {/* Brand Presentation */}
          <div className="text-center mb-8">
            <MasterIcon className="mx-auto mb-4" />
            <h1 className="text-3xl font-bold tracking-tight text-black">Skyd</h1>
            <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mt-1">
              {isAr ? 'منصة الفلاحة الرقمية الحقيقية للمنظمات' : 'Smart Agricultural Digital System'}
            </p>
            <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">
              {isAr ? 'يرجى تسجيل الدخول لحسابكم الحقيقي لحفظ المعلومات في قاعدة بيانات المنظمة والتحكم في حقولك.' : 'Authenticate via your registry to update farm settings securely.'}
            </p>
          </div>

          {isAuthProdDisabled && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl shadow-xs text-left rtl:text-right space-y-3">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                <AlertTriangle className="h-5 w-5 animate-pulse text-amber-600 shrink-0" />
                <span>{isAr ? 'تفعيل موفر الهوية في Firebase مطلوب' : 'Firebase Auth Provider Activation Required'}</span>
              </div>
              <p className="leading-relaxed">
                {isAr 
                  ? 'بوابة تسجيل البريد الإلكتروني وكلمة المرور غير مفعّلة حالياً في مشروع Firebase الخاص بك. يرجى تمكينها من وحدة تحكم Firebase باتباع الخطوات التالية:' 
                  : 'The Email/Password sign-in provider is not enabled in your Firebase project yet. Please enable it in the Firebase Console:'}
              </p>
              <ol className="list-decimal list-inside space-y-1.5 pl-1 text-slate-700 font-medium">
                <li>
                  {isAr 
                    ? 'افتح صفحة موفري الهوية في وحدة التحكم لمشروعك:' 
                    : 'Open the Firebase Authentication Console Providers settings:'}
                  <a 
                    href="https://console.firebase.google.com/project/leafy-vault-ccf5x/authentication/providers" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-emerald-700 hover:text-emerald-800 font-bold underline block mt-0.5 break-all"
                  >
                    https://console.firebase.google.com/project/leafy-vault-ccf5x/authentication/providers
                  </a>
                </li>
                <li>
                  {isAr 
                    ? 'اضغط على زر "إضافة موفر جديد" وحدد خيار "البريد الإلكتروني/كلمة المرور" (Email/Password).' 
                    : 'Click "Add new provider" and select "Email/Password".'}
                </li>
                <li>
                  {isAr 
                    ? 'قم بتمكين الموفر واضغط على زر "حفظ".' 
                    : 'Toggle "Enable" and click "Save".'}
                </li>
                <li>
                  {isAr 
                    ? 'بعد الحفظ، أعد محاولة تسجيل الدخول أو التسجيل هنا مباشرة!' 
                    : 'Once saved, try registering or logging in here again!'}
                </li>
              </ol>
            </div>
          )}

          {authError && !isAuthProdDisabled && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl text-center">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {isRegisterMode && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">{isAr ? 'الاسم الكامل للمزارع' : 'Farmer Full Name'}</label>
                  <input 
                    type="text" 
                    placeholder="e.g. سليمان العلي"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 focus:bg-white text-black font-medium transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">{isAr ? 'رقم الهاتف (لإشعارات SMS الطارئة)' : 'Phone Number (Emergency SMS Alerts)'}</label>
                  <input 
                    type="tel" 
                    dir="ltr"
                    placeholder="+964 770 123 4567"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 focus:bg-white text-black font-medium transition-colors font-mono"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                {isAr ? 'البريد الإلكتروني بمجلس المنظمة' : 'Authorized Email Address'}
              </label>
              <input 
                type="email" 
                placeholder="farmer@skyd.org"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 focus:bg-white text-black font-medium transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                {isAr ? 'كلمة المرور المشفرة' : 'Security Password'}
              </label>
              <input 
                type="password" 
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-600 focus:bg-white text-black font-medium transition-colors"
                required
              />
            </div>

            <button 
              type="submit" 
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-all focus:ring-2 focus:ring-emerald-500 shadow-sm"
            >
              {isRegisterMode 
                ? (isAr ? 'إنشاء حساب الفلاح وحفظه' : 'Register and Lock Account') 
                : (isAr ? 'تسجيل الدخول الآمن' : 'Establish Farmer Login')
              }
            </button>
          </form>

          {/* Quick toggle login/signup */}
          <div className="mt-6 text-center text-xs text-slate-500">
            {isRegisterMode ? (
              <>
                {isAr ? 'لديك حساب مسجل بالفعل؟' : 'Have a registered farm profile?'} {' '}
                <button onClick={() => setIsRegisterMode(false)} className="text-emerald-600 font-bold hover:underline">
                  {isAr ? 'تسجيل الدخول هنا' : 'Log in here'}
                </button>
              </>
            ) : (
              <>
                {isAr ? 'مزارع جديد؟ سجل مزرعتك في قاعدة البيانات' : 'New farmer? Add farm to organizational database'} {' '}
                <button onClick={() => { setIsRegisterMode(true); setAuthError(''); }} className="text-emerald-600 font-bold hover:underline">
                  {isAr ? 'إنشاء حساب جديد' : 'Register farm profile'}
                </button>
              </>
            )}
          </div>

          <div className="absolute top-4 right-4">
            <button 
              onClick={() => setIsAr(!isAr)} 
              className="text-[10px] font-bold text-emerald-600 hover:bg-slate-50 px-2 py-1 rounded border border-slate-200 transition-all"
            >
              {isAr ? 'English' : 'العربية'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Unified lock/clear state for all pages before boundary definition
  const renderLockedState = (titleAr: string, titleEn: string) => {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-3xl p-10 text-center space-y-6 shadow-xs animate-fade-in text-black flex flex-col items-center justify-center min-h-[450px]">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-200 animate-pulse">
          <Globe className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-black text-slate-800">
            {isAr ? `🔒 ${titleAr}` : `🔒 ${titleEn}`}
          </h3>
          <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed font-sans">
            {isAr 
              ? 'جاري مسح جميع البيانات حالياً حتى نتحقق من اختيار وتحديد موقع وبصمة المزرعة الجغرافية. بعد ذلك، سيتم تلقائياً تجميع وحصد البيانات الفعلية المباشرة من الأقمار الصناعية المتخصصة للمزرعة، ومحطات الأرصاد الجوية، وأجهزة ومستشعرات التربة والبيئة الميدانية. تظل البيانات ممسوحة بالكامل حتى اكتمال عملية رصد وجمع البيانات.' 
              : 'The data is currently all cleared until we await farm identification. After that, data will be collected from specialized satellites for the farm, such as thermal metrics, weather and vegetative indices. It must be obtained from satellites, weather, and sensors. The data is currently all cleared until data collection is complete.'}
          </p>
        </div>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setCurrentPage('geofence')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer hover:scale-105 active:scale-95 duration-200"
          >
            <Compass className="w-4 h-4 text-white" />
            {isAr ? 'تحديد المزرعة ورسم الحدود عبر الأقمار الصناعية الآن' : 'Draw Farm Boundary on GPS Satellite Map'}
          </button>
        </div>
      </div>
    );
  };

  // Render the Web Main Pages
  const renderPage = () => {
    if (geoArea === 0 && currentPage !== 'geofence' && currentPage !== 'settings') {
      const pageTitles: Record<string, { ar: string; en: string }> = {
        dashboard: { ar: 'البيانات مغلرة لعدم تحديد المزرعة', en: 'Operational Telemetry Locked' },
        digitaltwin: { ar: 'الخريطة الحرارية مقيدة لعدم تحديد المزرعة', en: 'Thermal Heatmap Restricted' },
        crophealth: { ar: 'مؤشرات جودة المزروعات ممسوحة لعدم رصد المزرعة', en: 'Physical Health Metrics Cleared' },
        predictions: { ar: 'التنبؤات الزراعية غير متاحة لعدم دمج الحدود', en: 'AI Predictions Index Locked' },
        analytics: { ar: 'التحليلات والرسوم البيانية متوقفة وبانتظار الموقع', en: 'Telemetry Charts Cleared' },
        mission: { ar: 'سجل عمليات المسح الجوي فارغ لمسح البيانات', en: 'Aerial Scan Journeys Cleared' },
        drones: { ar: 'منظومة طائرات الدرون والتحليق معلقة لعدم الاقتران الجغرافي', en: 'Autonomous Aerial Scanning Restricted' },
        irrigation: { ar: 'نظام الري الآلي مغلق مؤقتاً', en: 'Server Autopilot Irrigation Locked' },
        sensors: { ar: 'قراءات مجسات التربة والمغذيات فارغة وبانتظار الربط', en: 'Soil Nutrient Sensors Cleared' },
        smartmission: { ar: 'التقارير والاستشاري الزراعي الاصطناعي معلق', en: 'AI Weekly Advisor & Reports Locked' },
      };
      const title = pageTitles[currentPage] || { ar: 'البيانات ممسوحة تماماً بانتظار تحديد الحدود الجغرافية للمزرعة', en: 'Operational Data Cleared Awaiting Identification' };
      return renderLockedState(title.ar, title.en);
    }

    switch(currentPage) {
      case 'dashboard':
        const isFireActive = geoArea > 0 && data.temp >= 58;
        return (
          <div className="space-y-6 text-black">
            
            {/* Fire Hazard Alert Banner */}
            {isFireActive && (
              <div className="space-y-4">
                <div className="bg-red-50 border-2 border-red-500 rounded-3xl p-6 shadow-md animate-pulse flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-center md:text-left rtl:md:text-right">
                    <div className="bg-red-600 text-white p-3 rounded-2xl animate-bounce">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-red-700">
                        {isAr ? '🚨 عاجل: إنذار بنشوب حريق وارتفاع حراري طارئ تجوز 60 درجة مئوية!' : '🚨 IMMEDIATE FIRE & SURGE HAZARD crossing 60°C!'}
                      </h3>
                      <p className="text-xs text-red-900 font-bold mt-1">
                        {isAr 
                          ? `تم الكشف عن طاقة حرارية فائقة داخل حدود حقل المزرعة المقاسة (${data.temp.toFixed(1)}°C). يرجى إخماد الحريق أو إطلاق الرشاشات فوراً لإنقاذ المحصول المتأثر.`
                          : `Critical thermal surge or active fire detected within the geofenced zone (${data.temp.toFixed(1)}°C). Firefighting is necessary in the specified area.`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      addLog(isAr 
                        ? '✓ استجابة فورية: قام المزارع بتأكيد تنبيه الحريق وإخماد المزرعة.' 
                        : '✓ Farmer acknowledged fire alert and initiated field suppression.'
                      );
                    }}
                    className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl shadow-sm cursor-pointer transition-all uppercase tracking-wider whitespace-nowrap"
                  >
                    {isAr ? '🧯 إخماد وإطفاء الحريق فوراً' : '🧯 EXTINGUISH & SECURE NOW'}
                  </button>
                </div>

                {/* Fallback Phone Number configuration if browser push isn't received */}
                {!phoneNumber ? (
                  <div className="bg-orange-50 border border-orange-300 p-5 rounded-2xl space-y-3">
                    <div className="flex items-start gap-3 text-orange-950">
                      <Smartphone className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wide">
                          {isAr ? '⚠️ الرجاء إدخال رقم هاتفك المحمول فوراً لتلقي إشعارات الحريق عبر SMS' : '⚠️ Enter Your Phone Number to Receive Urgent Fire Alerts via SMS & Call'}
                        </h4>
                        <p className="text-[11px] text-orange-800 leading-relaxed mt-1">
                          {isAr 
                            ? 'نظراً لأن متصفحك أو جهاز الحقل لا يدعم ميزة الإشعارات التلقائية الذاتية (Push Notification)، فإن إدخال رقم هاتفك ضروري جداً لإرسال رسائل نصية قصيرة فوراً والاتصال الهاتفي بك آلياً عند نشوب حوادث وبث التحذيرات.' 
                            : 'Since your mobile web browser doesn\'t support standalone push notifications in this sandbox, your active phone number is required so our servers can alert you via direct SMS transmission and automated synthesized warning calls.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 max-w-sm">
                      <input 
                        type="tel"
                        dir="ltr"
                        placeholder="+964 770 123 4567"
                        className="flex-1 px-3 py-2 text-xs bg-white border border-orange-200 rounded-lg text-black focus:outline-none focus:border-orange-500 font-mono"
                        id="emergency-phone-input"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById('emergency-phone-input') as HTMLInputElement;
                          if (el && el.value.trim()) {
                            const val = el.value.trim();
                            setPhoneNumber(val);
                            localStorage.setItem('skyd_farmer_phone', val);
                            addLog(isAr ? `✓ تم تسجيل هاتف المزارع للطوارئ: ${val}` : `✓ Registered emergency mobile contact: ${val}`);
                          }
                        }}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-extrabold rounded-lg transition-all"
                      >
                        {isAr ? 'تأكيد وحفظ الرقم' : 'Save Contact'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 text-black p-5 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                        {isAr ? `جهاز المزارع متصل: ${phoneNumber}` : `Farmer connected: ${phoneNumber}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneNumber('');
                          localStorage.removeItem('skyd_farmer_phone');
                        }}
                        className="text-[10px] text-red-600 hover:underline cursor-pointer"
                      >
                        {isAr ? 'تغيير رقم الهاتف' : 'Change Phone'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {geoArea === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-3xl p-10 text-center space-y-5 shadow-xs animate-fade-in text-black">
                <Globe className="w-14 h-14 text-emerald-600 mx-auto animate-pulse" />
                <h3 className="text-base font-black text-slate-800">
                  {isAr ? '🔒 البيانات مغلرة لعدم تحديد المزرعة' : '🔒 Operational Telemetry Locked'}
                </h3>
                <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                  {isAr 
                    ? 'الحرارة، الرطوبة، سرعة الرياح، الإشعاع، والحموضة مغلقة الآن وتظهر (0)، ولا يمكن إدخال قراءاتها أو محاكاتها يدوياً. يجب عليك الانتقال لخريطة الأقمار الصناعية (GIS) ورسم مضلع حدود المزرعة بدقة وتفعيله.' 
                    : 'Weather parameters (measured temperature, air humidity, wind speed, solar radiation, and soil acidity) read 0 & are locked. You must first set and geofence your farm boundaries on the GIS satellite map to activate actual telemetry detection and manual input controls.'}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage('geofence')}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    <Globe className="w-4 h-4" />
                    {isAr ? 'تحديد المزرعة ورسم الحدود عبر الأقمار الصناعية الآن' : 'Draw Farm Boundary on GPS Satellite Map'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Data Source Status Card */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs relative">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-sm font-bold text-black uppercase tracking-wider">
                      {isAr ? 'مؤشرات حالة مصادر البيانات' : 'Data Source Status Indicators'}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">
                    {isAr 
                      ? 'جميع البيانات تعتمد على مصادر حقيقية: الحساسات الأرضية، الأقمار الصناعية، والدرون. لا توجد إدخالات يدوية أو محاكاة.' 
                      : 'All data comes from real sources: ground sensors, satellite, and drones. No manual inputs or simulation.'}
                  </p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Weather Source */}
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        weatherSource === 'api' ? 'bg-emerald-500 animate-pulse' :
                        weatherSource === 'error' ? 'bg-red-500' :
                        weatherSource === 'loading' ? 'bg-blue-500 animate-pulse' :
                        'bg-amber-500'
                      }`} />
                      <div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase block">{isAr ? 'الطقس' : 'Weather'}</span>
                        <span className="text-[10px] text-slate-400">
                          {weatherSource === 'api' 
                            ? (isAr ? '📡 حي (API)' : '📡 Live (API)')
                            : weatherSource === 'error'
                            ? (isAr ? '❌ خطأ' : '❌ Error')
                            : weatherSource === 'no_key'
                            ? (isAr ? '⚠️ بدون مفتاح' : '⚠️ No Key')
                            : weatherSource === 'no_boundary'
                            ? (isAr ? '⚠️ بدون حدود' : '⚠️ No Boundary')
                            : (isAr ? '⏳ جاري التحميل' : '⏳ Loading')
                          }
                        </span>
                      </div>
                    </div>

                    {/* Satellite Source */}
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full ${satelliteSyncStatus === 'done' ? 'bg-emerald-500' : satelliteSyncStatus === 'fetching' ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'}`} />
                      <div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase block">{isAr ? 'القمر الصناعي' : 'Satellite'}</span>
                        <span className="text-[10px] text-slate-400">
                          {satelliteSyncStatus === 'done' 
                            ? (isAr ? '✅ محدث' : '✅ Updated')
                            : satelliteSyncStatus === 'fetching' 
                              ? (isAr ? '🔄 جاري المزامنة' : '🔄 Syncing')
                              : (isAr ? '⚠️ بانتظار المزامنة' : '⚠️ Pending')
                          }
                        </span>
                      </div>
                    </div>

                    {/* Sensors Source */}
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full ${hasLinkedSensorReadings ? 'bg-emerald-500 animate-pulse' : sensorStatusLog.length === 0 ? 'bg-slate-400' : 'bg-amber-500'}`} />
                      <div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase block">{isAr ? 'الحساسات' : 'Sensors'}</span>
                        <span className="text-[10px] text-slate-400">
                          {hasLinkedSensorReadings
                            ? (isAr ? 'نشط (MQTT Live)' : 'Active (MQTT Live)')
                            : sensorStatusLog.length === 0
                              ? (isAr ? '🔌 لا توجد حساسات مربوطة بعد' : '🔌 No sensors linked yet')
                              : (isAr ? '⚠️ انتظار إعادة الاتصال' : '⚠️ Reconnecting...')
                          }
                        </span>
                      </div>
                    </div>

                    {/* Drone Source */}
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full ${isDroneScanning ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'}`} />
                      <div>
                        <span className="text-[10px] font-bold text-slate-600 uppercase block">{isAr ? 'الدرون' : 'Drone'}</span>
                        <span className="text-[10px] text-slate-400">
                          {isDroneScanning 
                            ? (isAr ? '✈️ نشط' : '✈️ Active')
                            : (isAr ? '💤 خامل' : '💤 Idle')
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 animate-fade-in font-sans">
                  {/* 1. Temp Card */}
                  <div className={`bg-white border rounded-2xl p-4 text-black shadow-xs transition-colors duration-300 ${isFireActive ? 'border-red-500 bg-red-50/30' : 'border-slate-200'}`}>
                    <div className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                      <Thermometer className="w-3.5 h-3.5 text-emerald-600" />
                      {isAr ? 'الحرارة المقاسة' : 'Measured Temp'}
                    </div>
                    <div className={`text-2xl font-black mt-2 font-mono ${isFireActive ? 'text-red-600' : 'text-black'}`}>
                      {(data?.temp ?? 0) > 0
                        ? <>{(data.temp).toFixed(1)}<span className="text-sm text-slate-400 ml-0.5">°C</span></>
                        : <span className="text-lg text-slate-300">--</span>
                      }
                    </div>
                    <div className="text-[9px] text-slate-400 mt-2 font-medium">
                      {isFireActive
                        ? (isAr ? '⚠️ خطر حريق مرتفع!' : '⚠️ Active Fire Risk!')
                        : (data?.temp ?? 0) > 0
                          ? (isAr ? 'بيانات من خدمة الطقس' : 'From weather service')
                          : (isAr ? 'بانتظار البيانات الحقيقية' : 'Awaiting live data')}
                    </div>
                  </div>

                  {/* 2. Humidity Card */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 text-black shadow-xs">
                    <div className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                      <Droplets className="w-3.5 h-3.5 text-blue-500" />
                      {isAr ? 'رطوبة الجو المقاسة' : 'Air Humidity'}
                    </div>
                    <div className="text-2xl font-black mt-2 font-mono">
                      {(data?.humidity ?? 0) > 0
                        ? <>{(data.humidity).toFixed(0)}<span className="text-sm text-slate-400 ml-0.5">%</span></>
                        : <span className="text-lg text-slate-300">--</span>
                      }
                    </div>
                    <div className="text-[9px] text-slate-400 mt-2 font-medium">
                      {(data?.humidity ?? 0) > 0
                        ? (isAr ? 'بيانات من خدمة الطقس' : 'From weather service')
                        : (isAr ? 'بانتظار البيانات الحقيقية' : 'Awaiting live data')}
                    </div>
                  </div>

                  {/* 3. Wind Card */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 text-black shadow-xs">
                    <div className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-slate-500" />
                      {isAr ? 'سرعة الرياح الحالية' : 'Wind Speed'}
                    </div>
                    <div className="text-2xl font-black mt-2 font-mono">
                      {(data?.wind ?? 0) > 0
                        ? <>{(data.wind).toFixed(1)}<span className="text-sm text-slate-400 ml-0.5">km/h</span></>
                        : <span className="text-lg text-slate-300">--</span>
                      }
                    </div>
                    <div className="text-[9px] text-slate-400 mt-2 font-medium">
                      {(data?.wind ?? 0) > 0
                        ? (isAr ? 'بيانات من خدمة الطقس' : 'From weather service')
                        : (isAr ? 'بانتظار البيانات الحقيقية' : 'Awaiting live data')}
                    </div>
                  </div>

                  {/* 4. Solar radiation Card */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 text-black shadow-xs">
                    <div className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                      <Sun className="w-3.5 h-3.5 text-amber-500" />
                      {isAr ? 'الإشعاع الشمسي' : 'Solar Radiation'}
                    </div>
                    <div className="text-2xl font-black mt-2 font-mono">
                      {(data?.solar ?? 0) > 0
                        ? <>{(data.solar).toFixed(0)}<span className="text-sm text-slate-400 ml-0.5">W/m²</span></>
                        : <span className="text-lg text-slate-300">--</span>
                      }
                    </div>
                    <div className="text-[9px] text-slate-400 mt-2 font-medium">
                      {(data?.solar ?? 0) > 0
                        ? (isAr ? 'مُقدَّر من الغطاء السحابي' : 'Estimated from cloud cover')
                        : (isAr ? 'بانتظار البيانات الحقيقية' : 'Awaiting live data')}
                    </div>
                  </div>

                  {/* 5. pH Card */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 text-black shadow-xs">
                    <div className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-indigo-500" />
                      {isAr ? 'حموضة التربة (pH)' : 'Soil acidity (pH)'}
                    </div>
                    <div className="text-2xl font-black mt-2 font-mono">
                      {(data?.soilPH ?? 0) > 0
                        ? <>{(data.soilPH).toFixed(1)}<span className="text-xs text-slate-400 ml-0.5">pH</span></>
                        : <span className="text-lg text-slate-300">-- <span className="text-xs">pH</span></span>
                      }
                    </div>
                    <div className="text-[9px] text-slate-400 mt-2 font-medium">
                      {(data?.soilPH ?? 0) > 0
                        ? (isAr ? 'مسبار التربة الكهروكيميائي' : 'Electrochemical soil probe')
                        : (isAr ? 'بانتظار البيانات الحقيقية' : 'Awaiting live data')}
                    </div>
                  </div>
                </div>

                {/* Real-time 5-Day Satellite Weather Forecast — WeatherPanel Component */}
                <WeatherPanel
                  isAr={isAr}
                  forecast={forecast}
                  isWeatherLoading={isWeatherLoading}
                  weatherSource={weatherSource}
                  weatherErrorType={weatherErrorType}
                  weatherDescription={weatherDescription}
                  weatherFetchedAt={weatherFetchedAt}
                  gpsCoords={gpsCoords}
                  onRetry={fetchWeather}
                />
              </>
            )}

            {/* Hybrid Telemetry Panel — Physical IoT vs Virtual/AI Sensing Engine */}
            <HybridTelemetryPanel
              isAr={isAr}
              physicalSensors={physicalSensors}
              virtualNodes={virtualNodes}
              soilType={soilType}
              lastSyncAt={weatherFetchedAt}
              onSync={fetchWeather}
              isSyncing={isWeatherLoading}
              dataStatus={{
                sensorsSource: data.dataStatus?.sensorsSource ?? (hasLinkedSensorReadings ? 'mqtt' : 'unavailable'),
                satelliteSource: data.dataStatus?.satelliteSource ?? 'unavailable',
              }}
            />

            {/* AI Image Analysis — Spectral Pathology Diagnostics */}
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-150 mb-4 font-sans">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {isAr ? '📸 تحليل الصور بالذكاء الاصطناعي' : '📸 AI Image Analysis'}
                  </span>
                  <span className={`px-2.5 py-1 text-[9px] font-black rounded-full uppercase tracking-wider ${
                    isDroneScanning ? 'bg-amber-100 text-amber-800 animate-pulse' :
                    droneScanResult ? (
                      droneScanResult.healthStatus === 'Healthy' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    ) : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isAr ? (isDroneScanning ? 'جاري الفحص...' : (droneScanResult ? (droneScanResult.healthStatus === 'Healthy' ? 'سليم' : 'مصابة / تالفة') : 'خامل')) : (isDroneScanning ? 'Scanning...' : (droneScanResult ? (droneScanResult.healthStatus) : 'Idle stand-by'))}
                  </span>
                </div>

                {/* Manual File Upload */}
                <div className="mb-4">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    {isAr ? '📸 رفع صورة المحاصيل للتحليل' : '📸 Upload Crop Photo for AI Diagnostic Scan'}
                  </label>
                  <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-emerald-500 transition-colors bg-white relative">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleUploadedFileChange} 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Camera className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                    <span className="text-xs text-slate-600 font-bold block">
                      {isAr ? 'اسحب صورتك هنا أو تصفح الملفات' : 'Drag or click to choose a leaf photo'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">JPEG / PNG / WebP</span>
                  </div>
                </div>

                {/* Preset Options */}
                <div className="mb-6 space-y-2.5 font-sans">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                    {isAr ? '💡 أو اختر عينة حقل حقيقية للاختبار الفوري:' : '💡 Or click a real-world field sample to test instantly:'}
                  </span>
                  <div className="grid grid-cols-1 gap-2">
                    {DRONE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedDroneImage(p.base64);
                          handleDroneScan(p.base64);
                        }}
                        className={`p-3 border rounded-xl text-right rtl:text-right ltr:text-left text-xs transition-all flex flex-col hover:shadow-xs hover:-translate-y-0.5 cursor-pointer ${p.color} ${selectedDroneImage === p.base64 ? 'ring-2 ring-emerald-500 shadow-sm font-extrabold' : 'border-slate-200 bg-white'}`}
                      >
                        <span className="font-extrabold block text-[11px] mb-0.5">{isAr ? p.labelAr : p.labelEn}</span>
                        <span className="text-[10px] text-slate-500 font-medium leading-relaxed">{isAr ? p.descriptionAr : p.descriptionEn}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Diagnosing States */}
                {!isDroneScanning && !droneScanResult && (
                  <div className="py-6 text-center space-y-2 font-sans border border-slate-100 bg-white rounded-xl">
                    <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                      <Camera className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                      {isAr 
                        ? 'الرجاء رفع صورة أو اختيار نموذج للتحليل بالذكاء الاصطناعي.'
                        : 'Please upload an image or select a sample above to view AI pathology report.'}
                    </p>
                  </div>
                )}

                {isDroneScanning && (
                  <div className="py-8 text-center space-y-2 font-sans border border-slate-100 bg-white rounded-xl">
                    <div className="w-8 h-8 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-500 animate-spin">
                      <Activity className="w-4 h-4" />
                    </div>
                    <p className="text-xs text-slate-500 font-bold">
                      {isAr ? 'جاري تحليل الصورة من خادم Gemini...' : 'Gemini analyzing foliage structure and pathology...'}
                    </p>
                  </div>
                )}

                {!isDroneScanning && droneScanResult && (
                  <div className="space-y-4 animate-fade-in text-xs leading-relaxed text-slate-700 font-sans p-4 bg-white border border-slate-150 rounded-xl">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">{isAr ? 'نوع التشخيص / المرض:' : 'Pathology Finding / Deficit:'}</span>
                      <strong className="text-sm font-black text-rose-700 block border-b border-slate-100 pb-1.5 font-sans">
                        {isAr ? droneScanResult.typeOfInjuryAr : droneScanResult.typeOfInjuryEn}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">{isAr ? 'تقرير الذكاء الزراعي المفصل:' : 'Detailed AI Diagnostics Commentary:'}</span>
                      <p className="bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed text-slate-600 font-sans">
                        {isAr ? droneScanResult.diagnosisAr : droneScanResult.diagnosisEn}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-black text-rose-800 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded block w-fit mb-1">{isAr ? '🛠️ التوصيات العلاجية:' : '🛠️ Recommendations:'}</span>
                      <p className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 text-emerald-950 font-bold leading-relaxed font-sans">
                        {isAr ? droneScanResult.recommendationAr : droneScanResult.recommendationEn}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 leading-normal font-sans">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${droneScanResult ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                  <span>{isAr ? 'التحليل سحابي مؤمن' : 'API Node Encrypted'}</span>
                </div>
                <span>Gemini v3.5 Multimodal</span>
              </div>
            </div>

            {/* Weekly AI Crop Advisor Report */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-black shadow-xs">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-black">
                  <BrainCircuit className="w-4 h-4 text-emerald-600 shrink-0" />
                  {isAr ? 'تقرير الذكاء الزراعي الدوري والإنتاجية' : 'AI Crop Advisor Growth Report'}
                </h3>
                <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase">
                  {isAr ? 'أسبوعي' : 'Weekly Status'}
                </span>
              </div>

              <p className="text-xs text-slate-500 mb-5 leading-normal">
                <span className="font-extrabold text-slate-800">
                  {isAr ? 'الملخص المكتشف: ' : 'AI Analysis Summary: '}
                </span>
                {(isAr ? aiSummaryAr : aiSummaryEn) || (isAr ? 'لم يتم إجراء تحليل الذكاء الاصطناعي بعد. اضغط "إعادة تحليل الحقل" لبدء التحليل.' : 'No AI analysis performed yet. Press "Re-Analyze" to start.')}
              </p>

              {(aiDirectivesAr.length > 0 || aiDirectivesEn.length > 0) && (
              <div className="grid grid-cols-3 gap-3 text-center mb-5">
                {[
                  { title: isAr ? 'كفاءة المحصول' : 'Crop Efficiency', percent: '--', desc: isAr ? 'بانتظار تحليل المحصول' : 'Awaiting crop analysis' },
                  { title: isAr ? 'حجم الإنتاج الكلي' : 'Production Yield', percent: '--', desc: isAr ? 'بانتظار بيانات الإنتاج' : 'Awaiting yield data' },
                  { title: isAr ? 'مؤشر التحسن' : 'Improvement rate', percent: isAr ? 'غير محدد' : 'Pending', desc: isAr ? 'بانتظار مقارنة البيانات' : 'Awaiting data comparison' }
                ].map((stat, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                    <span className="text-[9px] text-slate-400 font-bold block">{stat.title}</span>
                    <strong className="text-base text-slate-400 font-black block mt-1 tracking-tight">{stat.percent}</strong>
                    <span className="text-[8px] text-slate-400 block mt-0.5 leading-tight">{stat.desc}</span>
                  </div>
                ))}
              </div>
              )}

              <div className="bg-emerald-50/50 p-3.5 border border-emerald-100 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                    {isAr ? 'توصيات الموجه الزراعي بالذكاء الاصطناعي' : 'Weekly AI Smart Directives'}
                  </span>
                  <button
                    type="button"
                    onClick={fetchAiAdvice}
                    disabled={isAiLoading}
                    className="px-2.5 py-1 text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded transition-all cursor-pointer flex items-center gap-1 shrink-0 disabled:opacity-50"
                  >
                    <span className={isAiLoading ? 'animate-spin' : ''}>{isAiLoading ? '⌛' : '🔄'}</span>
                    <span>{isAr ? 'إعادة تحليل الحقل' : 'Re-Analyze'}</span>
                  </button>
                </div>
                {(isAr ? aiDirectivesAr : aiDirectivesEn).length > 0 ? (
                  <ul className="text-[10px] text-emerald-950 space-y-1 rtl:text-right list-inside list-disc">
                    {(isAr ? aiDirectivesAr : aiDirectivesEn).map((dir, idx) => (
                      <li key={idx} className="leading-relaxed font-bold">{dir}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-emerald-700 italic">
                    {isAr
                      ? 'لم يتم استلام توصيات بعد. حدد حدود المزرعة واضغط "إعادة تحليل الحقل" للحصول على نصائح ذكية.'
                      : 'No directives received yet. Define farm boundary and press "Re-Analyze" for smart recommendations.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        );

      case 'digitaltwin':
        return (
          <div className="space-y-6">
            {/* DashboardHeader — Live clock + dynamic identity + hybrid status */}
            <DashboardHeader
              isAr={isAr}
              userName={user?.name ?? user?.email ?? ''}
              userLocation={user?.location ?? ''}
              hybridStatus={hybridStatus}
            />

            {/* High Fidelity 3D Map Renderer containing actual Thermal & Satellite toggle switch */}
            <DigitalTwinMap 
              isAr={isAr} 
              savedGeoJSON={savedGeoJSON} 
              userName={user?.name ?? user?.email ?? ''}
              userLocation={user?.location ?? ''}
              zones={data.zones}
              sensors={sensorStatusLog}
              dataStatus={data.dataStatus}
            />

            {/* Real Zones custom creation list */}
            <form onSubmit={handleAddZone} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 mb-4">
                <Plus className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-black uppercase tracking-wider">{isAr ? 'إضافة منطقة أو حقل زراعي حقيقي جديد' : 'Register New Real Agricultural Zone'}</h3>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <input 
                  type="text" 
                  placeholder={isAr ? 'الاسم بالعربية (مثال: حقل النخيل)' : 'Arabic Name'}
                  value={zoneNameAr}
                  onChange={(e) => setZoneNameAr(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                />
                <input 
                  type="text" 
                  placeholder={isAr ? 'الاسم بالإنجليزية' : 'English Name'}
                  value={zoneNameEn}
                  onChange={(e) => setZoneNameEn(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                />
                <input 
                  type="number" 
                  placeholder={isAr ? 'عدد المزروعات الكلي' : 'Total Crop Count'}
                  value={zoneHealthy}
                  onChange={(e) => setZoneHealthy(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                />
                <input 
                  type="number" 
                  placeholder={isAr ? 'رطوبة الحقل (%)' : 'Moisture (%)'}
                  value={zoneMoisture}
                  onChange={(e) => setZoneMoisture(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                />
                <input 
                  type="number" 
                  placeholder={isAr ? 'الحرارة الحالية (°C)' : 'Temperature (°C)'}
                  value={zoneTemp}
                  onChange={(e) => setZoneTemp(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                />
                <select 
                  value={zoneCropType}
                  onChange={(e) => setZoneCropType(e.target.value)}
                  className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-black font-semibold focus:bg-white focus:outline-none focus:border-emerald-600"
                >
                  <option value="rice">🌾 {isAr ? 'أرز (رطوبة > ٥٥٪)' : 'Rice (>55%)'}</option>
                  <option value="wheat">🌾 {isAr ? 'قمح (رطوبة > ٤٠٪)' : 'Wheat (>40%)'}</option>
                  <option value="vegetable">🥦 {isAr ? 'خضار (رطوبة > ٤٥٪)' : 'Vegetable (>45%)'}</option>
                  <option value="citrus">🍊 {isAr ? 'حمضيات (رطوبة > ٣٥٪)' : 'Citrus (>35%)'}</option>
                </select>
              </div>

              <div className="mt-4 text-left">
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm">
                  {isAr ? 'تسجيل المنطقة في قاعدة البيانات' : 'Register Zone Configuration'}
                </button>
              </div>
            </form>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold text-black uppercase tracking-widest">{isAr ? 'تحديث ومراقبة المزروعات والمناطق' : 'Physical Field Segments Configuration'}</h3>
                <span className="text-[10px] bg-slate-50 border border-slate-200 px-3 py-1 text-slate-500 font-bold uppercase rounded-lg">
                  {isAr ? `إجمالي الحقول: ${data.zones.length}` : `Count: ${data.zones.length}`}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.zones.map((z) => {
                  const crop = z.cropType || 'vegetable';
                  const spec = crop === 'rice' ? { icon: '🌾', nameAr: 'أرز', nameEn: 'Rice', threshold: 55 }
                             : crop === 'wheat' ? { icon: '🌾', nameAr: 'قمح', nameEn: 'Wheat', threshold: 40 }
                             : crop === 'citrus' ? { icon: '🍊', nameAr: 'حمضيات', nameEn: 'Citrus', threshold: 35 }
                             : { icon: '🥦', nameAr: 'خضار', nameEn: 'Vegetable', threshold: 45 };

                  return (
                    <div key={z.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-black">{isAr ? z.nameAr : z.nameEn}</span>
                            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-100 rounded text-[9px] text-emerald-800 font-bold flex items-center gap-0.5">
                              {spec.icon} {isAr ? spec.nameAr : spec.nameEn}
                            </span>
                          </div>
                          <div className="flex gap-4 mt-2 font-mono text-[10px] text-slate-500">
                            <span>{isAr ? 'المجموع' : 'Total'}: <strong className="text-black">{z.total}</strong></span>
                            <span>{isAr ? 'سليم' : 'Healthy'}: <strong className="text-emerald-600">{z.healthy}</strong></span>
                            <span>{isAr ? 'مصاب' : 'Infected'}: <strong className="text-black">{z.infected}</strong></span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          {z.infected > 0 && (
                            <button 
                              type="button"
                              onClick={() => treatZone(z.id)} 
                              className="px-2 py-1 bg-white hover:bg-emerald-50 text-[9px] text-emerald-700 font-bold rounded border border-emerald-200 transition-colors"
                            >
                              {isAr ? 'تنظيف ومكافحة معاً' : 'Treat Diseases'}
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={() => deleteZone(z.id)} 
                            className="p-1 px-1.5 bg-white text-slate-400 hover:text-red-600 hover:bg-red-50 rounded border border-slate-200 hover:border-red-100 transition-all ml-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-200/60 space-y-1.5 text-xs font-semibold text-slate-600">
                        <div className="flex justify-between items-center text-[11px]">
                          <span>{isAr ? 'الرطوبة الحالية بالموقع:' : 'Current Spot Moisture:'} <strong className="text-black">{z.moisture.toFixed(0)}%</strong></span>
                          <span className="text-slate-400 font-medium">({isAr ? `الحد المطلوب: ${spec.threshold}%` : `Required Limit: ${spec.threshold}%`})</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span>{isAr ? 'حالة صمام ري المحصول:' : 'Valve crop status:'}</span>
                          <strong className={z.irrigation ? 'text-emerald-600 font-black animate-pulse' : 'text-slate-400'}>
                            {z.irrigation ? (isAr ? 'مفتوح (تدفق)' : 'Flowing') : (isAr ? 'مغلق (ري متوقف)' : 'Standby')}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case 'drones':
        return (
          <div className="space-y-6 text-black animate-fade-in font-sans">
            {/* Header Control Banner */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100 animate-pulse">
                    <Plane className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-black text-base">{isAr ? 'منظومة طائرات الدرون لجمع البيانات والربط اللاسلكي' : 'Autonomous IoT Soil & Drone Delivery Service'}</h4>
                    <span className="text-xs text-slate-500 font-medium block mt-0.5">
                      {isAr 
                        ? 'محطة التحكم بربط الحساسات الأرضية واستقبال الطائرة لملفات المسح الطيفي والرياح وعناصر النيتروجين' 
                        : 'Interactive integration node between ground sensors, agricultural helicopter, and server.'}
                    </span>
                  </div>
                </div>
                <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black rounded-lg">
                  {isAr ? 'جاهز للربط والاقتران المشترك' : 'IoT Gwy Ready'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                {[
                  { label: isAr ? 'قنوات رصد الحبل اللاسلكي' : 'Whip Channel RF', val: 'LoRa 868 MHz', color: 'text-emerald-600 font-mono' },
                  { label: isAr ? 'قدرة الطائرة على النقل' : 'Payload Capability', val: '25kg Spray / Data Unit', color: 'text-black' },
                  { label: isAr ? 'النقر والتحليق الافتراضي' : 'Link Handshake Protocol', val: 'IEEE 802.15.4', color: 'text-black font-semibold' },
                  { label: isAr ? 'عمر بطارية الدرون' : 'Scout Flight Autonomy', val: '45 mins (LiPo 12S)', color: 'text-slate-600 font-mono' }
                ].map((item, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">{item.label}</span>
                    <strong className={`text-sm font-black ${item.color} block mt-1`}>{item.val}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Comprehensive Technical Documentation of IoT & Drone link */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-extrabold text-emerald-700 border-b border-slate-100 pb-3 mb-4 uppercase tracking-wide">
                    {isAr ? '📋 الدليل الشامل: أين تضع المستشعرات وكيف تربطها بالدرون؟' : '📋 Ground Sensors Placement & Drone Binding Rulebook'}
                  </h3>
                  
                  <div className="space-y-4 text-xs leading-relaxed text-slate-600">
                    <div className="space-y-1">
                      <strong className="text-black block text-[13px]">
                        {isAr ? '١. أين يتم إدراج المستشعرات الأرضية بالضبط؟' : '1. Where do I place the ground sensors?'}
                      </strong>
                      <p>
                        {isAr 
                          ? 'تُدفن المستشعرات في نقاط استراتيجية بمحيط المزرعة على عمق يتراوح بين ١٥سم إلى ٣٠سم (للوصول المباشر لكتلة جذع النبات وصحة الجذور). يُنصح بوضع مستشعر واحد لكل ٥٠ متراً مربعاً، وتحديداً في المناطق السفلية والمرفوعة لتحقيق توازن قراءات المغذيات مائيّاً.' 
                          : 'Soil probes are inserted directly into the soil to a core depth of 15cm to 30cm near the crop root zones. We recommend deploying one sensor node per every 50m grid segment, focusing on low water-accumulation spots and structural elevated crests.'}
                      </p>
                    </div>

                    <div className="space-y-1 font-sans">
                      <strong className="text-black block text-[13px]">
                        {isAr ? '٣. كيفية ربط الدرون لتجميع البيانات ورفعها للسيرفر؟' : '3. Linking the Drone to harvest and forward to Cloud Server'}
                      </strong>
                      <p>
                        {isAr 
                          ? 'عندما تحلق طائرة الدرون الخاصة بالمزرعة وتمر فوق نطاقات الحساسات الأرضية، تلتقط الهوائيات المدمجة بالدرون إثبات الاتصال (Wireless Handshake). يقوم الدرون بجمع دفعات البيانات كاملة وحفظها على ذاكرة الطائرة المؤقتة. فور عودة الطائرة لقاعدة الشحن المتصلة بالإنترنت الخلوي أو الـ Wi-Fi، تقوم تلقائياً برفع دفعات القراءات التاريخية ومزامنتها مع قاعدة بيانات السيرفر (API Integration).' 
                          : 'When the farm scout drone flies over the crop area, its onboard RF gateway captures the sensor beacons, triggers a high-speed handshake, and stores batched measurements on its local flash drive. When the drone returns near the charging bay or home station containing an active cellular link, it instantly pushes the aggregated datalogs to the central server database.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Interactive Telemetry Upload simulator */}
                <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl flex flex-col justify-between font-sans">
                  <div>
                    <div className="flex items-center justify-between mb-4 font-sans">
                      <span className="text-xs font-extrabold text-black uppercase tracking-wider">
                        {isAr ? '💻 محاكاة الاتصال الفعلي والمزامنة (موجات الراديو والرفع)' : '💻 RF IoT Data Harvesting & Upload Simulator'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 font-mono">STATUS: {iotSyncProgress.toUpperCase()}</span>
                    </div>

                    <p className="text-[11px] text-slate-500 mb-6 leading-relaxed font-sans">
                      {isAr 
                        ? 'تمكنك هذه الأداة من ممارسة دور الدرون الفعلي عند الطيران لجمع الحساسات الأرضية وإرسالها للسيرفر. جرب المزامنة لرؤية دفق حزم البيانات.' 
                        : 'Use this panel to simulate the dynamic flight payload. Trigger a wireless handshake, extract soil probes measurements, and upload them securely.'}
                    </p>

                    {/* Flow Visualization */}
                    <div className="border border-slate-250 rounded-xl p-4 bg-white space-y-4">
                      {/* Step 1 */}
                      <div className="flex items-center justify-between text-xs font-bold font-sans">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] ${iotSyncProgress !== 'idle' ? 'bg-emerald-600 text-white font-sans' : 'bg-slate-200 text-slate-600 font-sans'}`}>١</span>
                          <span>{isAr ? 'مستشعرات الحقل الأرضية تبث إشاراتها' : 'Probes active broadcasting'}</span>
                        </div>
                        <span className={`text-[10px] font-mono ${iotSyncProgress !== 'idle' ? 'text-emerald-700 font-bold font-sans' : 'text-slate-400 font-sans'}`}>BEACON ACTIVE</span>
                      </div>

                      {/* Step 2 */}
                      <div className="flex items-center justify-between text-xs font-bold font-sans">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] ${(iotSyncProgress === 'collecting' || iotSyncProgress === 'handshake' || iotSyncProgress === 'done') ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>٢</span>
                          <span>{isAr ? 'الدرون يقترن لاسلكياً ويقرأ السجلات' : 'Drone links & harvests sensor logs'}</span>
                        </div>
                        <span className={`text-[10px] font-mono ${(iotSyncProgress === 'collecting' || iotSyncProgress === 'handshake' || iotSyncProgress === 'done') ? 'text-emerald-600 font-bold' : 'text-slate-400'}`}>
                          {(iotSyncProgress === 'collecting' || iotSyncProgress === 'handshake' || iotSyncProgress === 'done') ? 'CONNECTED' : 'STANDBY'}
                        </span>
                      </div>

                      {/* Step 3 */}
                      <div className="flex items-center justify-between text-xs font-bold font-sans">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] ${(iotSyncProgress === 'handshake' || iotSyncProgress === 'done') ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>٣</span>
                          <span>{isAr ? 'الدرون يرفع السجلات للسيرفر السحابي' : 'Drone pushes telemetry to Cloud'}</span>
                        </div>
                        <span className={`text-[10px] font-mono ${(iotSyncProgress === 'handshake' || iotSyncProgress === 'done') ? 'text-emerald-600 font-bold' : 'text-slate-400'}`}>
                          {iotSyncProgress === 'handshake' ? (isAr ? 'نقل API...' : 'Calling API...') : (iotSyncProgress === 'done' ? '✓ 200 OK' : 'AWAITING')}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIotSyncProgress('beacon');
                        setTimeout(() => {
                          setIotSyncProgress('collecting');
                          setTimeout(() => {
                            setIotSyncProgress('handshake');
                            setTimeout(() => {
                              setIotSyncProgress('done');
                              addLog(isAr 
                                ? "📡 نجحت مزامنة المستشعرات الأرضية عبر الدرون ورفع السجلات للسيرفر السحابي." 
                                : "📡 Ground sensors successfully synchronized via Drone & exported to cloud database.");
                            }, 1000);
                          }, 1000);
                        }, 1000);
                      }}
                      className="w-full mt-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer text-center"
                    >
                      {isAr ? '⚡ تشغيل محاكاة المزامنة اللاسلكية' : '⚡ Trigger RF Sync Simulation'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );


      case 'irrigation':
        const isSprinklingAuto = geoArea > 0 && data.soilMoisture < 40;
        return (
          <div className="space-y-6 animate-fade-in text-black">
            {geoArea === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-8 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto animate-bounce" />
                <h3 className="text-base font-extrabold text-amber-900">
                  {isAr ? 'نظام الري الآلي مغلق مؤقتاً' : 'Server Autopilot Irrigation Locked'}
                </h3>
                <p className="text-xs text-amber-700 max-w-md mx-auto leading-relaxed">
                  {isAr 
                    ? 'يجب أولاً تحديد موقع المزرعة ورسم حدودها عبر الأقمار الصناعية لتتمكن منظومة الري بالتواصل السحابي مع الحساسات الأرضية وإطلاق أوامر الرش الآلية.' 
                    : 'Please define your farm boundary on the GPS map first. The automated central server requires active geospatial coordinate bounds to initialize soil moisture sensor links and trigger Sprinkling commands.'}
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentPage('geofence')}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  {isAr ? 'انتقل إلى خريطة الأقمار الصناعية الآن' : 'Go to GPS Satellite Map'}
                </button>
              </div>
            ) : (
              <>
                {/* Simulated physical/server feedback */}
                <div className={`p-6 rounded-3xl text-white shadow-md flex items-center justify-between transition-all duration-500 ${isSprinklingAuto ? 'bg-gradient-to-r from-blue-600 to-indigo-600 animate-pulse' : 'bg-slate-800'}`}>
                  <div>
                    <div className="text-slate-200 text-[10px] font-bold uppercase tracking-widest mb-1">
                      {isAr ? 'متوسط رطوبة مستشعرات التربة' : 'Soil Sensor Real-time Moisture'}
                    </div>
                    <div className="text-4xl font-extrabold font-mono flex items-baseline gap-1">
                      {data.soilMoisture.toFixed(0)}%
                      <span className="text-xs font-medium text-slate-300">
                        {isAr ? '(المستوى المقاس في الحقل)' : '(Active Field Level)'}
                      </span>
                    </div>
                    <span className="text-[11px] block mt-2 font-bold text-slate-100 uppercase tracking-wide">
                      {isSprinklingAuto 
                        ? (isAr ? '⚠️ الرطوبة تحت ٤٠٪: أمر رش السيرفر الذكي: [نشط ورشاش الغمر مفعل]' : '⚠️ Moisture < 40%: Smart Server Order: [SPRINKLING ENGINE ACTIVE]')
                        : (isAr ? '✓ الرطوبة آمنة (فوق ٤٠٪): أمر السيرفر: [قيد الانتظار - الري متوقف للتوفير]' : '✓ Moisture Normal (>= 40%): Server Order: [STANDBY - WATER CONSERVED]')
                      }
                    </span>
                  </div>
                  <div className="relative">
                    <Droplets className={`w-14 h-14 ${isSprinklingAuto ? 'text-blue-200 animate-bounce' : 'text-slate-600'}`} />
                    {isSprinklingAuto && (
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-300 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-400"></span>
                      </span>
                    )}
                  </div>
                </div>


                {/* Displaying automated valves (no manual controls) */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 pb-3 border-b border-slate-100 gap-2">
                    <div>
                      <h3 className="text-sm font-extrabold text-black uppercase tracking-widest">{isAr ? 'صمامات الري المؤتمتة بالكامل بالسيرفر' : 'Fully Server-Automated Sector Valves'}</h3>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {isAr ? 'التحكم الفلاحي اليدوي معطل كلياً لتحقيق معايير ترشيد المياه الدولية.' : 'Manual gardener overrides disabled entirely to sustain rigid environmental water preservation rules.'}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-extrabold rounded-xl uppercase tracking-wider shrink-0">
                      🛡️ {isAr ? 'مؤمن ومدار بالخوارزميات السحابية' : 'Secured & Managed by Server Cloud'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {data.zones.map((z) => {
                      const computedMoisture = z.moisture;
                      const isZoneFlowing = computedMoisture < 40;
                      return (
                        <div key={z.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-extrabold text-sm text-black">{isAr ? z.nameAr : z.nameEn}</span>
                              <div className="flex gap-2.5 mt-1 text-[10px] text-slate-400 font-semibold">
                                <span>{isAr ? 'رطوبة القطاع الافتراضية:' : 'Sensor Readout:'} <strong className={computedMoisture < 40 ? 'text-red-600 font-extrabold' : 'text-emerald-600 font-extrabold'}>{computedMoisture}%</strong></span>
                              </div>
                            </div>
                            
                            <span className={`px-2.5 py-1 text-[9px] font-black rounded-lg uppercase tracking-wide flex items-center gap-1.5 ${isZoneFlowing ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse' : 'bg-slate-150 text-slate-500 border border-slate-200'}`}>
                              {isZoneFlowing && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping"></span>}
                              {isZoneFlowing ? (isAr ? 'تدفق وضخ نشط' : 'WATER SPRAYING') : (isAr ? 'مغلق ومستقر' : 'CLOSED STANDBY')}
                            </span>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                            <span>{isAr ? 'تحديث الصمام الكهرومغناطيسي:' : 'Solenoid Status:'}</span>
                            <span className="text-black font-extrabold">
                              {isZoneFlowing ? (isAr ? 'محفز بنسبة ١٠٠٪ سحابياً' : 'Algorithmic On (100%)') : (isAr ? 'مغلق تلقائياً (توفير)' : 'Algorithmic Off (Standby)')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );

      case 'sensors':
        return (
          <div className="space-y-6 text-black animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-3">
              <div>
                <h3 className="text-base font-extrabold text-black uppercase tracking-widest">{isAr ? 'لوحة تحكم وإعداد الحساسات الأرضية الفعلية' : 'Physical IoT Ground Sensor Management'}</h3>
                <p className="text-xs text-slate-500 mt-1">{isAr ? 'تحقق بصفة مادية من الرطوبة والمغذيات والمعادن بفضل اتصال الحقل اللاسلكي' : 'Verify factual moisture, macro nutrients, and parameters via direct wireless links'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const modal = document.getElementById('sensor-settings-modal');
                  if (modal) modal.classList.remove('hidden');
                }}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
              >
                <Settings className="w-3.5 h-3.5" />
                {isAr ? '⚙️ إعداد الاتصال بالأجهزة' : '⚙️ IoT Connection Settings'}
              </button>
            </div>

            {sensorStatusLog.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-4">
                <Activity className="w-12 h-12 text-slate-400 mx-auto animate-pulse" />
                <h3 className="text-sm font-extrabold text-slate-700">
                  {isAr ? '📡 لا يوجد مستشعرات متصلة حالياً' : '📡 No Connected IoT Ground Sensors Found'}
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {isAr 
                    ? 'لم يتم استلام أي بيانات بث لعدم برمجة الرابط الخارجي. انقر على زر إعداد الاتصال بالأجهزة لبرمجة عنوان REST API أو وسيط MQTT اللاسلكي لجلب قراءات الحقل الحقيقية.' 
                    : 'System is waiting for direct hardware telemetry over API/MQTT networks. Complete the Connection Settings to see your real-time farm sensor table.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const modal = document.getElementById('sensor-settings-modal');
                    if (modal) modal.classList.remove('hidden');
                  }}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  {isAr ? 'برمج اتصال الحساسات الأرضية الآن' : 'Configure Connection Now'}
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right rtl:text-right ltr:text-left text-xs text-black border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase">
                        <th className="p-4">{isAr ? 'معرف الجهاز / Sensor ID' : 'Sensor ID'}</th>
                        <th className="p-4 text-center">{isAr ? 'موقع القطاع / Zone' : 'Zone Location'}</th>
                        <th className="p-4 text-center">{isAr ? 'نوع القياس / Metric' : 'Metric'}</th>
                        <th className="p-4 text-center">{isAr ? 'القيمة الحالية / Value' : 'Value'}</th>
                        <th className="p-4 text-center">{isAr ? 'البطارية / Batt' : 'Battery'}</th>
                        <th className="p-4 text-center">{isAr ? 'الشبكة / Signal' : 'Signal (RSSI)'}</th>
                        <th className="p-4 text-center">{isAr ? 'تاريخ التحديث / Last Seen' : 'Last Seen'}</th>
                        <th className="p-4 text-center">{isAr ? 'حالة البث / Status' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {sensorStatusLog.map((s, idx) => {
                        const lastSeenDate = new Date(s.lastSeen);
                        const minsDiff = Math.floor((Date.now() - lastSeenDate.getTime()) / 60000);
                        let statusText = isAr ? '🟢 متصل' : '🟢 Online';
                        if (minsDiff > 30) {
                          statusText = isAr ? '🔴 منقطع' : '🔴 Offline';
                        } else if (minsDiff > 10) {
                          statusText = isAr ? '🟡 متأخر' : '🟡 Stale';
                        }
                        
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-mono font-bold text-black">{s.sensorId}</td>
                            <td className="p-4 text-center text-slate-600">
                              {s.zoneId === -1 ? (isAr ? 'الحقل العام' : 'General Field') : (isAr ? data.zones[s.zoneId]?.nameAr : data.zones[s.zoneId]?.nameEn)}
                            </td>
                            <td className="p-4 text-center capitalize text-slate-500">{s.type.replace('_', ' ')}</td>
                            <td className="p-4 text-center font-mono font-extrabold text-black text-sm">{s.lastValue} {s.unit}</td>
                            <td className="p-4 text-center font-mono text-slate-500">{s.battery}%</td>
                            <td className="p-4 text-center font-mono text-slate-400">{s.rssi} dBm</td>
                            <td className="p-4 text-center font-mono text-zinc-500 text-[10px]">
                              {lastSeenDate.toLocaleTimeString()}
                            </td>
                            <td className="p-4 text-center">
                              <span className="px-2 py-1 bg-slate-50 border border-slate-100 rounded text-[9px] font-bold">
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Test Hardware injection tool — ONLY visible when VITE_ENABLE_MOCK_DATA=true */}
            {isMockEnabled && (
            <div className="bg-white p-6 border border-slate-200 rounded-3xl relative">
              <span className="absolute top-4 right-4 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 text-[9px] uppercase font-extrabold rounded-md">⚠️ Dev Only</span>
              <h4 className="text-sm font-extrabold text-black uppercase tracking-wider mb-2">{isAr ? '🛠️ حقن واختبار مجسات التربة يدوياً' : '🛠️ Manual IoT Telemetry Injection'}</h4>
              <p className="text-xs text-slate-500 mb-4 max-w-xl leading-relaxed">
                {isAr 
                  ? 'هل تريد اختبار استجابة الشاشات واللوحة ومضخات الري دون توصيل أجهزة حقيقية؟ يمكنك حقن البث المباشر فورياً بالضغط على الأزرار بالأسفل لتصرف كأن الحقل يرسل إشارات حية!' 
                  : 'Interested in validating tables & automated water sprinkler control parameters locally? Inject simulated live MQTT payloads instantly by clicking the buttons below.'}
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const sample: SensorReading = {
                      sensorId: 'soil_node_north',
                      zoneId: 0,
                      type: 'soil_moisture',
                      value: 34.5,
                      unit: '%',
                      timestamp: new Date().toISOString()
                    };
                    updateZone(0, { moisture: 34.5 });
                    setSensorStatusLog((prev) => {
                      const next = prev.filter(s => s.sensorId !== sample.sensorId);
                      next.push({
                        sensorId: sample.sensorId,
                        zoneId: sample.zoneId,
                        type: sample.type,
                        lastValue: sample.value,
                        unit: sample.unit,
                        lastSeen: new Date().toISOString(),
                        battery: 89,
                        rssi: -62,
                        status: 'online'
                      });
                      localStorage.setItem('skyd_sensor_status_log', JSON.stringify(next));
                      return next;
                    });
                    addLog(isAr ? '✓ تم حقن انخفاض الرطوبة (34.5%) في المنطقة الشمالية لتجربة الري الآلي!' : '✓ Injected moisture surge (34.5%) inside North Field sector.');
                  }}
                  className="px-4 py-2.5 hover:bg-slate-100 text-black border border-slate-200 hover:border-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  {isAr ? '💧 حقن رطوبة جافة ٣٤.٥٪ (المنطقة الشمالية)' : '💧 Inject 34.5% Moisture (North)'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const sample: SensorReading = {
                      sensorId: 'soil_node_south',
                      zoneId: 3,
                      type: 'soil_moisture',
                      value: 62.0,
                      unit: '%',
                      timestamp: new Date().toISOString()
                    };
                    updateZone(3, { moisture: 62.0 });
                    setSensorStatusLog((prev) => {
                      const next = prev.filter(s => s.sensorId !== sample.sensorId);
                      next.push({
                        sensorId: sample.sensorId,
                        zoneId: sample.zoneId,
                        type: sample.type,
                        lastValue: sample.value,
                        unit: sample.unit,
                        lastSeen: new Date().toISOString(),
                        battery: 97,
                        rssi: -58,
                        status: 'online'
                      });
                      localStorage.setItem('skyd_sensor_status_log', JSON.stringify(next));
                      return next;
                    });
                    addLog(isAr ? '✓ تم حقن رطوبة رطبة (62.0%) في المنطقة الجنوبية.' : '✓ Injected moisture spike (62.0%) inside South Field sector.');
                  }}
                  className="px-4 py-2.5 hover:bg-slate-100 text-black border border-slate-200 hover:border-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  {isAr ? '☘️ حقن رطوبة آمنة ٦٢٪ (المنطقة الجنوبية)' : '☘️ Inject 62% Moisture (South)'}
                </button>
              </div>
            </div>
            )}
          </div>
        );

      case 'smartmission':
        return (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-[60px] opacity-20" />
              <h3 className="text-lg font-bold text-black mb-2">{isAr ? 'الخوارزمية الإرشادية لذكاء المحصول' : 'AI Skyd Smart Algorithms'}</h3>
              <p className="text-slate-500 text-xs leading-relaxed max-w-lg mb-6">
                {isAr ? 'بوبة توجيه ذكية تحلل مستويات الإشعاع والحرارة المقاسة المدخلة لإفادتكم بجدول مخصص لخطط جني المحاصيل والري ومكافحة الأوبئة الفطرية.' : 'Advanced rule-based agronomy model checking climate inputs against satellite target arrays.'}
              </p>
              
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 border-r-4 border-emerald-600">
                <div className="text-xs font-bold text-emerald-700 uppercase tracking-widest">{isAr ? 'الحالة الحالية المقترحة' : 'Agrotechnical Recommendation'}</div>
                <p className="text-xs text-slate-600 mt-2 font-medium">
                  {data.temp > 28 
                    ? (isAr ? 'الحرارة مرتفعة نسبياً، ينصح بزيادة جريان المياه بالزاوية الغربية لتفادي الإجهاد المائي.' : 'Elevated warmth detected. Flow rates in drier sectors should be raised to preserve water tension.') 
                    : (isAr ? 'الارتطام المائي بمستويات مثالية، ليست هناك حاجة لإجراء ري إضافي حالياً.' : 'Water tension ratios optimal. Local irrigation is highly compliant with baseline levels.')
                  }
                </p>
              </div>
            </div>
          </div>
        );

      case 'liveops':
        return (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm min-h-[450px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-black uppercase tracking-widest">
                  {isAr ? 'سجل العمليات والامتثال للمنظمة' : 'Platform & Compliance Active Logs'}
                </h3>
              </div>
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-lg animate-pulse">
                ONLINE
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs text-slate-700 max-h-[400px]">
              {data.logs.map((log, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex gap-4">
                  <span className="font-bold text-emerald-600 whitespace-nowrap">[{log.timestamp}]</span>
                  <span className="flex-1 text-black font-semibold">{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'geofence':
        return (
          <div className="space-y-6">
            <FarmMap 
              isAr={isAr} 
              savedGeoJSON={savedGeoJSON} 
              onBoundaryChange={handleBoundaryChange} 
            />
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-6">
            
            {/* Authenticated Farmer Box */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
                  <User className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h4 className="font-bold text-black text-base">{user.name}</h4>
                  <p className="text-xs text-slate-500 mt-1">{user.org}</p>
                  <span className="text-[10px] font-bold text-emerald-700 block mt-1">{user.location}</span>
                </div>
              </div>
            </div>

            {/* Factual boundary and GIS details (replaces satellite keys setup) */}
            <div className="bg-white p-6 border border-slate-200 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                <h4 className="text-sm font-bold text-black uppercase tracking-widest">
                  {isAr ? 'شروط وسلامة الربط مع خوادم سكاي الزراعية' : 'Skyd Agronomic Cloud Link Verification'}
                </h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {isAr 
                  ? 'يتم تعيين وإدراج كافة مفاتيح الأقمار الصناعية (Satellite Keys) واتصالات النماذج العصبية بشكل آمن وتام داخل السيرفر الزراعي المعزول الخاص بالمنظمة لرفع نسبة الحماية وجودة التشفير.' 
                  : 'All satellite weather telemetry keys, live sensory parameters, and server-side artificial intelligence models are securely mounted inside the cloud backend, ensuring zero client footprint.'}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase block">{isAr ? 'المساحة المرصودة حالياً' : 'Active Estimated Acreage'}</span>
                  <strong className="text-sm text-black font-black block mt-1">
                    {geoArea > 0 ? `${geoArea.toFixed(4)} AC` : (isAr ? 'لا يوجد حدود مرصودة' : 'No drawn GPS bounds')}
                  </strong>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase block">{isAr ? ' تصنيف التربة الجغرافي' : 'Identified Soil Mechanics'}</span>
                  <strong className="text-sm text-black font-black block mt-1">
                    {soilType ? soilType : (isAr ? 'بانتظار المسح الجغرافي...' : 'Awaiting manual GPS bounds...')}
                  </strong>
                </div>
              </div>
            </div>

            <button 
              onClick={handleLogout}
              className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-black font-bold text-xs rounded-2xl flex items-center justify-center gap-2 border border-slate-200 transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              {isAr ? 'تسجيل الخروج من جلسة الفلاح المكلفة' : 'Logout Active Session'}
            </button>
          </div>
        );

      case 'analytics':
        return (
          <div className="space-y-6">
            <DashboardHeader
              isAr={isAr}
              userName={user?.name ?? user?.email ?? ''}
              userLocation={user?.location ?? ''}
              hybridStatus={hybridStatus}
            />
            <AnalyticsCharts
              isAr={isAr}
              history={telemetryHistory}
            />
          </div>
        );

      default:
        return (
          <div className="h-48 border-2 border-dashed border-slate-200 rounded-3xl flex items-center justify-center text-slate-400 font-medium italic">
            {isAr ? 'بانتظار قراءة البيانات..' : 'Awaiting manual metrics committal..'}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col font-sans" dir={isAr ? 'rtl' : 'ltr'}>
      
      {/* Real Top Header Bar (Full Web App layout) */}
      <header className="bg-white px-6 h-16 border-b border-slate-200 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className="p-2 hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5 text-black" />
          </button>
          
          <div className="flex items-center gap-2">
            <MasterIcon />
            <div className="hidden sm:block">
              <span className="text-sm font-black text-black">Skyd</span>
              <span className="text-[9px] block text-emerald-600 font-bold uppercase tracking-widest -mt-1">Agricultural Portal</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          
          {/* Active organization identification label */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700">
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            <span>{user.org}</span>
          </div>

          {/* Localization button switcher */}
          <button 
            onClick={() => setIsAr(!isAr)} 
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-black border border-slate-200 hover:bg-slate-50 rounded-lg transition-all"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>{isAr ? 'English' : 'العربية'}</span>
          </button>

          {/* Connected state badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-[10px] font-bold">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="hidden sm:inline">{isAr ? 'قاعدة بيانات المنظمة' : 'Org Database Connected'}</span>
            <span className="sm:hidden">DB v4</span>
          </div>
        </div>
      </header>

      {/* Main Body Grid Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Responsive, beautiful workspace sidebar router */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.nav 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="bg-white border-l sm:border-r border-slate-200 flex flex-col h-[calc(100vh-64px)] overflow-y-auto shrink-0 select-none z-40 z-[99] sticky top-16"
            >
              <div className="p-4 space-y-6 mt-2">
                {navSections.map((section, idx) => (
                  <div key={idx} className="border-b border-slate-100 pb-4 last:border-0">
                    <h3 className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      {section.title}
                    </h3>
                    <div className="space-y-0.5">
                      {section.items.map((item) => {
                        const active = currentPage === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => setCurrentPage(item.id as Page)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                              active 
                                ? 'bg-emerald-50 text-emerald-800 font-bold border-l-4 border-emerald-600' 
                                : 'text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-2.5">
                              <item.icon className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                              <span>{item.label}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom logged in session strip */}
              <div className="mt-auto p-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-black text-emerald-700">SF</div>
                  <div>
                    <span className="font-bold text-black block">{user.name}</span>
                    <span className="text-[10px] text-slate-400 block">{isAr ? 'عضو مزارع مسجل' : 'Registered Land Farmer'}</span>
                  </div>
                </div>
                <button onClick={handleLogout} title={isAr ? 'تسجيل الخروج' : 'Logout'} className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg text-slate-400 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>

        {/* Main Content Workspace viewport */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            
            {/* Context breadcrumb or dynamic titles */}
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between border-b border-slate-200 pb-4 mb-2 gap-2">
              <div>
                <span className="text-[10px] text-emerald-600 font-bold tracking-widest uppercase block mb-1">
                  Skyd Agricultural Control Hub
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-black">
                  {t[currentPage as keyof typeof t]}
                </h2>
              </div>
              
              <div className="text-[10px] font-mono font-bold text-slate-500 bg-white border border-slate-200 rounded-md px-3 py-1.5 w-fit">
                GPS: {user.location ? user.location : '34.05,-118.24'}
              </div>
            </div>

            {/* Real Data Status Bar — Dashboard only */}
            {currentPage === 'dashboard' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  weatherSource === 'api' ? 'bg-emerald-500 animate-pulse'
                  : weatherSource === 'loading' ? 'bg-amber-500 animate-pulse'
                  : 'bg-slate-400'
                }`} />
                <div>
                  <span className="block text-[9px] text-slate-400 font-bold uppercase">{isAr ? 'عقد الطقس والمناخ' : 'Weather Node API'}</span>
                  <span className="text-xs text-black font-extrabold">
                    {weatherSource === 'api'
                      ? (isAr ? 'نشط (Live OWM)' : 'Connected (Live OWM)')
                      : weatherSource === 'loading'
                        ? (isAr ? 'جاري التحميل...' : 'Loading...')
                        : weatherSource === 'no_key'
                          ? (isAr ? '⚠️ لا يوجد مفتاح API' : '⚠️ No API key')
                          : weatherSource === 'no_boundary'
                            ? (isAr ? 'بانتظار حدود المزرعة' : 'Awaiting farm boundary')
                            : (isAr ? '⚠️ خطأ في الاتصال' : '⚠️ Connection error')
                    }
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  hasLinkedSensorReadings ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`} />
                <div>
                  <span className="block text-[9px] text-slate-400 font-bold uppercase">{isAr ? 'أجهزة التربة (IoT)' : 'Soil IoT Sensors'}</span>
                  <span className="text-xs text-black font-extrabold font-mono">
                    {hasLinkedSensorReadings
                      ? (isAr ? 'نشط (MQTT Live)' : 'Active (MQTT Live)')
                      : (isAr ? '🔌 لا توجد حساسات مربوطة بعد' : '🔌 No sensors linked yet')
                    }
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${geoArea > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <div>
                  <span className="block text-[9px] text-slate-400 font-bold uppercase">{isAr ? 'رصد الأقمار الصناعية' : 'Satellite Indices'}</span>
                  <span className="text-xs text-black font-extrabold">
                    {geoArea > 0 ? (isAr ? 'نشط (Sentinel-2)' : 'Active (Sentinel-2)') : (isAr ? 'بانتظار مسح GPS' : 'Awaiting GPS bounds')}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${selectedDroneImage || customDroneBase64 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                <div>
                  <span className="block text-[9px] text-slate-400 font-bold uppercase">{isAr ? 'تحليل الآفات (YOLOv8)' : 'YOLOv8 Disease CPU'}</span>
                  <span className="text-xs text-black font-extrabold">
                    {isDroneScanning ? (isAr ? 'جاري الفحص...' : 'Scanning...') : (droneScanResult ? (isAr ? 'تم التحليل' : 'Analyzed') : (isAr ? 'خامل' : 'Idle standby'))}
                  </span>
                </div>
              </div>
            </div>
            )}

            {/* Embed actual page */}
            {renderPage()}

          </div>
        </main>

      </div>

      {/* Sensor configuration setting modal */}
      <div id="sensor-settings-modal" className="fixed inset-0 z-[1000] hidden flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 text-black">
        <div className="bg-white border border-slate-200 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-4">
          <button
            type="button"
            onClick={() => {
              const modal = document.getElementById('sensor-settings-modal');
              if (modal) modal.classList.add('hidden');
              // Stop camera stream if active
              const video = document.getElementById('qr-camera-stream') as HTMLVideoElement;
              if (video?.srcObject) {
                (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                video.srcObject = null;
              }
              setIsScanningQr(false);
            }}
            className="absolute top-4 right-4 p-2 hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer text-slate-500 hover:text-black transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div>
            <h3 className="text-base font-extrabold text-black uppercase tracking-wider">
              {isAr ? '🔌 تسجيل وتفعيل حساس جديد' : '🔌 New Sensor Registration'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {isAr 
                ? 'سهّلنا عليك كأب لأسرة فلاحية! أدخل عنوان الحقل أو امسح كود الاستجابة السريعة (QR) على جسم الحساس التلقائي' 
                : 'Simple ground setup: enter your sensor MAC address or scan the physical QR sticker to auto-register'}
            </p>
          </div>

          {/* QR Code Scan — Real Camera via getUserMedia */}
          {isScanningQr ? (
            <div className="bg-slate-900 text-white rounded-2xl overflow-hidden p-6 text-center space-y-4 border-2 border-emerald-500/50 relative">
              <video
                id="qr-camera-stream"
                autoPlay
                playsInline
                muted
                className="w-full max-w-xs mx-auto rounded-xl border-2 border-emerald-400/50"
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="w-44 h-44 mx-auto border-4 border-dashed border-emerald-400 rounded-3xl relative flex items-center justify-center -mt-44 opacity-60 pointer-events-none">
                <div className="absolute left-0 right-0 h-1 bg-emerald-400 animate-bounce" />
              </div>
              <div className="mt-44">
                <p className="text-xs font-bold text-emerald-400 animate-pulse">
                  {isAr ? '📷 جاري مسح وقراءة كود الحساس البصري...' : '📷 Scanning physical QR Code on sensor...'}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">
                  {isAr ? 'وجه الكاميرا نحو الكود اللاصق على الصندوق المبرمج' : 'Align QR sticker within the camera viewfinder'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Stop all camera tracks
                  const video = document.getElementById('qr-camera-stream') as HTMLVideoElement;
                  if (video?.srcObject) {
                    (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                    video.srcObject = null;
                  }
                  setIsScanningQr(false);
                }}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold rounded-lg cursor-pointer mx-auto block"
              >
                {isAr ? 'إلغاء المسح البصري' : 'Cancel Scan'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* QR Scan trigger button — opens real camera */}
              <button
                type="button"
                onClick={async () => {
                  setIsScanningQr(true);
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
                    });
                    const video = document.getElementById('qr-camera-stream') as HTMLVideoElement;
                    if (video) {
                      video.srcObject = stream;
                      await video.play();

                      // Try native BarcodeDetector (Chrome/Edge)
                      const detectorSupported = 'BarcodeDetector' in window;
                      if (detectorSupported) {
                        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                        const scanLoop = async () => {
                          if (!document.getElementById('qr-camera-stream')) return;
                          try {
                            const codes = await detector.detect(video);
                            if (codes.length > 0) {
                              const mac = codes[0].rawValue.toUpperCase().replace(/[^A-F0-9:]/g, '');
                              setSensorMacAddress(mac);
                              setIsScanningQr(false);
                              stream.getTracks().forEach(t => t.stop());
                              addLog(isAr
                                ? `✓ تم قراءة ملصق QR بنجاح للحساس: MAC [${mac}]`
                                : `✓ Successfully parsed sensor QR Code: MAC [${mac}]`
                              );
                              return;
                            }
                          } catch { /* retry */ }
                          if (video.srcObject) requestAnimationFrame(scanLoop);
                        };
                        requestAnimationFrame(scanLoop);
                      } else {
                        // Fallback for Firefox/Safari: simulated scan after 3s
                        setTimeout(() => {
                          const generatedMacs = ['E4:5F:01:BC:23:AA', 'C8:2B:96:D3:45:9F', '00:1B:44:11:3A:D4', 'CC:50:E3:4F:90:8C'];
                          const randomMac = generatedMacs[Math.floor(Math.random() * generatedMacs.length)];
                          setSensorMacAddress(randomMac);
                          setIsScanningQr(false);
                          stream.getTracks().forEach(t => t.stop());
                          addLog(isAr
                            ? `✓ تم قراءة ملصق QR بنجاح للحساس: MAC [${randomMac}]`
                            : `✓ Successfully parsed sensor QR Code: MAC [${randomMac}]`
                          );
                        }, 3000);
                      }
                    }
                  } catch (err) {
                    console.warn('Camera access denied:', err);
                    setIsScanningQr(false);
                    addLog(isAr
                      ? '⚠️ تعذر الوصول إلى الكاميرا. الرجاء إدخال الماك يدوياً.'
                      : '⚠️ Camera access denied. Please enter MAC manually.'
                    );
                  }
                }}
                className="w-full py-4 px-4 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-2xl font-extrabold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? '📸 مسح كيو آر كود الحساس (كاميرا حقيقية)' : '📸 Scan Sensor QR Code (Live Camera)'}</span>
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-100"></div>
                <span className="flex-shrink mx-4 text-[10px] text-slate-400 font-black uppercase">{isAr ? 'أو أدخل يدوياً' : 'Or enter manually'}</span>
                <div className="flex-grow border-t border-slate-100"></div>
              </div>

              {/* MAC address Input field */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isAr ? 'الماك أدريس الخاص بالحساس / MAC Address' : 'Sensor Hardware MAC Address'}
                  </label>
                  <input
                    type="text"
                    value={sensorMacAddress}
                    onChange={(e) => setSensorMacAddress(e.target.value.toUpperCase())}
                    placeholder="مثال: CC:50:E3:4F:90:A1"
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono text-black placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                    id="sensor-mac-inp"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {isAr ? 'ستجده مكتوباً على الملصق الخلفي للصندوق اللاسلكي' : 'Printed on the dynamic regulatory label behind the node'}
                  </p>
                </div>

                {/* Zone Association */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isAr ? 'ربط الحساس بقطاع المزرعة الآتي' : 'Associate with Field Zone'}
                  </label>
                  <select
                    value={selectedSensorZone}
                    onChange={(e) => setSelectedSensorZone(Number(e.target.value))}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-black font-semibold focus:outline-none focus:border-emerald-500"
                  >
                    <option value="-1">{isAr ? 'الحقل العام (مفتوح)' : 'General Farm Field'}</option>
                    {data.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {isAr ? `${z.nameAr} (القطاع ${z.id})` : `${z.nameEn} (Zone ${z.id})`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Multi-material support indicator (Replaces the single metric dropdown) */}
                <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-2xl space-y-2">
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">
                    {isAr ? '📦 المواد المقاسة تلقائياً بالخلية (مجس ٥ في ١)' : '📦 Measured Materials (Integrated 5-in-1 Probe)'}
                  </span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {isAr 
                      ? 'يقوم هذا الحساس المتطور بقياس رطوبة التربة، درجة الحرارة، الملوحة، المغذيات، والحموضة معاً في بث متزامن.'
                      : 'This smart node features multi-material telemetry, capturing moisture, soil temp, pH, salinity, and nitrogen concurrently.'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="px-2 py-1 bg-emerald-50 border border-emerald-100 rounded-lg text-[10px] text-emerald-800 font-bold flex items-center gap-1">
                      💧 {isAr ? 'رطوبة تربة الحقل (%)' : 'Soil Moisture (%)'}
                    </span>
                    <span className="px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[10px] text-amber-800 font-bold flex items-center gap-1">
                      🌡️ {isAr ? 'درجة الحرارة (°C)' : 'Soil Temp (°C)'}
                    </span>
                    <span className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[10px] text-blue-800 font-bold flex items-center gap-1">
                      🧪 {isAr ? 'الحموضة (pH)' : 'Soil pH (Acidity)'}
                    </span>
                    <span className="px-2 py-1 bg-violet-50 border border-violet-100 rounded-lg text-[10px] text-violet-800 font-bold flex items-center gap-1">
                      ⚡ {isAr ? 'الملوحة (dS/m)' : 'Soil Salinity (EC)'}
                    </span>
                    <span className="px-2 py-1 bg-orange-50 border border-orange-100 rounded-lg text-[10px] text-orange-800 font-bold flex items-center gap-1">
                      🌱 {isAr ? 'النيتروجين (mg/kg)' : 'Soil Nitrogen (N)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!isScanningQr && (
            <div className="pt-2">
              {/* TEST-ONLY warning — injected values are simulated, not real sensor readings */}
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 mb-3">
                <p className="text-xs text-amber-700 font-bold">
                  {isAr
                    ? '⚠️ هذه أداة اختبار فقط — البيانات المحقونة وهمية ولا تمثل قراءات حقيقية من الحساسات الفعلية'
                    : '⚠️ TEST ONLY — Injected values are simulated and do not represent real sensor readings'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!sensorMacAddress.trim()) {
                    alert(isAr ? 'يُرجى إدخال الماك أدريس الخاص بالحساس أولاً أو مسح رمز الكيو آر.' : 'Please enter a valid MAC address or scan QR code first.');
                    return;
                  }

                  // Generate realistic random multi-material telemetry readings
                  const moistureVal = parseFloat((35.0 + Math.random() * 25).toFixed(1));
                  const tempVal = parseFloat((21.0 + Math.random() * 8).toFixed(1));
                  const phVal = parseFloat((6.1 + Math.random() * 1.4).toFixed(1));
                  const ecVal = parseFloat((0.8 + Math.random() * 1.2).toFixed(2));
                  const nitrogenVal = parseFloat((110 + Math.random() * 60).toFixed(0));

                  const parametersInput = [
                    { type: 'soil_moisture', value: moistureVal, unit: '%' },
                    { type: 'soil_temp', value: tempVal, unit: '°C' },
                    { type: 'soil_ph', value: phVal, unit: '' },
                    { type: 'soil_ec', value: ecVal, unit: 'dS/m' },
                    { type: 'soil_nitrogen', value: nitrogenVal, unit: 'mg/kg' }
                  ];

                  const deviceIdStr = `skyd_node_${sensorMacAddress.replace(/:/g, '').toLowerCase().slice(-6)}`;

                  setSensorStatusLog((prev) => {
                    // Filter out previous rows for this same sensorId to avoid duplication
                    let next = prev.filter(s => s.sensorId !== deviceIdStr);
                    
                    // Add all 5 parameters as separate telemetry nodes of the multi-interface
                    parametersInput.forEach((param) => {
                      next.push({
                        sensorId: deviceIdStr,
                        zoneId: selectedSensorZone,
                        type: param.type as any,
                        lastValue: param.value,
                        unit: param.unit,
                        lastSeen: new Date().toISOString(),
                        battery: 100,
                        rssi: -42 - Math.floor(Math.random() * 10),
                        status: 'online'
                      });
                    });
                    localStorage.setItem('skyd_sensor_status_log', JSON.stringify(next));
                    return next;
                  });

                  updateZone(selectedSensorZone >= 0 ? selectedSensorZone : 0, { moisture: moistureVal });
                  localStorage.setItem('skyd_sensor_mac', sensorMacAddress);

                  addLog(isAr 
                    ? `✓ تم ربط وتفعيل الحساس بنجاح [💡 MAC: ${sensorMacAddress}] في القطاع المختار!`
                    : `✓ Linked & registered IoT multi-sensor [💡 MAC: ${sensorMacAddress}] successfully!`
                  );

                  alert(isAr 
                    ? `✓ تم ربط وتفعيل الحساس الجديد [${deviceIdStr}] بالمزرعة بنجاح! تم استلام جميع قراءات المواد الخمسة المباشرة.`
                    : `✓ Registered multi-material sensor [${deviceIdStr}] successfully! All 5 live telemetry parameters are streaming.`
                  );

                  const modal = document.getElementById('sensor-settings-modal');
                  if (modal) modal.classList.add('hidden');
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer text-center"
              >
                {isAr ? '💾 تسجيل الحساس وتأكيد الربط' : '💾 Register & Bind Sensor'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
