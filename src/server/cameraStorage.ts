import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type CameraAcquisitionMethod = 'ESP32_CAM_UPLOAD' | 'LAN_GATEWAY_PULL';

export type CameraFrameFreshness = 'FRESH' | 'CACHED' | 'STALE';

export interface StoredCameraFrame {
  id: string;
  timestamp: string;
  capturedAt: string;
  sizeBytes: number;
  mimeType: 'image/jpeg';
  sha256: string;
  buffer: Buffer;
  base64DataUri: string;
  url: string;
  acquisitionMethod: CameraAcquisitionMethod;
  cameraAddress?: string;
  clientIp?: string;
  analyzed: boolean;
  analysis?: unknown;
}

export interface CameraFrameStateClassification {
  ageSeconds: number;
  freshness: CameraFrameFreshness;
  status: 'ONLINE' | 'CACHED' | 'STALE';
  dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE';
  isFresh: boolean;
  isStale: boolean;
  isLiveStream: false;
}

export interface JpegValidationResult {
  valid: boolean;
  buffer: Buffer;
  statusCode: number;
  errorCode?: 'EMPTY_IMAGE' | 'PAYLOAD_TOO_LARGE' | 'INVALID_IMAGE_FORMAT';
  message?: string;
}

export interface CameraImageStoreOptions {
  storageBaseDir?: string;
  maxUploadBytes?: number;
  freshMaxSeconds?: number;
  cachedMaxSeconds?: number;
  maxHistoryFiles?: number;
}

export const DEFAULT_FRESH_MAX_SECONDS = 90;
export const DEFAULT_CACHED_MAX_SECONDS = 300;
export const MIN_VALID_JPEG_BYTES = 64;

/**
 * Extracts and validates genuine JPEG bytes from either a raw image/jpeg body
 * or a multipart/form-data envelope. Verifies SOI (0xFF 0xD8), internal JPEG
 * segment marker (0xFF ...), and EOI (0xFF 0xD9) so truncated or non-JPEG payloads are rejected.
 */
export function extractAndValidateJpeg(
  bodyBuffer: Buffer | undefined | null,
  maxUploadBytes: number = 10 * 1024 * 1024
): JpegValidationResult {
  if (!bodyBuffer || !Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 400,
      errorCode: 'EMPTY_IMAGE',
      message: 'Request body is empty. Expected binary image/jpeg data.'
    };
  }

  if (bodyBuffer.length > maxUploadBytes) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 413,
      errorCode: 'PAYLOAD_TOO_LARGE',
      message: `Image size (${bodyBuffer.length} bytes) exceeds maximum allowed limit of ${maxUploadBytes} bytes.`
    };
  }

  if (bodyBuffer.length < MIN_VALID_JPEG_BYTES) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 400,
      errorCode: 'INVALID_IMAGE_FORMAT',
      message: `Payload (${bodyBuffer.length} bytes) is too small to be a complete JPEG photograph.`
    };
  }

  let candidate: Buffer | null = null;

  // Case 1: Direct raw JPEG binary starting with SOI (0xFF 0xD8)
  if (bodyBuffer[0] === 0xff && bodyBuffer[1] === 0xd8) {
    candidate = bodyBuffer;
  } else {
    // Case 2: Multipart form-data containing an embedded JPEG stream
    const headerPreview = bodyBuffer.subarray(0, Math.min(256, bodyBuffer.length)).toString('latin1');
    const looksLikeMultipart =
      headerPreview.startsWith('--') || headerPreview.toLowerCase().includes('content-disposition:');
    if (looksLikeMultipart) {
      const soiIndex = bodyBuffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const eoiIndex = bodyBuffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (soiIndex !== -1 && eoiIndex > soiIndex) {
        candidate = bodyBuffer.subarray(soiIndex, eoiIndex + 2);
      }
    }
  }

  if (!candidate || candidate.length < MIN_VALID_JPEG_BYTES) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 400,
      errorCode: 'INVALID_IMAGE_FORMAT',
      message: 'Payload does not contain valid JPEG SOI magic bytes (0xFF, 0xD8).'
    };
  }

  // Verify third byte begins a valid JPEG marker segment (0xFF)
  if (candidate[2] !== 0xff || candidate[3] === 0x00 || candidate[3] === 0xff) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 400,
      errorCode: 'INVALID_IMAGE_FORMAT',
      message: 'Payload header lacks a valid JPEG marker segment following SOI.'
    };
  }

  // Verify closing EOI marker (0xFF 0xD9) near end of stream (allowing trailing padding bytes if any)
  const eoiPos = candidate.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (eoiPos === -1 || eoiPos < 4) {
    return {
      valid: false,
      buffer: Buffer.alloc(0),
      statusCode: 400,
      errorCode: 'INVALID_IMAGE_FORMAT',
      message: 'Incomplete or truncated JPEG image: missing closing EOI marker (0xFF, 0xD9).'
    };
  }

  // Trim any trailing transport padding after EOI
  const cleanJpeg = Buffer.from(candidate.subarray(0, eoiPos + 2));

  return {
    valid: true,
    buffer: cleanJpeg,
    statusCode: 200
  };
}

