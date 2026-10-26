import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { analyzePlantImage } from '../lib/gemini';

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

        const analysisResult = await analyzePlantImage(snapshotResult.base64Image, 'en');
        const now = new Date().toISOString();

        store.setValue('agent_VisionAgent_lastRun', now);
        store.setValue('plantHealthStatus', analysisResult.healthStatus);
        store.setValue('lastVisionAnalysis', JSON.stringify({
          species: analysisResult.species,
          healthStatus: analysisResult.healthStatus,
          foliageCondition: analysisResult.symptoms,
          cause: analysisResult.cause,
          recommendedAction: analysisResult.recommendation,
          timestamp: now,
          dataSource: snapshotResult.dataSource,
          isUploaded: Boolean(snapshotResult.isUploaded),
          imageId: snapshotResult.imageId || null
        }));

        // Mark backend uploaded image analyzed if applicable
        if (snapshotResult.isUploaded && snapshotResult.imageId) {
          await hardwareService.markCameraImageAnalyzed(snapshotResult.imageId, analysisResult);
          store.setValue('cameraUploadActive', true);
          store.setValue('cameraLastAnalyzedFrame', snapshotResult.imageId);
        }

        const sourceLabel = snapshotResult.isUploaded 
          ? (snapshotResult.dataSource === 'REAL_HARDWARE'
              ? 'REAL ESP32-CAM UPLOAD'
              : `ESP32-CAM UPLOAD (${snapshotResult.dataSource})`)
          : snapshotResult.dataSource === 'SIMULATED' 
            ? 'SIMULATION' 
            : snapshotResult.dataSource;

        store.setRow('activityLog', Date.now().toString() + 'va', {
          timestamp: now,
          type: 'agent',
          message: `📸 Vision Agent [${sourceLabel}]: ${analysisResult.species} — ${analysisResult.healthStatus}. Symptoms: ${analysisResult.symptoms}. Action: ${analysisResult.recommendation}`
        });
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
