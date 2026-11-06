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
      imageBase64,
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
      capturedAt: string;
      ageSeconds: number;
      freshness: string;
      dataSource: string;
      acquisitionMethod: string;
    } | null = null;

    const rawProvidedImage = image ?? imageBase64;
    if (
      useLatestCameraFrame ||
      String(source || '').toUpperCase() === 'LATEST_CAMERA_FRAME' ||
      (typeof rawProvidedImage === 'string' &&
        (rawProvidedImage.startsWith('/api/camera/latest.jpg') ||
          rawProvidedImage.includes('/camera/latest.jpg')))
    ) {
      const latest = activeStore.getLatest();
      if (!latest || !latest.frame.buffer || latest.frame.buffer.length === 0) {
        return res.status(404).json({
          error: 'NO_CAMERA_FRAME',
          message:
            'No ESP32-CAM photograph is currently stored on the server. Ensure the greenhouse ESP32-CAM is powered on and uploading frames to POST /api/camera/upload or captured via CONNECT EXISTING HARDWARE.'
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
          capturedAt: latest.frame.capturedAt || latest.frame.timestamp,
          frameId: latest.frame.id,
          message: `Latest ESP32-CAM photograph was captured ${latest.state.ageSeconds}s ago (${latest.state.freshness}) and is not a fresh live capture. Capture or upload a fresh camera frame before running live diagnosis.`
        });
      }

      imgBuffer = latest.frame.buffer;
      mimeType = latest.frame.mimeType;
      cleanBase64 = imgBuffer.toString('base64');
      resolvedSource = latest.state.isFresh ? 'ESP32_CAM_FRESH' : 'ESP32_CAM_HISTORICAL';
      cameraFrameMeta = {
        id: latest.frame.id,
        timestamp: latest.frame.timestamp,
        capturedAt: latest.frame.capturedAt || latest.frame.timestamp,
        ageSeconds: latest.state.ageSeconds,
        freshness: latest.state.freshness,
        dataSource: latest.state.dataSource,
        acquisitionMethod: latest.frame.acquisitionMethod
      };
    } else {
      if (!rawProvidedImage || typeof rawProvidedImage !== 'string' || !rawProvidedImage.trim()) {
        return res.status(400).json({
          error: 'EMPTY_IMAGE',
          message: 'No plant photograph provided for diagnosis.'
        });
      }

      cleanBase64 = rawProvidedImage.trim();
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

async function tryAlternativeVisionProvider(
  base64Data: string,
  mimeType: string,
  promptText: string
): Promise<{ rawJsonText: string; modelUsed: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VISION_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-placeholder')) {
    return null;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are EDENS AI, an agricultural plant health and agronomy expert. You must respond strictly with valid JSON conforming to the requested schema.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000
      })
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (content) {
      return { rawJsonText: content, modelUsed: data.model || 'openai-vision' };
    }
  } catch (err: any) {
    console.warn('[Vision] Alternative vision provider fallback failed:', err?.message);
  }
  return null;
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

    const imageOriginLabel =
      resolvedSource === 'MANUAL_UPLOAD' ? 'UPLOADED_TEST_IMAGE' : 'REAL_CAMERA_IMAGE';
    const resolvedDataSource =
      resolvedSource === 'MANUAL_UPLOAD' ? 'MANUAL_UPLOAD' : 'REAL_HARDWARE';

    let visionOutput: { rawJsonText: string; modelUsed: string } | null = null;
    const isAiAvailable = isAiConfigured();

    if (isAiAvailable) {
      try {
        visionOutput = await runVisionModel({
          base64Data: cleanBase64,
          mimeType: baseMime,
          promptText,
          responseSchema: PLANT_DIAGNOSIS_RESPONSE_SCHEMA
        });
      } catch (err: any) {
        console.warn('[Vision] Primary Gemini runner failed, checking alternative provider:', err.message);
      }
    }

    if (!visionOutput) {
      visionOutput = await tryAlternativeVisionProvider(cleanBase64, baseMime, promptText);
    }

    // Graceful offline fallback: If AI models are unconfigured or unavailable, return a structured 200 response with real frame confirmation
    if (!visionOutput) {
      const fallbackResult: Record<string, unknown> = {
        species: 'Greenhouse Crop (Hardware Live Capture)',
        speciesLocal: 'Shuka (Kyamar Greenhouse)',
        healthStatus: 'Manual Verification Required',
        healthStatusLocal: 'Binciken Manomi Yana Bukata',
        symptoms: 'Physical ESP32-CAM frame successfully ingested and verified on server. Automated neural vision diagnosis is currently in offline standby mode.',
        cause: 'AI Vision Provider Unconfigured (GEMINI_API_KEY not set in environment)',
        possibleCauses: 'AI model inference unconfigured on server. Camera capture and frame integrity confirmed.',
        recommendation: 'Visually inspect foliage directly or configure GEMINI_API_KEY on server to enable automated disease classification.',
        recommendedActions: '1. Visually check top and bottom of leaves. 2. Verify climate sensor values. 3. Configure AI API key for automated leaf disease inference.',
        audioSummary: 'Hoton kyamar greenhouse ya sauka lafiya lau. Ana bukatar duba shukar da ido ko saita makullin AI.',
        language: langInfo.name,
        imageSource: resolvedSource,
        imageOriginLabel,
        dataSource: resolvedDataSource,
        confidenceCalibrated: false,
        confidenceScore: null,
        confidenceNote: 'AI inference offline — manual inspection advised.',
        cropIdentification: 'Greenhouse Crop (Hardware Capture)',
        visibleSymptoms: 'Frame integrity verified; AI model inference in standby.',
        possibleDiseaseOrPest: 'Unspecified (Manual confirmation required)',
        confidenceLevel: 'UNAVAILABLE',
        supportingVisualObservations: [
          `Verified raster byte length: ${imgBuffer.length} bytes`,
          `MIME format: ${baseMime}`,
          `Acquisition method: ${cameraFrameMeta?.acquisitionMethod || 'DIRECT_UPLOAD'}`
        ],
        recommendedNextSteps: [
          'Visually inspect the physical plant leaves in the greenhouse.',
          'Verify soil moisture and temperature from telemetry.',
          'Configure GEMINI_API_KEY in server environment for automated disease classification.'
        ],
        humanConfirmationRequired: true,
        aiConfigured: false,
        status: 'AI_DIAGNOSIS_UNAVAILABLE',
        capturedAt: cameraFrameMeta?.capturedAt || null,
        frameId: cameraFrameMeta?.id,
        frameTimestamp: cameraFrameMeta?.timestamp,
        frameAgeSeconds: cameraFrameMeta?.ageSeconds,
        acquisitionMethod: cameraFrameMeta?.acquisitionMethod
      };

      if (cameraFrameMeta) {
        activeStore.markAnalyzed(cameraFrameMeta.id, fallbackResult);
      }

      onDiagnosisComplete?.({
        greenhouseId: resolvedGreenhouseId,
        actorUserId: resolvedActorUserId,
        imageSource: resolvedSource,
        frameId: cameraFrameMeta?.id,
        frameTimestamp: cameraFrameMeta?.timestamp,
        result: fallbackResult
      });

      return res.json({
        success: true,
        greenhouseId: resolvedGreenhouseId,
        result: fallbackResult,
        imageSource: resolvedSource,
        imageOriginLabel,
        dataSource: resolvedDataSource,
        capturedAt: cameraFrameMeta?.capturedAt || null,
        cameraFrame: cameraFrameMeta,
        possibleCauses: ['AI vision provider unconfigured on server. Physical frame verified.'],
        recommendedActions: ['Visually inspect physical foliage in greenhouse.'],
        confidenceCalibrated: false,
        confidenceScore: null,
        imageBytesVerified: imgBuffer.length,
        mimeType: baseMime,
        modelUsed: 'offline-standby',
        advisoryOnly: true,
        actuationExecuted: false,
        aiConfigured: false,
        status: 'AI_DIAGNOSIS_UNAVAILABLE',
        cropIdentification: fallbackResult.cropIdentification,
        visibleSymptoms: fallbackResult.visibleSymptoms,
        possibleDiseaseOrPest: fallbackResult.possibleDiseaseOrPest,
        confidenceLevel: 'UNAVAILABLE',
        supportingVisualObservations: fallbackResult.supportingVisualObservations,
        recommendedNextSteps: fallbackResult.recommendedNextSteps,
        humanConfirmationRequired: true
      });
    }

    try {
      const trimmed = visionOutput.rawJsonText?.trim();
      if (!trimmed) {
        throw new Error('Vision model returned an empty response.');
      }

      const parsed = JSON.parse(trimmed);

      const normalizedCausesList = Array.isArray(parsed.possibleCauses)
        ? parsed.possibleCauses.filter((x: unknown) => typeof x === 'string' && x.trim())
        : typeof parsed.cause === 'string' && parsed.cause.trim()
          ? parsed.cause
              .split(/\n+/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];
      const normalizedActionsList = Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.filter((x: unknown) => typeof x === 'string' && x.trim())
        : typeof parsed.recommendation === 'string' && parsed.recommendation.trim()
          ? parsed.recommendation
              .split(/\n+/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];

      parsed.language = langInfo.name;
      parsed.imageSource = resolvedSource;
      parsed.imageOriginLabel = imageOriginLabel;
      parsed.dataSource = resolvedDataSource;
      parsed.possibleCauses =
        normalizedCausesList.length > 0 ? normalizedCausesList : parsed.cause || '';
      parsed.recommendedActions =
        normalizedActionsList.length > 0 ? normalizedActionsList : parsed.recommendation || '';
      parsed.confidenceCalibrated = false;
      parsed.confidenceScore = null;
      parsed.confidenceNote =
        'Uncalibrated generative vision assessment — numerical confidence percentage omitted.';

      // Structured Independent Plant Vision fields
      parsed.cropIdentification = parsed.species || 'Greenhouse Crop';
      parsed.visibleSymptoms = parsed.symptoms || '';
      parsed.possibleDiseaseOrPest = parsed.cause || '';
      parsed.confidenceLevel = 'MEDIUM';
      parsed.supportingVisualObservations =
        normalizedCausesList.length > 0 ? normalizedCausesList : [parsed.symptoms || 'Visual indicators observed'];
      parsed.recommendedNextSteps =
        normalizedActionsList.length > 0 ? normalizedActionsList : [parsed.recommendation || 'Follow general greenhouse care'];
      parsed.humanConfirmationRequired = true;
      parsed.aiConfigured = true;
      parsed.status = 'DIAGNOSIS_COMPLETED';

      if (resolvedGreenhouseId) {
        parsed.greenhouseId = resolvedGreenhouseId;
      }
      if (cameraFrameMeta) {
        parsed.frameId = cameraFrameMeta.id;
        parsed.frameTimestamp = cameraFrameMeta.timestamp;
        parsed.capturedAt = cameraFrameMeta.capturedAt;
        parsed.frameAgeSeconds = cameraFrameMeta.ageSeconds;
        parsed.acquisitionMethod = cameraFrameMeta.acquisitionMethod;
        activeStore.markAnalyzed(cameraFrameMeta.id, parsed);
      } else {
        parsed.capturedAt = null;
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
        imageOriginLabel,
        dataSource: resolvedDataSource,
        capturedAt: cameraFrameMeta?.capturedAt || null,
        cameraFrame: cameraFrameMeta,
        possibleCauses: normalizedCausesList,
        recommendedActions: normalizedActionsList,
        confidenceCalibrated: false,
        confidenceScore: null,
        imageBytesVerified: imgBuffer.length,
        mimeType: baseMime,
        modelUsed: visionOutput.modelUsed,
        advisoryOnly: true,
        actuationExecuted: false,
        aiConfigured: true,
        status: 'DIAGNOSIS_COMPLETED',
        cropIdentification: parsed.cropIdentification,
        visibleSymptoms: parsed.visibleSymptoms,
        possibleDiseaseOrPest: parsed.possibleDiseaseOrPest,
        confidenceLevel: parsed.confidenceLevel,
        supportingVisualObservations: parsed.supportingVisualObservations,
        recommendedNextSteps: parsed.recommendedNextSteps,
        humanConfirmationRequired: true
      });
    } catch (err: any) {
      console.error('Plant diagnosis parsing error on server:', err.message);
      return res.status(502).json({
        error: 'DIAGNOSIS_FAILED',
        message: `Plant diagnosis failed: ${err.message}`
      });
    }
  };
}
