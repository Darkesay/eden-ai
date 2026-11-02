import { useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { resolveAgentTelemetryContext } from './agentTelemetryContext';

const lastAlertTimestamps = new Map<string, number>();

export async function runAlertAgentCycle(options?: {
  force?: boolean;
  allowNotifications?: boolean;
}): Promise<string[]> {
  const isEnabled = store.getValue('agent_AlertAgent_enabled') !== false;
  if (!isEnabled && !options?.force) return [];

  const ctx = await resolveAgentTelemetryContext();
  const isUsable =
    ctx.dataSource === 'REAL_HARDWARE' ||
    ctx.dataSource === 'CACHED' ||
    ctx.dataSource === 'SIMULATED';

  if (!isUsable) {
    store.setValue('agent_AlertAgent_status', 'STANDBY_OFFLINE');
    store.setValue(
      'agent_AlertAgent_summary',
      ctx.dataSource === 'STALE'
        ? 'Standby — controller reading is delayed (>45s). Waiting for fresh check-in.'
        : 'Standby — waiting for live greenhouse readings or Practice Mode.'
    );
    store.setValue('agent_AlertAgent_lastRun', new Date().toISOString());
    return [];
  }

  const tempMax = Number(store.getValue('tempMaxThreshold')) || 30;
  const tempMin = Number(store.getValue('tempMinThreshold')) || 16;
  const humMax = Number(store.getValue('humMaxThreshold')) || 82;

  const warnings: string[] = [];

  if (ctx.temperature !== null && ctx.temperature > tempMax + 2) {
    warnings.push(
      `High canopy heat (${ctx.temperature.toFixed(1)}°C > ${tempMax}°C max). Open roof vents or run circulation fans.`
    );
  } else if (ctx.temperature !== null && ctx.temperature < Math.max(10, tempMin - 2)) {
    warnings.push(
      `Low greenhouse temperature (${ctx.temperature.toFixed(1)}°C < ${tempMin}°C min). Close vents to retain warmth.`
    );
  }

  if (ctx.humidity !== null && ctx.humidity > Math.max(85, humMax)) {
    warnings.push(
      `High air humidity (${Math.round(ctx.humidity)}%) increases fungal blight risk. Improve airflow.`
    );
  }

  if (ctx.waterLevel !== null && ctx.waterLevel < 10) {
    warnings.push(
      `Water tank critically low (${Math.round(ctx.waterLevel)}%). Hardware pump lock is active to prevent dry running.`
    );
  }

  if (ctx.rain === true && ctx.roofActive) {
    warnings.push('Rain detected while roof vent is open. Close roof vent immediately.');
  }

  if (ctx.batteryVoltage !== null && ctx.batteryVoltage > 0 && ctx.batteryVoltage < 11.2) {
    warnings.push(
      `Backup battery low (${ctx.batteryVoltage.toFixed(1)}V). Check solar charger or 12V power supply.`
    );
  }

  const sourceTag = ctx.dataSource === 'SIMULATED' ? '[Practice Mode] ' : '';
  const now = Date.now();
  const browserNotifs = store.getValue('browserNotifs') !== false;

  for (const warning of warnings) {
    const prevTs = lastAlertTimestamps.get(warning) || 0;
    // Deduplicate identical alerts within 3 minutes unless forced
    if (options?.force || now - prevTs > 180_000) {
      lastAlertTimestamps.set(warning, now);
      const id = `${now}_${Math.random().toString(36).slice(2, 6)}`;
      store.setRow('activityLog', id, {
        timestamp: new Date().toISOString(),
        type: 'alert',
        message: `${sourceTag}Alert Agent: ${warning}`
      });

      if (
        options?.allowNotifications !== false &&
        browserNotifs &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('EDENS AI Greenhouse Alert', { body: `${sourceTag}${warning}` });
        } catch {}
      }
    }
  }

  store.setValue('agent_AlertAgent_status', warnings.length > 0 ? 'ALERT' : 'ADVISORY_READY');
  store.setValue(
    'agent_AlertAgent_summary',
    warnings.length > 0
      ? `${sourceTag}${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}`
      : `${sourceTag}All monitored thresholds (heat, humidity, tank, rain & battery) are within safe limits.`
  );
  store.setValue('agent_AlertAgent_lastRun', new Date().toISOString());

  return warnings;
}

/**
 * AlertAgent — Continuous Safety Threshold Watchdog
 *
 * Evaluates verified or simulated sensor readings against safe crop & equipment thresholds
 * and surfaces plain-language warnings without autonomous hardware actuation.
 */
export function AlertAgent() {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void runAlertAgentCycle({ allowNotifications: false });
    }
    const interval = setInterval(() => {
      void runAlertAgentCycle({ allowNotifications: true });
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return null;
}

export const useAlertAgent = AlertAgent;
