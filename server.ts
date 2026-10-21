import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_MB = parseInt(process.env.CAMERA_MAX_UPLOAD_MB || '10', 10);
const MAX_AUDIO_MB = parseInt(process.env.AUDIO_MAX_UPLOAD_MB || '15', 10);

// Camera Upload Storage Directories (supports Render Persistent Disks via CAMERA_STORAGE_PATH)
const STORAGE_BASE = process.env.CAMERA_STORAGE_PATH || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const UPLOAD_DIR = path.join(STORAGE_BASE, 'camera');
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

// 2. Raw body parser for audio transcription direct binary stream uploads
app.use('/api/ai/transcribe', (req, res, next) => {
  const cType = (req.headers['content-type'] || '').toLowerCase();
  if (cType.startsWith('audio/') || cType.includes('octet-stream')) {
    return express.raw({ type: () => true, limit: `${MAX_AUDIO_MB}mb` })(req, res, next);
  }
  return next();
});

// 3. Standard JSON parser for API routes (allows voice note base64 payloads up to MAX_AUDIO_MB)
app.use(express.json({ limit: `${MAX_AUDIO_MB + 5}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${MAX_AUDIO_MB + 5}mb` }));

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
 * Helper to get configured camera secret from environment.
 * NEVER falls back to any hardcoded or default public secret.
 */
function getCameraUploadSecret(): string {
  return (process.env.CAMERA_UPLOAD_KEY || process.env.HARDWARE_API_KEY || '').trim();
}

/**
 * Validates camera authorization against the configured secret key.
 * Fails securely if the secret is unconfigured on the server.
 */
function isCameraAuthorized(req: express.Request): { authorized: boolean; status: number; error: string; message: string } {
  const configuredKey = getCameraUploadSecret();
  if (!configuredKey) {
    return {
      authorized: false,
      status: 503,
      error: 'SERVER_MISCONFIGURED',
      message: 'CAMERA_UPLOAD_KEY is not configured on the server. Camera uploads are rejected for security.'
    };
  }

  // Accept credential from custom header, standard auth header, or query param
  const incomingHeaderKey = (req.headers['x-camera-key'] || req.headers['x-api-key']) as string | undefined;
  const authHeader = req.headers['authorization'];
  let bearerKey: string | undefined;
  if (authHeader) {
    bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  }
  const queryKey = (req.query.token || req.query.key || req.query.auth) as string | undefined;

  const keyToTest = (incomingHeaderKey || bearerKey || queryKey || '').trim();
  if (!keyToTest) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CAMERA',
      message: 'Authentication failed. ESP32-CAM must provide valid credential via X-Camera-Key header or token query parameter.'
    };
  }

  if (keyToTest !== configuredKey) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CAMERA',
      message: 'Invalid camera authentication credential provided.'
    };
  }

  return { authorized: true, status: 200, error: '', message: '' };
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
  // 1. Authenticate Camera securely
  const auth = isCameraAuthorized(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message,
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
// EDENS AI INTELLIGENCE & MULTILINGUAL VOICE PIPELINE
// --------------------------------------------------------------------

/**
 * Returns an authenticated GoogleGenAI client using server-side GEMINI_API_KEY.
 * NEVER exposes the API key to frontend bundles or client logs.
 */
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build-edens'
      }
    }
  });
}

const NIGERIAN_LANG_NAMES: Record<string, { name: string; native: string; region: string }> = {
  ha: { name: 'Hausa', native: 'Harshen Hausa', region: 'Northern Nigeria / Arewa' },
  ig: { name: 'Igbo', native: 'Asụsụ Igbo', region: 'Southeastern Nigeria / Ala Igbo' },
  yo: { name: 'Yoruba', native: 'Èdè Yorùbá', region: 'Southwestern Nigeria / Ilẹ̀ Yorùbá' },
  pcm: { name: 'Nigerian Pidgin', native: 'Naija Pidgin', region: 'Pan-Nigerian / All Regions' },
  ff: { name: 'Fulfulde', native: 'Fulfulde / Pulaar', region: 'Northern & Middle Belt Nigeria' },
  tiv: { name: 'Tiv', native: 'Zwa Tiv', region: 'Benue State (Food Basket of the Nation)' },
  efi: { name: 'Efik / Ibibio', native: 'Usem Efik', region: 'South-South (Cross River & Akwa Ibom)' },
  en: { name: 'English (Nigeria)', native: 'Nigerian English', region: 'Nationwide' }
};

/**
 * GET /api/ai/status
 * Informs the frontend whether Gemini is configured on Render without leaking secrets.
 */