/**
 * Classifies stored photograph freshness honestly.
 * Never claims a static stored photograph is a live video stream.
 */
export function classifyCameraFrameFreshness(
  timestampIso: string,
  nowMs: number = Date.now(),
  freshMaxSeconds: number = DEFAULT_FRESH_MAX_SECONDS,
  cachedMaxSeconds: number = DEFAULT_CACHED_MAX_SECONDS
): CameraFrameStateClassification {
  const parsedMs = new Date(timestampIso).getTime();
  const ageSeconds = Number.isFinite(parsedMs)
    ? Math.max(0, Math.round((nowMs - parsedMs) / 1000))
    : 999999;

  if (ageSeconds <= freshMaxSeconds) {
    return {
      ageSeconds,
      freshness: 'FRESH',
      status: 'ONLINE',
      dataSource: 'REAL_HARDWARE',
      isFresh: true,
      isStale: false,
      isLiveStream: false
    };
  }

  if (ageSeconds <= cachedMaxSeconds) {
    return {
      ageSeconds,
      freshness: 'CACHED',
      status: 'CACHED',
      dataSource: 'CACHED',
      isFresh: false,
      isStale: false,
      isLiveStream: false
    };
  }

  return {
    ageSeconds,
    freshness: 'STALE',
    status: 'STALE',
    dataSource: 'STALE',
    isFresh: false,
    isStale: true,
    isLiveStream: false
  };
}

/**
 * Dedicated Camera Image Storage Layer.
 * Keeps binary storage, disk persistence, history pruning, and freshness calculation
 * strictly decoupled from network acquisition and Gemini AI analysis.
 */
export class CameraImageStore {
  private readonly uploadDir: string;
  private readonly historyDir: string;
  private readonly maxUploadBytes: number;
  private readonly freshMaxSeconds: number;
  private readonly cachedMaxSeconds: number;
  private readonly maxHistoryFiles: number;

  private latestFrame: StoredCameraFrame | null = null;
  private totalFramesStored = 0;

  constructor(options: CameraImageStoreOptions = {}) {
    const baseDir =
      options.storageBaseDir ||
      process.env.CAMERA_STORAGE_PATH ||
      process.env.UPLOADS_DIR ||
      path.join(process.cwd(), 'uploads');

    this.uploadDir = path.join(baseDir, 'camera');
    this.historyDir = path.join(this.uploadDir, 'history');
    this.maxUploadBytes = options.maxUploadBytes ?? parseInt(process.env.CAMERA_MAX_UPLOAD_MB || '10', 10) * 1024 * 1024;
    this.freshMaxSeconds = options.freshMaxSeconds ?? parseInt(process.env.CAMERA_FRESH_MAX_SECONDS || String(DEFAULT_FRESH_MAX_SECONDS), 10);
    this.cachedMaxSeconds = options.cachedMaxSeconds ?? parseInt(process.env.CAMERA_CACHED_MAX_SECONDS || String(DEFAULT_CACHED_MAX_SECONDS), 10);
    this.maxHistoryFiles = options.maxHistoryFiles ?? 20;

    this.restoreFromDiskIfPresent();
  }

