import React, { useEffect, useState } from 'react';
import { hardwareService } from '../lib/hardwareService';
import { DataSource } from '../lib/hardwareTypes';
import { cn } from '../lib/utils';
import { RefreshCw, AlertTriangle, ShieldCheck, Cpu, WifiOff, Clock } from 'lucide-react';

interface DataSourceBadgeProps {
  className?: string;
  showFreshness?: boolean;
  variant?: 'badge' | 'banner' | 'pill';
}

const BADGE_LABEL: Record<DataSource, string> = {
  REAL_HARDWARE: 'Live hardware',
  SIMULATED: 'Simulation',
  CACHED: 'Cached',
  STALE: 'Stale',
  DISCONNECTED: 'Offline'
};

const BADGE_TONE: Record<DataSource, string> = {
  REAL_HARDWARE: 'bg-success/10 text-success',
  SIMULATED: 'bg-info/10 text-info',
  CACHED: 'bg-warning/10 text-warning',
  STALE: 'bg-warning/10 text-warning',
  DISCONNECTED: 'bg-destructive/10 text-destructive'
};

const BADGE_DOT: Record<DataSource, string> = {
  REAL_HARDWARE: 'bg-success',
  SIMULATED: 'bg-info',
  CACHED: 'bg-warning',
  STALE: 'bg-warning',
  DISCONNECTED: 'bg-destructive'
};

export function DataSourceBadge({
  className,
  showFreshness = true,
  variant = 'badge'
}: DataSourceBadgeProps) {
  const [dataSource, setDataSource] = useState<DataSource>(hardwareService.getDataSource());
  const [freshnessSec, setFreshnessSec] = useState<number>(hardwareService.getSensorFreshnessSeconds());

  useEffect(() => {
    const unsub = hardwareService.subscribe(() => {
      setDataSource(hardwareService.getDataSource());
      setFreshnessSec(hardwareService.getSensorFreshnessSeconds());
    });

    const timer = setInterval(() => {
      setFreshnessSec(hardwareService.getSensorFreshnessSeconds());
    }, 1000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const config = hardwareService.getConfig();

  const freshnessText =
    freshnessSec < 2 ? 'updated now' : `updated ${freshnessSec}s ago`;

  if (variant === 'banner') {
    const notice: Record<DataSource, { icon: React.ElementType; title: string; note: string; cta?: string }> = {
      REAL_HARDWARE: {
        icon: ShieldCheck,
        title: 'Live hardware connected',
        note: config.controllerHost ? `Controller at ${config.controllerHost} · ${freshnessText}` : freshnessText
      },
      CACHED: {
        icon: RefreshCw,
        title: 'Cached telemetry',
        note: `Showing the last reading while polling retries · last seen ${freshnessSec}s ago`
      },
      STALE: {
        icon: AlertTriangle,
        title: 'Stale telemetry',
        note: `Readings are ${freshnessSec}s old — don't treat these as live`
      },
      DISCONNECTED: {
        icon: WifiOff,
        title: 'Hardware offline',
        note: 'No signal from the main ESP32 controller',
        cta: 'Open hardware settings'
      },
      SIMULATED: {
        icon: Cpu,
        title: 'Simulation mode',
        note: 'Values are simulated for testing — not real greenhouse readings',
        cta: 'Connect real hardware'
      }
    };

    const item = notice[dataSource];
    const tone =
      dataSource === 'REAL_HARDWARE'
        ? 'border-success/30 bg-success/10 text-success'
        : dataSource === 'DISCONNECTED'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : dataSource === 'SIMULATED'
            ? 'border-info/30 bg-info/10 text-info'
            : 'border-warning/30 bg-warning/10 text-warning';

    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-xs',
          tone,
          className
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <item.icon size={15} className="shrink-0" aria-hidden="true" />
          <span className="font-medium">{item.title}</span>
          <span className="truncate opacity-80">{item.note}</span>
        </div>
        {item.cta && (
          <a
            href="/hardware"
            className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 font-medium transition-opacity hover:opacity-80"
          >
            {item.cta}
          </a>
        )}
      </div>
    );
  }

  // Variant: badge / pill — compact status chip for headers
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
        BADGE_TONE[dataSource],
        className
      )}
      title={
        dataSource === 'REAL_HARDWARE' && showFreshness
          ? `Sensor data ${freshnessText}`
          : BADGE_LABEL[dataSource]
      }
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', BADGE_DOT[dataSource])} aria-hidden="true" />
      <span className="truncate">{BADGE_LABEL[dataSource]}</span>

      {showFreshness && dataSource === 'REAL_HARDWARE' && (
        <span className="hidden text-muted-foreground lg:inline">· {freshnessText}</span>
      )}

      {showFreshness && (dataSource === 'CACHED' || dataSource === 'STALE') && (
        <span className="hidden text-muted-foreground lg:inline">· {freshnessSec}s ago</span>
      )}

      {showFreshness && (dataSource === 'CACHED' || dataSource === 'STALE') && (
        <Clock size={11} className="hidden shrink-0 text-muted-foreground lg:inline" aria-hidden="true" />
      )}
    </span>
  );
}
