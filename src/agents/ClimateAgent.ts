import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_GEMINI_API_KEY || '') : ''),
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export function useClimateAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_ClimateAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;

      isRunning.current = true;
      try {
        const dataSource = hardwareService.getDataSource();
        const freshnessSec = hardwareService.getSensorFreshnessSeconds();

        // Safety Rule: Report when information is unavailable or stale.
        // Never send automated actuator commands on stale or disconnected telemetry.
        if (dataSource === 'DISCONNECTED' || freshnessSec > 35) {
          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent: Telemetry unavailable or stale (${freshnessSec}s old). Actuator commands suspended for hardware safety.`
          });
          return;
        }

        const temp = Number(store.getValue('temperature') ?? 24);
        const humidity = Number(store.getValue('humidity') ?? 60);
        const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
        const thermalLocked = store.getValue('hardware_thermalLocked') === true || temp > 32;

        const prompt = `You are EDENS AI Climate Agent, optimizing greenhouse ventilation and temperature for ${activeCrop}.
Current Telemetry (${dataSource}):
- Temperature: ${temp}°C
- Humidity: ${humidity}%
- Thermal Interlock: ${thermalLocked ? 'ACTIVE (Heater locked OFF)' : 'CLEAR'}
Optimal ranges for ${activeCrop}: Temp 20-28°C, Humidity 50-75%.

Safety Rules:
1. Never turn heater ON if temperature is above 26°C or if thermal interlock is active.
2. Turn fan ON if temp > 28°C or humidity > 75%.
3. Explain your exact reasoning with safety margins.
Return JSON: { "fan": "ON"|"OFF", "heater": "ON"|"OFF", "reason": "string" }`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                fan: { type: Type.STRING },
                heater: { type: Type.STRING },
                reason: { type: Type.STRING }
              },
              required: ["fan", "heater", "reason"]
            }
          }
        });

        if (response.text) {
          const result = JSON.parse(response.text.trim());
          
          // Safety override check: Never allow AI to violate thermal safety
          let targetHeater = result.heater;
          if (thermalLocked && targetHeater === 'ON') {
            targetHeater = 'OFF';
            result.reason += ' (Heater forced OFF by hardware thermal interlock)';
          }

          // Dispatch through hardwareService to enforce safety rules
          if (result.fan) {
            await hardwareService.setOverride('fan', result.fan === 'ON' ? 'on' : 'off');
          }
          if (targetHeater) {
            await hardwareService.setOverride('heater', targetHeater === 'ON' ? 'on' : 'off');
          }

          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent (${dataSource}): Fan ${result.fan}, Heater ${targetHeater} — ${result.reason}`
          });
        }
      } catch (err: any) {
        console.error("ClimateAgent execution failed:", err);
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
