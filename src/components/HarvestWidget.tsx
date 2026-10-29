import React from 'react';
import { Calendar, CheckCircle2, Sprout } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { store, useStoreValue } from '../lib/store';
import type { HarvestPredictionResult } from '../lib/gemini';

export function HarvestWidget() {
  const predictionJson = useStoreValue('harvestPrediction', '');
  const cropType = String(useStoreValue('cropType', 'Tomato'));
  const [recordedNotice, setRecordedNotice] = React.useState(false);

  if (!predictionJson) {
    if (recordedNotice) {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 text-sm font-medium flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
          Harvest recorded in your crop log and planting date reset for the new cycle.
        </div>
      );
    }
    return null;
  }

  let prediction: HarvestPredictionResult;
  try {
    prediction = typeof predictionJson === 'string' ? JSON.parse(predictionJson) : predictionJson;
  } catch {
    return null;
  }

  const { daysRemaining, daysSaved, estimatedHarvestDate, confidence } = prediction;
  const isNearHarvest = daysRemaining <= 5;

  const cropDaysMap: Record<string, number> = {
    tomato: 70,
    pepper: 80,
    cucumber: 55,
    lettuce: 45,
    spinach: 40,
    kale: 60,
    maize: 90,
    rice: 120,
    beans: 65,
    onion: 100,
    carrot: 75,
    cabbage: 80,
    watermelon: 85,
    okra: 55,
    yam: 270,
    cassava: 365
  };
  const totalStandardDays = cropDaysMap[cropType.toLowerCase()] || 70;
  const progressPercent = Math.min(100, Math.max(0, 100 - (daysRemaining / totalStandardDays) * 100));

  return (
    <Card className="border border-border bg-card rounded-2xl shadow-xs">
      <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Sprout size={16} className="text-primary" />
          Estimated Harvest Window
        </CardTitle>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {cropType} · {confidence}% confidence
        </span>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono tabular-nums text-foreground">
                {daysRemaining}
              </span>
              <span className="text-sm text-muted-foreground">days remaining</span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <Calendar size={13} />
              Target date:{' '}
              <strong className="text-foreground">
                {new Date(estimatedHarvestDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </strong>
              {daysSaved > 0 && <span className="text-primary font-medium">· {daysSaved}d ahead of schedule</span>}
            </div>
          </div>

          <div className="w-full sm:w-56 space-y-1.5">
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

        {isNearHarvest && (
          <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Your crop is approaching harvest readiness. Inspect fruit color and firmness before picking.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const id = Date.now().toString();
                const planted = String(store.getValue('plantingDate') || 'Unknown');
                store.setRow('harvestHistory', id, {
                  cropType,
                  plantingDate: planted,
                  harvestDate: new Date().toISOString().split('T')[0],
                  predictedDate: estimatedHarvestDate
                });
                store.setValue('plantingDate', new Date().toISOString().split('T')[0]);
                setRecordedNotice(true);
                setTimeout(() => setRecordedNotice(false), 5000);
                store.delValue('harvestPrediction');
              }}
              className="h-9 px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Record Harvest
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
