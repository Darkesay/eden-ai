import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { CameraImageStore } from './src/server/cameraStorage.ts';
import {
  GreenhouseCameraStoreRegistry,
  isPrivateRfc1918Ipv4,
  registerCameraRoutes
} from './src/server/cameraAcquisition.ts';
import { createVisionDiagnosisHandler } from './src/server/visionDiagnosis.ts';
import { PlatformDatabase } from './src/server/database.ts';
import { extractClientIp, registerSelfServiceGreenhouseRoutes } from './src/server/greenhouseRoutes.ts';
import {
  DEVICE_STATE_THRESHOLDS,
  type ExplicitDeviceConnectionState,
  SlidingWindowRateLimiter,
  type ValidatedControllerTelemetry,
  computeExplicitDeviceState,
  constantTimeSecretMatch,
  hasDisallowedQuerySecret,
  isPlaceholderOrEmptySecret,
  redactSecretsFromText,
  validateControllerTelemetryPayload
} from './src/server/telemetryContract.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = parseInt(process.env.PORT || '10000', 10);
const distPath = path.join(__dirname, 'dist');
const distIndexPath = path.join(distPath, 'index.html');
const isCloudRuntime = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.FLY_APP_NAME);
const isProd =
  process.env.NODE_ENV === 'production' || (isCloudRuntime && fs.existsSync(distIndexPath));
const MAX_UPLOAD_MB = parseInt(process.env.CAMERA_MAX_UPLOAD_MB || '10', 10);
const MAX_AUDIO_MB = parseInt(process.env.AUDIO_MAX_UPLOAD_MB || '15', 10);

// Dedicated Camera Image Storage Layer (lazy disk writes via CAMERA_STORAGE_PATH)
export const cameraImageStore = new CameraImageStore({
  maxUploadBytes: MAX_UPLOAD_MB * 1024 * 1024
});

// Multi-tenant SQLite Database & Per-Greenhouse Isolated Camera Stores
export const platformDb = new PlatformDatabase();
export const cameraStoreRegistry = new GreenhouseCameraStoreRegistry({
  maxUploadBytes: MAX_UPLOAD_MB * 1024 * 1024
});

let lastAsyncInitError: string | null = null;

// Fast non-blocking readiness endpoint for Render port scan & health checks
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'edens-ai',
    mode: isProd ? 'production' : 'development',
    dbInitialized: platformDb.isInitialized(),
    asyncInitError: lastAsyncInitError,
    cameraUploadEndpoint: '/api/camera/upload',
    timestamp: new Date().toISOString()
  });
});

// Ensure SQLite is initialized for auth/greenhouse/per-device routes without crashing core camera/AI routes on error
app.use(async (req, res, next) => {
  if (req.path === '/api/health' || !req.path.startsWith('/api/')) {
    return next();
  }
  if (platformDb.isInitialized()) {
    return next();
  }
  try {
    await platformDb.init();
    lastAsyncInitError = null;
    return next();
  } catch (err: any) {
    lastAsyncInitError = err?.message || String(err);
    console.error('[EDENS AI Async DB Init Error]:', err?.stack || lastAsyncInitError);
    if (
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/greenhouses') ||
      req.path.startsWith('/api/enrollments') ||
      req.path.startsWith('/api/kits') ||
      req.path.startsWith('/api/devices')
    ) {
      return res.status(503).json({
        error: 'DATABASE_INIT_FAILED',
        message: `Platform database failed to initialize: ${lastAsyncInitError}`
      });
    }
    return next();
  }
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

// 2. Scoped JSON & URL-encoded parsers:
//    - Strict 64KB cap on hardware telemetry, gateway, auth, and greenhouse configuration routes
//    - Multimodal limit ONLY on /api/ai/transcribe, /api/ai/diagnose, and /api/ai/chat
const strictJsonParser = express.json({ limit: '64kb' });
const aiMultimodalJsonParser = express.json({ limit: `${MAX_AUDIO_MB + 5}mb` });
const strictUrlencodedParser = express.urlencoded({ extended: true, limit: '64kb' });

function handleBodyParserError(
  err: any,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!err) return next();
  const claimedGhId = (req.headers['x-greenhouse-id'] as string | undefined)?.trim();
  const claimedDevId = (req.headers['x-device-id'] as string | undefined)?.trim();

  if (err.type === 'entity.too.large' || err.status === 413) {
    if (req.path === '/api/telemetry/upload' && (claimedGhId || claimedDevId)) {
      platformDb.recordDeviceError({
        greenhouseId: claimedGhId,
        deviceId: claimedDevId,
        expectedType: 'esp32_controller',
        category: 'CONNECTION',
        errorCode: 'PAYLOAD_TOO_LARGE',
        message: 'Controller telemetry payload exceeded 64 KB gateway limit.',
        ipAddress: extractClientIp(req)
      });
    }
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds the maximum allowed payload size for this endpoint.'
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    if (req.path === '/api/telemetry/upload' && (claimedGhId || claimedDevId)) {
      platformDb.recordDeviceError({
        greenhouseId: claimedGhId,
        deviceId: claimedDevId,
        expectedType: 'esp32_controller',
        category: 'CONNECTION',
        errorCode: 'MALFORMED_JSON',
        message: 'Controller uploaded malformed JSON syntax.',
        ipAddress: extractClientIp(req)
      });
    }
    return res.status(400).json({
      error: 'MALFORMED_JSON',
      message: 'Request body contains invalid JSON syntax.'
    });
  }

  return next(err);
}

app.use((req, res, next) => {
  if (req.path === '/api/camera/upload') return next();
  const isMultimodalAiRoute =
    req.path === '/api/ai/transcribe' ||
    req.path === '/api/ai/diagnose' ||
    req.path === '/api/ai/chat';
  const parser = isMultimodalAiRoute ? aiMultimodalJsonParser : strictJsonParser;
  return parser(req, res, (err) => handleBodyParserError(err, req, res, next));
});

app.use((req, res, next) => {
  if (req.path === '/api/camera/upload') return next();
  return strictUrlencodedParser(req, res, (err) => handleBodyParserError(err, req, res, next));
});

// 3. Register Self-Service Greenhouse Auth, Onboarding, QR & RBAC Routes
const { requireAuthenticatedUser } = registerSelfServiceGreenhouseRoutes(app, {
  platformDb,
  cameraRegistry: cameraStoreRegistry
});

// 4. Register Dedicated ESP32-CAM Acquisition & Retrieval Routes (Global + Per-Device Isolated)
registerCameraRoutes(app, cameraImageStore, {
  resolvePerDeviceUpload: (req, providedKey) => {
    const claimedGhId = (req.headers['x-greenhouse-id'] as string | undefined)?.trim();
    const claimedDevId = (req.headers['x-device-id'] as string | undefined)?.trim();

    if (
      providedKey.startsWith('edcam_') ||
      providedKey.startsWith('edctrl_') ||
      Boolean(claimedGhId) ||
      Boolean(claimedDevId)
    ) {
      const authRes = platformDb.authenticateDeviceKey({
        rawKey: providedKey,
        expectedType: 'esp32_cam',
        claimedGreenhouseId: claimedGhId,
        claimedDeviceId: claimedDevId
      });
      if ('errorCode' in authRes) {
        return {
          authorized: false,
          status: authRes.statusCode,
          error: authRes.errorCode,
          message: authRes.message
        };
      }
      return {
        authorized: true,
        targetStore: cameraStoreRegistry.getStore(authRes.device.greenhouseId),
        greenhouseId: authRes.device.greenhouseId,
        deviceId: authRes.device.id,
        onFrameStored: ({ timestamp, clientIp }) => {
          platformDb.recordDeviceCheckIn({
            deviceId: authRes.device.id,
            greenhouseId: authRes.device.greenhouseId,
            ipAddress: clientIp,
            checkInKind: 'camera_upload',
            dataTimestamp: timestamp
          });
        }
      };
    }
    return null;
  },
  onUploadRejected: ({ req, category, errorCode, message, greenhouseId, deviceId }) => {
    if (greenhouseId || deviceId) {
      platformDb.recordDeviceError({
        greenhouseId,
        deviceId,
        expectedType: 'esp32_cam',
        category,
        errorCode,
        message,
        ipAddress: extractClientIp(req)
      });
    }
  }
});

// --------------------------------------------------------------------
// SECURE HARDWARE INTEGRATION GATEWAY (CONTROLLER)
// --------------------------------------------------------------------

function validateLanControllerTarget(
  overrideHost?: string,
  overridePort?: number
):
  | { valid: true; baseUrl: string; usesCallerOverride: boolean }
  | { valid: false; statusCode: number; errorCode: string; message: string } {
  const callerSupplied = Boolean(overrideHost && overrideHost.trim());
  const rawHost = (callerSupplied ? overrideHost! : process.env.HARDWARE_CONTROLLER_HOST || '').trim();

  if (!rawHost || rawHost.includes('placeholder-ip')) {
    return {
      valid: false,
      statusCode: 503,
      errorCode: 'HARDWARE_GATEWAY_NOT_CONFIGURED',
      message:
        'Controller host is not configured on server and no active pushed telemetry exists. Configure outbound ESP32 HTTPS upload to POST /api/telemetry/upload.'
    };
  }

  let parsed: URL;
  try {
    const candidate =
      rawHost.startsWith('http://') || rawHost.startsWith('https://') ? rawHost : `http://${rawHost}`;
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      statusCode: 400,
      errorCode: 'INVALID_CONTROLLER_HOST',
      message: 'Controller host is not a valid LAN IPv4 or .local mDNS address.'
    };
  }

  if (parsed.username || parsed.password || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: 'INVALID_CONTROLLER_PROTOCOL',
      message: 'Controller gateway target must not embed credentials or unsupported URL schemes.'
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isPrivate = isPrivateRfc1918Ipv4(hostname);
  const isMdns = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(hostname);
  const allowLoopback = process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER === '1' || !isCloudRuntime;
  const isLoopback = allowLoopback && (hostname === '127.0.0.1' || hostname === 'localhost');

  if (!isPrivate && !isMdns && !isLoopback) {
    return {
      valid: false,
      statusCode: 403,
      errorCode: 'NON_PRIVATE_CONTROLLER_HOST_REJECTED',
      message: `Controller target "${hostname}" is rejected: gateway only permits RFC1918 private LAN IPs or .local mDNS hosts (SSRF protection).`
    };
  }

  if (isCloudRuntime && (isPrivate || isMdns || callerSupplied)) {
    return {
      valid: false,
      statusCode: 503,
      errorCode: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
      message:
        'Cloud deployment cannot connect inbound to private greenhouse LAN addresses. Flash the ESP32 controller to push telemetry via HTTPS POST /api/telemetry/upload.'
    };
  }

  const resolvedPort =
    overridePort ??
    (parsed.port ? parseInt(parsed.port, 10) : parseInt(process.env.HARDWARE_CONTROLLER_PORT || '80', 10));
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: 'INVALID_CONTROLLER_PORT',
      message: 'Controller TCP port must be between 1 and 65535.'
    };
  }

  parsed.port = resolvedPort === 80 && parsed.protocol === 'http:' ? '' : String(resolvedPort);
  return {
    valid: true,
    baseUrl: parsed.origin,
    usesCallerOverride: callerSupplied
  };
}

