import express from 'express';
import { Type } from '@google/genai';
import { CameraImageStore } from './cameraStorage.ts';

export interface VisionModelInput {
  base64Data: string;
  mimeType: string;
  promptText: string;
  responseSchema: Record<string, unknown>;
}

export interface VisionModelOutput {
  rawJsonText: string;
  modelUsed: string;
}

export type VisionModelRunner = (input: VisionModelInput) => Promise<VisionModelOutput>;

export interface LanguageMetadata {
  name: string;
  native: string;
  region: string;
}

export function validateRasterImageBytes(
  buf: Buffer,
  maxBytes: number = 10 * 1024 * 1024
): { valid: boolean; detectedMime?: string; statusCode: number; errorCode?: string; error?: string } {
  if (!buf || buf.length < 32) {
    return {
      valid: false,
      statusCode: 400,
      errorCode: 'INVALID_IMAGE_BYTES',
      error: 'Decoded image payload is empty or smaller than 32 bytes.'
    };
  }
  if (buf.length > maxBytes) {
    return {
      valid: false,
      statusCode: 413,
      errorCode: 'PAYLOAD_TOO_LARGE',
      error: `Image payload (${buf.length} bytes) exceeds maximum limit of ${maxBytes} bytes.`
    };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { valid: true, detectedMime: 'image/jpeg', statusCode: 200 };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { valid: true, detectedMime: 'image/png', statusCode: 200 };
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { valid: true, detectedMime: 'image/webp', statusCode: 200 };
  }

  return {
    valid: false,
    statusCode: 400,
    errorCode: 'INVALID_IMAGE_BYTES',
    error: 'Payload does not contain valid JPEG, PNG, or WebP raster image magic bytes.'
  };
}

export const PLANT_DIAGNOSIS_RESPONSE_SCHEMA = {
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
};

