import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { cameraConnectionManager } from '../lib/cameraConnectionManager';
import { diagnoseLatestCameraFrame } from '../lib/gemini';

/**
 * Autonomous Vision Agent.
 * Strictly analyzes ONLY genuine, fresh (REAL_HARDWARE), unanalyzed ESP32-CAM photographs.
 * Never passes simulated drawings or cached/stale photographs to Gemini Vision.
 */
export function useVisionAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_VisionAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;

      isRunning.current = true;
      try {
        const latestFrame = await cameraConnectionManager.refreshNow(false);

        if (!latestFrame) {
          store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'va', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message:
              '📸 Vision Agent: No ESP32-CAM photograph received yet at POST /api/camera/upload. Standing by.'
          });
          return;
        }

        if (!latestFrame.isFresh || latestFrame.dataSource !== 'REAL_HARDWARE') {
          store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'va_stale', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `📸 Vision Agent: Skipping analysis — latest ESP32-CAM photograph is ${latestFrame.freshness} (${latestFrame.ageSeconds}s old), not a fresh capture.`
          });
          return;
        }

        if (latestFrame.analyzed) {
          return;
        }

        const analysisResult = await diagnoseLatestCameraFrame('en');
        const now = new Date().toISOString();

        store.setValue('agent_VisionAgent_lastRun', now);
        store.setValue('plantHealthStatus', analysisResult.healthStatus);
        store.setValue(
          'lastVisionAnalysis',
          JSON.stringify({
            species: analysisResult.species,
            healthStatus: analysisResult.healthStatus,
            foliageCondition: analysisResult.symptoms,
            cause: analysisResult.cause,
            recommendedAction: analysisResult.recommendation,
            timestamp: now,
            dataSource: 'REAL_HARDWARE',
            isUploaded: true,
            imageId: latestFrame.id,
            frameTimestamp: latestFrame.timestamp
          })
        );

        store.setValue('cameraUploadActive', true);
        store.setValue('cameraLastAnalyzedFrame', latestFrame.id);

        store.setRow('activityLog', Date.now().toString() + 'va', {
          timestamp: now,
          type: 'agent',
          message: `📸 Vision Agent [FRESH ESP32-CAM · ${latestFrame.id}]: ${analysisResult.species} — ${analysisResult.healthStatus}. Symptoms: ${analysisResult.symptoms}. Action: ${analysisResult.recommendation}`
        });
      } catch (err: any) {
        console.warn('VisionAgent cycle warning:', err.message);
        store.setRow('activityLog', Date.now().toString() + 'va_warn', {
          timestamp: new Date().toISOString(),
          type: 'warning',
          message: `📸 Vision Agent: Assessment deferred (${err.message}).`
        });
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 60000);
    const timeout = setTimeout(runAgent, 12000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