// --------------------------------------------------------------------
// MAIN ESP32 TELEMETRY PUSH INTAKE & CONTROLLER PROXY ROUTES
// --------------------------------------------------------------------

interface PushedControllerTelemetry {
  timestamp: string;
  receivedAtMs: number;
  validated: ValidatedControllerTelemetry;
  payload: Record<string, any>;
}

let latestPushedTelemetry: PushedControllerTelemetry | null = null;
let totalTelemetryUploadsCount = 0;

const telemetryUploadLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 120
});

export function setGlobalTelemetryReceivedAtForTesting(receivedAtMs: number): void {
  if (latestPushedTelemetry) {
    latestPushedTelemetry.receivedAtMs = receivedAtMs;
    latestPushedTelemetry.timestamp = new Date(receivedAtMs).toISOString();
  }
}

function classifyControllerTelemetryState(receivedAtMs: number): {
  ageSeconds: number;
  dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
  explicitState: ExplicitDeviceConnectionState;
  isStale: boolean;
} {
  const thresholds = DEVICE_STATE_THRESHOLDS.esp32_controller;
  const ageSeconds = Math.max(0, Math.round((Date.now() - receivedAtMs) / 1000));
  if (ageSeconds <= thresholds.onlineMaxAgeSeconds) {
    return { ageSeconds, dataSource: 'REAL_HARDWARE', explicitState: 'ONLINE', isStale: false };
  }
  if (ageSeconds <= thresholds.staleMaxAgeSeconds) {
    return { ageSeconds, dataSource: 'STALE', explicitState: 'STALE', isStale: true };
  }
  return { ageSeconds, dataSource: 'DISCONNECTED', explicitState: 'OFFLINE', isStale: true };
}

function getConfiguredHardwareSecret(): string {
  const raw = (process.env.HARDWARE_API_KEY || '').trim();
  return isPlaceholderOrEmptySecret(raw) ? '' : raw;
}

