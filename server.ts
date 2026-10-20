import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_MB = parseInt(process.env.CAMERA_MAX_UPLOAD_MB || '10', 10);

// Camera Upload Storage Directories
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'camera');
const HISTORY_DIR = path.join(UPLOAD_DIR, 'history');
try {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
} catch (e) {
  console.warn('Could not initialize upload directories:', e);
}

// In-Memory Cache of Latest Uploaded Camera Frame
export interface UploadedCameraFrame {
  id: string;
  timestamp: string;
  sizeBytes: number;
  mimeType: string;
  buffer: Buffer;
  base64DataUri: string;
  url: string;
  clientIp?: string;
  analyzed: boolean;
  analysis?: any;
}

let latestUploadedFrame: UploadedCameraFrame | null = null;
let totalCameraUploadsCount = 0;

// Restore persistent frame from disk if available
try {
  const metaPath = path.join(UPLOAD_DIR, 'metadata.json');
  const latestImgPath = path.join(UPLOAD_DIR, 'latest.jpg');
  if (fs.existsSync(metaPath) && fs.existsSync(latestImgPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const buf = fs.readFileSync(latestImgPath);
    latestUploadedFrame = {
      ...meta,
      buffer: buf,
      base64DataUri: `data:image/jpeg;base64,${buf.toString('base64')}`
    };
    console.log(`📸 Restored latest camera frame from disk (${latestUploadedFrame?.sizeBytes} bytes, ${latestUploadedFrame?.timestamp})`);
  }
} catch (e) {
  // Clean initialization
}

// --------------------------------------------------------------------
// BODY PARSERS
// --------------------------------------------------------------------

// 1. Raw body parser specifically for camera uploads (handles raw binary JPEG, octet-stream, and multipart)
app.use('/api/camera/upload', express.raw({
  type: () => true, // capture raw buffer regardless of content-type header for custom validation
  limit: `${MAX_UPLOAD_MB}mb`
}));

// 2. Standard JSON parser for other API routes
app.use(express.json());

// --------------------------------------------------------------------
// SECURE HARDWARE INTEGRATION GATEWAY (CONTROLLER)
// --------------------------------------------------------------------

function getControllerBaseUrl(overrideHost?: string, overridePort?: number) {
  let host = (overrideHost || process.env.HARDWARE_CONTROLLER_HOST || '').trim();
  if (!host) return null;
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = `http://${host}`;
  }
  const port = overridePort || parseInt(process.env.HARDWARE_CONTROLLER_PORT || '80', 10);
  if (port && port !== 80) {
    const u = new URL(host);
    u.port = port.toString();
    return u.origin;
  }
  return host.replace(/\/$/, '');
}

function getCameraBaseUrl(overrideHost?: string, overridePort?: number) {
  let host = (overrideHost || process.env.HARDWARE_CAMERA_HOST || '').trim();
  if (!host) return null;
  if (!host.startsWith('http://') && !host.startsWith('https://')) {
    host = `http://${host}`;
  }
  const port = overridePort || parseInt(process.env.HARDWARE_CAMERA_PORT || '81', 10);
  if (port && port !== 80) {
    const u = new URL(host);
    u.port = port.toString();
    return u.origin;
  }
  return host.replace(/\/$/, '');
}

// --------------------------------------------------------------------
// ESP32 CAMERA UPLOAD ENDPOINT (PUSH MODEL)
// --------------------------------------------------------------------

/**
 * Helper to validate camera authorization without exposing secrets in logs.
 */
function isCameraAuthorized(req: express.Request): boolean {
  const configuredKey = (
    process.env.CAMERA_UPLOAD_KEY ||
    process.env.HARDWARE_API_KEY ||
    'edens_camera_secret_2026'
  ).trim();

  // Accept credential from custom header, standard auth header, or query param
  const incomingHeaderKey = (req.headers['x-camera-key'] || req.headers['x-api-key']) as string | undefined;
  const authHeader = req.headers['authorization'];
  let bearerKey: string | undefined;
  if (authHeader) {
    bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  }
  const queryKey = (req.query.token || req.query.key || req.query.auth) as string | undefined;

  const keyToTest = (incomingHeaderKey || bearerKey || queryKey || '').trim();
  return Boolean(keyToTest && keyToTest === configuredKey);
}

/**
 * Extracts and validates JPEG bytes from buffer (handles both raw binary and multipart).
 */
