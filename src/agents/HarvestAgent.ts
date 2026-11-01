import { useEffect } from 'react';
import { store } from '../lib/store';
import { hardwareService } from '../lib/hardwareService';
import { getCropStandardDays } from '../lib/crops';
import { predictHarvest, type HarvestPredictionResult } from '../lib/gemini';

let harvestAgentRunning = false;

export async function runHarvestAgentCycle(options?: { force?: boolean }): Promise<HarvestPredictionResult | null> {
  const isEnabled = store.getValue('agent_HarvestAgent_enabled') ?? true;
  if ((!isEnabled && !options?.force) || harvestAgentRunning) return null;

  harvestAgentRunning = true;
  try {
    const rawPlantingDate = String(store.getValue('plantingDate') || '').trim();
    const plantingDateStr =
      rawPlantingDate || new Date(Date.now() - 21 * 86_400_000).toISOString().split('T')[0];
    if (!rawPlantingDate) {
      store.setValue('plantingDate', plantingDateStr);
    }

    const cropType = String(store.getValue('cropType') || 'Tomato');
    const standardDays = getCropStandardDays(cropType);
    const config = hardwareService.getConfig();
    const hwSource = hardwareService.getDataSource();

    const effectiveSource =
      hwSource === 'REAL_HARDWARE'
        ? 'REAL_HARDWARE'
        : config.mode === 'simulation'
          ? 'SIMULATED'
          : 'CROP_BASELINE';

    const toFiniteOrNull = (val: unknown): number | null =>
      val !== undefined && val !== null && Number.isFinite(Number(val)) ? Number(val) : null;

    const hasValidReadings = hwSource === 'REAL_HARDWARE' || config.mode === 'simulation';
    const avgTemp = hasValidReadings ? toFiniteOrNull(store.getValue('temperature')) ?? 25 : 25;
    const avgHumidity = hasValidReadings ? toFiniteOrNull(store.getValue('humidity')) ?? 62 : 62;
    const soilMoisture = hasValidReadings ? toFiniteOrNull(store.getValue('soilMoisture')) ?? 55 : 55;
    const lightHours = 12;

    let prediction: HarvestPredictionResult;
    try {
      prediction = await predictHarvest(
        cropType,
        plantingDateStr,
        standardDays,
        avgTemp,
        avgHumidity,
        lightHours,
        soilMoisture,
        {
          dataSource: effectiveSource,
          requireFresh: effectiveSource === 'REAL_HARDWARE'
        }
      );
    } catch {
      // Deterministic agronomic fallback if offline or rate-limited
      const plantedMs = new Date(plantingDateStr).getTime();
      const elapsed = Number.isFinite(plantedMs)
        ? Math.max(0, Math.floor((Date.now() - plantedMs) / 86_400_000))
        : 0;
      const daysRemaining = Math.max(0, standardDays - elapsed);
      const targetDate = new Date(Date.now() + daysRemaining * 86_400_000)
        .toISOString()
        .split('T')[0];

      prediction = {
        estimatedDaysTotal: standardDays,
        daysSaved: 0,
        daysRemaining,
        estimatedHarvestDate: targetDate,
        confidence: 78,
        dataSource: 'CROP_BASELINE',
        factors: [
          {
            name: 'Standard Crop Maturity Curve',
            impact: 0,
            explanation: `Baseline ${standardDays}-day growth cycle for ${cropType} planted on ${plantingDateStr}.`
          }
        ]
      };
    }

    const nowIso = new Date().toISOString();
    const summary =
      prediction.daysRemaining > 0
        ? `${cropType}: ${prediction.daysRemaining} days remaining (target ${prediction.estimatedHarvestDate}${prediction.daysSaved > 0 ? `, ${prediction.daysSaved}d faster` : ''}).`
        : `${cropType}: Ready for harvest inspection!`;

    store.setValue('harvestPrediction', JSON.stringify(prediction));
    store.setValue('daysRemainingToHarvest', prediction.daysRemaining);
    store.setValue('agent_HarvestAgent_lastRun', nowIso);
    store.setValue('agent_HarvestAgent_status', 'ADVISORY_READY');
    store.setValue('agent_HarvestAgent_summary', summary);

    store.setRow('activityLog', Date.now().toString() + 'ha', {
      timestamp: nowIso,
      type: 'agent',
      message: `Harvest Agent (${prediction.dataSource || effectiveSource}): ${summary}`
    });

    return prediction;
  } catch (err: any) {
    console.warn('HarvestAgent cycle warning:', err?.message);
    store.setValue('agent_HarvestAgent_status', 'STANDBY');
    store.setValue(
      'agent_HarvestAgent_summary',
      `Harvest forecast pending (${err?.message || 'check planting date'}).`
    );
    return null;
  } finally {
    harvestAgentRunning = false;
  }
}

export function useHarvestAgent() {
  useEffect(() => {
    const interval = setInterval(() => {
      void runHarvestAgentCycle();
    }, 1800000); // refresh every 30m in background
    const timeout = setTimeout(() => {
      void runHarvestAgentCycle();
    }, 2500);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
}