function isHardwareAuthorized(req: express.Request): {
  authorized: boolean;
  status: number;
  error: string;
  message: string;
} {
  const disallowedParam = hasDisallowedQuerySecret(req.query as Record<string, unknown>);
  if (disallowedParam) {
    return {
      authorized: false,
      status: 401,
      error: 'QUERY_AUTH_DISALLOWED',
      message: `Passing controller credentials in URL query parameter "${disallowedParam}" is disabled. Use X-Hardware-Key header.`
    };
  }

  const configuredKey = getConfiguredHardwareSecret();
  if (!configuredKey) {
    return {
      authorized: false,
      status: 503,
      error: 'SERVER_MISCONFIGURED',
      message:
        'HARDWARE_API_KEY is not configured on the server. Global telemetry uploads are rejected (fail-closed).'
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
      message: 'Authentication failed. Provide valid credential via X-Hardware-Key header.'
    };
  }
  if (!constantTimeSecretMatch(provided, configuredKey)) {
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
 * Authenticated outbound HTTPS intake for the physical ESP32 greenhouse controller.
 * Enforces independent controller auth, rejects URL query secrets unconditionally,
 * distinguishes null (UNREPORTED) from 0 readings, and records device state transitions.
 */
app.post('/api/telemetry/upload', (req, res) => {
  const ip = extractClientIp(req);
  const rate = telemetryUploadLimiter.check(`tel:${ip}`);
  if (!rate.allowed) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: `Telemetry upload rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.`
    });
  }

  const claimedGhId = (req.headers['x-greenhouse-id'] as string | undefined)?.trim();
  const claimedDevId = (req.headers['x-device-id'] as string | undefined)?.trim();

  const disallowedParam = hasDisallowedQuerySecret(req.query as Record<string, unknown>);
  if (disallowedParam) {
    if (claimedGhId || claimedDevId) {
      platformDb.recordDeviceError({
        greenhouseId: claimedGhId,
        deviceId: claimedDevId,
        expectedType: 'esp32_controller',
        category: 'AUTH',
        errorCode: 'QUERY_AUTH_DISALLOWED',
        message: `Rejected telemetry request passing credential in query parameter "${disallowedParam}".`,
        ipAddress: ip
      });
    }
    return res.status(401).json({
      error: 'QUERY_AUTH_DISALLOWED',
      message: 'Passing controller credentials in URL query parameters is disabled. Use X-Hardware-Key header.',
      requiredHeader: 'X-Hardware-Key'
    });
  }

  const headerKey = (req.headers['x-hardware-key'] || req.headers['x-api-key']) as string | undefined;
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader) : undefined;
  const providedKey = (headerKey || bearerKey || '').trim();

  // Per-device authenticated greenhouse telemetry path
  if (
    providedKey.startsWith('edctrl_') ||
    providedKey.startsWith('edcam_') ||
    Boolean(claimedGhId) ||
    Boolean(claimedDevId)
  ) {
    const devAuth = platformDb.authenticateDeviceKey({
      rawKey: providedKey,
      expectedType: 'esp32_controller',
      claimedGreenhouseId: claimedGhId,
      claimedDeviceId: claimedDevId
    });
    if ('errorCode' in devAuth) {
      platformDb.recordDeviceError({
        greenhouseId: claimedGhId,
        deviceId: claimedDevId,
        expectedType: 'esp32_controller',
        category: 'AUTH',
        errorCode: devAuth.errorCode,
        message: devAuth.message,
        ipAddress: ip
      });
      return res.status(devAuth.statusCode).json({
        error: devAuth.errorCode,
        message: devAuth.message,
        requiredHeader: 'X-Hardware-Key'
      });
    }

    const validated = validateControllerTelemetryPayload(req.body);
    if ('errorCode' in validated) {
      platformDb.recordDeviceError({
        greenhouseId: devAuth.device.greenhouseId,
        deviceId: devAuth.device.id,
        expectedType: 'esp32_controller',
        category: 'CONNECTION',
        errorCode: validated.errorCode,
        message: validated.message,
        ipAddress: ip
      });
      return res.status(validated.statusCode).json({
        error: validated.errorCode,
        message: validated.message
      });
    }

    const stored = platformDb.storeControllerTelemetry({
      greenhouseId: devAuth.device.greenhouseId,
      deviceId: devAuth.device.id,
      telemetry: validated,
      ipAddress: ip
    });

    return res.status(200).json({
      success: true,
      message: 'Physical ESP32 controller telemetry validated and stored.',
      greenhouseId: devAuth.device.greenhouseId,
      deviceId: devAuth.device.id,
      readingId: stored.readingId,
      timestamp: stored.recordedAt,
      explicitState: 'ONLINE',
      dataSource: 'REAL_HARDWARE',
      sensorHealth: validated.sensorHealth,
      interlocks: validated.interlocks
    });
  }

  // Backward-compatible global HARDWARE_API_KEY intake (strictly independent from CAMERA_UPLOAD_KEY)
  const auth = isHardwareAuthorized(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message,
      requiredHeader: 'X-Hardware-Key'
    });
  }

  const validated = validateControllerTelemetryPayload(req.body);
  if ('errorCode' in validated) {
    return res.status(validated.statusCode).json({
      error: validated.errorCode,
      message: validated.message
    });
  }

  const nowMs = Date.now();
  totalTelemetryUploadsCount++;
  latestPushedTelemetry = {
    timestamp: validated.timestamp,
    receivedAtMs: nowMs,
    validated,
    payload: {
      temperature: validated.temperature,
      humidity: validated.humidity,
      soilMoisture: validated.soilMoisture,
      sunlight: validated.sunlight,
      growLight: validated.growLight,
      waterLevel: validated.waterLevel,
      batteryVoltage: validated.batteryVoltage,
      rain: validated.rain,
      rainGaugeLevel: validated.rainGaugeLevel,
      sensorHealth: validated.sensorHealth,
      actuators: validated.actuators,
      interlocks: validated.interlocks,
      deviceHealth: validated.deviceHealth
    }
  };

  return res.status(200).json({
    success: true,
    message: 'Physical ESP32 telemetry accepted.',
    timestamp: validated.timestamp,
    explicitState: 'ONLINE',
    dataSource: 'REAL_HARDWARE',
    sensorHealth: validated.sensorHealth,
    interlocks: validated.interlocks,
    totalUploadsReceived: totalTelemetryUploadsCount
  });
});

/**
 * GET /api/telemetry/latest
 * Returns latest pushed Main ESP32 telemetry with explicit 7-state & freshness classification.
 */
app.get('/api/telemetry/latest', (_req, res) => {
  const hasSecret = Boolean(getConfiguredHardwareSecret());
  if (!latestPushedTelemetry) {
    return res.status(200).json({
      exists: false,
      explicitState: hasSecret ? 'WAITING_FOR_FIRST_CONNECTION' : 'CONFIGURATION_REQUIRED',
      dataSource: 'DISCONNECTED',
      isStale: true,
      totalUploadsCount: totalTelemetryUploadsCount,
      thresholds: DEVICE_STATE_THRESHOLDS.esp32_controller,
      message: 'No physical controller telemetry uploaded yet.'
    });
  }

  const state = classifyControllerTelemetryState(latestPushedTelemetry.receivedAtMs);
  if (state.dataSource === 'DISCONNECTED') {
    return res.status(200).json({
      exists: false,
      explicitState: 'OFFLINE',
      dataSource: 'DISCONNECTED',
      isStale: true,
      lastTimestamp: latestPushedTelemetry.timestamp,
      ageSeconds: state.ageSeconds,
      totalUploadsCount: totalTelemetryUploadsCount,
      thresholds: DEVICE_STATE_THRESHOLDS.esp32_controller,
      message: `Last controller reading expired (${state.ageSeconds}s ago; OFFLINE > ${DEVICE_STATE_THRESHOLDS.esp32_controller.staleMaxAgeSeconds}s).`
    });
  }

  return res.status(200).json({
    exists: true,
    explicitState: state.explicitState,
    timestamp: latestPushedTelemetry.timestamp,
    ageSeconds: state.ageSeconds,
    isStale: state.isStale,
    dataSource: state.dataSource,
    totalUploadsCount: totalTelemetryUploadsCount,
    thresholds: DEVICE_STATE_THRESHOLDS.esp32_controller,
    readings: {
      temperature: latestPushedTelemetry.validated.temperature,
      humidity: latestPushedTelemetry.validated.humidity,
      soilMoisture: latestPushedTelemetry.validated.soilMoisture,
      sunlight: latestPushedTelemetry.validated.sunlight,
      growLight: latestPushedTelemetry.validated.growLight,
      waterLevel: latestPushedTelemetry.validated.waterLevel,
      batteryVoltage: latestPushedTelemetry.validated.batteryVoltage,
      rain: latestPushedTelemetry.validated.rain,
      rainGaugeLevel: latestPushedTelemetry.validated.rainGaugeLevel
    },
    sensorHealth: latestPushedTelemetry.validated.sensorHealth,
    actuators: latestPushedTelemetry.validated.actuators,
    interlocks: latestPushedTelemetry.validated.interlocks,
    deviceHealth: latestPushedTelemetry.validated.deviceHealth,
    payload: latestPushedTelemetry.payload
  });
});

