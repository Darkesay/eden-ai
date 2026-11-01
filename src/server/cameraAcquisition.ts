import path from 'node:path';
import express from 'express';
import { Readable } from 'node:stream';
import { CameraImageStore } from './cameraStorage.ts';
import {
  DEVICE_STATE_THRESHOLDS,
  SlidingWindowRateLimiter,
  computeExplicitDeviceState,
  constantTimeSecretMatch,
  hasDisallowedQuerySecret,
  isPlaceholderOrEmptySecret,
  redactSecretsFromText
} from './telemetryContract.ts';

export interface CameraAuthCheckResult {
  authorized: boolean;
  status: number;
  error: string;
  message: string;
}

export type PerDeviceCameraAuthResolution =
  | {
      authorized: true;
      targetStore: CameraImageStore;
      greenhouseId: string;
      deviceId: string;
      onFrameStored?: (info: { frameId: string; timestamp: string; clientIp: string }) => void;
    }
  | {
      authorized: false;
      status: number;
      error: string;
      message: string;
    };

export class GreenhouseCameraStoreRegistry {
  private readonly stores = new Map<string, CameraImageStore>();
  private readonly rootBaseDir: string;
  private readonly maxUploadBytes?: number;
  private readonly freshMaxSeconds?: number;
  private readonly cachedMaxSeconds?: number;

  constructor(options: {
    rootBaseDir?: string;
    maxUploadBytes?: number;
    freshMaxSeconds?: number;
    cachedMaxSeconds?: number;
  } = {}) {
    this.rootBaseDir =
      options.rootBaseDir ||
      process.env.CAMERA_STORAGE_PATH ||
      process.env.UPLOADS_DIR ||
      path.join(process.cwd(), 'uploads');
    this.maxUploadBytes = options.maxUploadBytes;
    this.freshMaxSeconds = options.freshMaxSeconds;
    this.cachedMaxSeconds = options.cachedMaxSeconds;
  }

  public getStore(greenhouseId: string): CameraImageStore {
    const safeId = greenhouseId.replace(/[^a-zA-Z0-9_-]/g, '');
    let store = this.stores.get(safeId);
    if (!store) {
      store = new CameraImageStore({
        storageBaseDir: path.join(this.rootBaseDir, 'greenhouses', safeId),
        maxUploadBytes: this.maxUploadBytes,
        freshMaxSeconds: this.freshMaxSeconds,
        cachedMaxSeconds: this.cachedMaxSeconds
      });
      this.stores.set(safeId, store);
    }
    return store;
  }
}

export interface ValidatedLanCameraTarget {
  valid: boolean;
  host: string;
  httpPort: number;
  streamPort: number;
  photoPath: string;
  statusPath: string;
  streamPath: string;
  httpOrigin: string;
  streamOrigin: string;
  isPrivateLanIp: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface RegisterCameraRoutesOptions {
  allowLoopbackLanTargets?: boolean;
  getUploadSecret?: () => string;
  isCloudHosted?: () => boolean;
  maxUploadsPerMinute?: number;
  resolvePerDeviceUpload?: (req: express.Request, providedKey: string) => PerDeviceCameraAuthResolution | null;
  onUploadRejected?: (info: {
    req: express.Request;
    category: 'AUTH' | 'CONNECTION';
    errorCode: string;
    message: string;
    greenhouseId?: string;
    deviceId?: string;
  }) => void;
}

export const DEFAULT_ESP32_CAM_LAN_HOST = '';
export const DEFAULT_ESP32_CAM_HTTP_PORT = 80;
export const DEFAULT_ESP32_CAM_STREAM_PORT = 81;

/**
 * Returns ONLY the dedicated CAMERA_UPLOAD_KEY (never falls back to HARDWARE_API_KEY,
 * ensuring camera and controller authentication remain strictly independent).
 */
export function getConfiguredCameraUploadSecret(): string {
  const raw = (process.env.CAMERA_UPLOAD_KEY || '').trim();
  return isPlaceholderOrEmptySecret(raw) ? '' : raw;
}

/**
 * Authenticates camera upload requests using X-Camera-Key (or X-API-Key / Bearer header).
 * Unconditionally rejects URL query-parameter secrets even if headers are also supplied.
 */
export function verifyCameraUploadAuth(
  req: express.Request,
  getSecret: () => string = getConfiguredCameraUploadSecret
): CameraAuthCheckResult {
  const disallowedParam = hasDisallowedQuerySecret(req.query as Record<string, unknown>);
  if (disallowedParam) {
    return {
      authorized: false,
      status: 401,
      error: 'QUERY_AUTH_DISALLOWED',
      message: `Passing camera credentials in URL query parameter "${disallowedParam}" is disabled. Send the secret in the X-Camera-Key HTTP header.`
    };
  }

  const configuredKey = getSecret();
  if (isPlaceholderOrEmptySecret(configuredKey)) {
    return {
      authorized: false,
      status: 503,
      error: 'SERVER_MISCONFIGURED',
      message: 'CAMERA_UPLOAD_KEY is not configured on the server. Camera uploads are rejected.'
    };
  }

  const xCameraKey = req.headers['x-camera-key'];
  const xApiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  const rawHeader =
    (Array.isArray(xCameraKey) ? xCameraKey[0] : xCameraKey) ||
    (Array.isArray(xApiKey) ? xApiKey[0] : xApiKey) ||
    (typeof authHeader === 'string'
      ? authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader
      : '');

  const provided = (rawHeader || '').trim();
  if (!provided) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CAMERA',
      message: 'Authentication required. Provide the camera upload key via the X-Camera-Key header.'
    };
  }

  if (!constantTimeSecretMatch(provided, configuredKey)) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED_CAMERA',
      message: 'Invalid camera authentication credential in X-Camera-Key header.'
    };
  }

  return {
    authorized: true,
    status: 200,
    error: '',
    message: ''
  };
}

