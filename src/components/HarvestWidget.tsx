import React, { useState } from 'react';
import { Calendar, CheckCircle2, Loader2, RefreshCw, Sparkles, Sprout, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { store, useStoreValue } from '../lib/store';
import { getCropStandardDays, SUPPORTED_HARVEST_CROPS } from '../lib/crops';
import { runHarvestAgentCycle } from '../agents/HarvestAgent';
import type { HarvestPredictionResult } from '../lib/gemini';
import { cn } from '../lib/utils';

export function HarvestWidget() {
  const predictionJson = useStoreValue('harvestPrediction', '');
  const cropType = String(useStoreValue('cropType', 'Tomato') || 'Tomato');
  const plantingDate = String(
    useStoreValue(
      'plantingDate',
      new Date(Date.now() - 21 * 86_400_000).toISOString().split('T')[0]
    ) || ''
  );

  const [calculating, setCalculating] = useState(false);
  const [recordedNotice, setRecordedNotice] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);

  let prediction: HarvestPredictionResult | null = null;
  if (predictionJson) {
    try {
      prediction =
        typeof predictionJson === 'string' ? JSON.parse(predictionJson) : predictionJson;
    } catch {
      prediction = null;
    }
  }

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      await runHarvestAgentCycle({ force: true });
    } finally {
      setCalculating(false);
    }
  };

  const handleCropOrDateUpdate = async (nextCrop: string, nextDate: string) => {
    store.setValue('cropType', nextCrop);
    if (nextDate) {
      store.setValue('plantingDate', nextDate);
    }
    setCalculating(true);
    try {
      await runHarvestAgentCycle({ force: true });
    } finally {
      setCalculating(false);
    }
  };

  const totalStandardDays = getCropStandardDays(cropType);
  const daysRemaining = prediction?.daysRemaining ?? null;
  const daysSaved = prediction?.daysSaved ?? 0;
  const estimatedHarvestDate = prediction?.estimatedHarvestDate ?? '';
  const confidence = prediction?.confidence ?? 80;
  const factors = Array.isArray(prediction?.factors) ? prediction!.factors.slice(0, 3) : [];
  const sourceTag =
    prediction?.dataSource === 'REAL_HARDWARE'
      ? 'Live Sensor Forecast'
      : prediction?.dataSource === 'SIMULATED'
        ? 'Practice Simulation'
        : 'Crop Maturity Baseline';

  const progressPercent =
    daysRemaining !== null
      ? Math.min(
          100,
          Math.max(
            0,
            100 - (daysRemaining / Math.max(15, prediction?.estimatedDaysTotal || totalStandardDays)) * 100
          )
        )
      : 0;

  const isNearHarvest = daysRemaining !== null && daysRemaining <= 5;

  return (
    <Card className="border border-border bg-card rounded-2xl shadow-xs">
      <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between gap-2">
        <div className="space-y-0.5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Sprout size={16} className="text-primary" />
            Harvest Forecast
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            {cropType} · {sourceTag}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowScheduleEditor((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline px-2 py-1 cursor-pointer"
          >
            {showScheduleEditor ? 'Close' : 'Edit Crop / Date'}
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={calculating}
            onClick={() => void handleRecalculate()}
            className="h-8 px-2.5 rounded-lg text-xs font-semibold cursor-pointer"
            title="Recalculate AI harvest forecast"
          >
            <RefreshCw size={13} className={cn(calculating && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {recordedNotice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-3.5 py-2.5 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>Harvest saved to your crop log and planting date reset to today.</span>
          </div>
        )}

        {/* Inline Crop & Planting Date Selector */}
        {showScheduleEditor && (
          <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="harvest-crop-select"
                  className="text-[11px] font-semibold text-foreground block"
                >
                  Active Crop (18 Supported)
                </label>
                <select
                  id="harvest-crop-select"
                  value={cropType}
                  onChange={(e) => void handleCropOrDateUpdate(e.target.value, plantingDate)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {!SUPPORTED_HARVEST_CROPS.some(
                    (c) => c.label.toLowerCase() === cropType.toLowerCase()
                  ) && <option value={cropType}>{cropType}</option>}
                  {SUPPORTED_HARVEST_CROPS.map((crop) => (
                    <option key={crop.id} value={crop.label}>
                      {crop.label} ({crop.standardDays}d)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="harvest-planted-date"
                  className="text-[11px] font-semibold text-foreground block"
                >
                  Planting Date
                </label>
                <input
                  id="harvest-planted-date"
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  value={plantingDate}
                  onChange={(e) => void handleCropOrDateUpdate(cropType, e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        )}

        {prediction && daysRemaining !== null ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-foreground">
                    {daysRemaining}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {daysRemaining === 1 ? 'day remaining' : 'days remaining'}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5 mt-1">
                  <Calendar size={13} />
                  <span>Target:</span>
                  <strong className="text-foreground">
                    {new Date(`${estimatedHarvestDate}T12:00:00`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </strong>
                  <span>· {confidence}% confidence</span>
                  {daysSaved > 0 && (
                    <span className="text-primary font-semibold">· {daysSaved}d faster</span>
                  )}
                </div>
              </div>

              <div className="w-full sm:w-44 space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Planted</span>
                  <span className="font-mono tabular-nums">{Math.round(progressPercent)}%</span>
                  <span>Harvest</span>
                </div>
                <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {factors.length > 0 && (
              <div className="pt-2 border-t border-border space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-primary" />
                  Key Growth Factors
                </p>
                <div className="space-y-1.5">
                  {factors.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="rounded-lg bg-muted/45 px-3 py-2 text-xs flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground">{f.name}: </span>
                        <span className="text-muted-foreground">{f.explanation}</span>
                      </div>
                      {f.impact !== 0 && (
                        <span
                          className={cn(
                            'text-[11px] font-mono tabular-nums font-semibold shrink-0 px-1.5 py-0.5 rounded',
                            f.impact > 0
                              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          )}
                        >
                          {f.impact > 0 ? `+${f.impact}d faster` : `${f.impact}d`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isNearHarvest && (
              <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Crop is approaching harvest window. Check fruit color and firmness before picking.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const id = Date.now().toString();
                    const today = new Date().toISOString().split('T')[0];
                    store.setRow('harvestHistory', id, {
                      cropType,
                      plantingDate: plantingDate || 'Unknown',
                      harvestDate: today,
                      predictedDate: estimatedHarvestDate
                    });
                    store.setValue('plantingDate', today);
                    setRecordedNotice(true);
                    setTimeout(() => setRecordedNotice(false), 5000);
                    void handleCropOrDateUpdate(cropType, today);
                  }}
                  className="h-9 px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Record Harvest
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl bg-muted/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">
                Calculate Harvest Window for {cropType}
              </p>
              <p className="text-xs text-muted-foreground">
                Planted {plantingDate || 'recently'} ({totalStandardDays}-day standard cycle).
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={calculating}
              onClick={() => void handleRecalculate()}
              className="h-9 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shrink-0 cursor-pointer"
            >
              {calculating ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                  Calculating...
                </>
              ) : (
                <>
                  <Sparkles size={14} className="mr-1.5" />
                  Calculate Forecast
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
