/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import mqtt from 'mqtt';
import { db } from '../lib/firebase';
import { doc, setDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';

export type SensorType =
  | 'soil_moisture'       // Soil moisture %
  | 'soil_temp'           // Soil temperature °C
  | 'soil_ph'             // Soil acidity 0-14
  | 'soil_ec'             // Soil electrical conductivity dS/m
  | 'soil_nitrogen'       // Nitrogen mg/kg
  | 'soil_phosphorus'     // Phosphorus mg/kg
  | 'soil_potassium'      // Potassium mg/kg
  | 'air_temp'            // Air temperature °C
  | 'air_humidity'        // Air humidity %
  | 'wind_speed'          // Wind speed km/h
  | 'solar_radiation'     // Solar radiation W/m²
  | 'rainfall';           // Rain precipitation mm

export interface SensorReading {
  sensorId: string;       // e.g. "soil_node_01"
  zoneId: number;         // Zone id (0,1,2,3 or -1 for general)
  type: SensorType;       // Sensor read category
  value: number;          // Numeric value
  unit: string;           // Measurement unit
  timestamp: string;      // ISO 8601 Timestamp
  battery?: number;       // Battery health %
  rssi?: number;          // Network strength indicator dBm
}

export interface SensorStatus {
  sensorId: string;
  zoneId: number;
  type: SensorType;
  lastValue: number;
  unit: string;
  lastSeen: Date;
  battery: number;
  rssi: number;
  status: 'online' | 'stale' | 'offline';
}

/**
 * Writes a real sensor reading to Firestore under:
 *   users/{userId}/sensors/{sensorId}/readings (subcollection)
 *   users/{userId}/telemetry/main (merged top-level fields)
 *
 * This bridges physical IoT hardware data into the same Firestore
 * state that AnalyticsCharts and the dashboard read from.
 */
export async function writeSensorReadingToFirestore(
  userId: string,
  reading: SensorReading
): Promise<void> {
  if (!userId || !db) return;

  try {
    // 1. Append to sensor readings subcollection (historical record)
    const readingsRef = collection(db, 'users', userId, 'sensors', reading.sensorId, 'readings');
    await addDoc(readingsRef, {
      type: reading.type,
      value: reading.value,
      unit: reading.unit,
      zoneId: reading.zoneId,
      battery: reading.battery ?? null,
      rssi: reading.rssi ?? null,
      timestamp: reading.timestamp || new Date().toISOString(),
      createdAt: serverTimestamp(),
    });

    // 2. Merge key values into telemetry/main for dashboard cards
    const telemetryRef = doc(db, 'users', userId, 'telemetry', 'main');
    const patch: Record<string, any> = { updatedAt: serverTimestamp() };

    if (reading.type === 'soil_moisture') patch.soilMoisture = reading.value;
    if (reading.type === 'soil_ph') patch.soilPH = reading.value;
    if (reading.type === 'soil_ec') patch.ec = reading.value;
    if (reading.type === 'soil_nitrogen') patch.nitrogen = reading.value;
    if (reading.type === 'soil_phosphorus') patch.phosphorus = reading.value;
    if (reading.type === 'soil_potassium') patch.potassium = reading.value;
    if (reading.type === 'soil_temp') patch.soilTemp = reading.value;
    if (reading.type === 'air_temp') patch.temp = reading.value;
    if (reading.type === 'air_humidity') patch.humidity = reading.value;
    if (reading.type === 'wind_speed') patch.wind = reading.value;
    if (reading.type === 'solar_radiation') patch.solar = reading.value;

    // Only merge if we have recognized fields
    if (Object.keys(patch).length > 1) {
      await setDoc(telemetryRef, patch, { merge: true });
    }

    // 3. Append to telemetry history for AnalyticsCharts
    const historyRef = collection(db, 'users', userId, 'telemetry', 'history');
    await addDoc(historyRef, {
      ...patch,
      source: 'iot_sensor',
      sensorId: reading.sensorId,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('[SensorService] Failed to write reading to Firestore:', error);
  }
}

/**
 * Polls REST sensor endpoint and retrieves latest readings.
 */
export async function pollSensors(endpoint: string, apiKey: string, farmId = 'skyd_farm_01'): Promise<SensorReading[]> {
  if (!endpoint) return [];
  try {
    const url = `${endpoint.trim()}?farmId=${farmId}&limit=50`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Sensor REST API returned status code ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Error in sensor REST polling:", error);
    throw error;
  }
}

/**
 * Connects to a public or private WebSockets MQTT broker and subscribes to a telemetry stream.
 */
export function connectMQTT(
  brokerUrl: string, 
  topic: string, 
  userId: string,
  onReadingReceived: (reading: SensorReading) => void,
  onConnectionStatus: (connected: boolean, error?: string) => void
): mqtt.MqttClient | null {
  if (!brokerUrl || !topic) return null;
  try {
    const client = mqtt.connect(brokerUrl, {
      clientId: `skyd_webclient_${userId}_${Math.floor(Math.random() * 100000)}`,
      clean: true,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      client.subscribe(topic, (err) => {
        if (!err) {
          onConnectionStatus(true);
        } else {
          onConnectionStatus(false, err.message);
        }
      });
    });

    client.on('message', (t, payload) => {
      try {
        const reading: SensorReading = JSON.parse(payload.toString());
        onReadingReceived(reading);
      } catch (err) {
        console.warn("Could not parse MQTT JSON sensor payload:", err);
      }
    });

    client.on('error', (err) => {
      onConnectionStatus(false, err.message);
    });

    client.on('close', () => {
      onConnectionStatus(false, "Connection closed");
    });

    return client;
  } catch (e: any) {
    console.error("Error starting MQTT WS client:", e);
    onConnectionStatus(false, e?.message || "MQTT error");
    return null;
  }
}
