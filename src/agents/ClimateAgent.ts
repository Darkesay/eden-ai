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

        // Safety Rule: Never evaluate or dispatch actuator commands on disconnected or stale telemetry.
        if (dataSource === 'DISCONNECTED' || dataSource === 'STALE' || freshnessSec > 35) {
          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent: Telemetry ${dataSource.toLowerCase()} (${freshnessSec}s old). Actuator commands suspended for hardware safety.`
          });
          return;
        }

        const temp = Number(store.getValue('temperature') ?? 24);
        const humidity = Number(store.getValue('humidity') ?? 60);
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

          // Only dispatch to physical hardware if user explicitly enabled auto-approve for ClimateAgent
          const canAutoDispatch = config.mode === 'simulation' || store.getValue('auto_approve_agent_ClimateAgent') === true;
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
            message: `🤖 Climate Agent (${dataSource}${canAutoDispatch ? '' : ' · Advisory Only'}): Fan ${result.fan}, Heater ${targetHeater} — ${result.reason}`
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