  public getMaxUploadBytes(): number {
    return this.maxUploadBytes;
  }

  public getMaxUploadMb(): number {
    return Math.round((this.maxUploadBytes / (1024 * 1024)) * 10) / 10;
  }

  public getFreshMaxSeconds(): number {
    return this.freshMaxSeconds;
  }

  public getUploadDir(): string {
    return this.uploadDir;
  }

  private restoreFromDiskIfPresent(): void {
    try {
      const metaPath = path.join(this.uploadDir, 'metadata.json');
      const latestImgPath = path.join(this.uploadDir, 'latest.jpg');
      if (!fs.existsSync(metaPath) || !fs.existsSync(latestImgPath)) {
        return;
      }

      const rawMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const rawBuf = fs.readFileSync(latestImgPath);
      const check = extractAndValidateJpeg(rawBuf, this.maxUploadBytes);
      if (!check.valid) {
        return;
      }

      const sha256 = crypto.createHash('sha256').update(check.buffer).digest('hex');
      const id = String(rawMeta.id || `cam_restored_${Date.now()}`);
      const timestamp =
        typeof rawMeta.timestamp === 'string' && !Number.isNaN(new Date(rawMeta.timestamp).getTime())
          ? new Date(rawMeta.timestamp).toISOString()
          : fs.statSync(latestImgPath).mtime.toISOString();

      this.latestFrame = {
        id,
        timestamp,
        capturedAt: rawMeta.capturedAt || timestamp,
        sizeBytes: check.buffer.length,
        mimeType: 'image/jpeg',
        sha256,
        buffer: check.buffer,
        base64DataUri: `data:image/jpeg;base64,${check.buffer.toString('base64')}`,
        url: `/api/camera/latest.jpg?frame=${encodeURIComponent(id)}`,
        acquisitionMethod: rawMeta.acquisitionMethod === 'LAN_GATEWAY_PULL' ? 'LAN_GATEWAY_PULL' : 'ESP32_CAM_UPLOAD',
        cameraAddress: rawMeta.cameraAddress,
        analyzed: Boolean(rawMeta.analyzed),
        analysis: rawMeta.analysis
      };
    } catch (_) {
      // Ignore corrupt disk state; start clean
    }
  }

  public validateAndStoreJpeg(
    rawPayload: Buffer,
    meta: {
      acquisitionMethod: CameraAcquisitionMethod;
      cameraAddress?: string;
      clientIp?: string;
      capturedAt?: string;
      overrideTimestamp?: string;
    }
  ): { ok: true; frame: StoredCameraFrame; totalStored: number } | { ok: false; statusCode: number; errorCode: string; message: string } {
    const validation = extractAndValidateJpeg(rawPayload, this.maxUploadBytes);
    if (!validation.valid) {
      return {
        ok: false,
        statusCode: validation.statusCode,
        errorCode: validation.errorCode || 'INVALID_IMAGE_FORMAT',
        message: validation.message || 'Provided payload is not a valid JPEG image.'
      };
    }

    const jpegBuffer = validation.buffer;
    const sha256 = crypto.createHash('sha256').update(jpegBuffer).digest('hex');
    const nowIso = meta.overrideTimestamp || new Date().toISOString();

    let capturedAt = nowIso;
    if (meta.capturedAt) {
      const parsedCapture = new Date(meta.capturedAt).getTime();
      if (Number.isFinite(parsedCapture) && parsedCapture <= Date.now() + 5000) {
        capturedAt = new Date(parsedCapture).toISOString();
      }
    }

    const imageId = `cam_${Date.now()}_${sha256.slice(0, 8)}`;
    const url = `/api/camera/latest.jpg?frame=${encodeURIComponent(imageId)}`;

    const previousSha = this.latestFrame?.sha256;
    const previousAnalyzed = previousSha === sha256 ? Boolean(this.latestFrame?.analyzed) : false;
    const previousAnalysis = previousSha === sha256 ? this.latestFrame?.analysis : undefined;

    this.totalFramesStored += 1;

    const stored: StoredCameraFrame = {
      id: imageId,
      timestamp: nowIso,
      capturedAt,
      sizeBytes: jpegBuffer.length,
      mimeType: 'image/jpeg',
      sha256,
      buffer: jpegBuffer,
      base64DataUri: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
      url,
      acquisitionMethod: meta.acquisitionMethod,
      cameraAddress: meta.cameraAddress,
      clientIp: meta.clientIp,
      analyzed: previousAnalyzed,
      analysis: previousAnalysis
    };

    this.latestFrame = stored;
    this.persistToDisk(stored);

    return {
      ok: true,
      frame: stored,
      totalStored: this.totalFramesStored
    };
  }

