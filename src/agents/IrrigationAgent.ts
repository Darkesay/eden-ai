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

export function useIrrigationAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_IrrigationAgent_enabled') ?? false;
      if (!isEnabled || isRunning.current) return;

      isRunning.current = true;
      try {
        const dataSource = hardwareService.getDataSource();
        const freshnessSec = hardwareService.getSensorFreshnessSeconds();

        // Safety Rule 1: Report when information is unavailable or stale.
        // Never send automated actuator commands on stale or disconnected telemetry.
        if (dataSource === 'DISCONNECTED' || freshnessSec > 35) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Irrigation Agent: Telemetry unavailable or stale (${freshnessSec}s old). Irrigation decisions suspended for crop safety.`
          });
          return;
        }

        const soilMoisture = Number(store.getValue('soilMoisture') ?? 50);
        const rain = store.getValue('rain') === true;
        const temp = Number(store.getValue('temperature') ?? 24);
        const waterLevel = Number(store.getValue('waterLevel') ?? 70);
        const activeCrop = (store.getValue('cropType') as string) || 'Tomato';
        const waterLowLocked = waterLevel < 10;

        // Safety Rule 2: Physical Reservoir Interlock
        if (waterLowLocked) {
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'alert',
            message: `🚨 Irrigation Agent: Reservoir level critically low (${waterLevel}%). Pump activation locked by safety interlock.`
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

        const prompt = `You are EDENS AI Irrigation Agent, managing precision drip irrigation for ${activeCrop}.
Current Telemetry (${dataSource}):
- Soil Moisture: ${soilMoisture}%
- Ambient Temperature: ${temp}°C
- Rain Detected: ${rain}
- Reservoir Water Level: ${waterLevel}%
- Reservoir Interlock: ${waterLowLocked ? 'LOCKED (Low Water)' : 'CLEAR'}
Optimal soil moisture for ${activeCrop}: 45-65%.

Safety Rules:
1. ONLY recommend pump "ON" if soil moisture is strictly below 40% and reservoir > 15%.
2. Duration MUST NOT exceed 120 seconds to prevent over-irrigation.
3. If soil moisture is adequate, pump MUST be "OFF".
4. State your agronomic reason clearly.

Return JSON: { "pump": "ON"|"OFF", "duration": number, "reason": "string" }`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                pump: { type: Type.STRING },
                duration: { type: Type.NUMBER },
                reason: { type: Type.STRING }
              },
              required: ["pump", "duration", "reason"]
            }
          }
        });

        if (response.text) {
          const result = JSON.parse(response.text.trim());
          
          let targetPump = result.pump;
          let safeDuration = Math.min(120, Math.max(0, result.duration || 0));

          // Enforce firmware safety restrictions
          if (waterLowLocked && targetPump === 'ON') {
            targetPump = 'OFF';
            result.reason += ' (Blocked by physical water reservoir safety interlock)';
          }

          if (rain && targetPump === 'ON') {
            targetPump = 'OFF';
            result.reason += ' (Blocked: rain detected)';
          }

          // Dispatch command via hardware service
          if (targetPump === 'ON') {
            await hardwareService.setOverride('pump', 'on', safeDuration);
          } else {
            await hardwareService.setOverride('pump', 'off');
          }

          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `💧 Irrigation Agent (${dataSource}): Pump ${targetPump} (${safeDuration}s) — ${result.reason}`
          });
        }
      } catch (err: any) {
        console.error("IrrigationAgent execution failed:", err);
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 180000); // Check every 3 mins
    const timeout = setTimeout(runAgent, 7000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
