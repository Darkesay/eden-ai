import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';

let climateAgentRunning = false;

export async function runClimateAgentCycle(options?: { force?: boolean }): Promise<void> {
  const isEnabled = store.getValue('agent_ClimateAgent_enabled') ?? true;
  if ((!isEnabled && !options?.force) || climateAgentRunning) return;
  if (store.getValue('autonomousPaused') === true && !options?.force) {
    store.setValue('agent_ClimateAgent_status', 'PAUSED');
    store.setValue('agent_ClimateAgent_summary', 'Automation hold is active.');
    return;
  }

  climateAgentRunning = true;
  try {
    const config = hardwareService.getConfig();
    const dataSource = hardwareService.getDataSource();
    const freshnessSec = hardwareService.getSensorFreshnessSeconds();
    const nowIso = new Date().toISOString();

    // Safety Rule: Never evaluate or dispatch actuator commands on disconnected or stale telemetry (>45s).
    if (dataSource === 'DISCONNECTED' || dataSource === 'STALE' || freshnessSec > 45) {
      const msg =
        dataSource === 'DISCONNECTED'
          ? 'Standing by — waiting for fresh Main ESP32 temperature and humidity check-in (or enable Practice Mode in Settings).'
          : `Telemetry is ${dataSource.toLowerCase()} (${freshnessSec}s old). Climate advisory paused until a fresh reading arrives.`;
      store.setValue('agent_ClimateAgent_lastRun', nowIso);
      store.setValue('agent_ClimateAgent_status', 'STANDBY');
      store.setValue('agent_ClimateAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ca', {
        timestamp: nowIso,
        type: 'agent',
        message: `Climate Agent: ${msg}`
      });
      return;
    }

    const tempAvailable =
      config.mode === 'simulation' || store.getValue('hardware_temperatureAvailable') !== false;
    const humAvailable =
      config.mode === 'simulation' || store.getValue('hardware_humidityAvailable') !== false;
    const rawTemp = store.getValue('temperature');
    const rawHum = store.getValue('humidity');

    if (!tempAvailable || rawTemp === undefined || rawTemp === null || !Number.isFinite(Number(rawTemp))) {
      const msg = 'Temperature sensor reading is unavailable — refusing to guess climate settings.';
      store.setValue('agent_ClimateAgent_lastRun', nowIso);
      store.setValue('agent_ClimateAgent_status', 'STANDBY');
      store.setValue('agent_ClimateAgent_summary', msg);
      store.setRow('activityLog', Date.now().toString() + 'ca', {
        timestamp: nowIso,
        type: 'agent',
        message: `Climate Agent: ${msg}`
      });
      return;
    }

    const temp = Number(rawTemp);
    const humidity =
      humAvailable && rawHum !== undefined && rawHum !== null && Number.isFinite(Number(rawHum))
        ? Number(rawHum)
        : null;
    const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
    const thermalLocked = store.getValue('hardware_thermalLocked') === true || temp > 32;

    const result = await evaluateAgentDecision<{ fan: string; heater: string; reason: string }>(
      'climate',
      {
        temperature: temp,
        humidity,
        activeCrop,
        dataSource,
        thermalLocked
      }
    );

    if (result) {
      let targetHeater = result.heater;
      if (thermalLocked && targetHeater === 'ON') {
        targetHeater = 'OFF';
        result.reason += ' (Heater forced OFF by >32°C hardware thermal interlock)';
      }

      // Phase 8 Safety: Physical hardware operates strictly in Read-Only / Advisory Only mode.
      // Autonomous actuation only runs inside explicitly labeled Simulation Mode.
      const canAutoDispatch = config.mode === 'simulation';
      if (canAutoDispatch) {
        if (result.fan) {
          await hardwareService.setOverride('fan', result.fan === 'ON' ? 'on' : 'off');
        }
        if (targetHeater) {
          await hardwareService.setOverride('heater', targetHeater === 'ON' ? 'on' : 'off');
        }
      }

      const summary = `Fan: ${result.fan} · Heater: ${targetHeater} — ${result.reason}`;
      store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
      store.setValue('agent_ClimateAgent_status', 'ADVISORY_READY');
      store.setValue('agent_ClimateAgent_summary', summary);
      store.setRow('activityLog', Date.now().toString() + 'ca', {
        timestamp: new Date().toISOString(),
        type: 'agent',
        message: `Climate Agent (${dataSource}${canAutoDispatch ? '' : ' · Advisory Only'}): ${summary}`
      });
    }
  } catch (err: any) {
    console.warn('ClimateAgent evaluation skipped:', err.message);
    store.setValue('agent_ClimateAgent_status', 'STANDBY');
    store.setValue(
      'agent_ClimateAgent_summary',
      `Waiting for next climate evaluation (${err?.message || 'check connection'}).`
    );
  } finally {
    climateAgentRunning = false;
  }
}

export function useClimateAgent() {
  useEffect(() => {
    const interval = setInterval(() => {
      void runClimateAgentCycle();
    }, 60000);
    const timeout = setTimeout(() => {
      void runClimateAgentCycle();
    }, 3500);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