app.get('/api/ai/status', (req, res) => {
  const isConfigured = Boolean(getGeminiClient());
  res.json({
    status: isConfigured ? 'READY' : 'UNCONFIGURED',
    configured: isConfigured,
    provider: 'Google Gemini AI',
    maxAudioUploadMb: MAX_AUDIO_MB,
    supportedAudioFormats: ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/aac'],
    languages: Object.entries(NIGERIAN_LANG_NAMES).map(([id, info]) => ({ id, ...info })),
    instructions: 'On Render, configure GEMINI_API_KEY in Dashboard > Environment Variables.'
  });
});

/**
 * POST /api/ai/transcribe
 * Transcribes audio recordings & uploaded voice notes using Gemini models (gemini-3.5-transcribe / gemini-3.8-flash).
 * Supports JSON payloads with base64 audio and raw binary stream uploads.
 */
app.post('/api/ai/transcribe', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
    });
  }

  let base64Audio = '';
  let mimeType = 'audio/webm';
  let languageId = 'pcm';

  if (Buffer.isBuffer(req.body)) {
    // Raw binary upload
    if (req.body.length === 0) {
      return res.status(400).json({ error: 'EMPTY_AUDIO', message: 'No audio data received in request.' });
    }
    if (req.body.length > MAX_AUDIO_MB * 1024 * 1024) {
      return res.status(413).json({
        error: 'AUDIO_TOO_LARGE',
        message: `Audio file (${(req.body.length / (1024 * 1024)).toFixed(1)}MB) exceeds limit of ${MAX_AUDIO_MB}MB.`
      });
    }
    base64Audio = req.body.toString('base64');
    mimeType = (req.headers['content-type'] || 'audio/webm').split(';')[0].trim().toLowerCase();
    languageId = (req.query.languageId as string) || 'pcm';
  } else if (req.body && typeof req.body === 'object') {
    // JSON upload
    const rawData = req.body.audio;
    if (!rawData || typeof rawData !== 'string' || !rawData.trim()) {
      return res.status(400).json({ error: 'EMPTY_AUDIO', message: 'No audio data provided in request body.' });
    }
    // Clean base64 and extract mime if present as data url
    if (rawData.startsWith('data:')) {
      const match = rawData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1].toLowerCase();
        base64Audio = match[2];
      } else {
        base64Audio = rawData.split(',')[1] || rawData;
      }
    } else {
      base64Audio = rawData.trim();
    }

    if (req.body.mimeType && typeof req.body.mimeType === 'string') {
      mimeType = req.body.mimeType.split(';')[0].trim().toLowerCase();
    }
    if (req.body.languageId && typeof req.body.languageId === 'string') {
      languageId = req.body.languageId.trim().toLowerCase();
    }

    // Estimate size in bytes
    const estimatedBytes = (base64Audio.length * 3) / 4;
    if (estimatedBytes > MAX_AUDIO_MB * 1024 * 1024) {
      return res.status(413).json({
        error: 'AUDIO_TOO_LARGE',
        message: `Audio payload exceeds maximum upload limit of ${MAX_AUDIO_MB}MB.`
      });
    }
  } else {
    return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Invalid request body format. Expected JSON or audio binary.' });
  }

  // Validate MIME type
  const allowedMimePrefixes = [
    'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/ogg', 'audio/aac', 'audio/x-aac', 'audio/flac', 'video/mp4', 'video/webm'
  ];
  const isAllowed = allowedMimePrefixes.some(p => mimeType.startsWith(p));
  if (!isAllowed) {
    return res.status(400).json({
      error: 'UNSUPPORTED_AUDIO_FORMAT',
      message: `Audio format "${mimeType}" is not supported. Please use WebM, WAV, MP3, M4A, MP4, AAC, or OGG.`
    });
  }

  const langInfo = NIGERIAN_LANG_NAMES[languageId] || NIGERIAN_LANG_NAMES['pcm'];

  const instructionText = `You are an elite speech-to-text AI transcriber and linguist for Nigerian indigenous languages and local dialects.
The farmer is speaking into the microphone in: ${langInfo.name} (${langInfo.native}) [${langInfo.region}] or English/Nigerian Pidgin.
Listen carefully to the audio and transcribe the exact words spoken into clear, authentic text.
- If they speak Hausa, transcribe in authentic Hausa (Harshen Hausa).
- If they speak Yoruba, transcribe in authentic Yoruba (Èdè Yorùbá) with proper diacritics where appropriate.
- If they speak Igbo, transcribe in authentic Igbo (Asụsụ Igbo).
- If they speak Nigerian Pidgin, transcribe in authentic Naija Pidgin.
- If they speak Fulfulde, Tiv, Efik, or Nigerian English, transcribe accurately.
Return ONLY the exact transcribed words as plain text. Do not provide translation, explanations, quotation marks, or meta text.`;

  try {
    const audioPart = {
      inlineData: {
        mimeType: mimeType.split(';')[0],
        data: base64Audio
      }
    };

    let transcribedText = '';

    // First attempt: gemini-3.5-transcribe
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            { text: instructionText }
          ]
        }
      });
      transcribedText = response.text?.trim() || '';
    } catch (transcribeErr: any) {
      console.warn('gemini-3.5-transcribe attempt note, falling back to gemini-3.8-flash:', transcribeErr.message);
    }

    // Fallback attempt: gemini-3.8-flash (multimodal audio)
    if (!transcribedText) {
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            audioPart,
            { text: instructionText }
          ]
        }
      });
      transcribedText = fallbackResponse.text?.trim() || '';
    }

    return res.json({
      success: true,
      transcript: transcribedText,
      languageId,
      languageName: langInfo.name
    });
  } catch (err: any) {
    console.error('Speech transcription error on server:', err.message);
    return res.status(502).json({
      error: 'TRANSCRIPTION_FAILED',
      message: `Speech transcription failed: ${err.message || 'Error processing audio.'}`
    });
  }
});