function extractJpegBuffer(bodyBuffer: Buffer): { buffer: Buffer; error?: string } {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return { buffer: Buffer.alloc(0), error: 'Empty payload received.' };
  }

  // Minimum JPEG file size (SOI marker + APP0 + DQT + SOF0 + DHT + SOS + EOI) is ~64-100 bytes
  if (bodyBuffer.length < 32) {
    return { buffer: Buffer.alloc(0), error: 'Payload too small to be a valid JPEG.' };
  }

  // Check for direct JPEG SOI marker (0xFF, 0xD8) at start
  if (bodyBuffer[0] === 0xff && bodyBuffer[1] === 0xd8) {
    return { buffer: bodyBuffer };
  }

  // If payload is multipart/form-data, find the embedded JPEG SOI marker (0xFF, 0xD8)
  const soiIndex = bodyBuffer.indexOf(Buffer.from([0xff, 0xd8]));
  if (soiIndex !== -1) {
    // Find trailing EOI marker (0xFF, 0xD9)
    const eoiIndex = bodyBuffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoiIndex > soiIndex) {
      const sliced = bodyBuffer.slice(soiIndex, eoiIndex + 2);
      return { buffer: sliced };
    }
    // If no closing EOI marker found, slice from SOI onwards
    const sliced = bodyBuffer.slice(soiIndex);
    return { buffer: sliced };
  }

  return {
    buffer: Buffer.alloc(0),
    error: 'Payload does not contain valid JPEG magic bytes (0xFF, 0xD8). Expected raw image/jpeg binary stream.'
  };
}

/**
 * POST /api/camera/upload
 * Primary intake endpoint for ESP32-CAM images.
 */
