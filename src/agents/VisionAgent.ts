import { useEffect } from 'react';
import { store } from '../lib/store';
import { cameraConnectionManager } from '../lib/cameraConnectionManager';
import { diagnoseLatestCameraFrame } from '../lib/gemini';
import { resolveAgentTelemetryContext } from './agentTelemetryContext';

let visionRunning = false;

export async function runVisionAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_VisionAgent_enabled') !== false;
  if (!isEnabled && !options?.force) return;
  if (visionRunning) return;
  visionRunning = true;

  try {
    const [ctx, globalFrame] = await Promise.all([
      resolveAgentTelemetryContext(),
      cameraConnectionManager.refreshNow(false)
    ]);

    const hasEnrolledGh = Boolean(ctx.greenhouseId);
    const hasFreshFrame = hasEnrolledGh
      ? Boolean(ctx.latestCamera?.exists && ctx.latestCamera?.isFresh)
      : Boolean(globalFrame && globalFrame.isFresh);
    const hasAnyFrame = hasEnrolledGh
      ? Boolean(ctx.latestCamera?.exists)
      : Boolean(globalFrame);

    if (!hasFreshFrame) {
      store.setValue('agent_VisionAgent_status', 'STANDBY_NO_FRESH_FRAME');
      store.setValue(
        'agent_VisionAgent_summary',
        hasAnyFrame
          ? 'Standby — latest greenhouse camera photo is older than 90s. Refusing to treat outdated snapshot as live.'
          : 'Standby — awaiting a verified ESP32-CAM crop snapshot or manual leaf inspection in Plant Vision.'
      );
      store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
      return;
    }

    const lang = String(store.getValue('aiLanguage') || 'en');
    const result = await diagnoseLatestCameraFrame(lang);

    const id = Date.now().toString();
    store.setRow('ai_history', id, {
      timestamp: new Date().toISOString(),
      species: result.species,
      healthStatus: result.healthStatus,
      recommendation: result.recommendation,
      language: lang,
      source: 'Vision Agent (ESP32-CAM)'
    });

    const isHealthy = String(result.healthStatus || '').toLowerCase().includes('healthy');
    store.setValue('agent_VisionAgent_status', isHealthy ? 'ADVISORY_READY' : 'ALERT');
    store.setValue(
      'agent_VisionAgent_summary',
      `${result.species} (${result.healthStatus}): ${result.recommendation}`
    );
    store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());

    store.setRow('activityLog', `${id}_log`, {
      timestamp: new Date().toISOString(),
      type: isHealthy ? 'agent' : 'alert',
      message: `Vision Agent inspected fresh ESP32-CAM frame: ${result.species} — ${result.healthStatus}.`
    });
  } catch (e: any) {
    console.warn('VisionAgent cycle skipped:', e?.message || e);
    store.setValue('agent_VisionAgent_status', 'STANDBY_NO_FRESH_FRAME');
  } finally {
    visionRunning = false;
  }
}

/**
 * VisionAgent — Periodic Plant Health Inspector
 *
 * SAFETY & HONESTY POLICY:
 * - Only inspects genuine, fresh (<=90s) ESP32-CAM photographs stored on the server
 *   (including per-greenhouse edcam_* camera stores).
 * - Never analyzes simulated canvas drawings or stale cached frames.
 */
export function VisionAgent() {
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void runVisionAgentCycle();
    }, 6000);
    const interval = setInterval(() => {
      void runVisionAgentCycle();
    }, 120000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return null;
}

export const useVisionAgent = VisionAgent;