/**
 * POST /api/ai/chat
 * Multi-turn agronomist chat reasoning in native Nigerian languages.
 */
app.post('/api/ai/chat', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
    });
  }

  const { message, languageId = 'pcm', history = [], contextData } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'EMPTY_MESSAGE', message: 'Chat message cannot be empty.' });
  }

  const langInfo = NIGERIAN_LANG_NAMES[languageId] || NIGERIAN_LANG_NAMES['pcm'];

  const systemInstruction = `You are EDENS AI, an expert autonomous agricultural assistant and botanist for smart greenhouse farming in Nigeria and West Africa, powered by RA.
You have native, fluent fluency in all Nigerian languages: Hausa, Igbo, Yoruba, Nigerian Pidgin, Fulfulde, Tiv, Efik, and English.

The farmer wants to communicate with you in: ${langInfo.name} (${langInfo.native}) [Region: ${langInfo.region}].
ALWAYS reply directly, warmly, and thoroughly in ${langInfo.name}.
If the user speaks in Nigerian Pidgin, respond in cheerful, knowledgeable Nigerian Pidgin.
If the user speaks in Hausa, respond in respectful, accurate Harshen Hausa.
If the user speaks in Yoruba, respond in respectful, rich Èdè Yorùbá.
If the user speaks in Igbo, respond in clear, supportive Asụsụ Igbo.
Provide practical advice with local Nigerian agricultural realities in mind: organic pest remedies (e.g. Dongoyaro/Neem extract, wood ash, garlic spray), soil care, watering schedules, greenhouse ventilation, solar power considerations, and market-ready crop health.

${contextData ? `Current Greenhouse telemetry context:
- Monitored Crop: ${contextData.cropType || 'Vegetables'}
- Temp: ${contextData.temperature ?? 24}°C
- Humidity: ${contextData.humidity ?? 65}%
- Soil Moisture: ${contextData.soilMoisture ?? 50}%` : ''}`;

  // Multi-turn turn sanitization for Gemini
  const validHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  let expectedRole: 'user' | 'model' = 'user';

  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || !item.content || !String(item.content).trim()) continue;
      const itemRole: 'user' | 'model' = item.role === 'assistant' ? 'model' : 'user';
      if (validHistory.length === 0 && itemRole !== 'user') continue;
      if (itemRole === expectedRole) {
        validHistory.push({
          role: itemRole,
          parts: [{ text: String(item.content) }]
        });
        expectedRole = expectedRole === 'user' ? 'model' : 'user';
      }
    }
  }

  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  const slicedHistory = validHistory.slice(-6);
  const userTurn = {
    role: 'user' as const,
    parts: [{ text: `[Speaking in ${langInfo.name}]: ${message.trim()}` }]
  };
  const contents = [...slicedHistory, userTurn];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 800
      }
    });

    const replyText = response.text?.trim();
    if (!replyText) {
      throw new Error('Gemini model did not return any text.');
    }

    return res.json({
      success: true,
      reply: replyText,
      languageId,
      languageName: langInfo.name
    });
  } catch (err: any) {
    console.error('Gemini chat error on server:', err.message);
    return res.status(502).json({
      error: 'AI_REASONING_FAILED',
      message: `EDENS AI consultation failed: ${err.message}`
    });
  }
});

