/**
 * SKYD YOLOv8 Integration Service
 * Routes requests to the SKYD FastAPI backend /api/v1/detections/analyze
 */

import { analyzeDroneImage as backendAnalyze, type DetectionResponse } from './skydApiService';

export interface YOLODetection {
  class: string;
  class_ar: string;
  confidence: number; // 0.0 - 1.0
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

const DISEASE_LABELS_AR: Record<string, string> = {
  'Healthy': 'سليم',
  'Leaf_Rust': 'صدأ الأوراق',
  'Yellow_Rust': 'الصدأ الأصفر',
  'Sunn_Pest': 'سونة القمح',
  'Powdery_Mildew': 'البياض الدقيقي',
  'Fusarium_Blight': 'لفحة الفيوزاريوم',
  'Septoria_Leaf_Blotch': 'تبقع السبتوريا',
  'Nutrient_Deficiency_N': 'نقص النيتروجين',
  'Nutrient_Deficiency_K': 'نقص البوتاسيوم',
  'Water_Stress': 'إجهاد مائي',
};

function classifyConfidence(conf: number): 'low' | 'medium' | 'high' | 'critical' {
  if (conf >= 0.85) return 'critical';
  if (conf >= 0.65) return 'high';
  if (conf >= 0.45) return 'medium';
  return 'low';
}

/**
 * Analyzes a drone image for crop disease via SKYD backend.
 * Converts the backend DetectionResponse to YOLOResult format.
 */
export async function analyzeImage(
  imageFile: File | Blob | string,
  zoneId: number,
  _backendUrl: string,  // ignored — uses VITE_SKYD_API_URL
  _authToken: string,   // ignored — handled server-side
  _farmId = 'skyd_farm_01'
): Promise<YOLOResult> {
  let blob: Blob;
  if (typeof imageFile === 'string') {
    const res = await fetch(imageFile);
    blob = await res.blob();
  } else {
    blob = imageFile;
  }

  // Use a deterministic drone ID from zoneId
  const droneId = `skyd_drone_z${zoneId}`;

  const result: DetectionResponse = await backendAnalyze(
    blob,
    droneId,
    33.3213,  // Default Iraqi coords — will be overridden by real GPS in production
    44.3211,
    30,
    100
  );

  const isHealthy = result.disease_label === 'Healthy';
  const bbox = result.bounding_boxes[0];

  const detections: YOLODetection[] = result.disease_label === 'Healthy' ? [] : [{
    class: result.disease_label,
    class_ar: DISEASE_LABELS_AR[result.disease_label] || result.disease_label,
    confidence: result.confidence,
    severity: classifyConfidence(result.confidence),
    bbox: bbox ? [bbox.x1 ?? 0, bbox.y1 ?? 0, bbox.x2 ?? 640, bbox.y2 ?? 640] : [0, 0, 640, 640],
    treatment: `Apply treatment for ${result.disease_label}`,
    treatment_ar: `تطبيق علاج لـ ${DISEASE_LABELS_AR[result.disease_label] || result.disease_label}`,
  }];

  return {
    zoneId: zoneId.toString(),
    imageId: result.id,
    timestamp: result.detected_at,
    summary: {
      total_plants: 100,
      healthy: isHealthy ? 100 : Math.round((1 - result.confidence) * 100),
      infected: isHealthy ? 0 : Math.round(result.confidence * 100),
      dead: 0,
      healthScore: isHealthy ? 95 : Math.round((1 - result.confidence) * 100),
    },
    detections,
    model_version: 'SKYD-YOLOv8-v2',
  };
}
