import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { store } from './store';

type MqttStatus = 'connected' | 'error' | 'demo' | 'connecting';

interface MqttContextType {
  client: MqttClient | null;
  status: MqttStatus;
  publish: (topic: string, message: string) => void;
}

const MqttContext = createContext<MqttContextType>({
  client: null,
  status: 'connecting',
  publish: () => {},
});

export function useMqtt() {
  return useContext(MqttContext);
}

export function MqttProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<MqttClient | null>(null);
  const [status, setStatus] = useState<MqttStatus>('connecting');
  const retriesRef = useRef(0);
  const maxRetries = 3;
  const lastStateLogRef = useRef<Record<string, any>>({});

  useEffect(() => {
    let newClient: MqttClient | null = null;
    
    const connectMqtt = () => {
      const brokerUrl = import.meta.env.VITE_MQTT_BROKER_URL || 'wss://broker.hivemq.com:8884/mqtt';
      newClient = mqtt.connect(brokerUrl, {
        reconnectPeriod: 2000,
        connectTimeout: 10000,
      });

      newClient.on('connect', () => {
        setStatus('connected');
        retriesRef.current = 0;
        newClient?.subscribe('greenhouse/sensors');
        newClient?.subscribe('greenhouse/status');
        
        // initialize values if empty
        if (!store.getValue('temperature')) {
          store.setValue('temperature', 24);
          store.setValue('humidity', 62);
          store.setValue('soilMoisture', 50);
          store.setValue('sunlight', 650);
          store.setValue('growLight', 350);
          store.setValue('rain', false);
          store.setValue('rainGaugeLevel', 0);
          store.setValue('waterLevel', 72);
          store.setValue('batteryVoltage', 12.2);
          store.setValue('pumpActive', false);
          store.setValue('fanActive', false);
          store.setValue('lightActive', false);
          
          store.setValue('heaterActive', false);
          store.setValue('peltierActive', false);
          store.setValue('peltierFan1Active', false);
          store.setValue('peltierFan2Active', false);
          store.setValue('roofActive', false);
        }
      });

      newClient.on('message', (topic, message) => {
        const payloadStr = message.toString().trim();
        if (!payloadStr) return;

        const lower = payloadStr.toLowerCase();

        // Handle LWT and plain-text device heartbeat messages (e.g. "offline", "online")
        if (lower.includes('offline') || lower.includes('disconnected')) {
          store.setValue('hardware_dataSource', 'DISCONNECTED');
          return;
        }
        if (lower.includes('online') || lower.includes('connected')) {
          store.setValue('hardware_dataSource', 'REAL_HARDWARE');
          return;
        }

        // Strictly verify JSON format (starts with '{' or '[') before invoking JSON.parse
        if (!payloadStr.startsWith('{') && !payloadStr.startsWith('[')) {
          return;
        }

        // Parse JSON telemetry payloads safely
        let data: any = null;
        try {
          data = JSON.parse(payloadStr);
        } catch {
          return;
        }

        if (typeof data !== 'object' || data === null) return;

        if (topic === 'greenhouse/sensors') {
          if (data.temperature !== undefined) store.setValue('temperature', data.temperature);
          if (data.humidity !== undefined) store.setValue('humidity', data.humidity);
          if (data.soilMoisture !== undefined) store.setValue('soilMoisture', data.soilMoisture);
          if (data.sunlight !== undefined) store.setValue('sunlight', data.sunlight);
          if (data.growLight !== undefined) store.setValue('growLight', data.growLight);
          if (data.rain !== undefined) store.setValue('rain', data.rain);
          if (data.rainGaugeLevel !== undefined) store.setValue('rainGaugeLevel', data.rainGaugeLevel);
          if (data.waterLevel !== undefined) store.setValue('waterLevel', data.waterLevel);
          if (data.batteryVoltage !== undefined) store.setValue('batteryVoltage', data.batteryVoltage);

          // Update last seen for all registered devices to indicate connection activity
          const devicesTable = store.getTable('registeredDevices') || {};
          const now = new Date().toISOString();
          Object.keys(devicesTable).forEach(id => {
            store.setCell('registeredDevices', id, 'lastSeen', now);
          });
        }

        if (topic === 'greenhouse/status') {
          if (data.pumpActive !== undefined) store.setValue('pumpActive', data.pumpActive);
          if (data.fanActive !== undefined) store.setValue('fanActive', data.fanActive);
          if (data.lightActive !== undefined) store.setValue('lightActive', data.lightActive);
          if (data.heaterActive !== undefined) store.setValue('heaterActive', data.heaterActive);
          if (data.peltierActive !== undefined) store.setValue('peltierActive', data.peltierActive);
          if (data.peltierFan1Active !== undefined) store.setValue('peltierFan1Active', data.peltierFan1Active);
          if (data.peltierFan2Active !== undefined) store.setValue('peltierFan2Active', data.peltierFan2Active);
          if (data.roofActive !== undefined) store.setValue('roofActive', data.roofActive);
        }
      });

      newClient.on('error', (err) => {
        console.warn('MQTT connection fallback to DEMO mode:', err.message);
      });

      newClient.on('offline', () => {
        if (status !== 'demo') {
          retriesRef.current += 1;
          if (retriesRef.current >= maxRetries) {
            setStatus('demo');
            newClient?.end();
          } else {
             setStatus('error');
          }
        }
      });

      setClient(newClient);
    };

    connectMqtt();

    return () => {
      newClient?.end();
    };
  }, []);

  // Check thresholds
  useEffect(() => {
    const checkThresholds = () => {
      try {
        const temp = Number(store.getValue('temperature') || 0);
        const tempMin = Number(store.getValue('tempMinThreshold') || 18);
        const tempMax = Number(store.getValue('tempMaxThreshold') || 30);
        
        const hum = Number(store.getValue('humidity') || 0);
        const humMin = Number(store.getValue('humMinThreshold') || 40);
        const humMax = Number(store.getValue('humMaxThreshold') || 80);

        const states = lastStateLogRef.current;
        const now = new Date().toISOString();

        if (temp < tempMin && !states.tempCold) {
          store.setRow('activityLog', Date.now().toString() + 't1', { timestamp: now, type: 'warning', message: `Temperature dropped below minimum threshold (${tempMin}°C)` });
          states.tempCold = true;
          states.tempHot = false;
        } else if (temp > tempMax && !states.tempHot) {
          store.setRow('activityLog', Date.now().toString() + 't2', { timestamp: now, type: 'warning', message: `Temperature exceeded maximum threshold (${tempMax}°C)` });
          states.tempHot = true;
          states.tempCold = false;
        } else if (temp >= tempMin && temp <= tempMax) {
          if (states.tempCold || states.tempHot) {
             store.setRow('activityLog', Date.now().toString() + 't3', { timestamp: now, type: 'info', message: 'Temperature returned to normal range.' });
             states.tempCold = false;
             states.tempHot = false;
          }
        }
        
        if (hum < humMin && !states.humDry) {
          store.setRow('activityLog', Date.now().toString() + 'h1', { timestamp: now, type: 'warning', message: `Humidity dropped below minimum threshold (${humMin}%)` });
          states.humDry = true;
          states.humWet = false;
        } else if (hum > humMax && !states.humWet) {
          store.setRow('activityLog', Date.now().toString() + 'h2', { timestamp: now, type: 'warning', message: `Humidity exceeded maximum threshold (${humMax}%)` });
          states.humWet = true;
          states.humDry = false;
        } else if (hum >= humMin && hum <= humMax) {
          if (states.humDry || states.humWet) {
             store.setRow('activityLog', Date.now().toString() + 'h3', { timestamp: now, type: 'info', message: 'Humidity returned to normal range.' });
             states.humDry = false;
             states.humWet = false;
          }
        }
      } catch (e) {
        // ignore
      }
    };
    
    const interval = setInterval(checkThresholds, 5000);
    return () => clearInterval(interval);
  }, []);

  // Demo Mode Simulation
  useEffect(() => {
    if (status === 'demo') {
      // Initialize immediately
      if (!store.getValue('temperature')) {
        store.setValue('temperature', 24.5);
        store.setValue('humidity', 62);
        store.setValue('soilMoisture', 48);
        store.setValue('sunlight', 650);
        store.setValue('growLight', 380);
        store.setValue('rain', false);
        store.setValue('rainGaugeLevel', 25);
        store.setValue('waterLevel', 76);
        store.setValue('batteryVoltage', 12.3);
        
        const nowIso = new Date().toISOString();
        store.setValue('agent_ClimateAgent_lastRun', nowIso);
        store.setValue('agent_IrrigationAgent_lastRun', nowIso);
        store.setRow('activityLog', Date.now().toString() + 'ca_init', { timestamp: nowIso, type: 'info', message: '🤖 ClimateAgent: Optimal microclimate maintained. Adjusted ventilation.' });
        store.setRow('activityLog', Date.now().toString() + 'ia_init', { timestamp: nowIso, type: 'info', message: '💧 IrrigationAgent: Soil moisture optimal. No watering required.' });
        lastStateLogRef.current.lastClimateRun = Date.now();
        lastStateLogRef.current.lastIrrigationRun = Date.now();
      }

      const updateDemoState = () => {
        const t = Number(store.getValue('temperature') || 24.5);
        const h = Number(store.getValue('humidity') || 62);
        const rg = Number(store.getValue('rainGaugeLevel') || 25);
        const sl = Number(store.getValue('sunlight') || 650);
        const gl = Number(store.getValue('growLight') || 380);
        const bat = Number(store.getValue('batteryVoltage') || 12.3);
        const wl = Number(store.getValue('waterLevel') || 76);

        // Agents Logic
        const nowMs = Date.now();
        const states = lastStateLogRef.current;
        
        const proposeAction = (agent: string, actionDesc: string, topic: string, payload: string, reason: string, reading: string, isCritical: boolean = false) => {
            const autoApprove = store.getValue(`auto_approve_agent_${agent}`);
            const nowIso = new Date().toISOString();
            
            if (autoApprove) {
                // Execute immediately in demo mode simulation
                if (topic === 'greenhouse/control/pump') store.setValue('pumpActive', payload === 'ON');
                if (topic === 'greenhouse/control/fan') store.setValue('fanActive', payload === 'ON');
                if (topic === 'greenhouse/control/light') store.setValue('lightActive', payload === 'ON');
                if (topic === 'greenhouse/control/heater') store.setValue('heaterActive', payload === 'ON');
                if (topic === 'greenhouse/control/peltier') store.setValue('peltierActive', payload === 'ON');
                if (topic === 'greenhouse/control/peltier_fan1') store.setValue('peltierFan1Active', payload === 'ON');
                if (topic === 'greenhouse/control/peltier_fan2') store.setValue('peltierFan2Active', payload === 'ON');
                if (topic === 'greenhouse/control/roof') store.setValue('roofActive', payload === 'ON');
        
                store.setRow('activityLog', Date.now().toString() + Math.random().toString(36).substring(7), { 
                    timestamp: nowIso, 
                    type: 'info', 
                    message: `🤖 EDEN proposed: ${actionDesc} — ${reason}. ⚡ Auto-Approved.` 
                });
            } else {
                const id = Date.now().toString() + Math.random().toString(36).substring(7);
                store.setRow('pendingActions', id, {
                    id,
                    agent,
                    action: actionDesc,
                    topic,
                    payload,
                    reason,
                    reading,
                    timestamp: nowIso,
                    isCritical
                });
        
                if (store.getValue('browserNotifs') !== false && "Notification" in window && Notification.permission === "granted") {
                    new Notification(`EDEN Recommendation: ${actionDesc}`, {
                        body: reason
                    });
                }
            }
        };
        
        if (store.getValue('agent_ClimateAgent_enabled')) {
            if (!states.lastClimateRun || nowMs - states.lastClimateRun > 60000) {
               store.setValue('agent_ClimateAgent_lastRun', new Date().toISOString());
               states.lastClimateRun = nowMs;
               
               if (t > 30) {
                   proposeAction('ClimateAgent', 'Turn ON Circulation Fan', 'greenhouse/control/fan', 'ON', 'Temperature has risen to ' + t.toFixed(1) + '°C, which exceeds the maximum threshold of 30°C', t.toFixed(1) + '°C');
               } else if (t < 18) {
                   proposeAction('ClimateAgent', 'Turn ON Heater', 'greenhouse/control/heater', 'ON', 'Temperature dropped to ' + t.toFixed(1) + '°C, which is below the minimum threshold of 18°C', t.toFixed(1) + '°C');
               }
               
               if (h > 80) {
                   proposeAction('ClimateAgent', 'Turn ON Peltier Fan 1', 'greenhouse/control/peltier_fan1', 'ON', 'Humidity is high at ' + Math.round(h) + '%, exceeding 80%', Math.round(h) + '%');
               } else if (h < 40) {
                   proposeAction('ClimateAgent', 'Turn ON Humidifier', 'greenhouse/control/pump', 'ON', 'Humidity is low at ' + Math.round(h) + '%, below 40%', Math.round(h) + '%');
               }
            }
        }
        
        if (store.getValue('agent_IrrigationAgent_enabled')) {
            if (!states.lastIrrigationRun || nowMs - states.lastIrrigationRun > 300000) {
               store.setValue('agent_IrrigationAgent_lastRun', new Date().toISOString());
               states.lastIrrigationRun = nowMs;
               
               const soil = Number(store.getValue('soilMoisture') || 48);
               const isRaining = Boolean(store.getValue('rain'));
               if (soil < 30 && !isRaining) {
                   proposeAction('IrrigationAgent', 'Turn ON Water Pump for 15 seconds', 'greenhouse/control/pump', 'ON', 'Soil moisture at ' + Math.round(soil) + '%, below threshold of 30% and no rain detected', Math.round(soil) + '%');
               }
            }
        }
        
        // Vision Agent simulates random critical issues if auto scan is enabled
        if (store.getValue('agent_VisionAgent_enabled')) {
            if (!states.lastVisionRun || nowMs - states.lastVisionRun > 1800000) { // 30 mins
               store.setValue('agent_VisionAgent_lastRun', new Date().toISOString());
               states.lastVisionRun = nowMs;
               if (Math.random() > 0.8) {
                   proposeAction('VisionAgent', 'Send alert to farmer and request vet review', 'greenhouse/alert', 'SEVERE_STRESS', 'Plant health shows signs of Severe stress', 'Severe stress');
               }
            }
        }
        
        if (store.getValue('agent_AlertAgent_enabled')) {
            if (!states.lastAlertRun || nowMs - states.lastAlertRun > 120000) {
               store.setValue('agent_AlertAgent_lastRun', new Date().toISOString());
               states.lastAlertRun = nowMs;
               
               if (t > 35) proposeAction('AlertAgent', 'Activate Emergency Cooling', 'greenhouse/control/roof', 'ON', 'CRITICAL: Temperature at ' + t.toFixed(1) + '°C', t.toFixed(1) + '°C', true);
               else if (t < 10) proposeAction('AlertAgent', 'Activate Emergency Heating', 'greenhouse/control/heater', 'ON', 'CRITICAL: Temperature at ' + t.toFixed(1) + '°C', t.toFixed(1) + '°C', true);
               
               if (wl < 15) proposeAction('AlertAgent', 'Send Water Refill Alert', 'greenhouse/alert', 'WATER_LOW', 'CRITICAL: Water tank level at ' + Math.round(wl) + '%', Math.round(wl) + '%', true);
               if (bat < 10.5) proposeAction('AlertAgent', 'Send Battery Low Alert', 'greenhouse/alert', 'BATTERY_LOW', 'CRITICAL: Battery voltage at ' + bat.toFixed(1) + 'V', bat.toFixed(1) + 'V', true);
            }
        }

        if (store.getValue('agent_HarvestAgent_enabled')) {
            if (!states.lastHarvestRun || nowMs - states.lastHarvestRun > 21600000) { // 6 hours, or maybe 1 min for demo? Let's use 6 hours in ms, but we fire on first run
               store.setValue('agent_HarvestAgent_lastRun', new Date().toISOString());
               states.lastHarvestRun = nowMs;
               
               // Import is needed at top of file, but we can do dynamic import to avoid altering the top if we want, or just trigger an async function
               (async () => {
                   try {
                       const { predictHarvest } = await import('./gemini');
                       const cropType = String(store.getValue('cropType') || 'Tomato');
                       const plantingDate = String(store.getValue('plantingDate') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
                       const cropDaysMap: Record<string, number> = {
                         tomato: 70, pepper: 80, cucumber: 55, lettuce: 45, spinach: 40,
                         kale: 60, maize: 90, rice: 120, beans: 65, onion: 100, carrot: 75,
                         cabbage: 80, watermelon: 85, okra: 55, yam: 270, cassava: 365
                       };
                       const standardDays = cropDaysMap[cropType.toLowerCase()] || 70;

                       // Add some slight fluctuations for demo
                       const simTemp = 24.5 + (Math.random() * 1 - 0.5);
                       const simHum = 62 + (Math.random() * 4 - 2);
                       const simLight = 14.2 + (Math.random() * 0.4 - 0.2);
                       const simMoisture = 48 + (Math.random() * 2 - 1);

                       let prediction;
                       try {
                           prediction = await predictHarvest(cropType, plantingDate, standardDays, simTemp, simHum, simLight, simMoisture);
                       } catch(geminiError) {
                           console.error("Gemini failed, fallback to standard", geminiError);
                           // Fallback
                           const plantD = new Date(plantingDate);
                           const daysElapsed = Math.floor((Date.now() - plantD.getTime()) / (1000 * 60 * 60 * 24));
                           const daysRemaining = Math.max(0, standardDays - daysElapsed);
                           prediction = {
                               estimatedDaysTotal: standardDays,
                               daysSaved: 0,
                               daysRemaining,
                               estimatedHarvestDate: new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                               confidence: 50,
                               factors: [{ name: "Calendar based", impact: 0, explanation: "Fallback to standard calendar calculation due to AI unavailability." }]
                           };
                       }
                       
                       store.setValue('harvestPrediction', JSON.stringify(prediction));
                       store.setRow('activityLog', Date.now().toString() + 'ha', { timestamp: new Date().toISOString(), type: 'info', message: `🌾 Harvest Agent: Prediction updated. Estimated harvest in ${prediction.daysRemaining} days (${prediction.daysSaved} days saved vs. standard).` });

                       if (prediction.daysRemaining <= 5 && prediction.daysRemaining > 0) {
                           // Trigger checklist recommendation
                           proposeAction('HarvestAgent', 'Run Harvest Readiness Check', 'greenhouse/harvest/check', 'START', 'Harvest is predicted in ' + prediction.daysRemaining + ' days. Ready for final checks.', prediction.daysRemaining + ' days');
                       }
                   } catch(e) {
                       console.error("Harvest prediction failed", e);
                   }
               })();
            }
        }

        // Adjust temp mapping if heater or peltier is active
        let tDelta = (Math.random() - 0.5) * 0.5;
        if (store.getValue('heaterActive')) tDelta += 0.5;
        if (store.getValue('peltierActive')) tDelta -= 0.5;
        
        // Boundaries: 22-26 if no active heating/cooling
        let newTemp = t + tDelta;
        if (!store.getValue('heaterActive') && !store.getValue('peltierActive')) {
          if (newTemp > 26) newTemp -= 0.5;
          if (newTemp < 22) newTemp += 0.5;
        }
        
        let newHum = h + (Math.random() - 0.5) * 2;
        if (newHum > 70) newHum -= 1;
        if (newHum < 55) newHum += 1;

        store.setValue('temperature', Number(newTemp.toFixed(1)));
        store.setValue('humidity', Math.max(0, Math.min(100, Math.round(newHum))));
        
        let newSl = sl + (Math.random() - 0.5) * 50;
        if (newSl > 900) newSl -= 20;
        if (newSl < 400) newSl += 20;
        store.setValue('sunlight', Math.round(newSl));
        
        let newGl = gl + (Math.random() - 0.5) * 10;
        if (store.getValue('lightActive')) {
           newGl = 450 + (Math.random() * 50);
        } else {
            if (newGl > 500) newGl -= 10;
            if (newGl < 200) newGl += 10;
        }
        store.setValue('growLight', Math.round(newGl));
        
        // battery fluctuation 11.8 - 12.6
        let newBat = bat + (Math.random() - 0.5) * 0.05;
        if (newBat > 12.6) newBat -= 0.05;
        if (newBat < 11.8) newBat += 0.05;
        store.setValue('batteryVoltage', Number(newBat.toFixed(2)));
        
        const r = Math.random() > 0.95;
        const previouslyRaining = Boolean(store.getValue('rain'));
        
        store.setValue('rain', r);
        
        if (r && !previouslyRaining && !lastStateLogRef.current.rainStart) {
          store.setRow('activityLog', Date.now().toString() + 'r1', { timestamp: new Date().toISOString(), type: 'info', message: 'Precipitation detected. Tracking rain gauge.' });
          lastStateLogRef.current.rainStart = true;
        } else if (!r && previouslyRaining) {
          lastStateLogRef.current.rainStart = false;
        }

        if (r) {
           let newWl = wl + 0.5;
           if (newWl > 85) newWl = 85;
           store.setValue('waterLevel', Number(newWl.toFixed(1)));
           let newRg = rg + Math.random() * 2;
           if (newRg > 100) newRg = 100;
           store.setValue('rainGaugeLevel', Number(newRg.toFixed(1)));
        } else {
           let newWl = wl - 0.1;
           if (newWl < 60) newWl = 60;
           store.setValue('waterLevel', Number(newWl.toFixed(1)));
        }

        // Soil moisture 35-65%
        let soil = Number(store.getValue('soilMoisture') || 48);
        if (store.getValue('pumpActive')) soil += 2;
        else soil -= 0.5 * Math.random();
        if (!store.getValue('pumpActive')) {
           if (soil > 65) soil -= 1;
           if (soil < 35) soil += 1;
        }
        store.setValue('soilMoisture', Math.max(0, Math.min(100, Math.round(soil))));

        // Sunlight 400-900 lux
        let sun = Number(store.getValue('sunlight') || 650) + (Math.random() - 0.5) * 50;
        if (sun > 900) sun = 900;
        if (sun < 400) sun = 400;
        store.setValue('sunlight', Math.round(sun));

        // Grow Light 200-500 lux
        let gLight = Number(store.getValue('growLight') || 350) + (Math.random() - 0.5) * 20;
        if (store.getValue('lightActive')) {
           if (gLight > 500) gLight = 500;
           if (gLight < 200) gLight += 10;
        } else {
           gLight = 0;
        }
        store.setValue('growLight', Math.round(gLight));

        // Battery 11.8 - 12.6V
        let batt = Number(store.getValue('batteryVoltage') || 12.2) + (Math.random() - 0.5) * 0.05;
        if (batt > 12.6) batt = 12.6;
        if (batt < 11.8) batt = 11.8;
        store.setValue('batteryVoltage', Number(batt.toFixed(2)));

        // Demo device connection activity
        const devicesTable = store.getTable('registeredDevices') || {};
        const now = new Date().toISOString();
        Object.keys(devicesTable).forEach(id => {
          store.setCell('registeredDevices', id, 'lastSeen', now);
        });

      };

      updateDemoState();
      const interval = setInterval(updateDemoState, 3000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const publish = (topic: string, message: string) => {
    if (status === 'demo') {
      // simulate local state updates in demo mode based on topics
      if (topic === 'greenhouse/control/pump') store.setValue('pumpActive', message === 'ON');
      if (topic === 'greenhouse/control/fan') store.setValue('fanActive', message === 'ON');
      if (topic === 'greenhouse/control/light') store.setValue('lightActive', message === 'ON');
      
      if (topic === 'greenhouse/control/heater') store.setValue('heaterActive', message === 'ON');
      if (topic === 'greenhouse/control/peltier') store.setValue('peltierActive', message === 'ON');
      if (topic === 'greenhouse/control/peltier_fan1') store.setValue('peltierFan1Active', message === 'ON');
      if (topic === 'greenhouse/control/peltier_fan2') store.setValue('peltierFan2Active', message === 'ON');
      if (topic === 'greenhouse/control/roof') store.setValue('roofActive', message === 'ON');
      
      return;
    }
    if (client && client.connected) {
      client.publish(topic, message, { qos: 0 }, (error) => {
         if(error) {
            console.error("Publish failed", error);
         }
      });
    }
  };

  return (
    <MqttContext.Provider value={{ client, status, publish }}>
      {children}
    </MqttContext.Provider>
  );
}
