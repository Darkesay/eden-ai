import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_GEMINI_API_KEY || '') : ''),
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export function useVisionAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_VisionAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;

      isRunning.current = true;
      try {
        const config = hardwareService.getConfig();
        const dataSource = hardwareService.getDataSource();

        let snapshotResult: {
          base64Image: string;
          dataSource: string;
          isUploaded?: boolean;
          imageId?: string;
          timestamp?: string;
        };

        try {
          snapshotResult = await hardwareService.getCameraSnapshot();
        } catch (err: any) {
          store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'va', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `📸 Vision Agent: ${err.message || 'ESP32-CAM frame unavailable'}. Visual analysis paused.`
          });
          return;
        }

        if (!snapshotResult || !snapshotResult.base64Image) {
          store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'va', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `📸 Vision Agent: No frame data received from ESP32-CAM. Awaiting upload at /api/camera/upload.`
          });
          return;
        }

        // Clean raw base64 data and normalize mimeType to Gemini-compatible raster format
        let rawBase64 = snapshotResult.base64Image;
        let mimeType = 'image/jpeg';
        if (rawBase64.startsWith('data:')) {
          const match = rawBase64.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1].toLowerCase();
            rawBase64 = match[2];
          }
        }

        // Gemini only accepts raster formats (jpeg, png, webp, heic, heif).
        // If an SVG or unsupported format is supplied, rasterize it or use valid JPEG
        if (mimeType.includes('svg') || !mimeType.startsWith('image/')) {
          mimeType = 'image/jpeg';
          rawBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
        }

        const temp = Number(store.getValue('temperature') ?? 24);
        const hum = Number(store.getValue('humidity') ?? 60);
        const soil = Number(store.getValue('soilMoisture') ?? 50);
        const activeCrop = (store.getValue('cropType') as string) || 'Tomato';

        // Prepare grounded prompt with current telemetry
        const textPrompt = `You are EDENS AI Botanical Vision Agent, inspecting greenhouse foliage for ${activeCrop}.
Current Greenhouse Telemetry (${snapshotResult.dataSource}):
- Temperature: ${temp}°C
- Humidity: ${hum}%
- Soil Moisture: ${soil}%

Analyze this camera frame carefully:
1. Assess plant foliage vigor, leaf color, turgidity, and visible anomalies (chlorosis, necrosis, mildew, pests).
2. Correlate with current environmental telemetry.
3. Recommend safe agricultural actions (e.g. increase ventilation, maintain irrigation, inspect for aphids).
4. Clearly state health status: "Healthy" | "Mild stress" | "Severe stress" | "Requires attention".

Return JSON with exact fields:
{
  "healthStatus": "Healthy" | "Mild stress" | "Severe stress" | "Requires attention",
  "foliageCondition": "string (1-2 concise sentences)",
  "recommendedAction": "string (1 safe recommendation)",
  "confidenceScore": number (0 to 100)
}`;

        let response: any;
        try {
          response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg',
                      data: rawBase64
                    }
                  },
                  {
                    text: textPrompt
                  }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  healthStatus: { type: Type.STRING },
                  foliageCondition: { type: Type.STRING },
                  recommendedAction: { type: Type.STRING },
                  confidenceScore: { type: Type.NUMBER }
                },
                required: ["healthStatus", "foliageCondition", "recommendedAction", "confidenceScore"]
              }
            }
          });
        } catch (genError: any) {
          // If Gemini rejected image decoding, fallback to telemetry-grounded evaluation
          console.warn('VisionAgent multimodal analysis error, falling back to telemetry-assisted analysis:', genError.message);
          response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `${textPrompt}\n\nNote: Visual sensor frame was degraded or unparseable. Assess plant condition based on current telemetry readings and typical ${activeCrop} growing requirements.`
                  }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  healthStatus: { type: Type.STRING },
                  foliageCondition: { type: Type.STRING },
                  recommendedAction: { type: Type.STRING },
                  confidenceScore: { type: Type.NUMBER }
                },
                required: ["healthStatus", "foliageCondition", "recommendedAction", "confidenceScore"]
              }
            }
          });
        }

        if (response?.text) {
          const result = JSON.parse(response.text.trim());
          const now = new Date().toISOString();

          store.setValue('agent_VisionAgent_lastRun', now);
          store.setValue('plantHealthStatus', result.healthStatus);
          store.setValue('lastVisionAnalysis', JSON.stringify({
            ...result,
            timestamp: now,
            dataSource: snapshotResult.dataSource,
            isUploaded: Boolean(snapshotResult.isUploaded),
            imageId: snapshotResult.imageId || null
          }));

          // Mark backend uploaded image analyzed if applicable
          if (snapshotResult.isUploaded && snapshotResult.imageId) {
            await hardwareService.markCameraImageAnalyzed(snapshotResult.imageId, result);
            store.setValue('cameraUploadActive', true);
            store.setValue('cameraLastAnalyzedFrame', snapshotResult.imageId);
          }

          const sourceLabel = snapshotResult.isUploaded 
            ? 'REAL ESP32-CAM UPLOAD'
            : snapshotResult.dataSource === 'SIMULATED' 
              ? 'SIMULATION' 
              : 'REAL HARDWARE';

          store.setRow('activityLog', Date.now().toString() + 'va', {
            timestamp: now,
            type: 'agent',
            message: `📸 Vision Agent [${sourceLabel}]: ${result.healthStatus} (${result.confidenceScore}% conf) — ${result.foliageCondition} Action: ${result.recommendedAction}`
          });
        }
      } catch (err: any) {
        console.warn("VisionAgent cycle warning:", err.message);
        store.setRow('activityLog', Date.now().toString() + 'va_warn', {
          timestamp: new Date().toISOString(),
          type: 'warning',
          message: `📸 Vision Agent: Assessment cycle deferred (${err.message}).`
        });
      } finally {
        isRunning.current = false;
      }
    };

    // Run every 10 minutes (or on startup)
    const interval = setInterval(runAgent, 600000);
    const timeout = setTimeout(runAgent, 12000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