// Unified Local Hardware Gateway Proxy: /api/hardware
// Hardened against SSRF, query-string secret leaks, unauthenticated control commands, and unconfirmed actuation.
app.all('/api/hardware', async (req, res) => {
  const disallowedQuery = hasDisallowedQuerySecret(req.query as Record<string, unknown>);
  if (disallowedQuery) {
    return res.status(401).json({
      error: 'QUERY_AUTH_DISALLOWED',
      message: `Passing hardware credentials in URL query parameter "${disallowedQuery}" is forbidden.`
    });
  }

  const rawEndpoint = String(req.query.endpoint || '/status').trim();
  const endpoint = rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`;
  if (endpoint.includes('..') || endpoint.includes('//') || /\s/.test(endpoint)) {
    return res.status(400).json({
      error: 'INVALID_HARDWARE_ENDPOINT',
      message: 'Malformed hardware endpoint path.'
    });
  }

  const isReadOnlyQuery = req.method === 'GET' && (endpoint === '/status' || endpoint === '/crops');

  // Protect ALL configuration & actuator control routes against unauthorized access
  if (!isReadOnlyQuery) {
    const user = requireAuthenticatedUser(req);
    const hwAuth = getConfiguredHardwareSecret() ? isHardwareAuthorized(req).authorized : false;
    if (!user && !hwAuth) {
      return res.status(401).json({
        error: 'UNAUTHORIZED_HARDWARE_COMMAND',
        message: 'Sign in or provide valid X-Hardware-Key header to issue hardware configuration or actuator commands.'
      });
    }
    const ghId = String(req.query.greenhouseId || req.body?.greenhouseId || '').trim();
    if (user && ghId) {
      const role = platformDb.getMemberRole(ghId, user.id);
      if (role !== 'owner' && role !== 'operator') {
        return res.status(403).json({
          error: 'FORBIDDEN_HARDWARE_COMMAND',
          message: 'Only greenhouse owners or operators may issue actuator commands.'
        });
      }
    }
  }

  // Enforce server-side safety interlocks BEFORE attempting any network contact (preserving 0 vs null!)
  if (endpoint.startsWith('/roof')) {
    const state = String(req.query.state ?? req.body?.state ?? '').toLowerCase();
    const latestRain = latestPushedTelemetry?.validated.rain === true;
    const isRaining =
      req.query.rain === 'true' || req.body?.rain === true || (req.query.rain === undefined && req.body?.rain === undefined && latestRain);
    const emergencyOverride = req.query.override === 'true' || req.body?.override === true;

    if (state === 'open' && isRaining && !emergencyOverride) {
      return res.status(403).json({
        error: 'SAFETY_INTERLOCK_BLOCKED',
        message: 'GREENHOUSE ROOF SAFETY INTERLOCK: Cannot open roof while rain sensor is active.',
        interlock: 'rainLocked',
        interlockTriggered: true,
        confirmedByController: false
      });
    }
  }

  if (endpoint.startsWith('/override')) {
    const device = String(req.query.device ?? req.body?.device ?? '').toLowerCase();
    const state = String(req.query.state ?? req.body?.state ?? '').toLowerCase();

    const rawWater = req.query.waterLevel ?? req.body?.waterLevel ?? latestPushedTelemetry?.validated.waterLevel;
    const parsedWater =
      rawWater === undefined || rawWater === null || rawWater === '' ? null : Number(rawWater);

    if (device === 'pump' && state === 'on') {
      if (parsedWater !== null && Number.isFinite(parsedWater) && parsedWater < 10) {
        return res.status(403).json({
          error: 'SAFETY_INTERLOCK_BLOCKED',
          message: `WATER PUMP SAFETY INTERLOCK: Reservoir critically low (${parsedWater}% < 10%). Dry run prevented.`,
          interlock: 'waterLowLocked',
          interlockTriggered: true,
          confirmedByController: false
        });
      }
      const rawDuration = req.query.duration ?? req.body?.duration;
      if (rawDuration !== undefined && rawDuration !== null && Number(rawDuration) > 120) {
        return res.status(403).json({
          error: 'SAFETY_INTERLOCK_BLOCKED',
          message: 'IRRIGATION DURATION INTERLOCK: Single pump cycle cannot exceed 120 seconds.',
          interlock: 'overIrrigationLocked',
          interlockTriggered: true,
          confirmedByController: false
        });
      }
    }

    const rawTemp = req.query.temperature ?? req.body?.temperature ?? latestPushedTelemetry?.validated.temperature;
    const parsedTemp =
      rawTemp === undefined || rawTemp === null || rawTemp === '' ? null : Number(rawTemp);
    if (device === 'heater' && state === 'on' && parsedTemp !== null && Number.isFinite(parsedTemp) && parsedTemp > 32) {
      return res.status(403).json({
        error: 'SAFETY_INTERLOCK_BLOCKED',
        message: `THERMAL SAFETY INTERLOCK: Ambient temperature (${parsedTemp}°C) exceeds 32°C. Heater activation blocked.`,
        interlock: 'thermalLocked',
        interlockTriggered: true,
        confirmedByController: false
      });
    }
  }

  const overrideHost = req.query.host as string | undefined;
  const overridePort = req.query.port ? parseInt(req.query.port as string, 10) : undefined;
  const targetValidation = validateLanControllerTarget(overrideHost, overridePort);

  if ('errorCode' in targetValidation) {
    // Read-only /status fallback to pushed physical telemetry if recently uploaded
    if (
      req.method === 'GET' &&
      endpoint === '/status' &&
      !overrideHost &&
      targetValidation.errorCode === 'HARDWARE_GATEWAY_NOT_CONFIGURED' &&
      latestPushedTelemetry
    ) {
      const state = classifyControllerTelemetryState(latestPushedTelemetry.receivedAtMs);
      if (state.dataSource !== 'DISCONNECTED') {
        return res.status(200).json({
          ...latestPushedTelemetry.payload,
          connected: state.dataSource === 'REAL_HARDWARE',
          explicitState: state.explicitState,
          timestamp: latestPushedTelemetry.timestamp,
          ageSeconds: state.ageSeconds,
          isStale: state.isStale,
          dataSource: state.dataSource
        });
      }
    }
    return res.status(targetValidation.statusCode).json({
      error: targetValidation.errorCode,
      message: targetValidation.message,
      confirmedByController: false
    });
  }

  try {
    const targetUrl = new URL(`${targetValidation.baseUrl}${endpoint}`);

    // Copy safe non-secret query parameters (never inject secrets into URLs)
    Object.entries(req.query).forEach(([k, v]) => {
      if (!['endpoint', 'host', 'port', 'greenhouseId'].includes(k)) {
        targetUrl.searchParams.set(k, String(v));
      }
    });

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'EDENS-AI-Gateway/2.5'
    };

    // Never forward server's configured HARDWARE_API_KEY to a caller-overridden host (prevents key exfiltration)
    const serverHardwareKey = !targetValidation.usesCallerOverride ? getConfiguredHardwareSecret() : '';
    const callerHeaderKey = ((req.headers['x-hardware-key'] || req.headers['x-api-key']) as string | undefined)?.trim();
    const outboundKey = serverHardwareKey || callerHeaderKey || '';
    if (outboundKey) {
      headers['X-Hardware-Key'] = outboundKey;
      headers['X-API-Key'] = outboundKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body:
        req.method !== 'GET' && req.method !== 'HEAD'
          ? ((headers['Content-Type'] = 'application/json'), JSON.stringify(req.body || {}))
          : undefined,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (!isReadOnlyQuery && data && typeof data === 'object' && !Array.isArray(data)) {
        return res.status(response.status).json({
          ...data,
          confirmedByController: response.ok
        });
      }
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(redactSecretsFromText(text));
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'HARDWARE_TIMEOUT' : 'HARDWARE_UNREACHABLE',
      message: isTimeout
        ? 'ESP32 controller did not respond within 5000ms.'
        : `Failed to connect to ESP32: ${redactSecretsFromText(err?.message || 'unreachable')}`,
      confirmedByController: false
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

function formatNullableReading(val: number | null | undefined, unit: string): string {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) {
    return 'UNAVAILABLE (sensor not reported by hardware)';
  }
  return `${Number(val)}${unit}`;
}

function resolveGreenhouseAiContext(req: express.Request):
  | {
      ok: true;
      greenhouseId?: string;
      actorUserId?: string;
      cropType?: string;
      telemetrySource?: {
        dataSource: string;
        explicitState: string;
        timestamp: string | null;
        ageSeconds: number | null;
        isStale: boolean;
        readings: Record<string, any> | null;
        actuators: Record<string, boolean> | null;
        interlocks: Record<string, boolean> | null;
      };
      cameraSource?: {
        exists: boolean;
        freshness: string;
        timestamp: string | null;
        ageSeconds: number | null;
      };
    }
  | { ok: false; statusCode: number; errorCode: string; message: string } {
  const ghId = String(req.body?.greenhouseId || req.query?.greenhouseId || '').trim();
  if (!ghId) {
    if (latestPushedTelemetry) {
      const st = classifyControllerTelemetryState(latestPushedTelemetry.receivedAtMs);
      return {
        ok: true,
        telemetrySource: {
          dataSource: st.dataSource,
          explicitState: st.explicitState,
          timestamp: latestPushedTelemetry.timestamp,
          ageSeconds: st.ageSeconds,
          isStale: st.isStale,
          readings: latestPushedTelemetry.payload,
          actuators: latestPushedTelemetry.validated.actuators,
          interlocks: latestPushedTelemetry.validated.interlocks
        }
      };
    }
    return { ok: true };
  }

  const user = requireAuthenticatedUser(req);
  if (!user) {
    return {
      ok: false,
      statusCode: 401,
      errorCode: 'UNAUTHENTICATED',
      message: 'Sign in required to access greenhouse-bound AI intelligence.'
    };
  }
  const gh = platformDb.getGreenhouseForUser(ghId, user.id);
  if (!gh) {
    return {
      ok: false,
      statusCode: 403,
      errorCode: 'FORBIDDEN_GREENHOUSE',
      message: 'You do not have permission to access this greenhouse.'
    };
  }

  const latestTel = platformDb.getLatestTelemetryForGreenhouse(gh.id);
  const latestCam = cameraStoreRegistry.getStore(gh.id).getLatest();

  return {
    ok: true,
    greenhouseId: gh.id,
    actorUserId: user.id,
    cropType: gh.cropType,
    telemetrySource: {
      dataSource: latestTel.dataSource,
      explicitState: latestTel.explicitState,
      timestamp: latestTel.timestamp,
      ageSeconds: latestTel.ageSeconds,
      isStale: latestTel.isStale,
      readings: latestTel.readings,
      actuators: latestTel.actuators,
      interlocks: latestTel.interlocks
    },
    cameraSource: latestCam
      ? {
          exists: true,
          freshness: latestCam.state.freshness,
          timestamp: latestCam.frame.timestamp,
          ageSeconds: latestCam.state.ageSeconds
        }
      : { exists: false, freshness: 'NONE', timestamp: null, ageSeconds: null }
  };
}

/**
 * POST /api/ai/chat
 * Multi-turn agronomist chat reasoning in native Nigerian languages, bound to verified greenhouse telemetry.
 */
app.post('/api/ai/chat', async (req, res) => {
  const ghCtx = resolveGreenhouseAiContext(req);
  if ('errorCode' in ghCtx) {
    return res.status(ghCtx.statusCode).json({ error: ghCtx.errorCode, message: ghCtx.message });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message:
        'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
    });
  }

  const { message, languageId = 'pcm', history = [], contextData } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'EMPTY_MESSAGE', message: 'Chat message cannot be empty.' });
  }

  const langInfo = NIGERIAN_LANG_NAMES[languageId] || NIGERIAN_LANG_NAMES['pcm'];

  // Prefer server-verified greenhouse telemetry when greenhouseId is supplied; otherwise inspect caller contextData
  const effectiveCtx = ghCtx.greenhouseId && ghCtx.telemetrySource
    ? {
        dataSource: ghCtx.telemetrySource.dataSource,
        explicitState: ghCtx.telemetrySource.explicitState,
        timestamp: ghCtx.telemetrySource.timestamp,
        ageSeconds: ghCtx.telemetrySource.ageSeconds,
        isStale: ghCtx.telemetrySource.isStale,
        cropType: ghCtx.cropType || contextData?.cropType || 'Greenhouse Crops',
        temperature: ghCtx.telemetrySource.readings?.temperature ?? null,
        humidity: ghCtx.telemetrySource.readings?.humidity ?? null,
        soilMoisture: ghCtx.telemetrySource.readings?.soilMoisture ?? null,
        waterLevel: ghCtx.telemetrySource.readings?.waterLevel ?? null,
        actuators: ghCtx.telemetrySource.actuators,
        interlocks: ghCtx.telemetrySource.interlocks
      }
    : contextData || (ghCtx.telemetrySource
        ? {
            dataSource: ghCtx.telemetrySource.dataSource,
            explicitState: ghCtx.telemetrySource.explicitState,
            timestamp: ghCtx.telemetrySource.timestamp,
            ageSeconds: ghCtx.telemetrySource.ageSeconds,
            isStale: ghCtx.telemetrySource.isStale,
            cropType: 'Greenhouse Crops',
            temperature: ghCtx.telemetrySource.readings?.temperature ?? null,
            humidity: ghCtx.telemetrySource.readings?.humidity ?? null,
            soilMoisture: ghCtx.telemetrySource.readings?.soilMoisture ?? null,
            waterLevel: ghCtx.telemetrySource.readings?.waterLevel ?? null,
            actuators: ghCtx.telemetrySource.actuators,
            interlocks: ghCtx.telemetrySource.interlocks
          }
        : null);

  const sourceState = String(effectiveCtx?.dataSource || 'DISCONNECTED').toUpperCase();
  const telemetryTimestamp = effectiveCtx?.timestamp || effectiveCtx?.lastSeen || null;

  const telemetryContextBlock = (() => {
    if (!effectiveCtx || sourceState === 'DISCONNECTED') {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Connection State: DISCONNECTED / OFFLINE (No live signal from physical Main ESP32 controller)
- Monitored Crop: ${effectiveCtx?.cropType || 'Greenhouse Crops'}
- IMPORTANT: Do NOT claim live physical sensor readings exist right now. State honestly that the physical ESP32 controller is currently disconnected while still giving helpful agricultural advice.`;
    }
    if (sourceState === 'SIMULATED') {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Data Source: SIMULATED (Synthetic simulation values for testing — NOT live physical sensor hardware)
- Monitored Crop: ${effectiveCtx.cropType || 'Greenhouse Crops'}
- Simulated Temperature: ${formatNullableReading(effectiveCtx.temperature, '°C')}
- Simulated Relative Humidity: ${formatNullableReading(effectiveCtx.humidity, '%')}
- Simulated Soil Moisture: ${formatNullableReading(effectiveCtx.soilMoisture, '%')}
- Simulated Water Level: ${formatNullableReading(effectiveCtx.waterLevel, '%')}
- IMPORTANT: Never label these simulated readings as live physical greenhouse sensor data.`;
    }
    if (sourceState === 'CACHED' || sourceState === 'STALE' || effectiveCtx.isStale) {
      return `GREENHOUSE TELEMETRY CONTEXT:
- Data Source: ${sourceState} (Historical/expired controller reading — NOT live real-time data; recorded at: ${telemetryTimestamp || 'earlier'})
- Monitored Crop: ${effectiveCtx.cropType || 'Greenhouse Crops'}
- Last Recorded Temperature: ${formatNullableReading(effectiveCtx.temperature, '°C')}
- Last Recorded Relative Humidity: ${formatNullableReading(effectiveCtx.humidity, '%')}
- Last Recorded Soil Moisture: ${formatNullableReading(effectiveCtx.soilMoisture, '%')}
- Last Recorded Water Level: ${formatNullableReading(effectiveCtx.waterLevel, '%')}
- IMPORTANT: Clearly note that these readings are ${sourceState.toLowerCase()} rather than live real-time measurements, and never claim unavailable sensors have numeric values.`;
    }
    return `LIVE GREENHOUSE TELEMETRY CONTEXT:
- Data Source: REAL_HARDWARE (Verified fresh reading from physical Main ESP32 controller at ${telemetryTimestamp || 'just now'})
- Monitored Crop: ${effectiveCtx.cropType || 'Greenhouse Crops'}
- Temperature: ${formatNullableReading(effectiveCtx.temperature, '°C')}
- Relative Humidity: ${formatNullableReading(effectiveCtx.humidity, '%')}
- Soil Moisture: ${formatNullableReading(effectiveCtx.soilMoisture, '%')}
- Reservoir Water Level: ${formatNullableReading(effectiveCtx.waterLevel, '%')}
${effectiveCtx.actuators ? `- Reported Actuator State: ${JSON.stringify(effectiveCtx.actuators)}` : ''}
${effectiveCtx.interlocks ? `- Hardware Safety Interlocks: ${JSON.stringify(effectiveCtx.interlocks)}` : ''}
${ghCtx.cameraSource?.exists ? `- Latest ESP32-CAM Snapshot: ${ghCtx.cameraSource.freshness} (${ghCtx.cameraSource.ageSeconds}s old at ${ghCtx.cameraSource.timestamp})` : ''}`;
  })();

  const systemInstruction = `You are EDENS AI, the dedicated agricultural intelligence engine and expert agronomist for the EDENS smart greenhouse system, powered by RA.
You have fluent mastery of Nigerian languages: Hausa, Igbo, Yoruba, Nigerian Pidgin, Fulfulde, Tiv, Efik, and English.

COMMUNICATION REQUIREMENTS:
The farmer wants to communicate with you in: ${langInfo.name} (${langInfo.native}) [Region: ${langInfo.region}].
- ALWAYS reply directly, warmly, and thoroughly in ${langInfo.name}.
- Provide practical advice with local Nigerian agricultural realities: organic pest remedies (Dongoyaro/Neem extract, wood ash, garlic spray), soil care, watering schedules, greenhouse ventilation, solar power, and harvest readiness.

HARDWARE, SENSOR & ACTUATION HONESTY RULES:
- Current telemetry source state is: ${sourceState}${telemetryTimestamp ? ` (timestamp: ${telemetryTimestamp})` : ''}.
- NEVER label SIMULATED, CACHED, STALE, or DISCONNECTED readings as live physical sensor data.
- Distinguish strictly between a sensor reading of 0 (a real zero measurement) and UNAVAILABLE (sensor disconnected or not reported). Never invent values for unavailable sensors.
- ADVISORY ONLY: You operate in advisory mode and NEVER directly toggle physical relays without verified ESP32 controller confirmation. Never claim you turned on a pump, fan, heater, or roof vent yourself.

CONVERSATION & CONTINUATION HANDLING:
- If the farmer's prompt is a brief continuation request ("go on", "continue", "tell me more"), continue the previous agricultural topic directly without restarting with a greeting.

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

  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  const slicedHistory = validHistory.slice(-6);
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

    if (ghCtx.greenhouseId) {
      platformDb.recordAiObservation({
        greenhouseId: ghCtx.greenhouseId,
        actorUserId: ghCtx.actorUserId,
        category: 'agronomy_chat',
        dataSource: sourceState,
        summary: replyText.slice(0, 240),
        payload: { languageId, telemetryTimestamp, modelUsed }
      });
    }

    return res.json({
      success: true,
      reply: replyText,
      languageId,
      languageName: langInfo.name,
      modelUsed,
      dataSource: sourceState,
      telemetryTimestamp,
      advisoryOnly: true,
      actuationExecuted: false
    });
  } catch (err: any) {
    console.error('Gemini chat error on server:', redactSecretsFromText(err.message));
    return res.status(502).json({
      error: 'AI_REASONING_FAILED',
      message: `EDENS AI consultation failed: ${redactSecretsFromText(err.message)}`
    });
  }
});

