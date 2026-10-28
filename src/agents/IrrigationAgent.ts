import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { evaluateAgentDecision } from '../lib/gemini';

export function useIrrigationAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_IrrigationAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;
      if (store.getValue('autonomousPaused') === true) return;

      isRunning.current = true;
      try {
        const config = hardwareService.getConfig();
        const dataSource = hardwareService.getDataSource();
        const freshnessSec = hardwareService.getSensorFreshnessSeconds();

        // Safety Rule 1: Never evaluate on stale (>45s) or disconnected telemetry.
        if (dataSource === 'DISCONNECTED' || dataSource === 'STALE' || freshnessSec > 45) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Irrigation Agent: Telemetry ${dataSource.toLowerCase()} (${freshnessSec}s old). Irrigation advisory suspended for crop safety.`
          });
          return;
        }

        const soilAvailable = config.mode === 'simulation' || store.getValue('hardware_soilMoistureAvailable') !== false;
        const rawSoil = store.getValue('soilMoisture');
        if (!soilAvailable || rawSoil === undefined || rawSoil === null || !Number.isFinite(Number(rawSoil))) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Irrigation Agent: Soil moisture sensor unavailable. Refusing to fabricate irrigation decision.`
          });
          return;
        }

        const soilMoisture = Number(rawSoil);
        const rain = store.getValue('rain') === true;
        const tempAvailable = config.mode === 'simulation' || store.getValue('hardware_temperatureAvailable') !== false;
        const rawTemp = store.getValue('temperature');
        const temp = tempAvailable && rawTemp !== undefined && rawTemp !== null && Number.isFinite(Number(rawTemp))
          ? Number(rawTemp)
          : null;

        const waterAvailable = config.mode === 'simulation' || store.getValue('hardware_waterLevelAvailable') !== false;
        const rawWater = store.getValue('waterLevel');
        const waterLevel = waterAvailable && rawWater !== undefined && rawWater !== null && Number.isFinite(Number(rawWater))
          ? Number(rawWater)
          : null;

        const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
        const waterLowLocked =
          store.getValue('hardware_waterLowLocked') === true || (waterLevel !== null && waterLevel < 10);

        // Safety Rule 2: Physical Reservoir Interlock (including exact 0% reservoir reading)
        if (waterLowLocked) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'alert',
            message: `🚨 Irrigation Agent: Reservoir level critically low (${waterLevel !== null ? `${waterLevel}%` : '<10%'}). Pump activation locked by safety interlock.`
          });
          return;
        }

        // Safety Rule 3: Do not irrigate if rain is actively detected
        if (rain) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🌧️ Irrigation Agent: Rain detected by precipitation sensor. Irrigation suspended to prevent root rot.`
          });
          return;
        }

        const result = await evaluateAgentDecision<{ pump: string; duration: number; reason: string }>('irrigation', {
          soilMoisture,
          rain,
          temperature: temp,
          waterLevel,
          activeCrop,
          dataSource
        });

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

          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `💧 Irrigation Agent (${dataSource}${canAutoDispatch ? '' : ' · Advisory Only — No Physical Actuation'}): Pump ${targetPump} (${safeDuration}s) — ${result.reason}`
          });
        }
      } catch (err: any) {
        console.warn('IrrigationAgent evaluation skipped:', err.message);
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 180000);
    const timeout = setTimeout(runAgent, 7000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
