import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { CameraImageStore } from './src/server/cameraStorage';
import { registerCameraRoutes } from './src/server/cameraAcquisition';
import { createVisionDiagnosisHandler } from './src/server/visionDiagnosis';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_MB = parseInt(process.env.CAMERA_MAX_UPLOAD_MB || '10', 10);
const MAX_AUDIO_MB = parseInt(process.env.AUDIO_MAX_UPLOAD_MB || '15', 10);

// Dedicated Camera Image Storage Layer (lazy disk writes via CAMERA_STORAGE_PATH)
export const cameraImageStore = new CameraImageStore({
  maxUploadBytes: MAX_UPLOAD_MB * 1024 * 1024
});

// --------------------------------------------------------------------
// BODY PARSERS
// --------------------------------------------------------------------

// 1. Raw body parser for audio transcription direct binary stream uploads
app.use('/api/ai/transcribe', (req, res, next) => {
  const cType = (req.headers['content-type'] || '').toLowerCase();
  if (cType.startsWith('audio/') || cType.includes('octet-stream')) {
    return express.raw({ type: () => true, limit: `${MAX_AUDIO_MB}mb` })(req, res, next);
  }
  return next();
});

// 2. Standard JSON & URL-encoded parsers (bypassed for binary /api/camera/upload)
const jsonParser = express.json({ limit: `${MAX_AUDIO_MB + 5}mb` });
const urlencodedParser = express.urlencoded({ extended: true, limit: `${MAX_AUDIO_MB + 5}mb` });

app.use((req, res, next) => {
  if (req.path === '/api/camera/upload') return next();
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/api/camera/upload') return next();
  return urlencodedParser(req, res, next);
});

// 3. Register Dedicated ESP32-CAM Acquisition & Retrieval Routes
registerCameraRoutes(app, cameraImageStore);

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



// --------------------------------------------------------------------
// MAIN ESP32 TELEMETRY PUSH INTAKE & CONTROLLER PROXY ROUTES
// --------------------------------------------------------------------

interface PushedControllerTelemetry {
  timestamp: string;
  receivedAtMs: number;
  payload: Record<string, any>;
}

let latestPushedTelemetry: PushedControllerTelemetry | null = null;
let totalTelemetryUploadsCount = 0;

function classifyControllerTelemetryState(receivedAtMs: number): {
  ageSeconds: number;
  dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
  isStale: boolean;
} {
  const ageSeconds = Math.max(0, Math.round((Date.now() - receivedAtMs) / 1000));
  if (ageSeconds <= 15) {
    return { ageSeconds, dataSource: 'REAL_HARDWARE', isStale: false };
  }
  if (ageSeconds <= 60) {
    return { ageSeconds, dataSource: 'CACHED', isStale: false };
  }
  if (ageSeconds <= 180) {
    return { ageSeconds, dataSource: 'STALE', isStale: true };
  }
  return { ageSeconds, dataSource: 'DISCONNECTED', isStale: true };
}

function hasValidCoreTelemetryFields(raw: any): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const src = raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : raw;
  const candidates = [src.temperature, src.humidity, src.soilMoisture];
  return candidates.some((v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)));
}

function isHardwareAuthorized(req: express.Request): { authorized: boolean; status: number; error: string; message: string } {
  const configuredKey = (process.env.HARDWARE_API_KEY || '').trim();
  if (!configuredKey) {
    return {
      authorized: false,
      status: 503,
      error: 'SERVER_MISCONFIGURED',
      message: 'HARDWARE_API_KEY is not configured on the server. Telemetry push uploads are rejected for security.'
    };
  }
  const headerKey = (req.headers['x-hardware-key'] || req.headers['x-api-key']) as string | undefined;
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader) : undefined;
  const provided = (headerKey || bearerKey || '').trim();
  if (!provided) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CONTROLLER',
      message: 'Authentication failed. Provide valid credential via X-Hardware-Key or X-API-Key header.'
    };
  }
  if (provided !== configuredKey) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CONTROLLER',
      message: 'Invalid controller authentication credential provided.'
    };
  }
  return { authorized: true, status: 200, error: '', message: '' };
}

/**
 * POST /api/telemetry/upload
 * Authenticated push intake allowing the Main ESP32 controller or a local LAN relay
 * to forward physical /status telemetry to cloud deployments without exposing private LAN ports.
 */
