import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatRelativeAge, useFarmerGreenhouseState } from '../lib/greenhouseState';

interface DataSourceBadgeProps {
  className?: string;
  showFreshness?: boolean;
  variant?: 'badge' | 'banner' | 'pill';
}

export function DataSourceBadge({
  className,
  showFreshness = true,
  variant = 'badge'
}: DataSourceBadgeProps) {
  const ghState = useFarmerGreenhouseState();
  const { provenance, lastUpdatedAgeSeconds, lastUpdatedAt, activeGreenhouse } = ghState;
  const ageText = formatRelativeAge(lastUpdatedAgeSeconds, lastUpdatedAt);

  if (variant === 'banner') {
    if (provenance === 'REAL_HARDWARE') {
      return (
        <div
          className={cn(
            'rounded-xl border border-emerald-200 bg-emerald-50/80 dark:border-emerald-800/60 dark:bg-emerald-950/45 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-emerald-950 dark:text-emerald-100',
            className
          )}
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
            <div>
              <span className="font-semibold">Live Greenhouse Hardware Connected</span>
              <span className="text-emerald-800 dark:text-emerald-200/90 ml-2">
                Showing verified readings from {ghState.greenhouseName}.
              </span>
            </div>
          </div>
          {showFreshness && (
            <span className="text-xs font-mono tabular-nums text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Clock size={13} /> Updated {ageText}
            </span>
          )}
        </div>
      );
    }

    if (provenance === 'CACHED' || provenance === 'STALE') {
      return (
        <div
          className={cn(
            'rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/45 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-950 dark:text-amber-100',
            className
          )}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="text-amber-700 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-semibold">Sensor Update Delayed</span>
              <span className="text-amber-900 dark:text-amber-200/90 ml-2">
                Last reading arrived {ageText}. Do not rely on these numbers as live until your controller reconnects.
              </span>
            </div>
          </div>
          <Link
            to={activeGreenhouse ? `/greenhouses/${activeGreenhouse.id}` : '/settings?tab=hardware'}
            className="text-xs font-semibold text-amber-900 dark:text-amber-300 underline underline-offset-4 whitespace-nowrap shrink-0"
          >
            Check Connection
          </Link>
        </div>
      );
    }

    if (provenance === 'SIMULATED') {
      return (
        <div
          className={cn(
            'rounded-xl border border-indigo-200 bg-indigo-50/80 dark:border-indigo-800/60 dark:bg-indigo-950/45 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-indigo-950 dark:text-indigo-100',
            className
          )}
        >
          <div className="flex items-center gap-2.5">
            <FlaskConical size={18} className="text-indigo-700 dark:text-indigo-300 shrink-0" />
            <div>
              <span className="font-semibold">Practice Mode Active</span>
              <span className="text-indigo-900 dark:text-indigo-200/90 ml-2">
                Numbers shown are simulated for learning — not live readings from a physical greenhouse.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/greenhouses/setup"
              className="text-xs font-semibold text-indigo-900 dark:text-indigo-300 underline underline-offset-4 whitespace-nowrap"
            >
              Connect Real Hardware
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-foreground',
          className
        )}
      >
        <div className="flex items-center gap-2.5">
          <WifiOff size={18} className="text-muted-foreground shrink-0" />
          <div>
            <span className="font-semibold">No Live Sensor Signal</span>
            <span className="text-muted-foreground ml-2">
              {activeGreenhouse
                ? `Waiting for ${activeGreenhouse.name} hardware to send verified readings.`
                : 'Connect your EDENS AI greenhouse kit to view live environmental readings.'}
            </span>
          </div>
        </div>
        <Link
          to={activeGreenhouse ? `/greenhouses/${activeGreenhouse.id}/setup` : '/greenhouses/setup'}
          className="text-xs font-semibold text-primary hover:underline underline-offset-4 whitespace-nowrap shrink-0"
        >
          {activeGreenhouse ? 'Open Setup Guide' : 'Set Up Greenhouse'}
        </Link>
      </div>
    );
  }

  // Compact sidebar / header indicator
  const toneClass =
    provenance === 'REAL_HARDWARE'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-300'
      : provenance === 'CACHED' || provenance === 'STALE'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-300'
        : provenance === 'SIMULATED'
          ? 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/45 dark:text-indigo-300'
          : 'border-border bg-muted text-muted-foreground';

  const Icon =
    provenance === 'REAL_HARDWARE'
      ? CheckCircle2
      : provenance === 'CACHED'
        ? RefreshCw
        : provenance === 'STALE'
          ? AlertTriangle
          : provenance === 'SIMULATED'
            ? FlaskConical
            : WifiOff;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0',
        toneClass,
        className
      )}
    >
      <Icon size={13} className="shrink-0" />
      <span>{ghState.provenanceLabel}</span>
      {showFreshness && provenance === 'REAL_HARDWARE' && lastUpdatedAgeSeconds !== null && (
        <span className="text-[11px] font-mono tabular-nums opacity-80">· {ageText}</span>
      )}
    </div>
  );
}
