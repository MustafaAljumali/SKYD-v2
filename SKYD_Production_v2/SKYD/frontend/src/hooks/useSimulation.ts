/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PRODUCTION RULE: This hook manages state synchronization with Firebase Firestore.
 * Default values are ALL ZEROS — no fake data is ever injected.
 * Real data only arrives via:
 *   - Firestore onSnapshot listeners (Firebase sync)
 *   - writeTelemetry() calls from weather/sensor services
 *   - updateZone() calls from satellite NDWI or MQTT sensor events
 */

import { useState, useEffect, useCallback } from 'react';
import { SimData, Zone } from '../types';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  doc, 
  setDoc, 
  deleteDoc, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  addDoc
} from 'firebase/firestore';

/**
 * No pre-seeded zones — real zones are created by the farmer via the dashboard
 * and synced from Firestore. Empty array = honest zero-state.
 */
const EMPTY_ZONES: Zone[] = [];

const DEFAULT_TELEMETRY: SimData = {
  tick: 0,
  day: 0,
  hour: 0,
  temp: 0,
  humidity: 0,
  wind: 0,
  solar: 0,
  rain: 0,
  soilMoisture: 0,
  soilPH: 0,
  nitrogen: 0,
  phosphorus: 0,
  potassium: 0,
  ec: 0,
  zones: EMPTY_ZONES,
  logs: [
    { msg: 'الهوية الرقمية نشطة - بانتظار ربط الحساسات الأرضية الفعلية', color: '#10b981', timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) },
    { msg: 'Skyd Platform activated - Awaiting physical ground telemetry sensor connection', color: '#10b981', timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) }
  ],
};

