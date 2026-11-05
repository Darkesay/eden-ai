import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStoreValue, useStoreTable, store } from '../lib/store';
import { useMqtt } from '../lib/mqtt';
import { AgronomyAgentsPanel } from '../components/AgronomyAgentsPanel';
import { MonitoringModeBanner } from '../components/MonitoringModeBanner';
import { useAuth } from '../lib/auth';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import {
  Sun, Lightbulb, CloudRain, Droplet, Battery, BatteryMedium, BatteryLow, Power, Wind, Fan,
  Activity, Video, Zap, Flame, Snowflake, Home, Thermometer, ThermometerSun, ThermometerSnowflake,
  Leaf, Bot, QrCode, RadioReceiver
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { SettingsPanel } from '../components/SettingsPanel';
import { HarvestWidget } from '../components/HarvestWidget';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { CameraStream } from '../components/CameraStream';
import { hardwareService } from '../lib/hardwareService';

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function SectionTitle({
  icon: Icon,
  children,
  action
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Icon size={16} className="text-muted-foreground" aria-hidden="true" />
        {children}
      </span>
      {action}
    </div>
  );
}

/** Instrument-style readout: large tabular number, quiet unit beneath. */
function Readout({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-baseline gap-1">
        <span className="font-mono tabular text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function StateNote({
  icon: Icon,
  tone,
  children
}: {
  icon: React.ElementType;
  tone: 'success' | 'info' | 'warning';
  children: React.ReactNode;
}) {
  const toneCls =
    tone === 'success' ? 'text-success' : tone === 'info' ? 'text-info' : 'text-warning';
  return (
    <span className={cn('flex w-16 flex-col items-center gap-1 text-[11px]', toneCls)}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

function CircularGauge({ value, max, unit, label }: { value: number; max: number; unit: string; label: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), max);
  const offset = circumference - (clamped / max) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-32 w-32">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} className="stroke-muted" strokeWidth="6" fill="none" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="var(--brand)"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-700 ease-out"
            style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono tabular text-2xl font-semibold">
            {Number(value).toFixed(1)}
          </span>
          <span className="text-[11px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Device toggle                                                       */
/* ------------------------------------------------------------------ */

// Monitoring Mode Lock: physical actuation stays disabled while hardware verification is in progress.
// Mirrors the monitoring lock used across the dashboard (see MonitoringModeBanner).
const MONITORING_MODE_LOCKED = true;

function DeviceToggle({ label, stateKey, topic, icon: Icon, statusActive = 'Active', statusIdle = 'Off' }: any) {
  const active = useStoreValue(stateKey, false);
  const { publish, status } = useMqtt();
  const [interlockWarning, setInterlockWarning] = useState<string | null>(null);

  const toggle = async () => {
    if (MONITORING_MODE_LOCKED) return;
    try {
      const newState = !active;

      // Map stateKey to hardware device
      let res: { success: boolean; message: string; interlockTriggered?: boolean } | null = null;
      if (stateKey === 'roofActive') {
        res = await hardwareService.setRoof(newState ? 'open' : 'close');
      } else if (stateKey === 'pumpActive') {
        res = await hardwareService.setOverride('pump', newState ? 'on' : 'off');
      } else if (stateKey === 'fanActive' || stateKey === 'peltierFan1Active' || stateKey === 'peltierFan2Active') {
        res = await hardwareService.setOverride('fan', newState ? 'on' : 'off');
      } else if (stateKey === 'heaterActive') {
        res = await hardwareService.setOverride('heater', newState ? 'on' : 'off');
      } else if (stateKey === 'peltierActive') {
        res = await hardwareService.setOverride('peltier', newState ? 'on' : 'off');
      } else if (stateKey === 'lightActive') {
        res = await hardwareService.setOverride('light', newState ? 'on' : 'off');
      }

      if (res && res.interlockTriggered) {
        setInterlockWarning(res.message);
        setTimeout(() => setInterlockWarning(null), 4000);
        store.setRow('activityLog', Date.now().toString(), {
          timestamp: new Date().toISOString(),
          type: 'alert',
          message: res.message
        });
        return;
      }

      store.setValue(stateKey, newState);
      store.setRow('activityLog', Date.now().toString(), {
        timestamp: new Date().toISOString(),
        type: 'info',
        message: `${label} switched ${newState ? 'on' : 'off'} by user.`,
        topic
      });

      if (status !== 'demo') {
        publish(topic, newState ? 'ON' : 'OFF');
      }
    } catch (e: any) {
      console.error(e);
      setInterlockWarning(e.message || 'Command failed to execute');
      setTimeout(() => setInterlockWarning(null), 3000);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={MONITORING_MODE_LOCKED}
        title={MONITORING_MODE_LOCKED ? 'Physical control disabled in Monitoring Mode' : undefined}
        onClick={toggle}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors',
          MONITORING_MODE_LOCKED ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted/50'
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
              active
                ? 'border-brand/30 bg-accent text-brand'
                : 'border-border bg-muted/50 text-muted-foreground'
            )}
          >
            <Icon size={17} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{label}</span>
            <span className={cn('block text-xs', active ? 'text-success' : 'text-muted-foreground')}>
              {active ? statusActive : statusIdle}
            </span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
            active ? 'bg-primary' : 'bg-input'
          )}
        >
          <span
            className={cn(
              'size-4 rounded-full bg-white shadow-sm transition-transform',
              active ? 'translate-x-5' : 'translate-x-1'
            )}
          />
        </span>
      </button>

      {interlockWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-snug text-warning">
          <span className="shrink-0">Safety interlock</span>
          <span>{interlockWarning}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

export default function ControlCenter() {
  const temp = useStoreValue('temperature', 24.5);
  const humidity = useStoreValue('humidity', 62);
  const soilMoisture = useStoreValue('soilMoisture', 48);
  const sunlight = useStoreValue('sunlight', 650);
  const growLight = useStoreValue('growLight', 380);
  const rain = useStoreValue('rain', false);
  const waterLevel = useStoreValue('waterLevel', 76);
  const batteryVoltage = useStoreValue('batteryVoltage', 12.3);
  const rainGaugeLevel = useStoreValue('rainGaugeLevel', 25);
  const logTable = useStoreTable('activityLog');

  const climateAgent = useStoreValue('agent_ClimateAgent_enabled', true);
  const irrigationAgent = useStoreValue('agent_IrrigationAgent_enabled', true);
  const visionAgent = useStoreValue('agent_VisionAgent_enabled', false);
  const harvestAgent = useStoreValue('agent_HarvestAgent_enabled', false);
  const alertAgent = useStoreValue('agent_AlertAgent_enabled', false);

  const climateAgentLastRun = useStoreValue('agent_ClimateAgent_lastRun', 'Never');
  const irrigationAgentLastRun = useStoreValue('agent_IrrigationAgent_lastRun', 'Never');
  const visionAgentLastRun = useStoreValue('agent_VisionAgent_lastRun', 'Never');
  const harvestAgentLastRun = useStoreValue('agent_HarvestAgent_lastRun', 'Never');
  const alertAgentLastRun = useStoreValue('agent_AlertAgent_lastRun', 'Never');

  const camUrl = useStoreValue('cameraUrl', import.meta.env.VITE_ESP32_CAM_STREAM_URL || '');

  const logContainerRef = useRef<HTMLDivElement>(null);

  const pendingActions = useStoreTable('pendingActions') || {};
  const pendingActionsEntries = Object.entries(pendingActions).sort(([, a]: any, [, b]: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const { publish, status } = useMqtt();

  const handleApprove = (id: string, actionData: any) => {
    // Monitoring Mode Lock: record the farmer's advisory decision without dispatching physical MQTT actuation
    void publish;
    store.setRow('activityLog', Date.now().toString() + id, {
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Approved recommendation (advisory recorded — physical control disabled in Monitoring Mode): ${actionData.action || 'Advisory recorded'}`
    });
    // Remove from pending
    store.delRow('pendingActions', id);
  };

  const handleDecline = (id: string, actionData: any) => {
    store.setRow('activityLog', Date.now().toString() + id, {
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `EDEN proposed: ${actionData.action} — ${actionData.reason}. Declined by user.`
    });
    store.delRow('pendingActions', id);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logTable]);

  const activityEntries = Object.entries(logTable || {})
    .sort(([, a]: any, [, b]: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-50); // Ascending order, taking the last 50 entries so bottom is newest

  const typeChipCls = (type: string) =>
    type === 'error' || type === 'alert'
      ? 'bg-destructive/10 text-destructive'
      : type === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-muted text-muted-foreground';

  const typeDotCls = (type: string) =>
    type === 'error' || type === 'alert'
      ? 'bg-destructive'
      : type === 'warning'
        ? 'bg-warning'
        : 'bg-border';

  const stripEmoji = (msg: string) => msg.replace(/^[📸🌾🤖🚨💧]\s*/, '');

  const activeAgentsCount = [climateAgent, irrigationAgent, visionAgent, harvestAgent, alertAgent].filter(Boolean).length;
  const { greenhouses, activeGreenhouse } = useAuth();

  const batteryPct = Math.min(
    100,
    Math.max(0, Math.round(((batteryVoltage - 10.5) / (12.6 - 10.5)) * 100))
  );
  const batteryTone = batteryPct > 60 ? 'text-success' : batteryPct >= 30 ? 'text-warning' : 'text-destructive';
  const BatteryIcon = batteryPct > 60 ? Battery : batteryPct >= 30 ? BatteryMedium : BatteryLow;

  const agents: Array<{ key: string; name: string; enabled: boolean; lastRun: string }> = [
    { key: 'ClimateAgent', name: 'Climate agent', enabled: climateAgent, lastRun: climateAgentLastRun },
    { key: 'IrrigationAgent', name: 'Irrigation agent', enabled: irrigationAgent, lastRun: irrigationAgentLastRun },
    { key: 'VisionAgent', name: 'Vision agent', enabled: visionAgent, lastRun: visionAgentLastRun },
    { key: 'HarvestAgent', name: 'Harvest agent', enabled: harvestAgent, lastRun: harvestAgentLastRun },
    { key: 'AlertAgent', name: 'Alert agent', enabled: alertAgent, lastRun: alertAgentLastRun }
  ];

  return (
    <div className="space-y-6">
      <MonitoringModeBanner />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live readings, recommendations and device control.
          </p>
        </div>
        <SettingsPanel />
      </div>

      {/* Active greenhouse status */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        {activeGreenhouse ? (
          <>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold">{activeGreenhouse.name}</span>
                <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                  {activeGreenhouse.overallStatus}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {greenhouses.length} authorized greenhouse{greenhouses.length === 1 ? '' : 's'} ·
                Camera {activeGreenhouse.camera.connectionStatus.toLowerCase()} · Controller{' '}
                {activeGreenhouse.controller.connectionStatus.toLowerCase()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                to={`/greenhouses/${activeGreenhouse.id}`}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open greenhouse
              </Link>
              <Link
                to="/greenhouses"
                className="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                Switch
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Connect your greenhouse kit</div>
              <p className="text-xs text-muted-foreground">
                Scan the QR code on your kit or run the setup wizard to enroll the ESP32
                controller and camera.
              </p>
            </div>
            <Link
              to="/greenhouses"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <QrCode size={15} aria-hidden="true" /> Enroll a kit
            </Link>
          </>
        )}
      </div>

      {/* Real Hardware / Simulated / Cached / Disconnected banner */}
      <DataSourceBadge variant="banner" />

      {/* EDEN's recommendations */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <SectionTitle
            icon={Bot}
            action={
              pendingActionsEntries.length > 0 ? (
                <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  {pendingActionsEntries.length} pending
                </span>
              ) : undefined
            }
          >
            EDEN’s recommendations
          </SectionTitle>
        </CardHeader>
        <CardContent className="p-4">
          {pendingActionsEntries.length === 0 ? (
            <div className="flex items-center gap-2.5 py-4 text-sm text-muted-foreground">
              <Bot size={18} aria-hidden="true" />
              Nothing needs your approval right now. EDEN asks before it acts.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingActionsEntries.map(([id, action]: any) => (
                <div key={id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Bot size={14} aria-hidden="true" />
                    <span className="font-medium">{action.agent}</span>
                    <span aria-hidden="true">·</span>
                    <time className="font-mono tabular">{format(new Date(action.timestamp), 'HH:mm:ss')}</time>
                    {action.isCritical && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        Critical
                      </span>
                    )}
                  </div>
                  <h4 className="mt-2 flex items-center gap-2 text-sm font-semibold">
                    <Zap size={14} className="text-warning" aria-hidden="true" />
                    {action.action}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">{action.reason}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleDecline(id, action)}>
                      Decline
                    </Button>
                    <Button size="sm" onClick={() => handleApprove(id, action)}>
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <HarvestWidget />

      {/* Main grid — ordered by importance, one row per concern */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Environment */}
        <Card id="tour-env-gauges">
          <CardHeader className="border-b border-border pb-3">
            <SectionTitle icon={Activity}>Environment</SectionTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="flex items-start justify-around gap-2">
              <div className="flex flex-col items-center gap-3">
                <CircularGauge value={temp} max={50} unit="°C" label="Temperature" />
                <div className="flex gap-2">
                  <StateNote icon={ThermometerSnowflake} tone={temp < 18 ? 'info' : 'success'}>
                    {temp < 18 ? 'Cold' : 'Normal'}
                  </StateNote>
                  <StateNote icon={ThermometerSun} tone={temp > 30 ? 'warning' : 'success'}>
                    {temp > 30 ? 'Hot' : 'Normal'}
                  </StateNote>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <CircularGauge value={humidity} max={100} unit="%" label="Humidity" />
                <div className="flex gap-2">
                  <StateNote icon={Leaf} tone={humidity < 40 ? 'warning' : 'success'}>
                    {humidity < 40 ? 'Dry' : 'Normal'}
                  </StateNote>
                  <StateNote icon={Droplet} tone={humidity > 80 ? 'info' : 'success'}>
                    {humidity > 80 ? 'Wet' : 'Normal'}
                  </StateNote>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Water system */}
        <Card id="tour-water-system">
          <CardHeader className="border-b border-border pb-3">
            <SectionTitle icon={Droplet}>Water</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Soil moisture</span>
                <span className="font-mono tabular text-sm font-medium">{soilMoisture}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, soilMoisture))}%` }}
                />
              </div>
            </div>

            <div className="flex gap-4">
              {/* Reservoir */}
              <div className="flex flex-1 items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex h-20 w-5 flex-col justify-end overflow-hidden rounded-full bg-muted">
                  <div
                    className="w-full bg-info transition-[height] duration-500 ease-out"
                    style={{ height: `${Math.min(100, Math.max(0, waterLevel))}%` }}
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Reservoir</div>
                  <div className="font-mono tabular text-xl font-semibold">{waterLevel}%</div>
                </div>
              </div>

              {/* Rain */}
              <div
                className={cn(
                  'flex-1 rounded-lg border p-3 transition-colors',
                  rain ? 'border-info/40 bg-info/10' : 'border-border bg-muted/40'
                )}
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CloudRain size={14} className={cn(rain ? 'text-info' : '')} aria-hidden="true" />
                  Rain status
                </div>
                <div className={cn('mt-1 text-sm font-medium', rain ? 'text-info' : 'text-foreground')}>
                  {rain ? 'Raining now' : 'No rain'}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Gauge{' '}
                  <span className="font-mono tabular font-medium text-foreground">
                    {Number(rainGaugeLevel).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Light & power */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <SectionTitle icon={Sun}>Light & power</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <Sun size={18} className="text-muted-foreground" aria-hidden="true" />
                <div className="mt-2">
                  <Readout value={String(sunlight)} unit="lux" label="Sunlight" />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <Lightbulb size={18} className="text-muted-foreground" aria-hidden="true" />
                <div className="mt-2">
                  <Readout value={String(growLight)} unit="lux" label="Grow light" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div className="flex items-center gap-3">
                <span className={cn('flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50', batteryTone)}>
                  <BatteryIcon size={17} aria-hidden="true" />
                </span>
                <div>
                  <div className="text-sm font-medium">Battery</div>
                  <div className="font-mono tabular text-xs text-muted-foreground">
                    {Number(batteryVoltage).toFixed(2)} V DC
                  </div>
                </div>
              </div>
              <div className="w-24 text-right">
                <div className="font-mono tabular text-lg font-semibold">{batteryPct}%</div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-500',
                      batteryPct > 60 ? 'bg-success' : batteryPct >= 30 ? 'bg-warning' : 'bg-destructive'
                    )}
                    style={{ width: `${batteryPct}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Device controls */}
        <Card id="tour-device-controls">
          <CardHeader className="border-b border-border pb-3">
            <SectionTitle icon={Power}>Device controls</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Thermometer size={13} aria-hidden="true" /> Heating & cooling
              </div>
              <DeviceToggle label="Heater" stateKey="heaterActive" topic="greenhouse/control/heater" icon={Flame} />
              <DeviceToggle label="Peltier module" stateKey="peltierActive" topic="greenhouse/control/peltier" icon={Snowflake} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Wind size={13} aria-hidden="true" /> Ventilation
              </div>
              <DeviceToggle label="Circulation fan" stateKey="fanActive" topic="greenhouse/control/fan" icon={Wind} />
              <DeviceToggle label="Peltier fan 1" stateKey="peltierFan1Active" topic="greenhouse/control/peltier_fan1" icon={Fan} />
              <DeviceToggle label="Peltier fan 2" stateKey="peltierFan2Active" topic="greenhouse/control/peltier_fan2" icon={Fan} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Droplet size={13} aria-hidden="true" /> Irrigation
              </div>
              <DeviceToggle label="Water pump" stateKey="pumpActive" topic="greenhouse/control/pump" icon={Droplet} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Lightbulb size={13} aria-hidden="true" /> Lighting
              </div>
              <DeviceToggle label="Grow light" stateKey="lightActive" topic="greenhouse/control/light" icon={Lightbulb} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Home size={13} aria-hidden="true" /> Structure
              </div>
              <DeviceToggle
                label="Automated roof"
                stateKey="roofActive"
                topic="greenhouse/control/roof"
                icon={Home}
                statusActive="Open"
                statusIdle="Closed"
              />
            </div>
          </CardContent>
        </Card>

        {/* Camera */}
        <div className="space-y-4">
          <Card className="flex flex-col">
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle
                icon={Video}
                action={
                  <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                    Live
                  </span>
                }
              >
                Camera stream
              </SectionTitle>
            </CardHeader>
            <CardContent className="flex-1 p-4">
              <CameraStream showControls={true} />
            </CardContent>
          </Card>

          <Dialog>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="group relative block w-full cursor-pointer rounded-lg border border-border bg-muted/30 p-0 transition-colors hover:bg-muted/60"
                />
              }
            >
              <img
                src="https://i.imgur.com/pIYgcNO.png"
                alt="ESP32 camera setup diagram"
                className="h-36 w-full rounded-lg object-contain p-2 md:h-48"
              />
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                <span className="rounded-lg bg-background/85 px-3 py-1.5 text-xs font-medium shadow-sm">
                  View setup diagram
                </span>
              </span>
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] overflow-hidden p-2 sm:max-w-4xl">
              <DialogHeader className="sr-only">
                <DialogTitle>Camera setup diagram</DialogTitle>
              </DialogHeader>
              <img
                src="https://i.imgur.com/pIYgcNO.png"
                alt="ESP32 camera setup diagram"
                className="max-h-[85vh] w-full rounded-lg object-contain"
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* AI agents */}
        <Card className="flex flex-col">
          <CardHeader className="border-b border-border pb-3">
            <SectionTitle
              icon={Bot}
              action={
                <span className="text-xs font-medium text-muted-foreground">
                  {activeAgentsCount} of {agents.length} on
                </span>
              }
            >
              AI agents
            </SectionTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {agents.map((agent) => (
              <Label
                key={agent.key}
                className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    onChange={(e) => store.setValue(`agent_${agent.key}_enabled`, e.target.checked)}
                    className="size-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{agent.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      Last run:{' '}
                      {agent.lastRun !== 'Never'
                        ? new Date(agent.lastRun as string).toLocaleTimeString()
                        : 'never'}
                    </span>
                  </span>
                </span>
                <Bot
                  size={16}
                  className={agent.enabled ? 'text-brand' : 'text-muted-foreground/50'}
                  aria-hidden="true"
                />
              </Label>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 5 Specialized Agronomy Agents Hub */}
      <AgronomyAgentsPanel />

      {/* Activity log */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <SectionTitle icon={RadioReceiver}>Activity log</SectionTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={logContainerRef}
            className="custom-scrollbar h-[420px] overflow-y-auto px-2 py-2"
          >
            {activityEntries.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                No activity yet. Actions you take will appear here.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {activityEntries.map(([id, entry]: any) => (
                  <li key={id} className="flex gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40">
                    <span
                      className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', typeDotCls(entry.type))}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <time className="font-mono tabular text-xs text-muted-foreground">
                          {format(new Date(entry.timestamp), 'MMM dd · HH:mm:ss')}
                        </time>
                        {entry.type !== 'info' && (
                          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium capitalize', typeChipCls(entry.type))}>
                            {entry.type}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] leading-relaxed">
                        {stripEmoji(entry.message).includes(':') ? (
                          <>
                            <span className="font-semibold">
                              {stripEmoji(entry.message).split(':')[0]}:
                            </span>
                            <span className="text-muted-foreground">
                              {stripEmoji(entry.message).substring(stripEmoji(entry.message).indexOf(':') + 1)}
                            </span>
                          </>
                        ) : (
                          <span>{stripEmoji(entry.message)}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