export function isPrivateRfc1918Ipv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = nums;
  // 10.0.0.0/8 (includes 10.87.237.36)
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function isMdnsLocalHostname(hostname: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(hostname);
}

function sanitizeCameraPath(rawPath: string | undefined, fallback: string): string {
  const trimmed = (rawPath || fallback).trim();
  if (!trimmed) return fallback;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.includes('..') || withSlash.includes('//') || /\s/.test(withSlash)) {
    return fallback;
  }
  return withSlash;
}

/**
 * Strictly validates a LAN camera target so local gateway routes only ever contact
 * private greenhouse LAN addresses (e.g., 10.87.237.36, 192.168.x.x, edens-cam.local)
 * and can never be misused for SSRF against cloud metadata or arbitrary public servers.
 */
export function validateLanCameraTarget(
  params: {
    host?: string;
    httpPort?: number | string;
    streamPort?: number | string;
    photoPath?: string;
    statusPath?: string;
    streamPath?: string;
  },
  allowLoopbackForTests: boolean = false
): ValidatedLanCameraTarget {
  const rawInput = (params.host ?? process.env.HARDWARE_CAMERA_HOST ?? '').trim();
  if (!rawInput || rawInput.includes('placeholder-ip')) {
    return {
      valid: false,
      host: '',
      httpPort: DEFAULT_ESP32_CAM_HTTP_PORT,
      streamPort: DEFAULT_ESP32_CAM_STREAM_PORT,
      photoPath: '/photo',
      statusPath: '/status',
      streamPath: '/stream',
      httpOrigin: '',
      streamOrigin: '',
      isPrivateLanIp: false,
      errorCode: 'CAMERA_HOST_NOT_CONFIGURED',
      errorMessage: 'ESP32-CAM LAN address is not configured.'
    };
  }

  let parsedUrl: URL;
  try {
    const candidateUrl =
      rawInput.startsWith('http://') || rawInput.startsWith('https://')
        ? rawInput
        : `http://${rawInput}`;
    parsedUrl = new URL(candidateUrl);
  } catch (_) {
    return {
      valid: false,
      host: '',
      httpPort: DEFAULT_ESP32_CAM_HTTP_PORT,
      streamPort: DEFAULT_ESP32_CAM_STREAM_PORT,
      photoPath: '/photo',
      statusPath: '/status',
      streamPath: '/stream',
      httpOrigin: '',
      streamOrigin: '',
      isPrivateLanIp: false,
      errorCode: 'INVALID_CAMERA_ADDRESS',
      errorMessage: `Invalid camera host "${rawInput}". Expected a private LAN IPv4 (e.g. 10.87.237.36) or .local hostname.`
    };
  }

  if (parsedUrl.protocol !== 'http:' || parsedUrl.username || parsedUrl.password) {
    return {
      valid: false,
      host: '',
      httpPort: DEFAULT_ESP32_CAM_HTTP_PORT,
      streamPort: DEFAULT_ESP32_CAM_STREAM_PORT,
      photoPath: '/photo',
      statusPath: '/status',
      streamPath: '/stream',
      httpOrigin: '',
      streamOrigin: '',
      isPrivateLanIp: false,
      errorCode: 'INVALID_CAMERA_PROTOCOL',
      errorMessage: 'LAN gateway targets must use plain HTTP on a private LAN address without embedded credentials.'
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isPrivateIp = isPrivateRfc1918Ipv4(hostname);
  const isMdns = isMdnsLocalHostname(hostname);
  const isLoopback = allowLoopbackForTests && isLoopbackHost(hostname);

  if (!isPrivateIp && !isMdns && !isLoopback) {
    return {
      valid: false,
      host: hostname,
      httpPort: DEFAULT_ESP32_CAM_HTTP_PORT,
      streamPort: DEFAULT_ESP32_CAM_STREAM_PORT,
      photoPath: '/photo',
      statusPath: '/status',
      streamPath: '/stream',
      httpOrigin: '',
      streamOrigin: '',
      isPrivateLanIp: false,
      errorCode: 'NON_PRIVATE_CAMERA_HOST_REJECTED',
      errorMessage: `Camera host "${hostname}" is not a private greenhouse LAN IPv4 (10.x, 172.16-31.x, 192.168.x) or .local mDNS device.`
    };
  }

  const parsedPortFromUrl = parsedUrl.port ? parseInt(parsedUrl.port, 10) : undefined;
  const envHttpPort = process.env.HARDWARE_CAMERA_HTTP_PORT
    ? parseInt(process.env.HARDWARE_CAMERA_HTTP_PORT, 10)
    : undefined;
  const envStreamPort = process.env.HARDWARE_CAMERA_PORT
    ? parseInt(process.env.HARDWARE_CAMERA_PORT, 10)
    : undefined;

  const httpPortNum = Number(
    params.httpPort ?? (parsedPortFromUrl && parsedPortFromUrl !== 81 ? parsedPortFromUrl : undefined) ?? envHttpPort ?? DEFAULT_ESP32_CAM_HTTP_PORT
  );
  const streamPortNum = Number(
    params.streamPort ?? (parsedPortFromUrl === 81 ? 81 : undefined) ?? envStreamPort ?? DEFAULT_ESP32_CAM_STREAM_PORT
  );

  if (
    !Number.isInteger(httpPortNum) ||
    httpPortNum < 1 ||
    httpPortNum > 65535 ||
    !Number.isInteger(streamPortNum) ||
    streamPortNum < 1 ||
    streamPortNum > 65535
  ) {
    return {
      valid: false,
      host: hostname,
      httpPort: DEFAULT_ESP32_CAM_HTTP_PORT,
      streamPort: DEFAULT_ESP32_CAM_STREAM_PORT,
      photoPath: '/photo',
      statusPath: '/status',
      streamPath: '/stream',
      httpOrigin: '',
      streamOrigin: '',
      isPrivateLanIp: isPrivateIp,
      errorCode: 'INVALID_CAMERA_PORT',
      errorMessage: 'Camera HTTP and stream ports must be valid TCP ports between 1 and 65535.'
    };
  }

  const photoPath = sanitizeCameraPath(params.photoPath, '/photo');
  const statusPath = sanitizeCameraPath(params.statusPath, '/status');
  const streamPath = sanitizeCameraPath(params.streamPath, '/stream');

  const httpOrigin = httpPortNum === 80 ? `http://${hostname}` : `http://${hostname}:${httpPortNum}`;
  const streamOrigin = streamPortNum === 80 ? `http://${hostname}` : `http://${hostname}:${streamPortNum}`;

  return {
    valid: true,
    host: hostname,
    httpPort: httpPortNum,
    streamPort: streamPortNum,
    photoPath,
    statusPath,
    streamPath,
    httpOrigin,
    streamOrigin,
    isPrivateLanIp: isPrivateIp || isMdns
  };
}

export async function pullFreshFrameFromLanCamera(
  target: ValidatedLanCameraTarget,
  imageStore: CameraImageStore,
  timeoutMs: number = 6000
): Promise<
  | { ok: true; frameId: string; timestamp: string; sizeBytes: number; url: string; latencyMs: number }
  | { ok: false; statusCode: number; errorCode: string; message: string }
> {
  const startMs = Date.now();
  const candidatePaths = target.photoPath === '/photo' ? ['/photo', '/capture'] : [target.photoPath];

  let lastErrorMsg = 'Camera unreachable';
  let lastHttpStatus = 502;

  for (const candidatePath of candidatePaths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${target.httpOrigin}${candidatePath}`, {
        method: 'GET',
        headers: { Accept: 'image/jpeg,*/*' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        lastHttpStatus = response.status >= 400 && response.status < 600 ? 502 : 502;
        lastErrorMsg = `ESP32-CAM returned HTTP ${response.status} on ${candidatePath}`;
        continue;
      }

      const rawArrayBuffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(rawArrayBuffer);
      const saved = imageStore.validateAndStoreJpeg(rawBuffer, {
        acquisitionMethod: 'LAN_GATEWAY_PULL',
        cameraAddress: `${target.host}:${target.httpPort}${candidatePath}`
      });

      if ('errorCode' in saved) {
        return {
          ok: false,
          statusCode: saved.statusCode === 413 ? 413 : 502,
          errorCode: saved.errorCode,
          message: `ESP32-CAM returned invalid image data: ${saved.message}`
        };
      }

      return {
        ok: true,
        frameId: saved.frame.id,
        timestamp: saved.frame.timestamp,
        sizeBytes: saved.frame.sizeBytes,
        url: saved.frame.url,
        latencyMs: Date.now() - startMs
      };
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError';
      lastHttpStatus = isTimeout ? 504 : 502;
      lastErrorMsg = isTimeout
        ? `ESP32-CAM at ${target.httpOrigin} timed out after ${timeoutMs}ms.`
        : `Cannot reach ESP32-CAM at ${target.httpOrigin}: ${err?.message || 'network unreachable'}`;
    }
  }

  return {
    ok: false,
    statusCode: lastHttpStatus,
    errorCode: lastHttpStatus === 504 ? 'CAMERA_LAN_TIMEOUT' : 'CAMERA_LAN_UNREACHABLE',
    message: lastErrorMsg
  };
}

export async function probeLanCameraStatus(
  target: ValidatedLanCameraTarget,
  timeoutMs: number = 3500
): Promise<{
  reachable: boolean;
  latencyMs: number;
  sensorModel?: string;
  resolution?: string;
  rssi?: number;
  uptimeSeconds?: number;
  rawStatus?: Record<string, unknown>;
  error?: string;
}> {
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${target.httpOrigin}${target.statusPath}`, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: controller.signal
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      return {
        reachable: false,
        latencyMs,
        error: `HTTP ${response.status} from ${target.httpOrigin}${target.statusPath}`
      };
    }

    const text = await response.text();
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = { statusText: text.slice(0, 120) };
    }

    return {
      reachable: true,
      latencyMs,
      sensorModel: String(parsed.model || parsed.sensor || 'OV2640 (ESP32-CAM)'),
      resolution: String(parsed.resolution || parsed.framesize || 'SVGA'),
      rssi: typeof parsed.rssi === 'number' ? parsed.rssi : undefined,
      uptimeSeconds: typeof parsed.uptime === 'number' ? parsed.uptime : undefined,
      rawStatus: parsed
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      reachable: false,
      latencyMs: Date.now() - startMs,
      error: err?.name === 'AbortError' ? 'Timed out probing LAN camera /status' : err?.message || 'LAN unreachable'
    };
  }
}

