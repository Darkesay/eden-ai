import { useEffect } from 'react';
import { store } from '../lib/store';
import { cameraConnectionManager } from '../lib/cameraConnectionManager';
import { diagnoseLatestCameraFrame } from '../lib/gemini';

let visionAgentRunning = false;

/**
 * Autonomous Vision Agent.
 * Strictly analyzes ONLY genuine, fresh (REAL_HARDWARE), unanalyzed ESP32-CAM photographs.
 * Never passes simulated drawings or cached/stale photographs to Gemini Vision.
 */
export async function runVisionAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_VisionAgent_enabled') ?? true;
  if ((!isEnabled && !options?.force) || visionAgentRunning) return;

  visionAgentRunning = true;
  try {
    const latestFrame = await cameraConnectionManager.refreshNow(false);
    const now = new Date().toISOString();

    if (!latestFrame) {
      const msg =
        'Standing by — waiting for an ESP32-CAM JPEG snapshot upload (or snap/upload a leaf photo in Plant Vision).';
      store.setValue('agent_VisionAgent_lastRun', now);
      store.setValue('agent_VisionAgent_status', 'STANDBY');
      store.setValue('agent_VisionAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'va', {
        timestamp: now,
        type: 'agent',
        message: `Vision Agent: ${msg}`
      });
      return;
    }

    if (!latestFrame.isFresh || latestFrame.dataSource !== 'REAL_HARDWARE') {
      const msg = `Latest ESP32-CAM snapshot is ${latestFrame.freshness.toLowerCase()} (${latestFrame.ageSeconds}s old > 90s limit). Waiting for a fresh capture so old photos are never misdiagnosed as live.`;
      store.setValue('agent_VisionAgent_lastRun', now);
      store.setValue('agent_VisionAgent_status', 'STANDBY');
      store.setValue('agent_VisionAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'va_stale', {
        timestamp: now,
        type: 'agent',
        message: `Vision Agent: ${msg}`
      });
      return;
    }

    if (latestFrame.analyzed && !options?.force) {
      store.setValue('agent_VisionAgent_lastRun', now);
      store.setValue('agent_VisionAgent_status', 'ADVISORY_READY');
      if (!store.getValue('agent_VisionAgent_summary')) {
        store.setValue(
          'agent_VisionAgent_summary',
          `Latest fresh ESP32-CAM frame (${latestFrame.id}) has already been inspected.`
        );
      }
      return;
    }

    const langId = String(store.getValue('aiLanguage') || 'en');
    const analysisResult = await diagnoseLatestCameraFrame(langId);
    const completedAt = new Date().toISOString();
    const summary = `${analysisResult.species} — ${analysisResult.healthStatus}: ${analysisResult.recommendation}`;

    store.setValue('agent_VisionAgent_lastRun', completedAt);
    store.setValue('agent_VisionAgent_status', 'ADVISORY_READY');
    store.setValue('agent_VisionAgent_summary', summary);
    store.setValue('plantHealthStatus', analysisResult.healthStatus);
    store.setValue(
      'lastVisionAnalysis',
      JSON.stringify({
        species: analysisResult.species,
        healthStatus: analysisResult.healthStatus,
        foliageCondition: analysisResult.symptoms,
        cause: analysisResult.cause,
        recommendedAction: analysisResult.recommendation,
        timestamp: completedAt,
        dataSource: 'REAL_HARDWARE',
        isUploaded: true,
        imageId: latestFrame.id,
        frameTimestamp: latestFrame.timestamp
      })
    );

    store.setValue('cameraUploadActive', true);
    store.setValue('cameraLastAnalyzedFrame', latestFrame.id);

    store.setRow('activityLog', Date.now().toString() + 'va', {
      timestamp: completedAt,
      type: 'agent',
      message: `Vision Agent [FRESH ESP32-CAM]: ${summary}`
    });
  } catch (err: any) {
    console.warn('VisionAgent cycle warning:', err.message);
    store.setValue('agent_VisionAgent_status', 'STANDBY');
    store.setValue(
      'agent_VisionAgent_summary',
      `Camera assessment deferred (${err?.message || 'waiting for fresh snapshot'}).`
    );
  } finally {
    visionAgentRunning = false;
  }
}

export function useVisionAgent() {
  useEffect(() => {
    const interval = setInterval(() => {
      void runVisionAgentCycle();
    }, 60000);
    const timeout = setTimeout(() => {
      void runVisionAgentCycle();
    }, 9000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