/**
 * POST /api/ai/diagnose
 * Computer vision plant disease & botanical diagnosis in Nigerian languages.
 */
app.post('/api/ai/diagnose', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
    });
  }

  const { image, languageId = 'ha' } = req.body || {};
  if (!image || typeof image !== 'string' || !image.trim()) {
    return res.status(400).json({ error: 'EMPTY_IMAGE', message: 'No image provided for diagnosis.' });
  }

  let cleanBase64 = image.trim();
  let mimeType = 'image/jpeg';
  if (cleanBase64.startsWith('data:')) {
    const match = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1].toLowerCase();
      cleanBase64 = match[2];
    } else {
      cleanBase64 = cleanBase64.split(',')[1] || cleanBase64;
    }
  }

  const langInfo = NIGERIAN_LANG_NAMES[languageId] || NIGERIAN_LANG_NAMES['ha'];

  const promptText = `You are EDENS AI, an elite plant health expert and agronomist for Nigerian and tropical greenhouse farming, powered by RA.
Analyze this plant leaf/crop image carefully.

CRITICAL REQUIREMENT:
The user selected the language: "${langInfo.name} (${langInfo.native}) - ${langInfo.region}".
Communicate the diagnosis, visible symptoms, likely cause, and recommendations fluently and naturally in ${langInfo.name} (${langInfo.native}), suitable for farmers in Nigeria.
If Nigerian Pidgin is selected, use authentic, friendly Naija Pidgin.
If Hausa is selected, use authentic Harshen Hausa.
If Yoruba is selected, use authentic Èdè Yorùbá.
If Igbo is selected, use authentic Asụsụ Igbo.
For other Nigerian native tongues (Fulfulde, Tiv, Efik), communicate accurately in that tongue.

In the JSON response:
- 'species': Scientific or common English name with local Nigerian name (e.g. "Tomato (Tumatir / Tòmátì)").
- 'speciesLocal': The name solely in ${langInfo.name}.
- 'healthStatus': One of: "Healthy", "Stressed", "Diseased".
- 'healthStatusLocal': Translated status in ${langInfo.name}.
- 'symptoms': Detailed visible symptoms written in ${langInfo.name}.
- 'cause': Root cause explanation written in ${langInfo.name}.
- 'recommendation': Actionable, practical steps in ${langInfo.name} (include organic/local Nigerian remedies like neem leaf/dongoyaro water, wood ash, proper spacing, drip watering where appropriate).
- 'audioSummary': A short, clear 1-2 sentence spoken summary written in ${langInfo.name} for audio read-aloud.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType.split(';')[0],
              data: cleanBase64
            }
          },
          { text: promptText }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            species: { type: Type.STRING },
            speciesLocal: { type: Type.STRING },
            healthStatus: { type: Type.STRING },
            healthStatusLocal: { type: Type.STRING },
            symptoms: { type: Type.STRING },
            cause: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            audioSummary: { type: Type.STRING }
          },
          required: ['species', 'healthStatus', 'symptoms', 'cause', 'recommendation']
        }
      }
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    parsed.language = langInfo.name;
    return res.json({ success: true, result: parsed });
  } catch (err: any) {
    console.error('Plant diagnosis error on server:', err.message);
    return res.status(502).json({
      error: 'DIAGNOSIS_FAILED',
      message: `Plant diagnosis failed: ${err.message}`
    });
  }
});

/**
 * POST /api/ai/speech
 * High-quality Text-To-Speech generation via Gemini 3.8 Flash Lite TTS.
 */
app.post('/api/ai/speech', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
    });
  }

  const { text, voiceName = 'Kore' } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'EMPTY_TEXT', message: 'No text provided for speech generation.' });
  }

  const cleanText = text
    .replace(/[*#_`>~]/g, '')
    .replace(/\[.*?\]/g, '')
    .trim()
    .slice(0, 900);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: cleanText,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' }
          }
        }
      }
    });

    const pcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!pcmBase64) {
      throw new Error('No audio data returned from Gemini TTS.');
    }

    return res.json({
      success: true,
      pcmBase64,
      sampleRate: 24000,
      mimeType: 'audio/pcm'
    });
  } catch (err: any) {
    console.error('Speech generation error on server:', err.message);
    return res.status(502).json({
      error: 'TTS_FAILED',
      message: `Speech synthesis failed: ${err.message}`
    });
  }
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
