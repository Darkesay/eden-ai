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
        'rounded-xl border border-warning/30 bg-warning/10 text-warning px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs',
        className
      )}
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <ShieldAlert
          size={16}
          className="text-warning shrink-0 mt-0.5 sm:mt-0"
        />
        <div className="min-w-0">
          <span className="font-bold tracking-tight text-warning">
            {MONITORING_MODE_LABEL}
          </span>
          <span className="text-warning sm:ml-2 block sm:inline mt-0.5 sm:mt-0">
            Real camera inspection, sensor telemetry, Plant Vision diagnosis, and AI recommendations are active; physical relay actuation is locked off.
          </span>
        </div>
      </div>
      <span className="font-mono tabular-nums text-[11px] text-warning whitespace-nowrap shrink-0">
        Read-Only Hardware Lock
      </span>
    </div>
  );
}
