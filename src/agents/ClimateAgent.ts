import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';

export function useClimateAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_ClimateAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;
      if (store.getValue('autonomousPaused') === true) return;

      isRunning.current = true;
      try {
        const config = hardwareService.getConfig();
        const dataSource = hardwareService.getDataSource();
        const freshnessSec = hardwareService.getSensorFreshnessSeconds();

        // Safety Rule: Never evaluate or dispatch actuator commands on disconnected or stale telemetry (>45s).
        if (dataSource === 'DISCONNECTED' || dataSource === 'STALE' || freshnessSec > 45) {
          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent: Telemetry ${dataSource.toLowerCase()} (${freshnessSec}s old). Advisory evaluation suspended until fresh packet arrives.`
          });
          return;
        }

        const tempAvailable = config.mode === 'simulation' || store.getValue('hardware_temperatureAvailable') !== false;
        const humAvailable = config.mode === 'simulation' || store.getValue('hardware_humidityAvailable') !== false;
        const rawTemp = store.getValue('temperature');
        const rawHum = store.getValue('humidity');

        if (!tempAvailable || rawTemp === undefined || rawTemp === null || !Number.isFinite(Number(rawTemp))) {
          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent: Temperature sensor unavailable. Refusing to fabricate readings.`
          });
          return;
        }

        const temp = Number(rawTemp);
        const humidity = humAvailable && rawHum !== undefined && rawHum !== null && Number.isFinite(Number(rawHum))
          ? Number(rawHum)
          : null;
        const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
        const thermalLocked = store.getValue('hardware_thermalLocked') === true || temp > 32;

        const result = await evaluateAgentDecision<{ fan: string; heater: string; reason: string }>('climate', {
          temperature: temp,
          humidity,
          activeCrop,
          dataSource,
          thermalLocked
        });

        if (result) {
          let targetHeater = result.heater;
          if (thermalLocked && targetHeater === 'ON') {
            targetHeater = 'OFF';
            result.reason += ' (Heater forced OFF by hardware thermal interlock)';
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

          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent (${dataSource}${canAutoDispatch ? '' : ' · Advisory Only — No Physical Actuation'}): Fan ${result.fan}, Heater ${targetHeater} — ${result.reason}`
          });
        }
      } catch (err: any) {
        console.warn('ClimateAgent evaluation skipped:', err.message);
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 60000);
    const timeout = setTimeout(runAgent, 4000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
