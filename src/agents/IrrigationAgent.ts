import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { useMqtt } from '../lib/mqtt';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '' });

export function useIrrigationAgent() {
  const { publish, status } = useMqtt();
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_IrrigationAgent_enabled') ?? false;
      if (!isEnabled) return;
      if (isRunning.current) return;
      
      isRunning.current = true;
      try {
        const soilMoisture = store.getValue('soilMoisture') || 0;
        const rain = store.getValue('rain') || false;
        const temp = store.getValue('temperature') || 0;
        
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are EDEN. Soil moisture ${soilMoisture}%, rain detected: ${rain}, temp ${temp}°C. Decide: water pump ON/OFF, duration in seconds. Only water if soil < 30% AND no rain. Return JSON.`,
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
          
          if (result.pump) publish('greenhouse/control/pump', result.pump);
          
          store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
          
          store.setRow('activityLog', Date.now().toString() + 'ia', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `💧 Irrigation Agent: Pump ${result.pump} - ${result.reason}`
          });
        }
      } catch (err) {
        console.error("IrrigationAgent failed", err);
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 300000); // 5 mins
    setTimeout(runAgent, 6000);
    return () => clearInterval(interval);
  }, [publish, status]);
}
