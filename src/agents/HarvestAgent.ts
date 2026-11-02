import { useEffect } from 'react';
import { store } from '../lib/store';
import { getCropStandardDays } from '../lib/crops';
import { predictHarvest, type HarvestPredictionResult } from '../lib/gemini';
import { resolveAgentTelemetryContext } from './agentTelemetryContext';

let harvestRunning = false;

export async function runHarvestAgentCycle(options?: {
  force?: boolean;
}): Promise<HarvestPredictionResult | null> {
  const isEnabled = store.getValue('agent_HarvestAgent_enabled') !== false;
  if (!isEnabled && !options?.force) return null;
  if (harvestRunning) return null;
  harvestRunning = true;

  try {
    const ctx = await resolveAgentTelemetryContext();
    const cropType = String(store.getValue('cropType') || ctx.cropType || 'Tomato');

    let plantingDate = String(store.getValue('plantingDate') || '').trim();
    if (!plantingDate) {
      const defaultPlanted = new Date();
      defaultPlanted.setDate(defaultPlanted.getDate() - 21);
      plantingDate = defaultPlanted.toISOString().split('T')[0];
      store.setValue('plantingDate', plantingDate);
    }

    const standardDays = getCropStandardDays(cropType);

    let effectiveSource: 'REAL_HARDWARE' | 'SIMULATED' | 'CROP_BASELINE' = 'CROP_BASELINE';
    let avgTemp: number | null = null;
    let avgHumidity: number | null = null;
    let soilMoisture: number | null = null;
    let lightHours = 12;

    if (ctx.dataSource === 'REAL_HARDWARE' || ctx.dataSource === 'CACHED') {
      effectiveSource = 'REAL_HARDWARE';
      avgTemp = ctx.temperature;
      avgHumidity = ctx.humidity;
      soilMoisture = ctx.soilMoisture;
      if (ctx.light !== null && ctx.light > 0) {
        lightHours = Math.max(8, Math.min(16, Math.round(ctx.light / 55)));
      }
    } else if (ctx.dataSource === 'SIMULATED') {
      effectiveSource = 'SIMULATED';
      avgTemp = ctx.temperature ?? 24.5;
      avgHumidity = ctx.humidity ?? 62;
      soilMoisture = ctx.soilMoisture ?? 55;
      lightHours = 12;
    }

    const prediction = await predictHarvest(
      cropType,
      plantingDate,
      standardDays,
      avgTemp,
      avgHumidity,
      lightHours,
      soilMoisture,
      {
        dataSource: effectiveSource,
        requireFresh: false
      }
    );

    store.setValue('harvestPrediction', JSON.stringify(prediction));

    const daysLabel =
      prediction.daysRemaining <= 0
        ? 'Ready for harvest inspection now'
        : `${prediction.daysRemaining} days to harvest (${prediction.estimatedHarvestDate})`;
    const savedNote =
      prediction.daysSaved > 0
        ? ` · ${prediction.daysSaved}d ahead of schedule`
        : prediction.daysSaved < 0
          ? ` · ${Math.abs(prediction.daysSaved)}d slower than baseline`
          : '';

    store.setValue(
      'agent_HarvestAgent_status',
      prediction.daysRemaining <= 5 ? 'ALERT' : 'ADVISORY_READY'
    );
    store.setValue(
      'agent_HarvestAgent_summary',
      `${cropType}: ${daysLabel}${savedNote} (${prediction.confidence}% confidence).`
    );
    store.setValue('agent_HarvestAgent_lastRun', new Date().toISOString());

    return prediction;
  } catch (e: any) {
    console.warn('HarvestAgent forecast error:', e?.message || e);
    store.setValue('agent_HarvestAgent_status', 'ERROR');
    return null;
  } finally {
    harvestRunning = false;
  }
}

export function HarvestAgent() {
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void runHarvestAgentCycle();
    }, 1500);
    const interval = setInterval(() => {
      void runHarvestAgentCycle();
    }, 180000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return null;
}

export const useHarvestAgent = HarvestAgent;