/**
 * POST /api/ai/diagnose
 * Dedicated AI Vision Analysis Layer decoupled from camera acquisition & storage.
 * Enforces genuine raster image bytes, refuses simulated or stale camera snapshots,
 * and persists historical observations per greenhouse.
 */
app.post(
  '/api/ai/diagnose',
  createVisionDiagnosisHandler({
    imageStore: cameraImageStore,
    languages: NIGERIAN_LANG_NAMES,
    isAiConfigured: () => Boolean(getGeminiClient()),
    resolveRequestStore: (req) => {
      const ghId = String(req.body?.greenhouseId || req.query?.greenhouseId || '').trim();
      if (!ghId) {
        return { ok: true, store: cameraImageStore };
      }
      const user = requireAuthenticatedUser(req);
      if (!user) {
        return {
          ok: false,
          statusCode: 401,
          errorCode: 'UNAUTHENTICATED',
          message: 'Sign in required to diagnose a greenhouse camera snapshot.'
        };
      }
      const gh = platformDb.getGreenhouseForUser(ghId, user.id);
      if (!gh) {
        return {
          ok: false,
          statusCode: 403,
          errorCode: 'FORBIDDEN_GREENHOUSE',
          message: 'You do not have permission to diagnose this greenhouse camera.'
        };
      }
      return {
        ok: true,
        store: cameraStoreRegistry.getStore(gh.id),
        greenhouseId: gh.id,
        actorUserId: user.id
      };
    },
    onDiagnosisComplete: ({ greenhouseId, actorUserId, imageSource, frameId, frameTimestamp, result }) => {
      if (greenhouseId) {
        platformDb.recordAiObservation({
          greenhouseId,
          actorUserId,
          category: 'vision_diagnosis',
          dataSource: imageSource,
          summary: `${result.species || 'Crop'}: ${result.healthStatus || 'Analyzed'}`,
          payload: { ...result, frameId, frameTimestamp }
        });
      }
    },
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
 * Supports real greenhouse telemetry binding and stale-telemetry rejection.
 */
app.post('/api/ai/predict-harvest', async (req, res) => {
  const ghCtx = resolveGreenhouseAiContext(req);
  if ('errorCode' in ghCtx) {
    return res.status(ghCtx.statusCode).json({ error: ghCtx.errorCode, message: ghCtx.message });
  }

  if (ghCtx.greenhouseId && req.body?.requireFresh !== false) {
    if (!ghCtx.telemetrySource || ghCtx.telemetrySource.dataSource !== 'REAL_HARDWARE') {
      return res.status(409).json({
        error: 'STALE_TELEMETRY',
        dataSource: ghCtx.telemetrySource?.dataSource || 'DISCONNECTED',
        timestamp: ghCtx.telemetrySource?.timestamp || null,
        message:
          'Fresh verified ESP32 telemetry is required for live harvest prediction. Wait for an ONLINE controller check-in.'
      });
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server.'
    });
  }

  const liveReadings = ghCtx.greenhouseId ? ghCtx.telemetrySource?.readings : null;
  const resolvedSource = ghCtx.greenhouseId
    ? ghCtx.telemetrySource?.dataSource || 'DISCONNECTED'
    : String(req.body?.dataSource || 'SIMULATED').toUpperCase();

  const cropType = String(req.body?.cropType || ghCtx.cropType || 'Tomato');
  const plantingDate = String(req.body?.plantingDate || new Date().toISOString().split('T')[0]);
  const standardDays = Number(req.body?.standardDays ?? 70);
  const avgTemp = liveReadings ? liveReadings.temperature : (req.body?.avgTemp ?? 24.5);
  const avgHumidity = liveReadings ? liveReadings.humidity : (req.body?.avgHumidity ?? 62);
  const lightHours = Number(req.body?.lightHours ?? 14);
  const soilMoisture = liveReadings ? liveReadings.soilMoisture : (req.body?.soilMoisture ?? 50);

  const prompt = `You are an expert agronomist and greenhouse scientist in EDENS AI (powered by RA). Based on the following growing conditions (Data Source: ${resolvedSource}), calculate the estimated harvest date for ${cropType} planted on ${plantingDate}.
Standard growing period: ${standardDays} days.
Current conditions: Average temp: ${formatNullableReading(avgTemp, '°C')}, Humidity: ${formatNullableReading(avgHumidity, '%')}, Light hours/day: ${lightHours}h, Soil moisture: ${formatNullableReading(soilMoisture, '%')}.
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

    const parsed = JSON.parse(response.text.trim());
    if (ghCtx.greenhouseId) {
      platformDb.recordAiObservation({
        greenhouseId: ghCtx.greenhouseId,
        actorUserId: ghCtx.actorUserId,
        category: 'harvest_prediction',
        dataSource: resolvedSource,
        summary: `${cropType}: est. harvest ${parsed.estimatedHarvestDate} (${parsed.daysRemaining}d remaining)`,
        payload: parsed
      });
    }

    return res.json({
      success: true,
      result: parsed,
      dataSource: resolvedSource,
      telemetryTimestamp: ghCtx.telemetrySource?.timestamp || null,
      modelUsed
    });
  } catch (err: any) {
    console.error('Harvest prediction error on server:', redactSecretsFromText(err.message));
    return res.status(502).json({
      error: 'HARVEST_PREDICTION_FAILED',
      message: `Harvest prediction failed: ${redactSecretsFromText(err.message)}`
    });
  }
});

/**
 * POST /api/ai/agent-decision
 * Server-side structured advisory evaluation for ClimateAgent and IrrigationAgent.
 * Enforces telemetry freshness, distinguishes 0 from unavailable (null), clamps safety interlocks,
 * and returns advisoryOnly=true (never executing unconfirmed physical actuation).
 */
app.post('/api/ai/agent-decision', async (req, res) => {
  const ghCtx = resolveGreenhouseAiContext(req);
  if ('errorCode' in ghCtx) {
    return res.status(ghCtx.statusCode).json({ error: ghCtx.errorCode, message: ghCtx.message });
  }

  const { agentType, telemetry, requireFresh = true } = req.body || {};
  if (agentType !== 'climate' && agentType !== 'irrigation') {
    return res.status(400).json({
      error: 'INVALID_AGENT_TYPE',
      message: 'agentType must be "climate" or "irrigation".'
    });
  }

  const resolvedTelemetry =
    ghCtx.greenhouseId && ghCtx.telemetrySource
      ? {
          ...ghCtx.telemetrySource.readings,
          activeCrop: ghCtx.cropType || telemetry?.activeCrop || 'Tomato',
          dataSource: ghCtx.telemetrySource.dataSource,
          timestamp: ghCtx.telemetrySource.timestamp,
          ageSeconds: ghCtx.telemetrySource.ageSeconds,
          thermalLocked: ghCtx.telemetrySource.interlocks?.thermalLocked,
          waterLowLocked: ghCtx.telemetrySource.interlocks?.waterLowLocked
        }
      : telemetry || {};

  const dataSource = String(resolvedTelemetry?.dataSource || 'SIMULATED').toUpperCase();
  const telemetryTimestamp = resolvedTelemetry?.timestamp || null;

  if (requireFresh !== false && (dataSource === 'STALE' || dataSource === 'DISCONNECTED')) {
    return res.status(409).json({
      error: 'STALE_TELEMETRY',
      dataSource,
      telemetryTimestamp,
      message: `Telemetry source is ${dataSource}; refusing live ${agentType} agent decision on stale or disconnected hardware readings.`
    });
  }

  const isSimulated = dataSource === 'SIMULATED';
  const toNullable = (v: unknown): number | null =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

  if (!isSimulated) {
    if (agentType === 'climate') {
      if (toNullable(resolvedTelemetry?.temperature) === null && toNullable(resolvedTelemetry?.humidity) === null) {
        return res.status(422).json({
          error: 'SENSOR_UNAVAILABLE',
          message: 'Physical temperature and humidity readings are both unavailable (null); cannot evaluate climate recommendation.'
        });
      }
    } else if (toNullable(resolvedTelemetry?.soilMoisture) === null) {
      return res.status(422).json({
        error: 'SENSOR_UNAVAILABLE',
        message: 'Physical soilMoisture reading is unavailable (null); cannot evaluate irrigation recommendation.'
      });
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI_SERVICE_UNCONFIGURED',
      message: 'GEMINI_API_KEY is not configured on the server.'
    });
  }

  try {
    if (agentType === 'climate') {
      const temp = toNullable(resolvedTelemetry?.temperature) ?? (isSimulated ? 24 : null);
      const humidity = toNullable(resolvedTelemetry?.humidity) ?? (isSimulated ? 60 : null);
      const activeCrop = String(resolvedTelemetry?.activeCrop || 'Tomato');
      const thermalLocked = Boolean(resolvedTelemetry?.thermalLocked || (temp !== null && temp > 32));

      const prompt = `You are EDENS AI Climate Agent (Advisory Mode), recommending greenhouse ventilation and temperature settings for ${activeCrop}.
Current Telemetry (Source: ${dataSource}${telemetryTimestamp ? `, Timestamp: ${telemetryTimestamp}` : ''}):
- Temperature: ${formatNullableReading(temp, '°C')}
- Humidity: ${formatNullableReading(humidity, '%')}
- Thermal Interlock: ${thermalLocked ? 'ACTIVE (Heater locked OFF)' : 'CLEAR'}
Optimal ranges for ${activeCrop}: Temp 20-28°C, Humidity 50-75%.

Safety Rules:
1. Never recommend heater "ON" if temperature is unavailable, above 26°C, or if thermal interlock is active.
2. Recommend fan "ON" if temp > 28°C or humidity > 75%.
3. State clearly if any sensor is unavailable and explain your exact reasoning with safety margins.
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
      // Enforce deterministic server-side safety interlock clamp
      if (thermalLocked || temp === null || temp > 26) {
        parsed.heater = 'OFF';
      }

      if (ghCtx.greenhouseId) {
        platformDb.recordAiObservation({
          greenhouseId: ghCtx.greenhouseId,
          actorUserId: ghCtx.actorUserId,
          category: 'agent_advisory',
          dataSource,
          summary: `Climate Advisory: Fan=${parsed.fan}, Heater=${parsed.heater} (${parsed.reason || ''})`,
          payload: { agentType, ...parsed, telemetryTimestamp }
        });
      }

      return res.json({
        success: true,
        result: parsed,
        dataSource,
        telemetryTimestamp,
        advisoryOnly: true,
        actuationExecuted: false,
        modelUsed
      });
    }

    const soilMoisture = toNullable(resolvedTelemetry?.soilMoisture) ?? (isSimulated ? 50 : null);
    const rain =
      resolvedTelemetry?.rain === null || resolvedTelemetry?.rain === undefined
        ? null
        : Boolean(resolvedTelemetry.rain);
    const temp = toNullable(resolvedTelemetry?.temperature) ?? (isSimulated ? 24 : null);
    const waterLevel = toNullable(resolvedTelemetry?.waterLevel) ?? (isSimulated ? 70 : null);
    const activeCrop = String(resolvedTelemetry?.activeCrop || 'Tomato');
    const waterLowLocked = Boolean(
      resolvedTelemetry?.waterLowLocked || (waterLevel !== null && waterLevel < 10)
    );

    const prompt = `You are EDENS AI Irrigation Agent (Advisory Mode), recommending precision drip irrigation for ${activeCrop}.
Current Telemetry (Source: ${dataSource}${telemetryTimestamp ? `, Timestamp: ${telemetryTimestamp}` : ''}):
- Soil Moisture: ${formatNullableReading(soilMoisture, '%')}
- Ambient Temperature: ${formatNullableReading(temp, '°C')}
- Rain Detected: ${rain === null ? 'UNAVAILABLE (sensor not reported)' : String(rain)}
- Reservoir Water Level: ${formatNullableReading(waterLevel, '%')}
- Reservoir Interlock: ${waterLowLocked ? 'LOCKED (Low Water < 10%)' : waterLevel === null ? 'UNVERIFIED (Water sensor unavailable)' : 'CLEAR'}
Optimal soil moisture for ${activeCrop}: 45-65%.

Safety Rules:
1. ONLY recommend pump "ON" if soil moisture is strictly below 40% AND reservoir water level is verified > 15% (never recommend pump ON when waterLevel is UNAVAILABLE or < 10%).
2. Duration MUST NOT exceed 120 seconds to prevent over-irrigation.
3. If soil moisture is adequate or reservoir level is unverified/low, pump MUST be "OFF" and duration 0.
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
    // Deterministic server-side safety clamp: never allow pump ON if waterLevel is null or < 10, and cap duration <= 120s
    if (waterLowLocked || waterLevel === null || (soilMoisture !== null && soilMoisture >= 40)) {
      parsed.pump = 'OFF';
      parsed.duration = 0;
    } else {
      parsed.duration = Math.min(120, Math.max(0, Number(parsed.duration || 0)));
    }

    if (ghCtx.greenhouseId) {
      platformDb.recordAiObservation({
        greenhouseId: ghCtx.greenhouseId,
        actorUserId: ghCtx.actorUserId,
        category: 'agent_advisory',
        dataSource,
        summary: `Irrigation Advisory: Pump=${parsed.pump} (${parsed.duration}s) — ${parsed.reason || ''}`,
        payload: { agentType, ...parsed, telemetryTimestamp }
      });
    }

    return res.json({
      success: true,
      result: parsed,
      dataSource,
      telemetryTimestamp,
      advisoryOnly: true,
      actuationExecuted: false,
      modelUsed
    });
  } catch (err: any) {
    console.error('Agent decision error on server:', redactSecretsFromText(err.message));
    return res.status(502).json({
      error: 'AGENT_DECISION_FAILED',
      message: `Agent decision evaluation failed: ${redactSecretsFromText(err.message)}`
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

export async function startServer(listenPort: number = PORT) {
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error(`Invalid PORT configuration: "${process.env.PORT}". Expected TCP port 1-65535.`);
  }

  if (isProd) {
    if (!fs.existsSync(distIndexPath)) {
      console.warn(
        `[EDENS AI Startup Warning] Built frontend bundle not found at ${distIndexPath}. Run "npm run build" before "npm run start". API routes remain active.`
      );
    }
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (fs.existsSync(distIndexPath)) {
        return res.sendFile(distIndexPath);
      }
      return res.status(503).json({
        error: 'FRONTEND_BUNDLE_MISSING',
        message: 'Frontend build artifacts (dist/index.html) are missing. Run "npm run build" during deployment.'
      });
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  await platformDb.init();
  lastAsyncInitError = null;
  console.log('[EDENS AI Startup] SQLite PlatformDatabase initialized and verified.');

  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const srv = app.listen(listenPort, '0.0.0.0', () => {
      console.log(`🌿 EDENS AI Server & Hardware Gateway running on http://0.0.0.0:${listenPort} (${isProd ? 'production' : 'development'})`);
      console.log(`📸 ESP32-CAM Upload intake ready at POST http://0.0.0.0:${listenPort}/api/camera/upload`);
      resolve(srv);
    });
    srv.on('error', (err) => {
      console.error(`[EDENS AI Fatal] HTTP server failed to bind 0.0.0.0:${listenPort}:`, err);
      reject(err);
    });
  });

  return httpServer;
}

if (process.env.EDENS_SKIP_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('[EDENS AI Startup Fatal] Server failed to start:', err?.stack || err);
    process.exit(1);
  });
}
