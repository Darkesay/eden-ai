import React from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Sprout, CheckCircle2, AlertTriangle, Info, Calendar } from 'lucide-react';
import { store, useStoreValue } from '../lib/store';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import type { HarvestPredictionResult } from '../lib/gemini';

export function HarvestWidget() {
  const predictionJson = useStoreValue('harvestPrediction', '');
  const cropType = String(useStoreValue('cropType', 'Tomato'));
  
  if (!predictionJson) return null;
  
  let prediction: HarvestPredictionResult;
  try {
    prediction = typeof predictionJson === 'string' ? JSON.parse(predictionJson) : predictionJson;
  } catch (e) {
    return null;
  }

  const { daysRemaining, daysSaved, estimatedHarvestDate, confidence, factors } = prediction;
  const isNearHarvest = daysRemaining <= 5;
  const isMediumHarvest = daysRemaining > 5 && daysRemaining <= 14;

  const cropDaysMap: Record<string, number> = {
    tomato: 70, pepper: 80, cucumber: 55, lettuce: 45, spinach: 40,
    kale: 60, maize: 90, rice: 120, beans: 65, onion: 100, carrot: 75,
    cabbage: 80, watermelon: 85, okra: 55, yam: 270, cassava: 365
  };
  const totalStandardDays = cropDaysMap[cropType.toLowerCase()] || 70;
  const progressPercent = Math.min(100, Math.max(0, 100 - (daysRemaining / totalStandardDays) * 100));

  return (
    <Card className={cn(
      "border backdrop-blur-xl rounded-3xl shadow-sm hover:shadow-md transition-all duration-500 overflow-hidden relative group",
      isNearHarvest ? "border-[#10B981] bg-gradient-to-br from-[#10B981]/10 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.15)]" : "bg-[#FFFFFF]/80 dark:bg-[#080808]/80 border-[#D1E8D1] dark:border-[#1A2A1A]"
    )}>
      {isNearHarvest && <div className="absolute inset-0 bg-[#10B981]/5 animate-pulse pointer-events-none" />}
      
      <CardHeader className="pb-3 border-b border-[#D1E8D1]/50 dark:border-[#1A2A1A]/50 relative z-10">
        <div className="flex items-center justify-between">
          <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
            <Sprout size={14} className="text-[#10B981]" /> HARVEST PREDICTION
          </div>
          {isNearHarvest && (
            <span className="bg-[#10B981] text-white px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider animate-pulse uppercase">
              Harvest Soon
            </span>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-6 relative z-10 space-y-6">
        <div className="flex flex-col md:flex-row gap-6 items-center md:items-start justify-between">
          <div className="text-center md:text-left space-y-1">
            <h2 className="text-3xl font-bold font-mono tracking-tight flex items-center justify-center md:justify-start gap-3">
              🌾 {daysRemaining}
              <span className="text-lg text-gray-500 font-sans tracking-normal opacity-70">Days Remaining</span>
            </h2>
            <div className="flex items-center justify-center md:justify-start gap-2 text-sm opacity-80 mt-2 text-gray-600 dark:text-gray-300">
               <Calendar size={14} /> Estimated: <strong>{new Date(estimatedHarvestDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric'})}</strong>
            </div>
            {daysSaved > 0 && (
               <div className="text-[#10B981] text-xs font-bold mt-1 uppercase tracking-wider flex items-center justify-center md:justify-start gap-1">
                 <CheckCircle2 size={12} /> AI-Optimized: {daysSaved} days saved
               </div>
            )}
          </div>

          <div className="w-full md:w-1/2 space-y-2">
            <div className="flex justify-between text-xs font-mono opacity-60 mb-2 uppercase tracking-wider px-1">
              <span>Seedling</span>
              <span>Ready</span>
            </div>
            <div className="h-4 w-full bg-black/5 dark:bg-white/5 rounded-full overflow-hidden border border-black/5 dark:border-white/5 relative">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full transition-all duration-1000",
                  isNearHarvest ? "bg-gradient-to-r from-[#10B981] to-emerald-400" : 
                  isMediumHarvest ? "bg-gradient-to-r from-amber-400 to-amber-500" :
                  "bg-gradient-to-r from-[#10B981]/50 to-[#10B981]"
                )}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
            </div>
            <div className="text-right text-[10px] font-mono opacity-50 mt-1">{cropType} Check • {confidence}% Confidence</div>
          </div>
        </div>

        <div className="bg-black/5 dark:bg-white/5 rounded-2xl p-4 border border-[#D1E8D1] dark:border-[#1A2A1A]">
          <h4 className="text-xs font-bold opacity-60 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Info size={12} /> Growth Factors
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {factors.slice(0, 4).map((f, i) => (
               <div key={i} className="flex gap-2 items-start text-xs">
                 {f.impact > 0 ? (
                    <CheckCircle2 size={14} className="text-[#10B981] mt-0.5 shrink-0" />
                 ) : f.impact < 0 ? (
                    <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                 ) : (
                    <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                 )}
                 <div>
                    <span className="font-bold">{f.name}</span>
                    <p className="opacity-70 mt-0.5">{f.explanation}</p>
                 </div>
               </div>
            ))}
          </div>
        </div>

        {isNearHarvest && (
          <div className="bg-[#10B981]/10 rounded-2xl p-4 border border-[#10B981]/30">
            <h4 className="text-xs font-bold text-[#10B981] uppercase tracking-widest mb-3 flex items-center gap-2">
              <CheckCircle2 size={14} /> Readiness Checklist
            </h4>
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-sm cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-emerald-500/50 text-emerald-500 focus:ring-emerald-500 bg-transparent" />
                <span className="opacity-80 group-hover:opacity-100 transition-opacity">Check fruit/vegetable size and color</span>
              </label>
              <label className="flex items-center gap-3 text-sm cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-emerald-500/50 text-emerald-500 focus:ring-emerald-500 bg-transparent" />
                <span className="opacity-80 group-hover:opacity-100 transition-opacity">Test firmness & inspect leaves</span>
              </label>
              <label className="flex items-center gap-3 text-sm cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-emerald-500/50 text-emerald-500 focus:ring-emerald-500 bg-transparent" />
                <span className="opacity-80 group-hover:opacity-100 transition-opacity">Review AI confidence score ({confidence}%)</span>
              </label>
            </div>
            <div className="mt-4 pt-4 border-t border-[#10B981]/20 flex justify-end gap-2">
              <button 
                onClick={() => {
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
                  store.delValue('harvestPrediction');
                  alert('Harvest recorded successfully!');
                }}
                className="bg-transparent border border-[#10B981] text-[#10B981] hover:bg-[#10B981]/10 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              >
                Record Harvest
              </button>
              <div className="bg-[#10B981] text-white px-3 py-1.5 rounded-lg text-xs font-bold">
                 Final Recommendation: Ready to Harvest!
              </div>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