app.post('/api/camera/upload', (req, res) => {
  // 1. Authenticate Camera
  if (!isCameraAuthorized(req)) {
    return res.status(401).json({
      error: 'UNAUTHORIZED_CAMERA',
      message: 'Authentication failed. ESP32-CAM must provide valid credential via X-Camera-Key header or token query parameter.',
      requiredHeader: 'X-Camera-Key',
      alternativeQueryParam: 'token'
    });
  }

  // 2. Validate Body Type & Content
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({
      error: 'INVALID_BODY',
      message: 'Request body must be a binary JPEG image buffer.',
      receivedType: typeof req.body
    });
  }

  // 3. Extract and Validate JPEG Format
  const { buffer: jpegBuffer, error: validationError } = extractJpegBuffer(req.body);
  if (validationError || jpegBuffer.length === 0) {
    return res.status(400).json({
      error: 'INVALID_IMAGE_FORMAT',
      message: validationError || 'Provided data is not a valid JPEG.'
    });
  }

  // 4. Generate metadata & store image
  const imageId = `cam_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();
  const sizeBytes = jpegBuffer.length;
  const base64DataUri = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';

  totalCameraUploadsCount++;

  const frameData: UploadedCameraFrame = {
    id: imageId,
    timestamp,
    sizeBytes,
    mimeType: 'image/jpeg',
    buffer: jpegBuffer,
    base64DataUri,
    url: '/api/camera/latest.jpg',
    clientIp,
    analyzed: false
  };

  latestUploadedFrame = frameData;

  // 5. Persist to Disk Storage
  try {
    const latestFilePath = path.join(UPLOAD_DIR, 'latest.jpg');
    fs.writeFileSync(latestFilePath, jpegBuffer);

    const historyFilePath = path.join(HISTORY_DIR, `${imageId}.jpg`);
    fs.writeFileSync(historyFilePath, jpegBuffer);

    const metaFilePath = path.join(UPLOAD_DIR, 'metadata.json');
    fs.writeFileSync(metaFilePath, JSON.stringify({
      id: imageId,
      timestamp,
      sizeBytes,
      mimeType: 'image/jpeg',
      url: '/api/camera/latest.jpg',
      analyzed: false
    }, null, 2));

    // Prune history to last 20 images
    const historyFiles = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.jpg'))
      .map(f => ({ name: f, time: fs.statSync(path.join(HISTORY_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (historyFiles.length > 20) {
      historyFiles.slice(20).forEach(file => {
        try {
          fs.unlinkSync(path.join(HISTORY_DIR, file.name));
        } catch (_) {}
      });
    }
  } catch (storageErr: any) {
    console.error('Persistent storage warning (in-memory cache preserved):', storageErr.message);
  }

  console.log(`[Camera Upload] Frame ${imageId} accepted (${sizeBytes} bytes) at ${timestamp}`);

  return res.status(200).json({
    success: true,
    message: 'ESP32-CAM frame received and stored successfully.',
    imageId,
    timestamp,
    sizeBytes,
    mimeType: 'image/jpeg',
    url: '/api/camera/latest.jpg',
    totalUploadsReceived: totalCameraUploadsCount,
    readyForVisionAnalysis: true
  });
});

/**
 * GET /api/camera/upload
 * Helpful guidance for engineers who open the upload URL in a browser.
 */
app.get('/api/camera/upload', (req, res) => {
  res.status(405).json({
    error: 'METHOD_NOT_ALLOWED',
    message: 'The /api/camera/upload endpoint expects HTTP POST containing raw JPEG binary body.',
    expectedMethod: 'POST',
    contentType: 'image/jpeg',
    authHeader: 'X-Camera-Key: <your_camera_key>',
    queryTokenOption: '?token=<your_camera_key>',
    testCurl: 'curl -X POST http://<server-ip>:3000/api/camera/upload -H "Content-Type: image/jpeg" -H "X-Camera-Key: <key>" --data-binary @photo.jpg'
  });
});

/**
 * GET /api/camera/latest.jpg
 * Returns the raw binary JPEG of the latest uploaded frame.
 */
app.get('/api/camera/latest.jpg', (req, res) => {
  if (!latestUploadedFrame || !latestUploadedFrame.buffer) {
    return res.status(404).json({
      error: 'NO_FRAME_AVAILABLE',
      message: 'No camera frame has been uploaded yet. Awaiting ESP32-CAM POST to /api/camera/upload.'
    });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Frame-ID', latestUploadedFrame.id);
  res.setHeader('X-Frame-Timestamp', latestUploadedFrame.timestamp);
  res.setHeader('X-Data-Source', 'REAL_HARDWARE');
  return res.send(latestUploadedFrame.buffer);
});

/**
 * GET /api/camera/latest
 * Returns JSON metadata and base64 data URI for VisionAgent and UI display.
 */
app.get('/api/camera/latest', (req, res) => {
  if (!latestUploadedFrame) {
    return res.status(200).json({
      exists: false,
      status: 'WAITING_FOR_UPLOAD',
      message: 'No camera frame uploaded yet. Awaiting ESP32-CAM upload at POST /api/camera/upload.',
      uploadEndpoint: '/api/camera/upload',
      dataSource: 'DISCONNECTED',
      totalUploadsCount: totalCameraUploadsCount
    });
  }

  const ageSeconds = Math.round((Date.now() - new Date(latestUploadedFrame.timestamp).getTime()) / 1000);
  return res.status(200).json({
    exists: true,
    status: 'ONLINE',
    id: latestUploadedFrame.id,
    timestamp: latestUploadedFrame.timestamp,
    ageSeconds,
    sizeBytes: latestUploadedFrame.sizeBytes,
    mimeType: latestUploadedFrame.mimeType,
    url: latestUploadedFrame.url,
    base64: latestUploadedFrame.base64DataUri,
    analyzed: latestUploadedFrame.analyzed,
    analysis: latestUploadedFrame.analysis,
    dataSource: 'REAL_HARDWARE',
    totalUploadsCount: totalCameraUploadsCount
  });
});

/**
 * GET /api/camera/upload-info
 * Returns upload configuration guidelines and live telemetry for UI panels.
 */
app.get('/api/camera/upload-info', (req, res) => {
  const hasKey = Boolean(process.env.CAMERA_UPLOAD_KEY || process.env.HARDWARE_API_KEY);
  res.json({
    endpoint: '/api/camera/upload',
    method: 'POST',
    supportedContentTypes: ['image/jpeg', 'application/octet-stream', 'multipart/form-data'],
    authHeader: 'X-Camera-Key',
    authQueryParam: 'token',
    maxSizeMb: MAX_UPLOAD_MB,
    authConfigured: hasKey,
    latestUploadTimestamp: latestUploadedFrame?.timestamp || null,
    latestImageId: latestUploadedFrame?.id || null,
    latestSizeBytes: latestUploadedFrame?.sizeBytes || 0,
    totalUploadsReceived: totalCameraUploadsCount,
    hasUploadedImage: Boolean(latestUploadedFrame)
  });
});

/**
 * POST /api/camera/mark-analyzed
 * Records VisionAgent inspection results on the current frame.
 */
app.post('/api/camera/mark-analyzed', (req, res) => {
  if (latestUploadedFrame && req.body?.id === latestUploadedFrame.id) {
    latestUploadedFrame.analyzed = true;
    latestUploadedFrame.analysis = req.body.analysis;
  }
  return res.json({ success: true });
});

/**
 * DELETE /api/camera/latest
 * Diagnostics & testing: clears uploaded frame.
 */
app.delete('/api/camera/latest', (req, res) => {
  latestUploadedFrame = null;
  return res.json({ success: true, message: 'Latest camera frame cache cleared.' });
});

// --------------------------------------------------------------------
// CONTROLLER & CAMERA PROXY ROUTES
// --------------------------------------------------------------------

// Unified Gateway Proxy: /api/hardware
app.all('/api/hardware', async (req, res) => {
  const endpoint = (req.query.endpoint as string) || '/status';
  const overrideHost = req.query.host as string | undefined;
  const overridePort = req.query.port ? parseInt(req.query.port as string, 10) : undefined;
  
  const baseUrl = getControllerBaseUrl(overrideHost, overridePort);
  if (!baseUrl) {
    return res.status(503).json({
      error: 'HARDWARE_GATEWAY_NOT_CONFIGURED',
      message: 'Controller host is not configured on server. Provide HARDWARE_CONTROLLER_HOST in environment or specify host parameter.'
    });
  }

  // Firmware Safety Interlocks Enforced at Server Gateway
  if (endpoint.startsWith('/roof')) {
    const state = req.query.state || req.body?.state;
    const isRaining = req.query.rain === 'true' || req.body?.rain === true;
    const emergencyOverride = req.query.override === 'true' || req.body?.override === true;

    if (state === 'open' && isRaining && !emergencyOverride) {
      return res.status(403).json({
        error: 'SAFETY_INTERLOCK_BLOCKED',
        message: 'GREENHOUSE ROOF SAFETY INTERLOCK: Cannot open roof while rain sensor is active.',
        interlock: 'rainLocked'
      });
    }
  }

  if (endpoint.startsWith('/override')) {
    const device = req.query.device || req.body?.device;
    const state = req.query.state || req.body?.state;
    const waterLevel = req.query.waterLevel ? parseFloat(req.query.waterLevel as string) : 50;

    if (device === 'pump' && state === 'on' && waterLevel < 10) {
      return res.status(403).json({
        error: 'SAFETY_INTERLOCK_BLOCKED',
        message: 'WATER PUMP SAFETY INTERLOCK: Reservoir critically low (<10%). Dry run prevented.',
        interlock: 'waterLowLocked'
      });
    }
  }

  try {
    const targetUrl = new URL(`${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`);
    
    // Copy query parameters (except control params)
    Object.entries(req.query).forEach(([k, v]) => {
      if (!['endpoint', 'host', 'port'].includes(k)) {
        targetUrl.searchParams.set(k, String(v));
      }
    });

    // Injected server-side secret API key (NEVER exposed to frontend bundle)
    const apiKey = process.env.HARDWARE_API_KEY || (req.headers['x-api-key'] as string);
    if (apiKey) {
      targetUrl.searchParams.set('auth', apiKey);
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'EDENS-AI-Gateway/2.4'
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'HARDWARE_TIMEOUT' : 'HARDWARE_UNREACHABLE',
      message: isTimeout 
        ? 'ESP32 controller did not respond within 6000ms.'
        : `Failed to connect to ESP32: ${err.message}`
    });
  }
});

// Camera Snapshot Pull Proxy: /api/camera/capture (Pull Model)
app.get('/api/camera/capture', async (req, res) => {
  // If an uploaded frame is present and fresh, serve that first!
  if (latestUploadedFrame && latestUploadedFrame.buffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Data-Source', 'REAL_HARDWARE');
    return res.send(latestUploadedFrame.buffer);
  }

  const overrideHost = req.query.host as string | undefined;
  const overridePort = req.query.port ? parseInt(req.query.port as string, 10) : undefined;
  const cameraBase = getCameraBaseUrl(overrideHost, overridePort);

  if (!cameraBase) {
    return res.status(503).json({
      error: 'CAMERA_NOT_CONFIGURED',
      message: 'ESP32-CAM host is not configured on server and no uploaded frame exists.'
    });
  }

  const capturePath = (req.query.path as string) || '/capture';
  const targetUrl = `${cameraBase}${capturePath.startsWith('/') ? capturePath : '/' + capturePath}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Camera returned HTTP ${response.status}` });
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(Buffer.from(buffer));
  } catch (err: any) {
    return res.status(502).json({
      error: 'CAMERA_UNREACHABLE',
      message: `Failed to fetch frame from ESP32-CAM: ${err.message}`
    });
  }
});

// Camera Status Proxy: /api/camera/status
app.get('/api/camera/status', async (req, res) => {
  // If an uploaded image exists, report push status
  if (latestUploadedFrame) {
    const ageSeconds = Math.round((Date.now() - new Date(latestUploadedFrame.timestamp).getTime()) / 1000);
    return res.json({
      connected: ageSeconds < 120,
      mode: 'PUSH_UPLOAD',
      sensorModel: 'ESP32-CAM (Push Intake)',
      status: ageSeconds < 120 ? 'ONLINE' : 'IDLE',
      lastUploadTimestamp: latestUploadedFrame.timestamp,
      ageSeconds,
      sizeBytes: latestUploadedFrame.sizeBytes,
      totalUploadsReceived: totalCameraUploadsCount
    });
  }

  const overrideHost = req.query.host as string | undefined;
  const overridePort = req.query.port ? parseInt(req.query.port as string, 10) : undefined;
  const cameraBase = getCameraBaseUrl(overrideHost, overridePort);

  if (!cameraBase) {
    return res.json({
      connected: false,
      mode: 'PUSH_OR_PULL',
      sensorModel: 'ESP32-CAM',
      status: 'AWAITING_UPLOAD_OR_CONFIG'
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${cameraBase}/status`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return res.json({ connected: true, mode: 'PULL_DIRECT', ...data });
  } catch (err: any) {
    return res.json({
      connected: false,
      mode: 'PULL_DIRECT',
      sensorModel: 'ESP32-CAM',
      status: 'OFFLINE',
      error: err.message
    });
  }
});

