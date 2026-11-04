import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';

export const MONITORING_MODE_LABEL = 'MONITORING MODE — PHYSICAL CONTROL DISABLED.';

export function MonitoringModeBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs',
        className
      )}
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <ShieldAlert
          size={16}
          className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0"
        />
        <div className="min-w-0">
          <span className="font-bold tracking-tight text-amber-950 dark:text-amber-100">
            {MONITORING_MODE_LABEL}
          </span>
          <span className="text-amber-900 dark:text-amber-200/90 sm:ml-2 block sm:inline mt-0.5 sm:mt-0">
            Real camera inspection, sensor telemetry, Plant Vision diagnosis, and AI recommendations are active; physical relay actuation is locked off.
          </span>
        </div>
      </div>
      <span className="font-mono tabular-nums text-[11px] text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0">
        Read-Only Hardware Lock
      </span>
    </div>
  );
}
