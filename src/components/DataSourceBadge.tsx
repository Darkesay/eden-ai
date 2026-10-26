import React, { useEffect, useState } from 'react';
import { hardwareService } from '../lib/hardwareService';
import { DataSource } from '../lib/hardwareTypes';
import { cn } from '../lib/utils';
import { Radio, RefreshCw, AlertTriangle, ShieldCheck, Cpu, WifiOff, Clock } from 'lucide-react';

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

  if (variant === 'banner') {
    if (dataSource === 'REAL_HARDWARE') {
      return (
        <div className={cn(
          "px-4 py-2 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex flex-wrap items-center justify-between gap-2 text-xs",
          className
        )}>
          <div className="flex items-center gap-2 text-[#10B981]">
            <ShieldCheck size={16} className="animate-pulse" />
            <span className="font-bold uppercase tracking-wider">Connected to Real ESP32 Hardware</span>
            <span className="opacity-70 font-mono">({config.controllerHost})</span>
          </div>
          {showFreshness && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#10B981]/80">
              <Clock size={12} />
              <span>Freshness: {freshnessSec < 2 ? 'live' : `${freshnessSec}s ago`}</span>
            </div>
          )}
        </div>
      );
    }

    if (dataSource === 'CACHED') {
      return (
        <div className={cn(
          "px-4 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-500",
          className
        )}>
          <div className="flex items-center gap-2">
            <RefreshCw size={15} className="animate-spin" />
            <span className="font-bold uppercase tracking-wider">CACHED HARDWARE TELEMETRY</span>
            <span className="opacity-80 text-[11px]">— Recent reading buffered while polling retries...</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono font-bold">
            <Clock size={12} />
            <span>Last seen: {freshnessSec}s ago</span>
          </div>
        </div>
      );
    }

    if (dataSource === 'STALE') {
      return (
        <div className={cn(
          "px-4 py-2.5 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-orange-500",
          className
        )}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} />
            <span className="font-bold uppercase tracking-wider">STALE HARDWARE TELEMETRY</span>
            <span className="opacity-80 text-[11px]">— Readings are outdated ({freshnessSec}s old). Do not treat as live.</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono font-bold">
            <Clock size={12} />
            <span>Last seen: {freshnessSec}s ago</span>
          </div>
        </div>
      );
    }

    if (dataSource === 'DISCONNECTED') {
      return (
        <div className={cn(
          "px-4 py-2.5 rounded-2xl bg-red-500/10 border border-red-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-red-500",
          className
        )}>
          <div className="flex items-center gap-2">
            <WifiOff size={16} />
            <span className="font-bold uppercase tracking-wider">HARDWARE DISCONNECTED</span>
            <span className="opacity-80 text-[11px]">— No active signal from main ESP32 controller</span>
          </div>
          <a
            href="/hardware"
            className="px-2.5 py-1 rounded-xl bg-red-500/20 hover:bg-red-500/30 font-bold uppercase tracking-widest text-[10px] text-red-400 underline"
          >
            Configure Hardware →
          </a>
        </div>
      );
    }

    // SIMULATED BANNER
    return (
      <div className={cn(
        "px-4 py-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-purple-400",
        className
      )}>
        <div className="flex items-center gap-2">
          <Cpu size={16} />
          <div>
            <span className="font-bold uppercase tracking-wider">SIMULATION MODE ACTIVE</span>
            <span className="opacity-80 text-[11px] ml-2 text-foreground/80">
              Values are simulated for testing. Not actual greenhouse hardware readings.
            </span>
          </div>
        </div>
        <a
          href="/hardware"
          className="px-2.5 py-1 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 font-bold uppercase tracking-widest text-[10px] text-purple-300"
        >
          Connect Real Hardware
        </a>
      </div>
    );
  }

  // Variant: Badge / Pill
  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1 rounded-xl font-mono text-[11px] font-bold border tracking-wider uppercase backdrop-blur-md shadow-sm transition-all",
      dataSource === 'REAL_HARDWARE' && "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40",
      dataSource === 'SIMULATED' && "bg-purple-500/15 text-purple-400 border-purple-500/40",
      dataSource === 'CACHED' && "bg-amber-500/15 text-amber-500 border-amber-500/40",
      dataSource === 'STALE' && "bg-orange-500/15 text-orange-500 border-orange-500/40",
      dataSource === 'DISCONNECTED' && "bg-red-500/15 text-red-500 border-red-500/40",
      className
    )}>
      <span className={cn(
        "w-2 h-2 rounded-full",
        dataSource === 'REAL_HARDWARE' && "bg-[#10B981] animate-ping",
        dataSource === 'SIMULATED' && "bg-purple-400",
        dataSource === 'CACHED' && "bg-amber-500 animate-pulse",
        dataSource === 'STALE' && "bg-orange-500",
        dataSource === 'DISCONNECTED' && "bg-red-500"
      )} />

      <span>
        {dataSource === 'REAL_HARDWARE' && 'REAL HARDWARE'}
        {dataSource === 'SIMULATED' && 'SIMULATED DATA'}
        {dataSource === 'CACHED' && 'CACHED DATA'}
        {dataSource === 'STALE' && 'STALE DATA'}
        {dataSource === 'DISCONNECTED' && 'DISCONNECTED'}
      </span>

      {showFreshness && dataSource === 'REAL_HARDWARE' && (
        <span className="opacity-70 text-[10px] lowercase">
          · {freshnessSec < 2 ? 'live' : `${freshnessSec}s`}
        </span>
      )}

      {showFreshness && (dataSource === 'CACHED' || dataSource === 'STALE') && (
        <span className="opacity-70 text-[10px] lowercase">
          · {freshnessSec}s old
        </span>
      )}
    </div>
  );
}