export function useSimulation(isAr: boolean = true) {
  const [userId, setUserId] = useState<string | null>(() => auth.currentUser?.uid || null);
  const [data, setData] = useState<SimData>(DEFAULT_TELEMETRY);

  // Monitor Auth Changes to update target synchronization path
  useEffect(() => {
    return auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setUserId(firebaseUser.uid);
      } else {
        // If there's a local user session in localStorage, use that as fallback
        const savedSession = localStorage.getItem('skyd_active_user') || localStorage.getItem('skyed_active_user');
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            setUserId(parsed.uid || 'local_admin');
          } catch (e) {
            setUserId(null);
            setData(DEFAULT_TELEMETRY);
          }
        } else {
          setUserId(null);
          setData(DEFAULT_TELEMETRY);
        }
      }
    });
  }, []);

  // Sync state for local-only users
  useEffect(() => {
    if (!userId || !userId.startsWith('local_')) return;

    const saved = localStorage.getItem(`skyd_local_sim_${userId}`) || localStorage.getItem(`skyed_local_sim_${userId}`);
    if (saved) {
      try {
        setData(JSON.parse(saved));
      } catch (e) {
        setData(DEFAULT_TELEMETRY);
      }
    } else {
      setData(DEFAULT_TELEMETRY);
    }
  }, [userId]);

  // Synchronize Firestore collections with React State
  useEffect(() => {
    if (!userId || userId.startsWith('local_')) return;

    // 1. Telemetry main doc synchronization
    const telemetryDocRef = doc(db, 'users', userId, 'telemetry', 'main');
    const unsubscribeTelemetry = onSnapshot(telemetryDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        setData((prev) => ({
          ...prev,
          temp: typeof d.temp === 'number' ? d.temp : prev.temp,
          humidity: typeof d.humidity === 'number' ? d.humidity : prev.humidity,
          wind: typeof d.wind === 'number' ? d.wind : prev.wind,
          solar: typeof d.solar === 'number' ? d.solar : prev.solar,
          soilPH: typeof d.soilPH === 'number' ? d.soilPH : prev.soilPH,
          nitrogen: typeof d.nitrogen === 'number' ? d.nitrogen : prev.nitrogen,
          phosphorus: typeof d.phosphorus === 'number' ? d.phosphorus : prev.phosphorus,
          potassium: typeof d.potassium === 'number' ? d.potassium : prev.potassium,
          ec: typeof d.ec === 'number' ? d.ec : prev.ec,
        }));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/telemetry/main`);
    });

    // 2. Zones sub-collection synchronization
    const zonesCollectionRef = collection(db, 'users', userId, 'zones');
    const unsubscribeZones = onSnapshot(zonesCollectionRef, (snapshot) => {
      const loadedZones: Zone[] = [];
      snapshot.forEach((doc) => {
        const d = doc.data();
        loadedZones.push({
          id: Number(doc.id),
          nameAr: d.nameAr || '',
          nameEn: d.nameEn || '',
          total: Number(d.total ?? 0),
          healthy: Number(d.healthy ?? 0),
          infected: Number(d.infected ?? 0),
          dead: Number(d.dead ?? 0),
          moisture: Number(d.moisture ?? 0),
          temp: Number(d.temp ?? 0),
          irrigation: Boolean(d.irrigation ?? false),
          cropType: d.cropType || 'vegetable',
        });
      });

      // Maintain ascending numerical alignment
      loadedZones.sort((a, b) => a.id - b.id);

      setData((prev) => {
        const avg = loadedZones.length > 0 
          ? loadedZones.reduce((acc, z) => acc + z.moisture, 0) / loadedZones.length 
          : 0;
        return {
          ...prev,
          zones: loadedZones,
          soilMoisture: avg,
        };
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/zones`);
    });

    // 3. Logs sub-collection synchronization (limited to 50 for performance)
    const logsCollectionRef = collection(db, 'users', userId, 'logs');
    const logsQuery = query(logsCollectionRef, orderBy('createdAt', 'desc'), limit(50));
    const unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
      const loadedLogs: { msg: string; color: string; timestamp: string }[] = [];
      snapshot.forEach((doc) => {
        const d = doc.data();
        loadedLogs.push({
          msg: d.msg || '',
          color: d.color || '#10b981',
          timestamp: d.timestamp || '00:00',
        });
      });

      setData((prev) => ({
        ...prev,
        logs: loadedLogs,
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${userId}/logs`);
    });

    return () => {
      unsubscribeTelemetry();
      unsubscribeZones();
      unsubscribeLogs();
    };
  }, [userId]);

  // Batch-write real sensor/weather telemetry data
  const writeTelemetry = useCallback(async (fields: Partial<SimData>) => {
    if (!userId) return;
    if (userId.startsWith('local_')) {
      setData((prev) => {
        const next = { ...prev, ...fields };
        localStorage.setItem(`skyd_local_sim_${userId}`, JSON.stringify(next));
        return next;
      });
      return;
    }
    try {
      const telemetryDocRef = doc(db, 'users', userId, 'telemetry', 'main');
      const patch: Record<string, any> = { ...fields, updatedAt: serverTimestamp() };
      await setDoc(telemetryDocRef, patch, { merge: true });

      // Append to telemetry history for AnalyticsCharts
      const historyRef = collection(db, 'users', userId, 'telemetry', 'history');
      await addDoc(historyRef, {
        ...fields,
        source: 'writeTelemetry',
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}/telemetry/main`);
    }
  }, [userId]);

  // Update a specific zone
  const updateZone = useCallback(async (zoneId: number, fields: Partial<Zone>) => {
    if (!userId) return;
    if (userId.startsWith('local_')) {
      setData((prev) => {
        const zones = prev.zones.map((z) => {
          if (z.id === zoneId) {
            const updated = { ...z, ...fields };
            updated.total = Number(updated.healthy || 0) + Number(updated.infected || 0) + Number(updated.dead || 0);
            return updated;
          }
          return z;
        });
        const avg = zones.length > 0 ? zones.reduce((acc, z) => acc + z.moisture, 0) / zones.length : 0;
        const next = { ...prev, zones, soilMoisture: avg };
        localStorage.setItem(`skyd_local_sim_${userId}`, JSON.stringify(next));
        return next;
      });
      return;
    }
    try {
      const zoneDocRef = doc(db, 'users', userId, 'zones', String(zoneId));
      
      // Fetch existing zone to compute totals accurately
      const existingZone = data.zones.find(z => z.id === zoneId);
      if (!existingZone) return;

      const updated = { ...existingZone, ...fields };
      const total = Number(updated.healthy || 0) + Number(updated.infected || 0) + Number(updated.dead || 0);

      await setDoc(zoneDocRef, {
        id: String(zoneId),
        nameAr: updated.nameAr,
        nameEn: updated.nameEn,
        total: total,
        healthy: Number(updated.healthy),
        infected: Number(updated.infected),
        dead: Number(updated.dead),
        moisture: Number(updated.moisture),
        temp: Number(updated.temp),
        irrigation: Boolean(updated.irrigation),
        cropType: updated.cropType || 'vegetable',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}/zones/${zoneId}`);
    }
  }, [userId, data.zones]);

  // Create a new agricultural zone
  const addZone = useCallback(async (nameAr: string, nameEn: string, healthy: number, moisture: number, temp: number, cropType: string = 'vegetable') => {
    if (!userId) return;
    const newId = data.zones.length > 0 ? Math.max(...data.zones.map(z => z.id)) + 1 : 0;
    if (userId.startsWith('local_')) {
      setData((prev) => {
        const newZ: Zone = {
          id: newId,
          nameAr,
          nameEn,
          total: Number(healthy),
          healthy: Number(healthy),
          infected: 0,
          dead: 0,
          moisture: Number(moisture),
          temp: Number(temp),
          irrigation: false,
          cropType: cropType,
        };
        const zones = [...prev.zones, newZ].sort((a, b) => a.id - b.id);
        const avg = zones.length > 0 ? zones.reduce((acc, z) => acc + z.moisture, 0) / zones.length : 0;
        const next = { ...prev, zones, soilMoisture: avg };
        localStorage.setItem(`skyd_local_sim_${userId}`, JSON.stringify(next));
        return next;
      });
      return;
    }
    try {
      const zoneDocRef = doc(db, 'users', userId, 'zones', String(newId));

      await setDoc(zoneDocRef, {
        id: String(newId),
        nameAr,
        nameEn,
        total: Number(healthy),
        healthy: Number(healthy),
        infected: 0,
        dead: 0,
        moisture: Number(moisture),
        temp: Number(temp),
        irrigation: false,
        cropType: cropType,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${userId}/zones/${newId}`);
    }
  }, [userId, data.zones]);

  // Delete an agricultural zone
  const deleteZone = useCallback(async (id: number) => {
    if (!userId) return;
    if (userId.startsWith('local_')) {
      setData((prev) => {
        const zones = prev.zones.filter(z => z.id !== id);
        const avg = zones.length > 0 ? zones.reduce((acc, z) => acc + z.moisture, 0) / zones.length : 0;
        const next = { ...prev, zones, soilMoisture: avg };
        localStorage.setItem(`skyd_local_sim_${userId}`, JSON.stringify(next));
        return next;
      });
      return;
    }
    try {
      const zoneDocRef = doc(db, 'users', userId, 'zones', String(id));
      await deleteDoc(zoneDocRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}/zones/${id}`);
    }
  }, [userId]);

  // Add an audit compliance log
  const addLog = useCallback(async (msg: string) => {
    if (!userId) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (userId.startsWith('local_')) {
      setData((prev) => {
        const nextLog = { msg, color: '#10b981', timestamp: timeStr };
        const logs = [nextLog, ...prev.logs].slice(0, 50);
        const next = { ...prev, logs };
        localStorage.setItem(`skyd_local_sim_${userId}`, JSON.stringify(next));
        return next;
      });
      return;
    }
    try {
      const logId = `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const logDocRef = doc(db, 'users', userId, 'logs', logId);

      await setDoc(logDocRef, {
        msg,
        color: '#10b981',
        timestamp: timeStr,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${userId}/logs`);
    }
  }, [userId]);

  // Treat zone infections
  const treatZone = useCallback(async (id: number) => {
    if (!userId) return;
    if (userId.startsWith('local_')) {
      const existingZone = data.zones.find(z => z.id === id);
      if (!existingZone) return;

      const cured = existingZone.infected;
      await updateZone(id, {
        healthy: existingZone.healthy + cured,
        infected: 0
      });
      await addLog(isAr 
        ? `تمت معالجة كافة الإصابات بالمنطقة: ${existingZone?.nameAr || id}`
        : `Treated all infection anomalies in Zone: ${existingZone?.nameEn || id}`
      );
      return;
    }
    try {
      const existingZone = data.zones.find(z => z.id === id);
      if (!existingZone) return;

      const cured = existingZone.infected;
      const zoneDocRef = doc(db, 'users', userId, 'zones', String(id));

      await setDoc(zoneDocRef, {
        ...existingZone,
        id: String(id),
        healthy: existingZone.healthy + cured,
        infected: 0,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await addLog(isAr 
        ? `تمت معالجة كافة الإصابات بالمنطقة: ${existingZone?.nameAr || id}`
        : `Treated all infection anomalies in Zone: ${existingZone?.nameEn || id}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}/zones/${id}`);
    }
  }, [userId, data.zones, addLog, updateZone, isAr]);

  // Toggle zone irrigation
  const toggleIrrigation = useCallback(async (id: number) => {
    if (!userId) return;
    if (userId.startsWith('local_')) {
      const existingZone = data.zones.find(z => z.id === id);
      if (!existingZone) return;

      const nextIrrigation = !existingZone.irrigation;
      await updateZone(id, { irrigation: nextIrrigation });
      await addLog(isAr 
        ? (nextIrrigation 
            ? `قام الفلاح بفتح صمام الري في المنطقة: ${existingZone.nameAr}`
            : `قام الفلاح بإغلاق صمام الري في المنطقة: ${existingZone.nameAr}`)
        : (nextIrrigation 
            ? `Farmer opened the flow irrigation valve in Zone: ${existingZone.nameEn}`
            : `Farmer closed the flow irrigation valve in Zone: ${existingZone.nameEn}`)
      );
      return;
    }
    try {
      const existingZone = data.zones.find(z => z.id === id);
      if (!existingZone) return;

      const nextIrrigation = !existingZone.irrigation;
      const zoneDocRef = doc(db, 'users', userId, 'zones', String(id));

      await setDoc(zoneDocRef, {
        ...existingZone,
        id: String(id),
        irrigation: nextIrrigation,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await addLog(isAr 
        ? (nextIrrigation 
            ? `قام الفلاح بفتح صمام الري في المنطقة: ${existingZone.nameAr}`
            : `قام الفلاح بإغلاق صمام الري في المنطقة: ${existingZone.nameAr}`)
        : (nextIrrigation 
            ? `Farmer opened the flow irrigation valve in Zone: ${existingZone.nameEn}`
            : `Farmer closed the flow irrigation valve in Zone: ${existingZone.nameEn}`)
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}/zones/${id}`);
    }
  }, [userId, data.zones, addLog, updateZone, isAr]);

  return {
    data,
    writeTelemetry,
    updateZone,
    addZone,
    deleteZone,
    addLog,
    treatZone,
    toggleIrrigation
  };
}