app.post('/api/telemetry/upload', (req, res) => {
  const auth = isHardwareAuthorized(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message,
      requiredHeader: 'X-Hardware-Key'
    });
  }

  if (!hasValidCoreTelemetryFields(req.body)) {
    return res.status(400).json({
      error: 'INVALID_TELEMETRY_PAYLOAD',
      message: 'Telemetry JSON must contain at least one numeric environmental reading (temperature, humidity, or soilMoisture).'
    });
  }

  if (req.body?.dataSource === 'SIMULATED') {
    return res.status(400).json({
      error: 'SIMULATED_DATA_REJECTED',
      message: 'Simulated payloads cannot be uploaded to the physical hardware telemetry intake.'
    });
  }

  const timestamp = new Date().toISOString();
  totalTelemetryUploadsCount++;
  latestPushedTelemetry = {
    timestamp,
    receivedAtMs: Date.now(),
    payload: req.body
  };

  return res.status(200).json({
    success: true,
    message: 'Physical ESP32 telemetry accepted.',
    timestamp,
    dataSource: 'REAL_HARDWARE',
    totalUploadsReceived: totalTelemetryUploadsCount
  });
});

/**
 * GET /api/telemetry/latest
 * Returns latest pushed Main ESP32 telemetry with accurate freshness classification.
 */
app.get('/api/telemetry/latest', (req, res) => {
  if (!latestPushedTelemetry) {
    return res.status(200).json({
      exists: false,
      dataSource: 'DISCONNECTED',
      isStale: true,
      totalUploadsCount: totalTelemetryUploadsCount,
      message: 'No physical controller telemetry uploaded yet.'
    });
  }

  const state = classifyControllerTelemetryState(latestPushedTelemetry.receivedAtMs);
  if (state.dataSource === 'DISCONNECTED') {
    return res.status(200).json({
      exists: false,
      dataSource: 'DISCONNECTED',
      isStale: true,
      lastTimestamp: latestPushedTelemetry.timestamp,
      ageSeconds: state.ageSeconds,
      totalUploadsCount: totalTelemetryUploadsCount,
      message: `Last controller reading expired (${state.ageSeconds}s ago).`
    });
  }

  return res.status(200).json({
    exists: true,
    timestamp: latestPushedTelemetry.timestamp,
    ageSeconds: state.ageSeconds,
    isStale: state.isStale,
    dataSource: state.dataSource,
    totalUploadsCount: totalTelemetryUploadsCount,
    payload: latestPushedTelemetry.payload
  });
});