// Test Suite Endpoint: /api/hardware/test-suite
app.get('/api/hardware/test-suite', (req, res) => {
  res.json({
    tests: [
      { id: 'camera_upload_endpoint', name: 'POST /api/camera/upload Intake', supported: true },
      { id: 'camera_latest_endpoint', name: 'GET /api/camera/latest Metadata', supported: true },
      { id: 'camera_latest_jpg', name: 'GET /api/camera/latest.jpg Binary', supported: true },
      { id: 'status_endpoint', name: 'GET /status Telemetry Packet', supported: true },
      { id: 'crops_endpoint', name: 'GET /crops Botanical Profiles', supported: true },
      { id: 'setPlant_endpoint', name: 'GET /setPlant Crop Config', supported: true },
      { id: 'setCustom_endpoint', name: 'GET /setCustom Target Ranges', supported: true },
      { id: 'roof_endpoint', name: 'GET /roof Vent Actuation', supported: true },
      { id: 'override_endpoint', name: 'GET /override Actuator Relay', supported: true },
      { id: 'pause_endpoint', name: 'GET /pause Automation Hold', supported: true },
      { id: 'setOption_endpoint', name: 'GET /setOption Config Parameter', supported: true },
      { id: 'camera_capture', name: 'GET /capture Botanical Still Frame', supported: true },
      { id: 'camera_stream', name: 'GET /stream MJPEG Feed', supported: true }
    ],
    safetyInterlocks: [
      { name: 'Rain vs Roof Vent Interlock', status: 'ACTIVE' },
      { name: 'Low Water Pump Dry-Run Lock', status: 'ACTIVE' },
      { name: 'Thermal Heater Interlock (>32°C)', status: 'ACTIVE' },
      { name: 'Max Irrigation Duration Limit (120s)', status: 'ACTIVE' }
    ]
  });
});

// --------------------------------------------------------------------
// FRONTEND SERVING & VITE MIDDLEWARE
// --------------------------------------------------------------------

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌿 EDENS AI Server & Hardware Gateway running on http://0.0.0.0:${PORT}`);
    console.log(`📸 ESP32-CAM Upload intake ready at POST http://0.0.0.0:${PORT}/api/camera/upload`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
