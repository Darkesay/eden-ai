import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';
import { resolveAgentTelemetryContext } from './agentTelemetryContext';

let climateRunning = false;

export async function runClimateAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_ClimateAgent_enabled') !== false;
  if (!isEnabled && !options?.force) return;
  if (climateRunning) return;
  climateRunning = true;

  try {
    const config = hardwareService.getConfig();
    const canAutoDispatch = config.mode === 'simulation' && Boolean(store.getValue('auto_approve_agent_ClimateAgent')) && false;
    void canAutoDispatch;
    const ctx = await resolveAgentTelemetryContext();
    const isUsable =
      ctx.dataSource === 'REAL_HARDWARE' ||
      ctx.dataSource === 'CACHED' ||
      ctx.dataSource === 'SIMULATED';

    if (!isUsable || ctx.temperature === null || ctx.humidity === null) {
      store.setValue('agent_ClimateAgent_status', 'STANDBY_OFFLINE');
      store.setValue(
        'agent_ClimateAgent_summary',
        ctx.dataSource === 'STALE'
          ? 'Standby — sensor reading is delayed (>45s). Waiting for fresh controller update.'
          : 'Standby — sensor telemetry is offline. Connect your greenhouse controller or enable Practice Mode.'
      );
      store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
      return;
    }

    const tempMin = Number(store.getValue('tempMinThreshold')) || 18;
    const tempMax = Number(store.getValue('tempMaxThreshold')) || 28;
    const humMin = Number(store.getValue('humMinThreshold')) || 50;
    const humMax = Number(store.getValue('humMaxThreshold')) || 75;

    const decision = await evaluateAgentDecision('climate', {
      temperature: ctx.temperature,
      humidity: ctx.humidity,
      light: ctx.light ?? 500,
      rain: ctx.rain ?? false,
      cropType: ctx.cropType,
      tempMin,
      tempMax,
      humMin,
      humMax,
      dataSource: ctx.dataSource
    });

    let safeActionText = String(decision?.reason || 'Canopy temperature and humidity are within safe range.');
    let needsAttention = Boolean(decision?.actionRequired);

    // Hardware safety interlock: never suggest heating when temperature > 32°C
    if (decision?.heater && ctx.temperature > 32) {
      safeActionText = `Thermal lock active (${ctx.temperature.toFixed(1)}°C > 32°C): heater stays OFF; open vents or run circulation fans.`;
      needsAttention = true;
    }

    const sourceTag = ctx.dataSource === 'SIMULATED' ? '[Practice Mode] ' : '';
    store.setValue('agent_ClimateAgent_status', needsAttention ? 'ALERT' : 'ADVISORY_READY');
    store.setValue('agent_ClimateAgent_summary', `${sourceTag}${safeActionText}`);
    store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());

    if (needsAttention) {
      const id = Date.now().toString();
      store.setRow('activityLog', id, {
        timestamp: new Date().toISOString(),
        type: 'agent',
        message: `${sourceTag}Climate Agent Advisory: ${safeActionText} (No automatic equipment actuation performed.)`
      });
    }
  } catch (e: any) {
    console.warn('ClimateAgent advisory error:', e?.message || e);
    store.setValue('agent_ClimateAgent_status', 'ERROR');
  } finally {
    climateRunning = false;
  }
}

/**
 * ClimateAgent — Advisory-Only Agronomic Monitor
 *
 * SAFETY POLICY: Never triggers physical relays, fans, heaters, or roof vents autonomously.
 * Evaluates verified or simulated telemetry and writes plain-language recommendations.
 */
export function ClimateAgent() {
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void runClimateAgentCycle();
    }, 2500);
    const interval = setInterval(() => {
      void runClimateAgentCycle();
    }, 30000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return null;
}

export const useClimateAgent = ClimateAgent;
