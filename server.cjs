var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_vite = require("vite");
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = parseInt(process.env.PORT || "3000", 10);
var SKYD_BACKEND_URL = process.env.SKYD_BACKEND_URL || "http://localhost:8000";
app.use(import_express.default.json({ limit: "12mb" }));
async function proxyToBackend(path2, options = {}) {
  const res = await fetch(`${SKYD_BACKEND_URL}${path2}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return { status: res.status, body };
}
app.post("/api/gemini/advice", async (req, res) => {
  try {
    const { telemetry, zones, language } = req.body;
    const result = await proxyToBackend("/api/v1/ai/advice", {
      method: "POST",
      body: JSON.stringify({ telemetry, zones, language })
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[SKYD] AI Advice proxy error:", err.message);
    res.status(502).json({ error: err.message || "Backend unreachable" });
  }
});
app.post("/api/gemini/drone-scan", async (req, res) => {
  try {
    const { base64Image, zoneId, cropType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image attachment" });
    }
    const result = await proxyToBackend("/api/v1/ai/diagnose", {
      method: "POST",
      body: JSON.stringify({ base64Image, zoneId, cropType })
    });
    const data = result.body;
    if (result.status === 200 && data.diagnosisAr) {
      res.json(data);
    } else {
      res.status(result.status).json(data);
    }
  } catch (err) {
    console.error("[SKYD] Drone scan proxy error:", err.message);
    res.status(502).json({ error: err.message || "Backend unreachable" });
  }
});
app.get("/api/satellite/ndvi", async (req, res) => {
  try {
    const { lat, lon, zone_id, radius_m } = req.query;
    const params = new URLSearchParams({
      lat: String(lat || 33.3),
      lon: String(lon || 44.4),
      zone_id: String(zone_id || "zone_default"),
      radius_m: String(radius_m || 500)
    });
    const result = await proxyToBackend(`/api/v1/satellite/ndvi?${params}`);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.get("/api/skyd/health", async (_req, res) => {
  try {
    const result = await proxyToBackend("/api/v1/health");
    res.status(result.status).json({
      ...result.body,
      backend_url: SKYD_BACKEND_URL
    });
  } catch {
    res.status(503).json({
      status: "OFFLINE",
      backend_url: SKYD_BACKEND_URL,
      message: "SKYD backend unreachable. Ensure FastAPI server is running."
    });
  }
});
async function runServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SKYD] Frontend server running on http://0.0.0.0:${PORT}`);
    console.log(`[SKYD] Backend URL: ${SKYD_BACKEND_URL}`);
  });
}
runServer();
//# sourceMappingURL=server.cjs.map