  private persistToDisk(frame: StoredCameraFrame): void {
    try {
      fs.mkdirSync(this.historyDir, { recursive: true });
      fs.writeFileSync(path.join(this.uploadDir, 'latest.jpg'), frame.buffer);
      fs.writeFileSync(path.join(this.historyDir, `${frame.id}.jpg`), frame.buffer);
      fs.writeFileSync(
        path.join(this.uploadDir, 'metadata.json'),
        JSON.stringify(
          {
            id: frame.id,
            timestamp: frame.timestamp,
            capturedAt: frame.capturedAt,
            sizeBytes: frame.sizeBytes,
            mimeType: frame.mimeType,
            sha256: frame.sha256,
            url: '/api/camera/latest.jpg',
            acquisitionMethod: frame.acquisitionMethod,
            cameraAddress: frame.cameraAddress,
            analyzed: frame.analyzed,
            analysis: frame.analysis
          },
          null,
          2
        )
      );

      const historyFiles = fs
        .readdirSync(this.historyDir)
        .filter((f) => f.endsWith('.jpg'))
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(this.historyDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (historyFiles.length > this.maxHistoryFiles) {
        for (const oldFile of historyFiles.slice(this.maxHistoryFiles)) {
          try {
            fs.unlinkSync(path.join(this.historyDir, oldFile.name));
          } catch (_) {}
        }
      }
    } catch (err: any) {
      console.error('Camera storage persistence warning (in-memory frame preserved):', err.message);
    }
  }

  public getLatest(nowMs: number = Date.now()): {
    frame: StoredCameraFrame;
    state: CameraFrameStateClassification;
  } | null {
    if (!this.latestFrame) {
      return null;
    }
    const state = classifyCameraFrameFreshness(
      this.latestFrame.timestamp,
      nowMs,
      this.freshMaxSeconds,
      this.cachedMaxSeconds
    );
    return { frame: this.latestFrame, state };
  }

  public getTotalFramesStored(): number {
    return this.totalFramesStored;
  }

  public markAnalyzed(frameId: string, analysis: unknown): boolean {
    if (!this.latestFrame || this.latestFrame.id !== frameId) {
      return false;
    }
    this.latestFrame.analyzed = true;
    this.latestFrame.analysis = analysis;
    try {
      const metaPath = path.join(this.uploadDir, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.analyzed = true;
        meta.analysis = analysis;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }
    } catch (_) {}
    return true;
  }

  /**
   * Test helper to adjust stored frame timestamp when verifying freshness aging transitions.
   */
  public setLatestTimestampForTesting(isoTimestamp: string): void {
    if (this.latestFrame) {
      this.latestFrame.timestamp = isoTimestamp;
      this.latestFrame.capturedAt = isoTimestamp;
    }
  }

  public clear(): void {
    this.latestFrame = null;
    try {
      const latestImgPath = path.join(this.uploadDir, 'latest.jpg');
      const metaPath = path.join(this.uploadDir, 'metadata.json');
      if (fs.existsSync(latestImgPath)) fs.unlinkSync(latestImgPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    } catch (_) {}
  }
}
