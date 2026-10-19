import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { useMqtt } from '../lib/mqtt';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '' });

export function useClimateAgent() {
  const { publish, status } = useMqtt();
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_ClimateAgent_enabled') ?? false;
      if (!isEnabled) return;
      if (isRunning.current) return;
      
      isRunning.current = true;
      try {
        const temp = store.getValue('temperature');
        const humidity = store.getValue('humidity');
        
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are EDEN, a greenhouse climate controller. Current temp is ${temp}°C, humidity ${humidity}%. Ideal: 22-28°C, 50-70%. Decide: turn fan ON/OFF, turn heater ON/OFF. Return JSON: { "fan": "ON"|"OFF", "heater": "ON"|"OFF", "reason": "string" }.`,
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
          
          if (result.fan) publish('greenhouse/control/fan', result.fan);
          if (result.heater) publish('greenhouse/control/heater', result.heater);
          
          store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
          
          store.setRow('activityLog', Date.now().toString() + 'ca', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `🤖 Climate Agent: Fan ${result.fan}, Heater ${result.heater} - ${result.reason}`
          });
        }
      } catch (err) {
        console.error("ClimateAgent failed", err);
      } finally {
        isRunning.current = false;
      }
    };

    const interval = setInterval(runAgent, 60000);
    // Initial run delayed
    setTimeout(runAgent, 5000);
    return () => clearInterval(interval);
  }, [publish, status]);
}