/**
 * Registers all ESP32-CAM acquisition and retrieval routes onto the Express app,
 * keeping acquisition decoupled from storage (CameraImageStore) and AI vision analysis.
 */
export function registerCameraRoutes(
  app: express.Express,
  imageStore: CameraImageStore,
  options: RegisterCameraRoutesOptions = {}
): { stopBackgroundSync: () => void } {
  const allowLoopback = Boolean(options.allowLoopbackLanTargets);
  const getSecret = options.getUploadSecret || getConfiguredCameraUploadSecret;
  const isCloud =
    options.isCloudHosted ||
    (() => Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.FLY_APP_NAME));

  const maxUploadMb = Math.max(1, Math.ceil(imageStore.getMaxUploadMb()));
  const uploadLimiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxRequests: options.maxUploadsPerMinute ?? 90
  });

  // Raw binary body parser exclusively for POST /api/camera/upload
  const rawUploadMiddleware = express.raw({
    type: () => true,
    limit: `${maxUploadMb}mb`
  });

  app.post(
    '/api/camera/upload',
    (req, res, next) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const rate = uploadLimiter.check(`cam:${clientIp}`);
      if (!rate.allowed) {
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Camera upload rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.`
        });
      }

      const claimedGhId = (req.headers['x-greenhouse-id'] as string | undefined)?.trim();
      const claimedDevId = (req.headers['x-device-id'] as string | undefined)?.trim();

      const disallowedParam = hasDisallowedQuerySecret(req.query as Record<string, unknown>);
      if (disallowedParam) {
        options.onUploadRejected?.({
          req,
          category: 'AUTH',
          errorCode: 'QUERY_AUTH_DISALLOWED',
          message: `Rejected camera upload containing query parameter "${disallowedParam}".`,
          greenhouseId: claimedGhId,
          deviceId: claimedDevId
        });
        return res.status(401).json({
          error: 'QUERY_AUTH_DISALLOWED',
          message:
            'Passing camera credentials in URL query parameters is disabled. Send the secret in the X-Camera-Key HTTP header.',
          requiredHeader: 'X-Camera-Key'
        });
      }

      const xCameraKey = req.headers['x-camera-key'];
      const xApiKey = req.headers['x-api-key'];
      const authHeader = req.headers['authorization'];
      const rawHeader =
        (Array.isArray(xCameraKey) ? xCameraKey[0] : xCameraKey) ||
        (Array.isArray(xApiKey) ? xApiKey[0] : xApiKey) ||
        (typeof authHeader === 'string'
          ? authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : authHeader
          : '');
      const providedKey = (rawHeader || '').trim();

      if (options.resolvePerDeviceUpload) {
        const perDevice = options.resolvePerDeviceUpload(req, providedKey);
        if (perDevice) {
          if ('error' in perDevice) {
            options.onUploadRejected?.({
              req,
              category: 'AUTH',
              errorCode: perDevice.error,
              message: perDevice.message,
              greenhouseId: claimedGhId,
              deviceId: claimedDevId
            });
            return res.status(perDevice.status).json({
              error: perDevice.error,
              message: perDevice.message,
              requiredHeader: 'X-Camera-Key'
            });
          }
          (req as any).__perDeviceCameraUpload = perDevice;
          return rawUploadMiddleware(req, res, (err: any) => {
            if (err) {
              if (err.type === 'entity.too.large' || err.status === 413) {
                options.onUploadRejected?.({
                  req,
                  category: 'CONNECTION',
                  errorCode: 'PAYLOAD_TOO_LARGE',
                  message: `Uploaded camera image exceeds maximum size limit of ${maxUploadMb} MB.`,
                  greenhouseId: perDevice.greenhouseId,
                  deviceId: perDevice.deviceId
                });
                return res.status(413).json({
                  error: 'PAYLOAD_TOO_LARGE',
                  message: `Uploaded camera image exceeds maximum size limit of ${maxUploadMb} MB.`
                });
              }
              options.onUploadRejected?.({
                req,
                category: 'CONNECTION',
                errorCode: 'UPLOAD_READ_ERROR',
                message: redactSecretsFromText(err.message || 'Failed reading uploaded image stream.'),
                greenhouseId: perDevice.greenhouseId,
                deviceId: perDevice.deviceId
              });
              return res.status(400).json({
                error: 'UPLOAD_READ_ERROR',
                message: redactSecretsFromText(err.message || 'Failed reading uploaded image stream.')
              });
            }
            next();
          });
        }
      }

      // Authenticate BEFORE buffering or processing untrusted camera payloads
      const auth = verifyCameraUploadAuth(req, getSecret);
      if (!auth.authorized) {
        return res.status(auth.status).json({
          error: auth.error,
          message: auth.message,
          requiredHeader: 'X-Camera-Key'
        });
      }
      rawUploadMiddleware(req, res, (err: any) => {
        if (err) {
          if (err.type === 'entity.too.large' || err.status === 413) {
            return res.status(413).json({
              error: 'PAYLOAD_TOO_LARGE',
              message: `Uploaded camera image exceeds maximum size limit of ${maxUploadMb} MB.`
            });
          }
          return res.status(400).json({
            error: 'UPLOAD_READ_ERROR',
            message: redactSecretsFromText(err.message || 'Failed reading uploaded image stream.')
          });
        }
        next();
      });
    },
    (req, res) => {
      const perDeviceCtx = (req as any).__perDeviceCameraUpload as
        | Extract<PerDeviceCameraAuthResolution, { authorized: true }>
        | undefined;

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        if (perDeviceCtx) {
          options.onUploadRejected?.({
            req,
            category: 'CONNECTION',
            errorCode: 'INVALID_BODY',
            message: 'Request body must be a non-empty binary JPEG image buffer.',
            greenhouseId: perDeviceCtx.greenhouseId,
            deviceId: perDeviceCtx.deviceId
          });
        }
        return res.status(400).json({
          error: 'INVALID_BODY',
          message: 'Request body must be a non-empty binary JPEG image buffer.'
        });
      }

      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const cameraAddrHeader = (req.headers['x-camera-address'] as string | undefined)?.trim();
      const capturedAtHeader = (req.headers['x-captured-at'] as string | undefined)?.trim();

      const targetStore = perDeviceCtx ? perDeviceCtx.targetStore : imageStore;

      const stored = targetStore.validateAndStoreJpeg(req.body, {
        acquisitionMethod: 'ESP32_CAM_UPLOAD',
        cameraAddress: cameraAddrHeader,
        clientIp,
        capturedAt: capturedAtHeader
      });

      if ('errorCode' in stored) {
        if (perDeviceCtx) {
          options.onUploadRejected?.({
            req,
            category: 'CONNECTION',
            errorCode: stored.errorCode,
            message: stored.message,
            greenhouseId: perDeviceCtx.greenhouseId,
            deviceId: perDeviceCtx.deviceId
          });
        }
        return res.status(stored.statusCode).json({
          error: stored.errorCode,
          message: stored.message
        });
      }

      const { frame, totalStored } = stored;
      if (perDeviceCtx?.onFrameStored) {
        perDeviceCtx.onFrameStored({
          frameId: frame.id,
          timestamp: frame.timestamp,
          clientIp
        });
      }

      const publicUrl = perDeviceCtx
        ? `/api/greenhouses/${encodeURIComponent(perDeviceCtx.greenhouseId)}/camera/latest.jpg?frame=${encodeURIComponent(frame.id)}`
        : frame.url;

      console.log(
        `[Camera Upload] Frame ${frame.id} stored (${frame.sizeBytes} bytes, sha256=${frame.sha256.slice(0, 10)}) at ${frame.timestamp}`
      );

      return res.status(200).json({
        success: true,
        message: 'ESP32-CAM frame received, validated, and stored.',
        greenhouseId: perDeviceCtx?.greenhouseId,
        deviceId: perDeviceCtx?.deviceId,
        imageId: frame.id,
        timestamp: frame.timestamp,
        capturedAt: frame.capturedAt,
        sizeBytes: frame.sizeBytes,
        sha256: frame.sha256,
        mimeType: frame.mimeType,
        url: publicUrl,
        acquisitionMethod: frame.acquisitionMethod,
        totalUploadsReceived: totalStored,
        readyForVisionAnalysis: true
      });
    }
  );

  app.get('/api/camera/upload', (_req, res) => {
    res.status(405).json({
      error: 'METHOD_NOT_ALLOWED',
      message:
        'POST /api/camera/upload expects a raw image/jpeg binary body authenticated with the X-Camera-Key header.',
      expectedMethod: 'POST',
      contentType: 'image/jpeg',
      authHeader: 'X-Camera-Key: <CAMERA_UPLOAD_KEY>',
      exampleCurl:
        'curl -X POST https://edens-ai.onrender.com/api/camera/upload -H "Content-Type: image/jpeg" -H "X-Camera-Key: $CAMERA_UPLOAD_KEY" --data-binary @photo.jpg'
    });
  });

  app.get('/api/camera/latest.jpg', (_req, res) => {
    const latest = imageStore.getLatest();
    if (!latest) {
      return res.status(404).json({
        error: 'NO_FRAME_AVAILABLE',
        message: 'No camera frame has been uploaded yet. Awaiting ESP32-CAM POST to /api/camera/upload.'
      });
    }

    const { frame, state } = latest;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Frame-ID', frame.id);
    res.setHeader('X-Frame-Timestamp', frame.timestamp);
    res.setHeader('X-Frame-Age-Seconds', String(state.ageSeconds));
    res.setHeader('X-Frame-Freshness', state.freshness);
    res.setHeader('X-Frame-Fresh', String(state.isFresh));
    res.setHeader('X-Data-Source', state.dataSource);
    return res.send(frame.buffer);
  });

  app.get('/api/camera/latest', (_req, res) => {
    const latest = imageStore.getLatest();
    const hasConfiguredSecret = !isPlaceholderOrEmptySecret(getSecret());
    if (!latest) {
      return res.status(200).json({
        exists: false,
        connectionState: 'DISCONNECTED',
        explicitState: hasConfiguredSecret ? 'WAITING_FOR_FIRST_CONNECTION' : 'CONFIGURATION_REQUIRED',
        status: 'WAITING_FOR_UPLOAD',
        freshness: 'NONE',
        freshnessState: 'NONE',
        isFresh: false,
        isStale: true,
        isLiveStream: false,
        message: 'No camera photograph received yet. Awaiting ESP32-CAM upload at POST /api/camera/upload.',
        uploadEndpoint: '/api/camera/upload',
        dataSource: 'DISCONNECTED',
        totalUploadsCount: imageStore.getTotalFramesStored(),
        freshMaxSeconds: imageStore.getFreshMaxSeconds(),
        thresholds: DEVICE_STATE_THRESHOLDS.esp32_cam
      });
    }

    const { frame, state } = latest;
    const explicit = computeExplicitDeviceState({
      deviceType: 'esp32_cam',
      hasCredentialIssued: true,
      lastDataTimestamp: frame.timestamp
    });
    // Never expose internal camera LAN IPs/URLs or client IPs in public browser responses
    return res.status(200).json({
      exists: true,
      connectionState: state.isFresh ? 'CONNECTED' : 'DISCONNECTED',
      explicitState: explicit.explicitState,
      status: state.status,
      freshness: state.freshness,
      freshnessState: state.isFresh ? 'FRESH' : 'STALE',
      isFresh: state.isFresh,
      isStale: state.isStale,
      isLiveStream: false,
      id: frame.id,
      timestamp: frame.timestamp,
      capturedAt: frame.capturedAt,
      ageSeconds: state.ageSeconds,
      sizeBytes: frame.sizeBytes,
      sha256: frame.sha256,
      mimeType: frame.mimeType,
      url: frame.url,
      base64: frame.base64DataUri,
      acquisitionMethod: frame.acquisitionMethod,
      analyzed: frame.analyzed,
      analysis: frame.analysis,
      dataSource: state.dataSource,
      totalUploadsCount: imageStore.getTotalFramesStored(),
      freshMaxSeconds: imageStore.getFreshMaxSeconds(),
      thresholds: DEVICE_STATE_THRESHOLDS.esp32_cam
    });
  });

  app.get('/api/camera/upload-info', (_req, res) => {
    const hasKey = !isPlaceholderOrEmptySecret(getSecret());
    const latest = imageStore.getLatest();
    const lanConfigured = Boolean((process.env.HARDWARE_CAMERA_HOST || '').trim());

    res.json({
      endpoint: '/api/camera/upload',
      method: 'POST',
      supportedContentTypes: ['image/jpeg', 'application/octet-stream', 'multipart/form-data'],
      authHeader: 'X-Camera-Key',
      maxSizeMb: imageStore.getMaxUploadMb(),
      freshMaxSeconds: imageStore.getFreshMaxSeconds(),
      authConfigured: hasKey,
      cloudHosted: isCloud(),
      lanGatewayConfigured: lanConfigured && !isCloud(),
      latestUploadTimestamp: latest?.frame.timestamp || null,
      latestImageId: latest?.frame.id || null,
      latestSizeBytes: latest?.frame.sizeBytes || 0,
      latestFreshness: latest?.state.freshness || 'NONE',
      latestIsFresh: latest?.state.isFresh || false,
      latestAgeSeconds: latest?.state.ageSeconds ?? null,
      latestDataSource: latest ? latest.state.dataSource : 'DISCONNECTED',
      totalUploadsReceived: imageStore.getTotalFramesStored(),
      hasUploadedImage: Boolean(latest)
    });
  });

  /**
   * POST /api/camera/lan/sync
   * Local Greenhouse Gateway route: pulls a fresh JPEG from the configurable LAN ESP32-CAM
   * (e.g. http://10.87.237.36/photo) and stores it in CameraImageStore.
   * Honestly reports PRIVATE_LAN_UNREACHABLE_FROM_CLOUD when hosted on Render cloud.
   */
  app.post('/api/camera/lan/sync', async (req, res) => {
    const target = validateLanCameraTarget(
      {
        host: req.body?.host,
        httpPort: req.body?.httpPort,
        streamPort: req.body?.streamPort,
        photoPath: req.body?.photoPath
      },
      allowLoopback
    );

    if (!target.valid) {
      return res.status(400).json({
        success: false,
        error: target.errorCode || 'INVALID_CAMERA_TARGET',
        message: target.errorMessage || 'Invalid LAN camera address.'
      });
    }

    if (isCloud() && target.isPrivateLanIp) {
      return res.status(503).json({
        success: false,
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message: 'Cloud server cannot directly reach a private greenhouse LAN address. Configure direct ESP32-CAM HTTPS upload to POST /api/camera/upload.'
      });
    }

    const pulled = await pullFreshFrameFromLanCamera(target, imageStore);
    if ('errorCode' in pulled) {
      return res.status(pulled.statusCode).json({
        success: false,
        error: pulled.errorCode,
        message: pulled.message
      });
    }

    return res.status(200).json({
      success: true,
      message: `Captured fresh JPEG from ESP32-CAM at ${target.httpOrigin}${target.photoPath}`,
      imageId: pulled.frameId,
      timestamp: pulled.timestamp,
      sizeBytes: pulled.sizeBytes,
      url: pulled.url,
      latencyMs: pulled.latencyMs,
      acquisitionMethod: 'LAN_GATEWAY_PULL'
    });
  });

  /**
   * GET /api/camera/lan/status
   * Probes LAN ESP32-CAM /status when running locally, or reports cloud-vs-LAN reachability clearly.
   */
  app.get('/api/camera/lan/status', async (req, res) => {
    const target = validateLanCameraTarget(
      {
        host: (req.query.host as string) || undefined,
        httpPort: (req.query.httpPort as string) || undefined,
        streamPort: (req.query.streamPort as string) || undefined,
        statusPath: (req.query.statusPath as string) || undefined,
        streamPath: (req.query.streamPath as string) || undefined
      },
      allowLoopback
    );

    const latest = imageStore.getLatest();

    if (!target.valid) {
      return res.json({
        lanReachable: false,
        cloudHosted: isCloud(),
        reason: target.errorCode,
        message: target.errorMessage,
        latestStoredFrame: latest
          ? {
              id: latest.frame.id,
              timestamp: latest.frame.timestamp,
              ageSeconds: latest.state.ageSeconds,
              freshness: latest.state.freshness,
              isFresh: latest.state.isFresh,
              dataSource: latest.state.dataSource
            }
          : null
      });
    }

    if (isCloud() && target.isPrivateLanIp) {
      return res.json({
        lanReachable: false,
        cloudHosted: true,
        reason: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message: 'Private LAN camera addresses cannot be polled directly from cloud hosting. Waiting for authenticated HTTPS uploads at POST /api/camera/upload.',
        latestStoredFrame: latest
          ? {
              id: latest.frame.id,
              timestamp: latest.frame.timestamp,
              ageSeconds: latest.state.ageSeconds,
              freshness: latest.state.freshness,
              isFresh: latest.state.isFresh,
              dataSource: latest.state.dataSource
            }
          : null
      });
    }

    const probe = await probeLanCameraStatus(target);
    return res.json({
      lanReachable: probe.reachable,
      cloudHosted: isCloud(),
      latencyMs: probe.latencyMs,
      sensorModel: probe.sensorModel,
      resolution: probe.resolution,
      rssi: probe.rssi,
      uptimeSeconds: probe.uptimeSeconds,
      proxyStreamUrl: probe.reachable
        ? `/api/camera/lan/stream?host=${encodeURIComponent(target.host)}&streamPort=${target.streamPort}&streamPath=${encodeURIComponent(target.streamPath)}`
        : null,
      error: probe.error,
      latestStoredFrame: latest
        ? {
            id: latest.frame.id,
            timestamp: latest.frame.timestamp,
            ageSeconds: latest.state.ageSeconds,
            freshness: latest.state.freshness,
            isFresh: latest.state.isFresh,
            dataSource: latest.state.dataSource
          }
        : null
    });
  });

  /**
   * GET /api/camera/lan/stream
   * Proxies MJPEG live stream (http://<host>:81/stream) when running as a local greenhouse gateway
   * so browsers avoid CORS/mixed-origin issues on the LAN.
   */
  app.get('/api/camera/lan/stream', async (req, res) => {
    const target = validateLanCameraTarget(
      {
        host: (req.query.host as string) || undefined,
        streamPort: (req.query.streamPort as string) || undefined,
        streamPath: (req.query.streamPath as string) || undefined
      },
      allowLoopback
    );

    if (!target.valid) {
      return res.status(400).json({ error: target.errorCode, message: target.errorMessage });
    }

    if (isCloud() && target.isPrivateLanIp) {
      return res.status(503).json({
        error: 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD',
        message: 'Live MJPEG LAN stream cannot be proxied directly from cloud hosting.'
      });
    }

    const upstreamAbort = new AbortController();
    req.on('close', () => upstreamAbort.abort());

    const connectTimer = setTimeout(() => upstreamAbort.abort(), 5000);
    try {
      const upstream = await fetch(`${target.streamOrigin}${target.streamPath}`, {
        signal: upstreamAbort.signal
      });
      clearTimeout(connectTimer);

      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({
          error: 'STREAM_UNAVAILABLE',
          message: `ESP32-CAM stream returned HTTP ${upstream.status}`
        });
      }

      const contentType =
        upstream.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Connection', 'close');

      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      clearTimeout(connectTimer);
      if (!res.headersSent) {
        return res.status(502).json({
          error: 'STREAM_UNREACHABLE',
          message: `Cannot connect to ESP32-CAM stream at ${target.streamOrigin}${target.streamPath}: ${err?.message || 'unreachable'}`
        });
      }
    }
  });

  // Backward-compatible /api/camera/capture route used by HardwareConfig diagnostics
  app.get('/api/camera/capture', async (req, res) => {
    const latest = imageStore.getLatest();
    if (latest && latest.state.isFresh) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Data-Source', latest.state.dataSource);
      res.setHeader('X-Frame-Age-Seconds', String(latest.state.ageSeconds));
      return res.send(latest.frame.buffer);
    }

    const target = validateLanCameraTarget(
      {
        host: (req.query.host as string) || undefined,
        httpPort: (req.query.port as string) || undefined,
        photoPath: (req.query.path as string) || '/photo'
      },
      allowLoopback
    );

    if (target.valid && !(isCloud() && target.isPrivateLanIp)) {
      const pulled = await pullFreshFrameFromLanCamera(target, imageStore);
      if (pulled.ok) {
        const refreshed = imageStore.getLatest();
        if (refreshed) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('X-Data-Source', 'REAL_HARDWARE');
          res.setHeader('X-Frame-Age-Seconds', '0');
          return res.send(refreshed.frame.buffer);
        }
      }
    }

    if (latest) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Data-Source', latest.state.dataSource);
      res.setHeader('X-Frame-Age-Seconds', String(latest.state.ageSeconds));
      return res.send(latest.frame.buffer);
    }

    return res.status(503).json({
      error: 'CAMERA_NOT_CONFIGURED',
      message: 'No fresh ESP32-CAM frame is available. Upload via POST /api/camera/upload or run on greenhouse LAN.'
    });
  });

  // Backward-compatible /api/camera/status route
  app.get('/api/camera/status', async (req, res) => {
    const latest = imageStore.getLatest();
    if (latest) {
      return res.json({
        connected: latest.state.isFresh,
        mode: latest.frame.acquisitionMethod === 'LAN_GATEWAY_PULL' ? 'LAN_GATEWAY_PULL' : 'PUSH_UPLOAD',
        sensorModel: 'ESP32-CAM',
        status: latest.state.status,
        freshness: latest.state.freshness,
        isFresh: latest.state.isFresh,
        isStale: latest.state.isStale,
        isLiveStream: false,
        dataSource: latest.state.dataSource,
        lastUploadTimestamp: latest.frame.timestamp,
        ageSeconds: latest.state.ageSeconds,
        sizeBytes: latest.frame.sizeBytes,
        totalUploadsReceived: imageStore.getTotalFramesStored()
      });
    }

    const target = validateLanCameraTarget(
      {
        host: (req.query.host as string) || undefined,
        httpPort: (req.query.port as string) || undefined
      },
      allowLoopback
    );

    if (!target.valid || (isCloud() && target.isPrivateLanIp)) {
      return res.json({
        connected: false,
        mode: 'PUSH_UPLOAD',
        sensorModel: 'ESP32-CAM',
        status: 'WAITING_FOR_UPLOAD',
        dataSource: 'DISCONNECTED',
        isLiveStream: false
      });
    }

    const probe = await probeLanCameraStatus(target);
    if (!probe.reachable) {
      return res.json({
        connected: false,
        mode: 'PULL_DIRECT',
        sensorModel: 'ESP32-CAM',
        status: 'OFFLINE',
        dataSource: 'DISCONNECTED',
        isLiveStream: false,
        error: probe.error
      });
    }

    return res.json({
      connected: true,
      mode: 'PULL_DIRECT',
      sensorModel: probe.sensorModel || 'ESP32-CAM',
      resolution: probe.resolution || 'SVGA',
      wifiRssi: probe.rssi,
      uptimeSeconds: probe.uptimeSeconds,
      status: 'ONLINE',
      dataSource: 'REAL_HARDWARE',
      latencyMs: probe.latencyMs
    });
  });

  app.post('/api/camera/mark-analyzed', (req, res) => {
    const frameId = String(req.body?.id || '');
    const updated = frameId ? imageStore.markAnalyzed(frameId, req.body?.analysis) : false;
    return res.json({ success: true, updated });
  });

  app.delete('/api/camera/latest', (req, res) => {
    const auth = verifyCameraUploadAuth(req, getSecret);
    if (!auth.authorized) {
      return res.status(auth.status).json({
        error: auth.error,
        message: auth.message,
        requiredHeader: 'X-Camera-Key'
      });
    }
    imageStore.clear();
    return res.json({ success: true, message: 'Latest camera frame cache cleared.' });
  });

  // Optional background auto-pull when running a local gateway with HARDWARE_CAMERA_HOST set
  let bgTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let backoffMs = 10000;

  const envCamHost = (process.env.HARDWARE_CAMERA_HOST || '').trim();
  if (envCamHost && !isCloud()) {
    const target = validateLanCameraTarget({ host: envCamHost }, allowLoopback);
    if (target.valid) {
      const baseIntervalMs = Math.max(
        5000,
        parseInt(process.env.CAMERA_AUTO_PULL_INTERVAL_MS || '15000', 10)
      );
      const tick = async () => {
        if (stopped) return;
        const result = await pullFreshFrameFromLanCamera(target, imageStore);
        backoffMs = result.ok ? baseIntervalMs : Math.min(60000, backoffMs * 2);
        if (!stopped) {
          bgTimer = setTimeout(tick, backoffMs);
        }
      };
      bgTimer = setTimeout(tick, 2500);
    }
  }

  return {
    stopBackgroundSync: () => {
      stopped = true;
      if (bgTimer) {
        clearTimeout(bgTimer);
        bgTimer = null;
      }
    }
  };
}