export function createVisionDiagnosisHandler(deps: {
  imageStore: CameraImageStore;
  languages: Record<string, LanguageMetadata>;
  isAiConfigured: () => boolean;
  runVisionModel: VisionModelRunner;
  resolveRequestStore?: (
    req: express.Request
  ) =>
    | { ok: true; store: CameraImageStore; greenhouseId?: string; actorUserId?: string }
    | { ok: false; statusCode: number; errorCode: string; message: string };
  onDiagnosisComplete?: (info: {
    greenhouseId?: string;
    actorUserId?: string;
    imageSource: string;
    frameId?: string;
    frameTimestamp?: string;
    result: Record<string, unknown>;
  }) => void;
}): express.RequestHandler {
  const { imageStore, languages, isAiConfigured, runVisionModel, resolveRequestStore, onDiagnosisComplete } = deps;

  return async (req, res) => {
    let activeStore = imageStore;
    let resolvedGreenhouseId: string | undefined;
    let resolvedActorUserId: string | undefined;

    if (resolveRequestStore) {
      const storeCheck = resolveRequestStore(req);
      if ('errorCode' in storeCheck) {
        return res.status(storeCheck.statusCode).json({
          error: storeCheck.errorCode,
          message: storeCheck.message
        });
      }
      activeStore = storeCheck.store;
      resolvedGreenhouseId = storeCheck.greenhouseId;
      resolvedActorUserId = storeCheck.actorUserId;
    }

    const {
      image,
      useLatestCameraFrame = false,
      requireFresh = true,
      source,
      dataSource,
      languageId = 'ha'
    } = req.body || {};

    // Never allow simulated or synthetic images to be passed as physical captures
    if (
      String(source || '').toUpperCase() === 'SIMULATED' ||
      String(dataSource || '').toUpperCase() === 'SIMULATED'
    ) {
      return res.status(400).json({
        error: 'SIMULATED_IMAGE_REJECTED',
        message: 'Simulated or synthetic placeholder images cannot be submitted as physical plant captures.'
      });
    }

    let imgBuffer: Buffer;
    let mimeType = 'image/jpeg';
    let cleanBase64 = '';
    let resolvedSource: 'ESP32_CAM_FRESH' | 'ESP32_CAM_HISTORICAL' | 'MANUAL_UPLOAD' = 'MANUAL_UPLOAD';
    let cameraFrameMeta: {
      id: string;
      timestamp: string;
      ageSeconds: number;
      freshness: string;
      dataSource: string;
    } | null = null;

    if (
      useLatestCameraFrame ||
      (typeof image === 'string' &&
        (image.startsWith('/api/camera/latest.jpg') || image.includes('/camera/latest.jpg')))
    ) {
      const latest = activeStore.getLatest();
      if (!latest || !latest.frame.buffer || latest.frame.buffer.length === 0) {
        return res.status(404).json({
          error: 'NO_CAMERA_FRAME',
          message:
            'No ESP32-CAM photograph is currently stored on the server. Ensure the greenhouse ESP32-CAM is powered on and uploading frames to POST /api/camera/upload.'
        });
      }

      // Enforce freshness by default: never pass cached or stale photographs as if they were fresh camera captures
      if (requireFresh !== false && !latest.state.isFresh) {
        return res.status(409).json({
          error: 'STALE_CAMERA_FRAME',
          freshness: latest.state.freshness,
          dataSource: latest.state.dataSource,
          ageSeconds: latest.state.ageSeconds,
          timestamp: latest.frame.timestamp,
          frameId: latest.frame.id,
          message: `Latest ESP32-CAM photograph was captured ${latest.state.ageSeconds}s ago (${latest.state.freshness}) and is not a fresh live capture. Wait for a fresh camera frame before running live diagnosis.`
        });
      }

      imgBuffer = latest.frame.buffer;
      mimeType = latest.frame.mimeType;
      cleanBase64 = imgBuffer.toString('base64');
      resolvedSource = latest.state.isFresh ? 'ESP32_CAM_FRESH' : 'ESP32_CAM_HISTORICAL';
      cameraFrameMeta = {
        id: latest.frame.id,
        timestamp: latest.frame.timestamp,
        ageSeconds: latest.state.ageSeconds,
        freshness: latest.state.freshness,
        dataSource: latest.state.dataSource
      };
    } else {
      if (!image || typeof image !== 'string' || !image.trim()) {
        return res.status(400).json({
          error: 'EMPTY_IMAGE',
          message: 'No plant photograph provided for diagnosis.'
        });
      }

      cleanBase64 = image.trim();
      if (cleanBase64.startsWith('data:')) {
        const match = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1].toLowerCase();
          cleanBase64 = match[2];
        } else {
          cleanBase64 = cleanBase64.split(',')[1] || cleanBase64;
        }
      }

      const baseMimeCheck = mimeType.split(';')[0].toLowerCase();
      const allowedImageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedImageMimes.includes(baseMimeCheck)) {
        return res.status(400).json({
          error: 'INVALID_IMAGE_FORMAT',
          message: `Image format "${baseMimeCheck}" is not supported for computer vision diagnosis. Provide a JPEG, PNG, or WebP photograph.`
        });
      }

      imgBuffer = Buffer.from(cleanBase64, 'base64');
    }

    const byteCheck = validateRasterImageBytes(imgBuffer, activeStore.getMaxUploadBytes());
    if (!byteCheck.valid) {
      return res.status(byteCheck.statusCode).json({
        error: byteCheck.errorCode || 'INVALID_IMAGE_BYTES',
        message: byteCheck.error || 'Provided image does not contain valid raster image bytes.'
      });
    }

    if (!isAiConfigured()) {
      return res.status(503).json({
        error: 'AI_SERVICE_UNCONFIGURED',
        message:
          'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Render Dashboard > Environment Variables.'
      });
    }

    const baseMime =
      byteCheck.detectedMime ||
      (mimeType.split(';')[0].toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.split(';')[0].toLowerCase());
    const langInfo = languages[languageId] || languages['ha'] || {
      name: 'English (Nigeria)',
      native: 'Nigerian English',
      region: 'Nationwide'
    };

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
      const { rawJsonText, modelUsed } = await runVisionModel({
        base64Data: cleanBase64,
        mimeType: baseMime,
        promptText,
        responseSchema: PLANT_DIAGNOSIS_RESPONSE_SCHEMA
      });

      const trimmed = rawJsonText?.trim();
      if (!trimmed) {
        throw new Error('Gemini vision model returned an empty response.');
      }

      const parsed = JSON.parse(trimmed);
      parsed.language = langInfo.name;
      parsed.imageSource = resolvedSource;
      if (resolvedGreenhouseId) {
        parsed.greenhouseId = resolvedGreenhouseId;
      }
      if (cameraFrameMeta) {
        parsed.frameId = cameraFrameMeta.id;
        parsed.frameTimestamp = cameraFrameMeta.timestamp;
        parsed.frameAgeSeconds = cameraFrameMeta.ageSeconds;
        activeStore.markAnalyzed(cameraFrameMeta.id, parsed);
      }

      onDiagnosisComplete?.({
        greenhouseId: resolvedGreenhouseId,
        actorUserId: resolvedActorUserId,
        imageSource: resolvedSource,
        frameId: cameraFrameMeta?.id,
        frameTimestamp: cameraFrameMeta?.timestamp,
        result: parsed
      });

      return res.json({
        success: true,
        greenhouseId: resolvedGreenhouseId,
        result: parsed,
        imageSource: resolvedSource,
        cameraFrame: cameraFrameMeta,
        imageBytesVerified: imgBuffer.length,
        mimeType: baseMime,
        modelUsed,
        advisoryOnly: true,
        actuationExecuted: false
      });
    } catch (err: any) {
      console.error('Plant diagnosis error on server:', err.message);
      return res.status(502).json({
        error: 'DIAGNOSIS_FAILED',
        message: `Plant diagnosis failed: ${err.message}`
      });
    }
  };
}
