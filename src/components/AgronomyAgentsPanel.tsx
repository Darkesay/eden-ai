import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  Clock,
  Droplets,
  Loader2,
  Play,
  ShieldCheck,
  Sprout,
  Thermometer
} from 'lucide-react';
import { store, useStoreValue } from '../lib/store';
import { formatRelativeAge } from '../lib/greenhouseState';
import { runClimateAgentCycle } from '../agents/ClimateAgent';
import { runIrrigationAgentCycle } from '../agents/IrrigationAgent';
import { runVisionAgentCycle } from '../agents/VisionAgent';
import { runHarvestAgentCycle } from '../agents/HarvestAgent';
import { runAlertAgentCycle } from '../agents/AlertAgent';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface AgentCardSpec {
  id: 'ClimateAgent' | 'IrrigationAgent' | 'VisionAgent' | 'HarvestAgent' | 'AlertAgent';
  title: string;
  roleDescription: string;
  safetyNote: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  runNow: () => Promise<void>;
}

const AGENTS: AgentCardSpec[] = [
  {
    id: 'ClimateAgent',
    title: 'Climate Agent',
    roleDescription: 'Evaluates temperature, humidity & ventilation balance against your crop range.',
    safetyNote: 'Heater locked OFF above 32°C',
    icon: Thermometer,
    runNow: () => runClimateAgentCycle({ force: true })
  },
  {
    id: 'IrrigationAgent',
    title: 'Irrigation Agent',
    roleDescription: 'Monitors root-zone soil moisture, weather rain sensor & water tank level.',
    safetyNote: 'Pump locked OFF below 10% tank · Max 120s',
    icon: Droplets,
    runNow: () => runIrrigationAgentCycle({ force: true })
  },
  {
    id: 'VisionAgent',
    title: 'Vision Agent',
    roleDescription: 'Inspects fresh (≤90s) ESP32-CAM snapshots for early leaf spots or stress.',
    safetyNote: 'Rejects stale or simulated photos',
    icon: Camera,
    runNow: () => runVisionAgentCycle({ force: true })
  },
  {
    id: 'HarvestAgent',
    title: 'Harvest Agent',
    roleDescription: 'Forecasts days remaining to maturity & harvest readiness across 18 crops.',
    safetyNote: 'Tracks elapsed days & climate impact',
    icon: Sprout,
    runNow: async () => {
      await runHarvestAgentCycle({ force: true });
    }
  },
  {
    id: 'AlertAgent',
    title: 'Alert Agent',
    roleDescription: 'Watches thermal extremes, fungal humidity, tank locks, rain+roof & battery voltage.',
    safetyNote: 'Continuous 8s watchdog',
    icon: AlertTriangle,
    runNow: async () => {
      await runAlertAgentCycle({ force: true });
    }
  }
];

function SingleAgentRow({ spec }: { spec: AgentCardSpec }) {
  const enabled = Boolean(useStoreValue(`agent_${spec.id}_enabled`, true));
  const status = String(useStoreValue(`agent_${spec.id}_status`, 'STANDBY') || 'STANDBY');
  const summary = String(
    useStoreValue(`agent_${spec.id}_summary`, spec.roleDescription) || spec.roleDescription
  );
  const lastRun = String(useStoreValue(`agent_${spec.id}_lastRun`, '') || '');
  const [running, setRunning] = useState(false);

  const Icon = spec.icon;

  const handleToggle = () => {
    const next = !enabled;
    store.setValue(`agent_${spec.id}_enabled`, next);
    if (next) {
      void handleRunNow();
    } else {
      store.setValue(`agent_${spec.id}_status`, 'PAUSED');
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await spec.runNow();
    } finally {
      setRunning(false);
    }
  };

  const badgeTone = !enabled
    ? 'bg-muted text-muted-foreground border-border'
    : status === 'ALERT'
      ? 'bg-warning/10 text-warning border-warning/30'
      : status === 'ADVISORY_READY'
        ? 'bg-success/10 text-success border-success/30'
        : 'bg-muted text-muted-foreground border-border';

  const badgeLabel = !enabled
    ? 'Paused'
    : status === 'ALERT'
      ? 'Attention'
      : status === 'ADVISORY_READY'
        ? 'Active Advisory'
        : 'Standing By';

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4 flex flex-col justify-between gap-3">
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent text-primary flex items-center justify-center shrink-0">
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">{spec.title}</h3>
              <p className="text-[11px] text-muted-foreground truncate">{spec.safetyNote}</p>
            </div>
          </div>

          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap shrink-0',
              badgeTone
            )}
          >
            {badgeLabel}
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{summary}</p>
      </div>

      <div className="pt-2.5 border-t border-border flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground font-mono tabular-nums flex items-center gap-1">
          <Clock size={11} />
          {lastRun ? formatRelativeAge(null, lastRun) : 'Ready'}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggle}
            className={cn(
              'px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors cursor-pointer',
              enabled
                ? 'border-border bg-card text-foreground hover:bg-muted'
                : 'border-primary/30 bg-accent text-accent-foreground'
            )}
          >
            {enabled ? 'Pause' : 'Enable'}
          </button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() => void handleRunNow()}
            className="h-7 px-2.5 rounded-md text-[11px] font-semibold cursor-pointer"
          >
            {running ? (
              <Loader2 size={12} className="animate-spin mr-1" />
            ) : (
              <Play size={11} className="mr-1 text-primary" />
            )}
            Check Now
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgronomyAgentsPanel() {
  const [runningAll, setRunningAll] = useState(false);

  const handleRunAll = async () => {
    setRunningAll(true);
    try {
      await Promise.allSettled([
        runAlertAgentCycle({ force: true }),
        runClimateAgentCycle({ force: true }),
        runIrrigationAgentCycle({ force: true }),
        runVisionAgentCycle({ force: true }),
        runHarvestAgentCycle({ force: true })
      ]);
    } finally {
      setRunningAll(false);
    }
  };

  return (
    <section
      aria-label="Specialized Agronomy Agents"
      className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4 sm:space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Bot size={20} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                5 Specialized Agronomy Agents
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-success/10 text-success border border-success/30">
                <ShieldCheck size={12} />
                Advisory-Only Hardware Safety
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Background specialists watching your greenhouse climate, watering safety, camera snapshots, harvest window, and emergency thresholds.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={runningAll}
          onClick={() => void handleRunAll()}
          className="h-10 px-4 rounded-xl text-xs font-semibold w-full sm:w-auto shrink-0 cursor-pointer"
        >
          {runningAll ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1.5 text-primary" />
              Running All 5 Agents...
            </>
          ) : (
            <>
              <CheckCircle2 size={15} className="mr-1.5 text-primary" />
              Run All 5 Checks Now
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AGENTS.map((spec) => (
          <SingleAgentRow key={spec.id} spec={spec} />
        ))}
      </div>
    </section>
  );
}
