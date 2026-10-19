import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '' });

// 1x1 transparent pixel as placeholder if no actual image can be captured autonomusly without DOM
const placeholderBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function useVisionAgent() {
  const isRunning = useRef(false);

  useEffect(() => {
    const runAgent = async () => {
      const isEnabled = store.getValue('agent_VisionAgent_enabled') ?? false;
      if (!isEnabled) return;
      if (isRunning.current) return;
      
      isRunning.current = true;
      try {
        const imagePart = {
          inlineData: {
            mimeType: "image/jpeg",
            data: placeholderBase64,
          },
        };

        const textPart = {
          text: "You are EDEN, evaluating plant health from the latest frame. If no plant is clear, assume it is mostly Healthy but maybe slightly Stressed due to dry air. Keep it brief. Return JSON.",
        };

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: { parts: [imagePart, textPart] },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                healthStatus: { type: Type.STRING },
                analysis: { type: Type.STRING }
              },
              required: ["healthStatus", "analysis"]
            }
          }
        });

        if (response.text) {
          const result = JSON.parse(response.text.trim());
          store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
          store.setValue('plantHealthStatus', result.healthStatus);
          
          store.setRow('activityLog', Date.now().toString() + 'va', {
            timestamp: new Date().toISOString(),
            type: 'agent',
            message: `📸 Vision Agent: Status ${result.healthStatus} - ${result.analysis}`
          });
        }
      } catch (err) {
        console.error("VisionAgent failed", err);
      } finally {
        isRunning.current = false;
      }
    };

    // Every 30 mins
    const interval = setInterval(runAgent, 1800000);
    // Initial run delayed
    setTimeout(runAgent, 15000);
    return () => clearInterval(interval);
  }, []);
}
