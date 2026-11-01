import React from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Sprout, CheckCircle2, AlertTriangle, Info, Calendar } from 'lucide-react';
import { store, useStoreValue } from '../lib/store';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import type { HarvestPredictionResult } from '../lib/gemini';

export function HarvestWidget() {
  const predictionJson = useStoreValue('harvestPrediction', '');
  const cropType = String(useStoreValue('cropType', 'Tomato'));
  const [recordedNotice, setRecordedNotice] = React.useState(false);
  const [checked, setChecked] = React.useState<number[]>([]);

  if (!predictionJson) {
    if (recordedNotice) {
      return (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          <CheckCircle2 size={15} aria-hidden="true" /> Harvest recorded and the growth cycle
          has been reset.
        </div>
      );
    }
    return null;
  }

  let prediction: HarvestPredictionResult;
  try {
    prediction = typeof predictionJson === 'string' ? JSON.parse(predictionJson) : predictionJson;
  } catch (e) {
    return null;
  }

  const { daysRemaining, daysSaved, estimatedHarvestDate, confidence, factors } = prediction;
  const isNearHarvest = daysRemaining <= 5;

  const cropDaysMap: Record<string, number> = {
    tomato: 70, pepper: 80, cucumber: 55, lettuce: 45, spinach: 40,
    kale: 60, maize: 90, rice: 120, beans: 65, onion: 100, carrot: 75,
    cabbage: 80, watermelon: 85, okra: 55, yam: 270, cassava: 365
  };
  const totalStandardDays = cropDaysMap[cropType.toLowerCase()] || 70;
  const progressPercent = Math.min(100, Math.max(0, 100 - (daysRemaining / totalStandardDays) * 100));

  const checklist = [
    'Check fruit size and color',
    'Test firmness and inspect leaves',
    `Review the AI confidence score (${confidence}%)`
  ];

  const recordHarvest = () => {
    const id = Date.now().toString();
    const planted = String(store.getValue('plantingDate') || 'Unknown');
    store.setRow('harvestHistory', id, {
      cropType,
      plantingDate: planted,
      harvestDate: new Date().toISOString().split('T')[0],
      predictedDate: estimatedHarvestDate,
    });
    // Reset planting date for next crop
    store.setValue('plantingDate', new Date().toISOString().split('T')[0]);
    setRecordedNotice(true);
    setTimeout(() => setRecordedNotice(false), 5000);
    store.delValue('harvestPrediction');
  };

  return (
    <Card className={cn(isNearHarvest && 'border-brand/50')}>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Sprout size={16} className="text-muted-foreground" aria-hidden="true" />
            Harvest prediction
          </span>
          {isNearHarvest && (
            <span className="rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              Harvest soon
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular text-3xl font-semibold">{daysRemaining}</span>
              <span className="text-sm text-muted-foreground">days remaining</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Calendar size={14} aria-hidden="true" />
              Estimated{' '}
              <span className="font-medium text-foreground">
                {new Date(estimatedHarvestDate).toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric'
                })}
              </span>
            </div>
            {daysSaved > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 size={13} aria-hidden="true" />
                Saved {daysSaved} day{daysSaved === 1 ? '' : 's'} with AI scheduling
              </div>
            )}
          </div>

          <div className="w-full md:w-1/2">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Seedling</span>
              <span>Ready</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1.5 text-right text-xs text-muted-foreground">
              {cropType} · {confidence}% confidence
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <h4 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Info size={13} aria-hidden="true" /> Growth factors
          </h4>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {factors.slice(0, 4).map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {f.impact > 0 ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                ) : f.impact < 0 ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                ) : (
                  <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
                )}
                <div>
                  <span className="font-medium">{f.name}</span>
                  <p className="mt-0.5 text-muted-foreground">{f.explanation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {isNearHarvest && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4">
            <h4 className="flex items-center gap-2 text-xs font-medium text-success">
              <CheckCircle2 size={13} aria-hidden="true" /> Readiness checklist
            </h4>
            <div className="mt-3 space-y-2">
              {checklist.map((item, i) => (
                <label key={i} className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checked.includes(i)}
                    onChange={(e) =>
                      setChecked((prev) => (e.target.checked ? [...prev, i] : prev.filter((n) => n !== i)))
                    }
                    className="size-4 cursor-pointer accent-primary"
                  />
                  <span className={checked.includes(i) ? 'text-muted-foreground line-through' : ''}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-success/20 pt-3">
              <span className="text-sm font-medium text-success">Ready to harvest</span>
              <Button type="button" size="sm" variant="outline" onClick={recordHarvest}>
                Record harvest
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