// Unified Gateway Proxy: /api/hardware
app.all('/api/hardware', async (req, res) => {
  const endpoint = (req.query.endpoint as string) || '/status';
  const overrideHost = req.query.host as string | undefined;
  const overridePort = req.query.port ? parseInt(req.query.port as string, 10) : undefined;
  
  const baseUrl = getControllerBaseUrl(overrideHost, overridePort);
  if (!baseUrl) {
    // Read-only /status fallback to pushed physical telemetry if recently uploaded via LAN relay
    if (req.method === 'GET' && endpoint === '/status' && latestPushedTelemetry) {
      const state = classifyControllerTelemetryState(latestPushedTelemetry.receivedAtMs);
      if (state.dataSource !== 'DISCONNECTED') {
        return res.status(200).json({
          ...latestPushedTelemetry.payload,
          connected: state.dataSource === 'REAL_HARDWARE',
          timestamp: latestPushedTelemetry.timestamp,
          ageSeconds: state.ageSeconds,
          isStale: state.isStale,
          dataSource: state.dataSource
        });
      }
    }
    return res.status(503).json({
      error: 'HARDWARE_GATEWAY_NOT_CONFIGURED',
      message: 'Controller host is not configured on server and no active pushed telemetry exists. Provide HARDWARE_CONTROLLER_HOST or push via POST /api/telemetry/upload.'
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
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

const GEMINI_TEXT_VISION_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'] as const;

function isFallbackEligibleError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.toLowerCase().includes('not found')
  );
}

async function generateWithModelFallback(
  ai: GoogleGenAI,
  requestParams: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  models: readonly string[] = GEMINI_TEXT_VISION_MODELS
): Promise<{ response: any; modelUsed: string }> {
  let lastErr: any = null;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        ...requestParams
      });
      return { response, modelUsed: modelName };
    } catch (err: any) {
      lastErr = err;
      if (i < models.length - 1 && isFallbackEligibleError(err)) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Gemini model generation failed.');
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
    models: {
      chat: 'gemini-3.8-flash',
      vision: 'gemini-3.8-flash',
      transcription: 'gemini-3.5-transcribe',
      speech: 'gemini-3.8-flash-lite-tts',
      fallbackChain: ['gemini-flash-latest', 'gemini-3.1-flash-lite']
    },
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

    // Fallback attempt: multimodal Gemini Flash chain
    if (!transcribedText) {
      const { response: fallbackResponse } = await generateWithModelFallback(ai, {
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

  const sourceState = String(contextData?.dataSource || 'DISCONNECTED').toUpperCase();
  const telemetryContextBlock = (() => {
    if (!contextData || sourceState === 'DISCONNECTED') {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Connection State: DISCONNECTED (No live signal from physical Main ESP32 controller)
- Monitored Crop: ${contextData?.cropType || 'Greenhouse Crops'}
- IMPORTANT: Do NOT claim live physical sensor readings exist right now. State honestly that the physical ESP32 controller is currently disconnected while still giving helpful agricultural advice.`;
    }
    if (sourceState === 'SIMULATED') {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Data Source: SIMULATED (Synthetic simulation values for testing — NOT live physical sensor hardware)
- Monitored Crop: ${contextData.cropType || 'Greenhouse Crops'}
- Simulated Temperature: ${contextData.temperature ?? 24}°C
- Simulated Relative Humidity: ${contextData.humidity ?? 65}%
- Simulated Soil Moisture: ${contextData.soilMoisture ?? 50}%
- IMPORTANT: Never label these simulated readings as live physical greenhouse sensor data.`;
    }
    if (sourceState === 'CACHED' || sourceState === 'STALE' || contextData.isStale) {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Data Source: ${sourceState} (Historical/expired controller reading — NOT live real-time data; last seen: ${contextData.lastSeen || 'earlier'})
- Monitored Crop: ${contextData.cropType || 'Greenhouse Crops'}
- Last Recorded Temperature: ${contextData.temperature ?? 'N/A'}°C
- Last Recorded Relative Humidity: ${contextData.humidity ?? 'N/A'}%
- Last Recorded Soil Moisture: ${contextData.soilMoisture ?? 'N/A'}%
- IMPORTANT: Clearly note that these readings are ${sourceState.toLowerCase()} rather than live real-time measurements.`;
    }
    return `LIVE GREENHOUSE TELEMETRY CONTEXT:
- Data Source: REAL_HARDWARE (Verified fresh reading from physical Main ESP32 controller)
- Monitored Crop: ${contextData.cropType || 'Greenhouse Crops'}
- Temperature: ${contextData.temperature}°C
- Relative Humidity: ${contextData.humidity}%
- Soil Moisture: ${contextData.soilMoisture}%
${contextData.actuators ? `- Active Actuators: ${JSON.stringify(contextData.actuators)}` : ''}
${contextData.interlocks ? `- Safety Interlocks: ${JSON.stringify(contextData.interlocks)}` : ''}`;
  })();

  const systemInstruction = `You are EDENS AI, the dedicated autonomous agricultural intelligence engine and expert agronomist for the EDENS smart greenhouse system, powered by RA.
You have fluent mastery of Nigerian languages: Hausa, Igbo, Yoruba, Nigerian Pidgin, Fulfulde, Tiv, Efik, and English.

COMMUNICATION REQUIREMENTS:
The farmer wants to communicate with you in: ${langInfo.name} (${langInfo.native}) [Region: ${langInfo.region}].
- ALWAYS reply directly, warmly, and thoroughly in ${langInfo.name}.
- If the user speaks in Nigerian Pidgin, respond in cheerful, knowledgeable Nigerian Pidgin.
- If the user speaks in Hausa, respond in respectful, accurate Harshen Hausa.
- If the user speaks in Yoruba, respond in respectful, rich Èdè Yorùbá.
- If the user speaks in Igbo, respond in clear, supportive Asụsụ Igbo.
- Provide practical advice with local Nigerian agricultural realities: organic pest remedies (Dongoyaro/Neem extract, wood ash, garlic spray), soil care, watering schedules, greenhouse ventilation, solar power, and harvest readiness.

HARDWARE & TELEMETRY HONESTY RULES:
- You are part of the EDENS AI greenhouse platform (Main ESP32 environmental controller, ESP32-CAM push intake at POST /api/camera/upload, and firmware safety interlocks: Rain vs Roof Lock, Dry-Run Pump Lock <10% water, Thermal Heater Lock >32°C).
- Current telemetry source state is: ${sourceState}.
- NEVER label SIMULATED, CACHED, STALE, or DISCONNECTED readings as live physical sensor data. Report the exact connection/data-source state honestly if asked about hardware status or sensor readings.

CONVERSATION & CONTINUATION HANDLING:
- If the farmer's prompt is a brief continuation request such as "go on", "continue", "tell me more", "explain further", or "what next", DO NOT restart with a generic greeting or welcome message. Look at the previous turns in the conversation history and continue providing detailed, actionable agricultural advice on the topic previously being discussed.

${telemetryContextBlock}`;

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

  // Ensure history ends with 'model' so appending userTurn alternates correctly
  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  // Take the most recent turns ensuring first item is 'user'
  let slicedHistory = validHistory.slice(-6);
  while (slicedHistory.length > 0 && slicedHistory[0].role !== 'user') {
    slicedHistory.shift();
  }

  const userTurn = {
    role: 'user' as const,
    parts: [{ text: `[Speaking in ${langInfo.name}]: ${message.trim()}` }]
  };
  const contents = [...slicedHistory, userTurn];

  try {
    const { response, modelUsed } = await generateWithModelFallback(ai, {
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
      languageName: langInfo.name,
      modelUsed,
      dataSource: sourceState
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
 * Dedicated AI Vision Analysis Layer decoupled from camera acquisition & storage.
 * Enforces genuine raster image bytes and refuses simulated or stale camera snapshots
 * when diagnosing live ESP32-CAM captures.
 */
app.post(
  '/api/ai/diagnose',
  createVisionDiagnosisHandler({
    imageStore: cameraImageStore,
    languages: NIGERIAN_LANG_NAMES,
    isAiConfigured: () => Boolean(getGeminiClient()),
    runVisionModel: async ({ base64Data, mimeType, promptText, responseSchema }) => {
      const ai = getGeminiClient();
      if (!ai) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
      }
      const { response, modelUsed } = await generateWithModelFallback(ai, {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            },
            { text: promptText }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema as any
        }
      });
      return {
        rawJsonText: response.text || '',
        modelUsed
      };
    }
  })
);

/**
 * POST /api/ai/predict-harvest
 * Server-side harvest date & growth factor calculation via Gemini.
 */
app.post('/api/ai/predict-harvest', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server.'
    });
  }

  const {
    cropType = 'Tomato',
    plantingDate = new Date().toISOString().split('T')[0],
    standardDays = 70,
    avgTemp = 24.5,
    avgHumidity = 62,
    lightHours = 14,
    soilMoisture = 50
  } = req.body || {};

  const prompt = `You are an expert agronomist and greenhouse scientist in EDENS AI (powered by RA). Based on the following growing conditions, calculate the estimated harvest date for ${cropType} planted on ${plantingDate}.
Standard growing period: ${standardDays} days.
Current conditions: Average temp: ${avgTemp}°C, Humidity stability: ${avgHumidity}%, Light hours/day: ${lightHours}h, Soil moisture stability: ${soilMoisture}%.
Ideal conditions: Temp 22-26°C, Humidity 60-70%, Light 14-16h/day, Moisture stable at 40-60%.
Calculate how much faster (or slower) the crop will mature compared to standard outdoor growing. Return JSON.`;

  try {
    const { response, modelUsed } = await generateWithModelFallback(ai, {
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedDaysTotal: { type: Type.INTEGER },
            daysSaved: { type: Type.INTEGER },
            daysRemaining: { type: Type.INTEGER },
            estimatedHarvestDate: { type: Type.STRING },
            confidence: { type: Type.INTEGER },
            factors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  impact: { type: Type.INTEGER },
                  explanation: { type: Type.STRING }
                },
                required: ['name', 'impact', 'explanation']
              }
            }
          },
          required: ['estimatedDaysTotal', 'daysSaved', 'daysRemaining', 'estimatedHarvestDate', 'confidence', 'factors']
        }
      }
    });

    if (!response.text) {
      throw new Error('No text returned from Gemini harvest model.');
    }

    return res.json({
      success: true,
      result: JSON.parse(response.text.trim()),
      modelUsed
    });
  } catch (err: any) {
    console.error('Harvest prediction error on server:', err.message);
    return res.status(502).json({
      error: 'HARVEST_PREDICTION_FAILED',
      message: `Harvest prediction failed: ${err.message}`
    });
  }
});

/**
 * POST /api/ai/agent-decision
 * Server-side structured decision evaluation for ClimateAgent and IrrigationAgent.
 * Keeps all @google/genai calls strictly on the server.
 */
app.post('/api/ai/agent-decision', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server.'
    });
  }

  const { agentType, telemetry } = req.body || {};
  if (agentType !== 'climate' && agentType !== 'irrigation') {
    return res.status(400).json({ error: 'INVALID_AGENT_TYPE', message: 'agentType must be "climate" or "irrigation".' });
  }

  try {
    if (agentType === 'climate') {
      const temp = Number(telemetry?.temperature ?? 24);
      const humidity = Number(telemetry?.humidity ?? 60);
      const activeCrop = String(telemetry?.activeCrop || 'Tomato');
      const dataSource = String(telemetry?.dataSource || 'SIMULATED');
      const thermalLocked = Boolean(telemetry?.thermalLocked || temp > 32);

      const prompt = `You are EDENS AI Climate Agent, optimizing greenhouse ventilation and temperature for ${activeCrop}.
Current Telemetry (${dataSource}):
- Temperature: ${temp}°C
- Humidity: ${humidity}%
- Thermal Interlock: ${thermalLocked ? 'ACTIVE (Heater locked OFF)' : 'CLEAR'}
Optimal ranges for ${activeCrop}: Temp 20-28°C, Humidity 50-75%.

Safety Rules:
1. Never turn heater ON if temperature is above 26°C or if thermal interlock is active.
2. Turn fan ON if temp > 28°C or humidity > 75%.
3. Explain your exact reasoning with safety margins.
Return JSON: { "fan": "ON"|"OFF", "heater": "ON"|"OFF", "reason": "string" }`;

      const { response, modelUsed } = await generateWithModelFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fan: { type: Type.STRING },
              heater: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ['fan', 'heater', 'reason']
          }
        }
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return res.json({ success: true, result: parsed, modelUsed });
    }

    const soilMoisture = Number(telemetry?.soilMoisture ?? 50);
    const rain = Boolean(telemetry?.rain);
    const temp = Number(telemetry?.temperature ?? 24);
    const waterLevel = Number(telemetry?.waterLevel ?? 70);
    const activeCrop = String(telemetry?.activeCrop || 'Tomato');
    const dataSource = String(telemetry?.dataSource || 'SIMULATED');
    const waterLowLocked = waterLevel < 10;

    const prompt = `You are EDENS AI Irrigation Agent, managing precision drip irrigation for ${activeCrop}.
Current Telemetry (${dataSource}):
- Soil Moisture: ${soilMoisture}%
- Ambient Temperature: ${temp}°C
- Rain Detected: ${rain}
- Reservoir Water Level: ${waterLevel}%
- Reservoir Interlock: ${waterLowLocked ? 'LOCKED (Low Water)' : 'CLEAR'}
Optimal soil moisture for ${activeCrop}: 45-65%.

Safety Rules:
1. ONLY recommend pump "ON" if soil moisture is strictly below 40% and reservoir > 15%.
2. Duration MUST NOT exceed 120 seconds to prevent over-irrigation.
3. If soil moisture is adequate, pump MUST be "OFF".
4. State your agronomic reason clearly.
Return JSON: { "pump": "ON"|"OFF", "duration": number, "reason": "string" }`;

    const { response, modelUsed } = await generateWithModelFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pump: { type: Type.STRING },
            duration: { type: Type.NUMBER },
            reason: { type: Type.STRING }
          },
          required: ['pump', 'duration', 'reason']
        }
      }
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return res.json({ success: true, result: parsed, modelUsed });
  } catch (err: any) {
    console.error('Agent decision error on server:', err.message);
    return res.status(502).json({
      error: 'AGENT_DECISION_FAILED',
      message: `Agent decision evaluation failed: ${err.message}`
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

    const headBuf = Buffer.from(pcmBase64.slice(0, 16), 'base64');
    const isRiffWav = headBuf.length >= 4 && headBuf.toString('ascii', 0, 4) === 'RIFF';

    return res.json({
      success: true,
      pcmBase64,
      sampleRate: 24000,
      mimeType: isRiffWav ? 'audio/wav' : 'audio/pcm'
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
