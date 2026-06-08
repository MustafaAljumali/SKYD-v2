# SKYD — Smart Field Intelligence Platform
### منصة سكاي الذكية للحقول الزراعية

**نسخة متكاملة للنشر الإنتاجي | Production-Ready Integration**

---

## المشاكل التي تم حلها | Issues Fixed

### 1. مسار WebSocket ✅
- **المشكلة**: مسار مختلف بين الفرونت إند والبك إند
- **الحل**: مسار موحد `/api/v1/ws/skyd` + مسار legacy `/api/v1/ws/dashboard` للتوافق

### 2. نقاط النهاية المفقودة ✅
- **المشكلة**: `satellite`, `ai_advice` غير موجودة في router.py
- **الحل**: تمت إضافة `/api/v1/satellite/*` و `/api/v1/ai/*`

### 3. مفاتيح API الأقمار الصناعية ✅
- **المشكلة**: مفاتيح Copernicus مكشوفة للفرونت إند
- **الحل**: `satellite_service.py` في الباك إند فقط — مفاتيح في `.env` الخادم

### 4. البيانات الوهمية / Simulation ✅
- **المشكلة**: `useSimulation.ts` يولد بيانات وهمية
- **الحل**: `skydApiService.ts` يتصل بالباك إند الحقيقي — بيانات حقيقية من Sentinel-2 وMQTT

### 5. تسمية SKYD ✅
- **المشكلة**: اسم ASFS في كل مكان في الكود
- **الحل**: تم استبدال جميع مراجع ASFS → SKYD في الباك إند والفرونت إند والملفات

---

## بنية المشروع | Project Structure

```
SKYD/
├── backend/                    # FastAPI Python Backend
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── endpoints/
│   │   │   │   ├── drones.py       # POST /drones/telemetry
│   │   │   │   ├── sensors.py      # POST /sensors/readings, GET /sensors/{zone}/readings
│   │   │   │   ├── detections.py   # POST /detections/analyze (YOLOv8)
│   │   │   │   ├── irrigation.py   # POST /irrigation/command, /irrigation/auto-decide
│   │   │   │   ├── satellite.py    # GET /satellite/ndvi (Copernicus, server-side keys)
│   │   │   │   ├── ai_advice.py    # POST /ai/advice, /ai/diagnose (Gemini, server-side)
│   │   │   │   ├── websocket.py    # WS /ws/skyd (unified path)
│   │   │   │   └── health.py       # GET /health
│   │   │   └── router.py
│   │   ├── core/
│   │   │   ├── config.py           # All settings from .env
│   │   │   └── websocket_manager.py
│   │   ├── services/
│   │   │   ├── satellite_service.py    # Copernicus + NASA POWER fallback
│   │   │   ├── ai_service.py           # YOLOv8 inference
│   │   │   ├── irrigation_service.py   # Iraq-adapted irrigation engine
│   │   │   └── virtual_sensor_service.py  # IDW interpolation VSE
│   │   └── main.py
│   ├── .env.example
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                   # React + TypeScript + Vite
│   ├── src/
│   │   ├── services/
│   │   │   ├── skydApiService.ts   # NEW: unified SKYD backend client
│   │   │   ├── sensorService.ts    # MQTT WebSocket sensor client
│   │   │   └── weatherService.ts   # OpenWeatherMap integration
│   │   ├── hooks/
│   │   │   └── useSimulation.ts    # Real Firestore + zero mock data
│   │   └── App.tsx
│   ├── server.ts               # Express proxy (Gemini/satellite → backend)
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
│
└── docker-compose.yml          # Full stack deployment
```

---

## تشغيل سريع | Quick Start

### المتطلبات | Requirements
- Python 3.12+
- Node.js 22+
- PostgreSQL 16+
- Docker & Docker Compose (للنشر الإنتاجي)

### 1. الباك إند | Backend
```bash
cd backend
cp .env.example .env
# Fill in your API keys in .env

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
API docs: http://localhost:8000/docs

### 2. الفرونت إند | Frontend
```bash
cd frontend
cp .env.example .env
# Set VITE_SKYD_API_URL=http://localhost:8000

npm install
npm run dev
```
App: http://localhost:3000

### 3. Docker (الإنتاج) | Production
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both .env files with real credentials

docker-compose up -d
```

---

## المفاتيح المطلوبة | Required API Keys

| المفتاح | الموقع | المصدر |
|---------|--------|--------|
| `COPERNICUS_CLIENT_ID` | backend/.env | https://dataspace.copernicus.eu |
| `COPERNICUS_CLIENT_SECRET` | backend/.env | https://dataspace.copernicus.eu |
| `GEMINI_API_KEY` | backend/.env | https://aistudio.google.com |
| Firebase Config | frontend/.env | Firebase Console |
| `VITE_OWM_API_KEY` | frontend/.env | https://openweathermap.org |

**⚠️ تحذير أمني**: مفاتيح Copernicus وGemini يجب أن تبقى في `backend/.env` فقط — لا تضعها أبداً في frontend/.env

---

## نقاط نهاية API | API Endpoints

```
GET  /api/v1/health                         — فحص الخادم
POST /api/v1/drones/telemetry               — إرسال بيانات الطائرة
GET  /api/v1/drones/{id}/telemetry          — استعلام سجل الطائرة
POST /api/v1/sensors/readings               — إرسال قراءة حساس
GET  /api/v1/sensors/{zone_id}/readings     — قراءات منطقة
POST /api/v1/sensors/virtual/infer          — VSE توليد بيانات افتراضية
POST /api/v1/detections/analyze             — تشخيص أمراض YOLOv8
GET  /api/v1/detections/recent              — آخر الكشوفات
POST /api/v1/irrigation/command             — أمر ري يدوي
POST /api/v1/irrigation/auto-decide         — ري تلقائي بالذكاء الاصطناعي
GET  /api/v1/satellite/ndvi                 — NDVI من Sentinel-2
POST /api/v1/satellite/analyze              — تحليل منطقة بالقمر الصناعي
POST /api/v1/ai/advice                      — نصائح زراعية من Gemini
POST /api/v1/ai/diagnose                    — تشخيص صورة المحصول
WS   /api/v1/ws/skyd                        — WebSocket الرئيسي
```

---

## الأحداث المباشرة | WebSocket Events

```json
{ "event": "TELEMETRY", "drone_id": "drone_01", "gps": {...}, "battery_pct": 85 }
{ "event": "SPRAY_ALERT", "disease": "Leaf_Rust", "confidence": 0.91, "area_m2": 120 }
{ "event": "IRRIGATION_COMMAND", "zone_id": "zone_A", "action": "START" }
{ "event": "SATELLITE_UPDATE", "zone_id": "zone_A", "ndvi": 0.62, "health_status": "Healthy" }
{ "event": "HEARTBEAT", "active_connections": 3 }
```
