import { useEffect } from 'react';
import { store } from '../lib/store';

export function useAlertAgent() {
  useEffect(() => {
    const runAgent = () => {
      const isEnabled = store.getValue('agent_AlertAgent_enabled') ?? false;
      if (!isEnabled) return;

      try {
        const temp = Number(store.getValue('temperature') || 22);
        const humidity = Number(store.getValue('humidity') || 50);
        const waterLvl = Number(store.getValue('waterLevel') || 80);
        const batt = Number(store.getValue('batteryVoltage') || 12);
        const plantHealth = store.getValue('plantHealthStatus') as string;

        const checkAlert = (id: string, condition: boolean, message: string, severity: 'warning' | 'critical') => {
          const table = store.getTable('alerts') || {};
          const now = new Date().toISOString();
          
          if (condition) {
            if (!table[id]) {
              store.setRow('alerts', id, { id, message, severity, timestamp: now });
              store.setRow('activityLog', Date.now().toString() + id, {
                timestamp: now,
                type: 'alert',
                message: `🚨 Alert Agent: ${message}`
              });
            }
          } else {
            if (table[id]) {
              store.delRow('alerts', id);
            }
          }
        };

        checkAlert('temp_high', temp > 35, 'Temperature critically high', 'critical');
        checkAlert('temp_low', temp < 10, 'Temperature critically low', 'critical');
        checkAlert('hum_high', humidity > 90, 'Humidity critically high', 'critical');
        checkAlert('hum_low', humidity < 20, 'Humidity critically low', 'critical');
        checkAlert('water_low', waterLvl < 15, 'Water reservoir low', 'warning');
        checkAlert('batt_low', batt < 10.5, 'Battery voltage critical', 'critical');
        checkAlert('health_stress', plantHealth === 'Severe stress', 'Plant shows severe stress', 'critical');

        store.setValue('agent_AlertAgent_lastRun', new Date().toISOString());
      } catch (err) {
        console.error("AlertAgent failed", err);
      }
    };

    const interval = setInterval(runAgent, 10000);
    setTimeout(runAgent, 3000);
    return () => clearInterval(interval);
  }, []);
}
