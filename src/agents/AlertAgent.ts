import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';

export function useAlertAgent() {
  useEffect(() => {
    const runAgent = () => {
      const isEnabled = store.getValue('agent_AlertAgent_enabled') ?? false;
      if (!isEnabled) return;

      try {
        const dataSource = hardwareService.getDataSource();
        const freshnessSec = hardwareService.getSensorFreshnessSeconds();
        const config = hardwareService.getConfig();

        const temp = Number(store.getValue('temperature') ?? 22);
        const humidity = Number(store.getValue('humidity') ?? 50);
        const waterLvl = Number(store.getValue('waterLevel') ?? 80);
        const batt = Number(store.getValue('batteryVoltage') ?? 12);
        const rain = store.getValue('rain') === true;
        const roofOpen = store.getValue('roofActive') === true;
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

        // Hardware connection alerts
        checkAlert(
          'hw_disconnected',
          config.mode !== 'simulation' && dataSource === 'DISCONNECTED',
          'Main ESP32 controller is disconnected. Telemetry halted.',
          'critical'
        );

        checkAlert(
          'hw_stale_telemetry',
          config.mode !== 'simulation' && (dataSource === 'CACHED' || dataSource === 'STALE') && freshnessSec > 20,
          `Sensor readings are stale (${freshnessSec}s since last packet). Reconnecting to ESP32...`,
          'warning'
        );

        // Safety interlock emergency alert: Rain while roof is open
        checkAlert(
          'emergency_rain_roof',
          rain && roofOpen,
          'CRITICAL: Rain detected while greenhouse roof is open! Emergency roof closure engaged.',
          'critical'
        );

        // Environmental condition alerts
        checkAlert('temp_high', temp > 35, `Temperature critically high (${temp}°C). Heat damage risk.`, 'critical');
        checkAlert('temp_low', temp < 10, `Temperature critically low (${temp}°C). Cold shock risk.`, 'critical');
        checkAlert('hum_high', humidity > 90, `Humidity critically high (${humidity}%). Fungal pathogen risk.`, 'warning');
        checkAlert('hum_low', humidity < 25, `Humidity critically low (${humidity}%). Foliage desiccation risk.`, 'warning');
        checkAlert('water_crit_low', waterLvl < 10, `Irrigation reservoir critically low (${waterLvl}%). Pump locked off.`, 'critical');
        checkAlert('water_warn_low', waterLvl >= 10 && waterLvl < 20, `Water reservoir running low (${waterLvl}%). Refill advised.`, 'warning');
        checkAlert('batt_low', batt < 10.8, `Battery voltage critical (${batt.toFixed(1)}V). Controller brownout risk.`, 'critical');
        checkAlert('health_stress', plantHealth === 'Severe stress', 'Plant visual analysis indicates severe foliage stress.', 'critical');

        store.setValue('agent_AlertAgent_lastRun', new Date().toISOString());
      } catch (err) {
        console.error("AlertAgent failed", err);
      }
    };

    const interval = setInterval(runAgent, 8000);
    const timeout = setTimeout(runAgent, 3000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
