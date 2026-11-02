import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';
import { resolveAgentTelemetryContext } from './agentTelemetryContext';

let irrigationRunning = false;

export async function runIrrigationAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_IrrigationAgent_enabled') !== false;
  if (!isEnabled && !options?.force) return;
  if (irrigationRunning) return;
  irrigationRunning = true;

  try {
    const config = hardwareService.getConfig();
    const canAutoDispatch = config.mode === 'simulation' && Boolean(store.getValue('auto_approve_agent_IrrigationAgent')) && false;
    void canAutoDispatch;
    const ctx = await resolveAgentTelemetryContext();
    const isUsable =
      ctx.dataSource === 'REAL_HARDWARE' ||
      ctx.dataSource === 'CACHED' ||
      ctx.dataSource === 'SIMULATED';

    if (!isUsable || ctx.soilMoisture === null) {
      store.setValue('agent_IrrigationAgent_status', 'STANDBY_OFFLINE');
      store.setValue(
        'agent_IrrigationAgent_summary',
        ctx.dataSource === 'STALE'
          ? 'Standby — soil moisture reading is delayed (>45s). Waiting for fresh controller update.'
          : 'Standby — soil moisture telemetry is offline. Connect your controller or enable Practice Mode.'
      );
      store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
      return;
    }

    const soilMin = Number(store.getValue('soilMinThreshold')) || 45;
    const soilMax = Number(store.getValue('soilMaxThreshold')) || 65;

    if (ctx.waterLevel !== null && ctx.waterLevel < 10) {
      const msg = `Water tank critically low (${Math.round(ctx.waterLevel)}%). Refill reservoir before running irrigation pump.`;
      store.setValue('agent_IrrigationAgent_status', 'ALERT');
      store.setValue('agent_IrrigationAgent_summary', msg);
      store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
      return;
    }

    const decision = await evaluateAgentDecision('irrigation', {
      soilMoisture: ctx.soilMoisture,
      temperature: ctx.temperature ?? 25,
      humidity: ctx.humidity ?? 60,
      rain: ctx.rain ?? false,
      waterLevel: ctx.waterLevel ?? 75,
      cropType: ctx.cropType,
      soilMin,
      soilMax,
      dataSource: ctx.dataSource
    });

    const sourceTag = ctx.dataSource === 'SIMULATED' ? '[Practice Mode] ' : '';
    const shouldIrrigate = Boolean(decision?.irrigate);
    const safeDuration = Math.min(Number(decision?.durationSeconds) || 30, 120);
    const summaryText = shouldIrrigate
      ? `${sourceTag}Recommended ${safeDuration}s drip cycle: ${decision?.reason || 'Root-zone moisture is below target.'}`
      : `${sourceTag}${decision?.reason || `Soil moisture (${Math.round(ctx.soilMoisture)}%) is healthy within ${soilMin}–${soilMax}%.`}`;

    store.setValue('agent_IrrigationAgent_status', shouldIrrigate ? 'ALERT' : 'ADVISORY_READY');
    store.setValue('agent_IrrigationAgent_summary', summaryText);
    store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());

    if (shouldIrrigate) {
      const id = Date.now().toString();
      store.setRow('activityLog', id, {
        timestamp: new Date().toISOString(),
        type: 'agent',
        message: `${sourceTag}Irrigation Agent Advisory: ${decision?.reason || 'Soil dry'} (Recommended manual watering: ${safeDuration}s; pump was NOT triggered automatically.)`
      });
    }
  } catch (e: any) {
    console.warn('IrrigationAgent advisory error:', e?.message || e);
    store.setValue('agent_IrrigationAgent_status', 'ERROR');
  } finally {
    irrigationRunning = false;
  }
}

/**
 * IrrigationAgent — Advisory-Only Watering Monitor
 *
 * SAFETY POLICY: Never starts water pumps automatically. Writes advisory watering
 * recommendations based on verified or simulated soil moisture and reservoir level.
 */
export function IrrigationAgent() {
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void runIrrigationAgentCycle();
    }, 3500);
    const interval = setInterval(() => {
      void runIrrigationAgentCycle();
    }, 45000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return null;
}

export const useIrrigationAgent = IrrigationAgent;
