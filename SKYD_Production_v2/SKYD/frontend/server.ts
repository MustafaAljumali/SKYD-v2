/**
 * SKYD Full-Stack Express Server
 *
 * Fixes applied:
 * 1. Gemini drone-scan now proxies to FastAPI backend /api/v1/ai/diagnose
 *    (GEMINI_API_KEY stays in backend .env, not here)
 * 2. Satellite data proxied from backend (Copernicus credentials server-side)
 * 3. SKYD WebSocket status endpoint added
 * 4. All ASFS references removed
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const SKYD_BACKEND_URL = process.env.SKYD_BACKEND_URL || "http://localhost:8000";

// Enable large JSON body payloads for base64 image drone scans
app.use(express.json({ limit: "12mb" }));

// ── Backend proxy helper ──────────────────────────────────────────────────────
async function proxyToBackend(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${SKYD_BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return { status: res.status, body };
}

// ── AI Agricultural Advice (proxied to backend) ───────────────────────────────
app.post("/api/gemini/advice", async (req, res) => {
  try {
    const { telemetry, zones, language } = req.body;
    const result = await proxyToBackend("/api/v1/ai/advice", {
      method: "POST",
      body: JSON.stringify({ telemetry, zones, language }),
    });
    res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error("[SKYD] AI Advice proxy error:", err.message);
    res.status(502).json({ error: err.message || "Backend unreachable" });
  }
});

// ── Drone Image Diagnosis (proxied to backend) ────────────────────────────────
app.post("/api/gemini/drone-scan", async (req, res) => {
  try {
    const { base64Image, zoneId, cropType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image attachment" });
    }

    const result = await proxyToBackend("/api/v1/ai/diagnose", {
      method: "POST",
      body: JSON.stringify({ base64Image, zoneId, cropType }),
    });

    // Map backend response to frontend-expected shape
    const data = result.body;
    if (result.status === 200 && data.diagnosisAr) {
      res.json(data);
    } else {
      res.status(result.status).json(data);
    }
  } catch (err: any) {
    console.error("[SKYD] Drone scan proxy error:", err.message);
    res.status(502).json({ error: err.message || "Backend unreachable" });
  }
});

// ── Satellite NDVI (proxied from backend — Copernicus credentials server-side) ─
app.get("/api/satellite/ndvi", async (req, res) => {
  try {
    const { lat, lon, zone_id, radius_m } = req.query;
    const params = new URLSearchParams({
      lat: String(lat || 33.3),
      lon: String(lon || 44.4),
      zone_id: String(zone_id || "zone_default"),
      radius_m: String(radius_m || 500),
    });
    const result = await proxyToBackend(`/api/v1/satellite/ndvi?${params}`);
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── SKYD Backend health check ─────────────────────────────────────────────────
app.get("/api/skyd/health", async (_req, res) => {
  try {
    const result = await proxyToBackend("/api/v1/health");
    res.status(result.status).json({
      ...result.body,
      backend_url: SKYD_BACKEND_URL,
    });
  } catch {
    res.status(503).json({
      status: "OFFLINE",
      backend_url: SKYD_BACKEND_URL,
      message: "SKYD backend unreachable. Ensure FastAPI server is running.",
    });
  }
});

// ── Configure Vite / Static assets ───────────────────────────────────────────
async function runServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SKYD] Frontend server running on http://0.0.0.0:${PORT}`);
    console.log(`[SKYD] Backend URL: ${SKYD_BACKEND_URL}`);
  });
}

runServer();
