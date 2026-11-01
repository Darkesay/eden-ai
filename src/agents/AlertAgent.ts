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

        const hasLiveSignal = config.mode === 'simulation' || dataSource === 'REAL_HARDWARE' || dataSource === 'CACHED';
        const tempAvailable = hasLiveSignal && (config.mode === 'simulation' || store.getValue('hardware_temperatureAvailable') !== false);
        const humAvailable = hasLiveSignal && (config.mode === 'simulation' || store.getValue('hardware_humidityAvailable') !== false);
        const waterAvailable = hasLiveSignal && (config.mode === 'simulation' || store.getValue('hardware_waterLevelAvailable') !== false);
        const battAvailable = hasLiveSignal && (config.mode === 'simulation' || store.getValue('hardware_batteryAvailable') !== false);

        const rawTemp = store.getValue('temperature');
        const rawHum = store.getValue('humidity');
        const rawWater = store.getValue('waterLevel');
        const rawBatt = store.getValue('batteryVoltage');

        const temp = tempAvailable && rawTemp !== undefined && rawTemp !== null && Number.isFinite(Number(rawTemp)) ? Number(rawTemp) : null;
        const humidity = humAvailable && rawHum !== undefined && rawHum !== null && Number.isFinite(Number(rawHum)) ? Number(rawHum) : null;
        const waterLvl = waterAvailable && rawWater !== undefined && rawWater !== null && Number.isFinite(Number(rawWater)) ? Number(rawWater) : null;
        const batt = battAvailable && rawBatt !== undefined && rawBatt !== null && Number.isFinite(Number(rawBatt)) ? Number(rawBatt) : null;
        const rain = hasLiveSignal && store.getValue('rain') === true;
        const roofOpen = hasLiveSignal && store.getValue('roofActive') === true;
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

        // Environmental condition alerts (only evaluated when the corresponding sensor is genuinely reported)
        checkAlert('temp_high', temp !== null && temp > 35, `Temperature critically high (${temp ?? 0}°C). Heat damage risk.`, 'critical');
        checkAlert('temp_low', temp !== null && temp < 10, `Temperature critically low (${temp ?? 0}°C). Cold shock risk.`, 'critical');
        checkAlert('hum_high', humidity !== null && humidity > 90, `Humidity critically high (${humidity ?? 0}%). Fungal pathogen risk.`, 'warning');
        checkAlert('hum_low', humidity !== null && humidity < 25, `Humidity critically low (${humidity ?? 0}%). Foliage desiccation risk.`, 'warning');
        checkAlert('water_crit_low', waterLvl !== null && waterLvl < 10, `Irrigation reservoir critically low (${waterLvl ?? 0}%). Pump locked off.`, 'critical');
        checkAlert('water_warn_low', waterLvl !== null && waterLvl >= 10 && waterLvl < 20, `Water reservoir running low (${waterLvl ?? 0}%). Refill advised.`, 'warning');
        checkAlert('batt_low', batt !== null && batt < 10.8, `Battery voltage critical (${batt !== null ? batt.toFixed(1) : '0.0'}V). Controller brownout risk.`, 'critical');
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
