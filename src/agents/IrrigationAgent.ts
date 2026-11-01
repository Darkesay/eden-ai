import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';

let irrigationAgentRunning = false;

export async function runIrrigationAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_IrrigationAgent_enabled') ?? true;
  if ((!isEnabled && !options?.force) || irrigationAgentRunning) return;
  if (store.getValue('autonomousPaused') === true && !options?.force) {
    store.setValue('agent_IrrigationAgent_status', 'PAUSED');
    store.setValue('agent_IrrigationAgent_summary', 'Automation hold is active.');
    return;
  }

  irrigationAgentRunning = true;
  try {
    const config = hardwareService.getConfig();
    const dataSource = hardwareService.getDataSource();
    const freshnessSec = hardwareService.getSensorFreshnessSeconds();
    const nowIso = new Date().toISOString();

    // Safety Rule 1: Never evaluate on stale (>45s) or disconnected telemetry.
    if (dataSource === 'DISCONNECTED' || dataSource === 'STALE' || freshnessSec > 45) {
      const msg =
        dataSource === 'DISCONNECTED'
          ? 'Standing by — waiting for fresh Main ESP32 soil moisture and water tank readings (or enable Practice Mode).'
          : `Telemetry is ${dataSource.toLowerCase()} (${freshnessSec}s old). Irrigation advisory suspended for crop safety.`;
      store.setValue('agent_IrrigationAgent_lastRun', nowIso);
      store.setValue('agent_IrrigationAgent_status', 'STANDBY');
      store.setValue('agent_IrrigationAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ia', {
        timestamp: nowIso,
        type: 'agent',
        message: `Irrigation Agent: ${msg}`
      });
      return;
    }

    const soilAvailable =
      config.mode === 'simulation' || store.getValue('hardware_soilMoistureAvailable') !== false;
    const rawSoil = store.getValue('soilMoisture');
    if (!soilAvailable || rawSoil === undefined || rawSoil === null || !Number.isFinite(Number(rawSoil))) {
      const msg = 'Soil moisture sensor reading is unavailable — refusing to fabricate watering advice.';
      store.setValue('agent_IrrigationAgent_lastRun', nowIso);
      store.setValue('agent_IrrigationAgent_status', 'STANDBY');
      store.setValue('agent_IrrigationAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ia', {
        timestamp: nowIso,
        type: 'agent',
        message: `Irrigation Agent: ${msg}`
      });
      return;
    }

    const soilMoisture = Number(rawSoil);
    const rain = store.getValue('rain') === true;
    const tempAvailable =
      config.mode === 'simulation' || store.getValue('hardware_temperatureAvailable') !== false;
    const rawTemp = store.getValue('temperature');
    const temp =
      tempAvailable && rawTemp !== undefined && rawTemp !== null && Number.isFinite(Number(rawTemp))
        ? Number(rawTemp)
        : null;

    const waterAvailable =
      config.mode === 'simulation' || store.getValue('hardware_waterLevelAvailable') !== false;
    const rawWater = store.getValue('waterLevel');
    const waterLevel =
      waterAvailable && rawWater !== undefined && rawWater !== null && Number.isFinite(Number(rawWater))
        ? Number(rawWater)
        : null;

    const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
    const waterLowLocked =
      store.getValue('hardware_waterLowLocked') === true || (waterLevel !== null && waterLevel < 10);

    // Safety Rule 2: Physical Reservoir Interlock (including exact 0% reservoir reading)
    if (waterLowLocked) {
      const msg = `Water tank critically low (${waterLevel !== null ? `${waterLevel}%` : '<10%'}). Drip pump locked OFF to prevent dry-run damage.`;
      store.setValue('agent_IrrigationAgent_lastRun', nowIso);
      store.setValue('agent_IrrigationAgent_status', 'ALERT');
      store.setValue('agent_IrrigationAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ia', {
        timestamp: nowIso,
        type: 'alert',
        message: `Irrigation Agent: ${msg}`
      });
      return;
    }

    // Safety Rule 3: Do not irrigate if rain is actively detected
    if (rain) {
      const msg = 'Rain detected by weather sensor. Irrigation suspended to prevent waterlogging and root rot.';
      store.setValue('agent_IrrigationAgent_lastRun', nowIso);
      store.setValue('agent_IrrigationAgent_status', 'ADVISORY_READY');
      store.setValue('agent_IrrigationAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ia', {
        timestamp: nowIso,
        type: 'agent',
        message: `Irrigation Agent: ${msg}`
      });
      return;
    }

    const result = await evaluateAgentDecision<{ pump: string; duration: number; reason: string }>(
      'irrigation',
      {
        soilMoisture,
        rain,
        temperature: temp,
        waterLevel,
        activeCrop,
        dataSource
      }
    );

    if (result) {
      let targetPump = result.pump;
      const safeDuration = Math.min(120, Math.max(0, result.duration || 0));

      if (waterLowLocked && targetPump === 'ON') {
        targetPump = 'OFF';
        result.reason += ' (Blocked by physical water reservoir safety interlock)';
      }

      if (rain && targetPump === 'ON') {
        targetPump = 'OFF';
        result.reason += ' (Blocked: rain detected)';
      }

      // Phase 8 Safety: Physical hardware operates strictly in Read-Only / Advisory Only mode.
      const canAutoDispatch = config.mode === 'simulation';
      if (canAutoDispatch) {
        if (targetPump === 'ON') {
          await hardwareService.setOverride('pump', 'on', safeDuration);
        } else {
          await hardwareService.setOverride('pump', 'off');
        }
      }

      const summary = `Pump: ${targetPump}${targetPump === 'ON' ? ` (${safeDuration}s)` : ''} — ${result.reason}`;
      store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
      store.setValue('agent_IrrigationAgent_status', 'ADVISORY_READY');
      store.setValue('agent_IrrigationAgent_summary', summary);
      store.setRow('activityLog', Date.now().toString() + 'ia', {
        timestamp: new Date().toISOString(),
        type: 'agent',
        message: `Irrigation Agent (${dataSource}${canAutoDispatch ? '' : ' · Advisory Only'}): ${summary}`
      });
    }
  } catch (err: any) {
    console.warn('IrrigationAgent evaluation skipped:', err.message);
    store.setValue('agent_IrrigationAgent_status', 'STANDBY');
    store.setValue(
      'agent_IrrigationAgent_summary',
      `Waiting for next watering evaluation (${err?.message || 'check connection'}).`
    );
  } finally {
    irrigationAgentRunning = false;
  }
}

export function useIrrigationAgent() {
  useEffect(() => {
    const interval = setInterval(() => {
      void runIrrigationAgentCycle();
    }, 180000);
    const timeout = setTimeout(() => {
      void runIrrigationAgentCycle();
    }, 5500);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
