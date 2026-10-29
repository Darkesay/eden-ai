import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Droplets,
  Info,
  Leaf,
  MessageSquareText,
  Mic,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Sun,
  Thermometer,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import {
  type EnvironmentalMetricSummary,
  formatRelativeAge,
  useFarmerGreenhouseState
} from '../lib/greenhouseState';
import { useMqtt } from '../lib/mqtt';
import { store, useStoreTable } from '../lib/store';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { HarvestWidget } from '../components/HarvestWidget';
import { QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

interface LatestPlantAssessment {
  species: string;
  healthStatus: string;
  recommendation: string;
  timestamp: string | null;
  sourceLabel: string;
}

function MetricCard({
  metric,
  icon: Icon,
  lastUpdatedText
}: {
  metric: EnvironmentalMetricSummary;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  lastUpdatedText: string;
}) {
  const isAvailable = metric.value !== null && metric.status !== 'unavailable';

  // Compute position along visual bar [targetMin - pad ... targetMax + pad]
  const span = Math.max(4, metric.targetMax - metric.targetMin);
  const scaleMin = Math.max(0, metric.targetMin - span * 0.5);
  const scaleMax = metric.targetMax + span * 0.5;
  const targetLeftPct = ((metric.targetMin - scaleMin) / (scaleMax - scaleMin)) * 100;
  const targetWidthPct = ((metric.targetMax - metric.targetMin) / (scaleMax - scaleMin)) * 100;
  const markerPct =
    metric.value !== null
      ? Math.max(2, Math.min(98, ((metric.value - scaleMin) / (scaleMax - scaleMin)) * 100))
      : null;

  const statusTone =
    metric.status === 'within'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800/60'
      : metric.status === 'low' || metric.status === 'high'
        ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
        : 'bg-muted text-muted-foreground border-border';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-primary shrink-0">
              <Icon size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{metric.label}</h3>
              <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                Target: {metric.targetMin}–{metric.targetMax}
                {metric.unit}
              </p>
            </div>
          </div>

          <span
            className={cn(
              'text-[11px] font-medium px-2.5 py-1 rounded-md border whitespace-nowrap shrink-0',
              statusTone
            )}
          >
            {metric.status === 'within'
              ? 'Within Target'
              : metric.status === 'low'
                ? 'Below Target'
                : metric.status === 'high'
                  ? 'Above Target'
                  : 'Unavailable'}
          </span>
        </div>

        <div className="pt-1">
          {isAvailable ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums tracking-tight text-foreground">
                {metric.formattedValue}
              </span>
              <span className="text-xs text-muted-foreground">{metric.provenanceLabel}</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="text-2xl font-semibold text-muted-foreground">Unavailable</div>
              <p className="text-xs text-muted-foreground">No live reading received yet</p>
            </div>
          )}
        </div>

        {/* Visual Target Band */}
        <div className="space-y-1.5 pt-1">
          <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="absolute top-0 bottom-0 bg-emerald-500/25 rounded-full"
              style={{
                left: `${Math.max(0, targetLeftPct)}%`,
                width: `${Math.min(100, targetWidthPct)}%`
              }}
              title={`Ideal range: ${metric.targetMin}–${metric.targetMax}${metric.unit}`}
            />
            {markerPct !== null && (
              <div
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white dark:border-card shadow-xs transition-all duration-200',
                  metric.status === 'within' ? 'bg-primary' : 'bg-amber-600 dark:bg-amber-400'
                )}
                style={{ left: `${markerPct}%` }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{metric.guidance}</p>
        </div>
      </div>

      <div className="pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Source: {metric.provenanceLabel}</span>
        <span className="font-mono tabular-nums">{lastUpdatedText}</span>
      </div>
    </div>
  );
}

export default function ControlCenter() {
  const navigate = useNavigate();
  const { refreshSession, setActiveGreenhouseId } = useAuth();
  const { publish } = useMqtt();
  const ghState = useFarmerGreenhouseState();

  const [refreshing, setRefreshing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrBanner, setQrBanner] = useState<string | null>(null);
  const [latestCropCheck, setLatestCropCheck] = useState<LatestPlantAssessment | null>(null);

  const pendingActions = useStoreTable('pendingActions') || {};
  const aiHistoryTable = useStoreTable('ai_history') || {};

  // Load real crop assessment from backend greenhouse observations or local plant inspection log
  useEffect(() => {
    let cancelled = false;
    const activeId = ghState.activeGreenhouse?.id;

    if (activeId) {
      apiFetch(`/api/greenhouses/${activeId}`)
        .then((res) => parseApiJsonResponse<any>(res))
        .then((parsed) => {
          const data = parsed.ok ? parsed.data : null;
          if (cancelled || !data) return;
          const camAnalysis = data.latestCamera?.analysis;
          if (camAnalysis && camAnalysis.healthStatus) {
            setLatestCropCheck({
              species: camAnalysis.species || ghState.cropName,
              healthStatus: camAnalysis.healthStatus,
              recommendation: camAnalysis.recommendation || 'Open Plant Vision to review full details.',
              timestamp: data.latestCamera?.capturedAt || data.latestCamera?.timestamp || null,
              sourceLabel: 'Greenhouse Camera Photo'
            });
            return;
          }
          const obs = Array.isArray(data.observations) ? data.observations[0] : null;
          if (obs && obs.summary) {
            setLatestCropCheck({
              species: ghState.cropName,
              healthStatus: obs.healthStatus || obs.category || 'Inspected',
              recommendation: obs.recommendation || obs.summary,
              timestamp: obs.createdAt || null,
              sourceLabel: 'Saved Crop Assessment'
            });
            return;
          }
          setLatestCropCheck(null);
        })
        .catch(() => {
          if (!cancelled) setLatestCropCheck(null);
        });
    } else {
      const entries = Object.values(aiHistoryTable) as any[];
      if (entries.length > 0) {
        const sorted = [...entries].sort(
          (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
        );
        const latest = sorted[0];
        if (latest && latest.healthStatus) {
          setLatestCropCheck({
            species: latest.species || ghState.cropName,
            healthStatus: latest.healthStatus,
            recommendation: latest.recommendation || '',
            timestamp: latest.timestamp || null,
            sourceLabel: 'Uploaded Leaf Photo'
          });
        } else {
          setLatestCropCheck(null);
        }
      } else {
        setLatestCropCheck(null);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [ghState.activeGreenhouse?.id, ghState.cropName, aiHistoryTable]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refreshSession();
    setRefreshing(false);
  };

  const handleQrDetected = async (rawCodeOrUri: string) => {
    setQrBanner(null);
    const res = await apiFetch('/api/enrollments/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrPayload: rawCodeOrUri })
    });
    const parsed = await parseApiJsonResponse<any>(res);
    if (!parsed.ok || !parsed.data?.success) {
      throw new Error(!parsed.ok ? parsed.message : parsed.data?.message || 'QR code could not be verified.');
    }
    const data = parsed.data;
    setScannerOpen(false);
    await refreshSession();
    if (data.greenhouse?.id) {
      setActiveGreenhouseId(data.greenhouse.id);
      if (data.action === 'claimed_kit') {
        navigate(`/greenhouses/${data.greenhouse.id}/setup`);
      } else {
        setQrBanner(`Connected to ${data.greenhouse.name}.`);
      }
    }
  };

  const handleApprovePendingAction = (id: string, act: any) => {
    if (act?.topic && act?.payload) {
      publish(String(act.topic), String(act.payload));
    }
    store.delRow('pendingActions', id);
    store.setRow('activityLog', `${Date.now()}_approved`, {
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Approved recommendation: ${act?.action || 'Action applied'}`
    });
  };

  const handleDismissPendingAction = (id: string) => {
    store.delRow('pendingActions', id);
  };

  const lastUpdatedText = formatRelativeAge(ghState.lastUpdatedAgeSeconds, ghState.lastUpdatedAt);
  const connectionIsGood = ghState.overallConnectionState === 'CONNECTED';
  const connectionIsWarn =
    ghState.overallConnectionState === 'PARTIAL' ||
    ghState.overallConnectionState === 'STALE' ||
    ghState.overallConnectionState === 'WAITING_CHECKIN';

  const quickQuestions = [
    `Are my ${ghState.cropName} conditions healthy today?`,
    `How much water does ${ghState.cropName} need right now?`,
    `How do I prevent yellow leaves and fungus naturally?`
  ];

  return (
    <div className="space-y-6">
      {/* Honest Source Banner whenever not on live verified hardware */}
      {ghState.provenance !== 'REAL_HARDWARE' && <DataSourceBadge variant="banner" />}

      {qrBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={17} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
            {qrBanner}
          </span>
          <button
            type="button"
            onClick={() => setQrBanner(null)}
            className="text-emerald-800 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100 cursor-pointer"
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 1. Greenhouse Connection & Status Overview Card */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap shrink-0',
                  connectionIsGood
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800/60'
                    : connectionIsWarn
                      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
                      : ghState.overallConnectionState === 'SIMULATION'
                        ? 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/45 dark:text-indigo-300 dark:border-indigo-800/60'
                        : 'bg-muted text-muted-foreground border-border'
                )}
              >
                {connectionIsGood ? <Wifi size={13} /> : <WifiOff size={13} />}
                {ghState.connectionHeadline}
              </span>

              <span className="text-xs text-muted-foreground font-medium">
                {ghState.greenhouseName} · {ghState.cropName}
              </span>

              <span className="text-xs text-muted-foreground font-mono tabular-nums flex items-center gap-1">
                <Clock size={12} /> {lastUpdatedText}
              </span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {connectionIsGood
                ? `${ghState.greenhouseName} is online and reporting normally`
                : ghState.overallConnectionState === 'SIMULATION'
                  ? 'Welcome to your EDENS AI Farm Workspace'
                  : ghState.connectionHeadline}
            </h1>

            <p className="text-sm text-muted-foreground leading-relaxed">
              {ghState.connectionSummary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setScannerOpen(true)}
              className="h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <QrCode size={15} className="mr-1.5 text-primary" />
              Scan Kit QR
            </Button>

            <Link
              to={ghState.nextActionTo}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <span>{ghState.nextActionLabel}</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Compact Secondary Readings Strip when available */}
        <div className="mt-5 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="flex items-center justify-between sm:justify-start sm:gap-2">
            <span className="text-muted-foreground">Water Tank:</span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {ghState.secondaryReadings.waterLevel !== null
                ? `${Math.round(ghState.secondaryReadings.waterLevel)}%`
                : 'Unavailable'}
            </span>
          </div>
          <div className="flex items-center justify-between sm:justify-start sm:gap-2">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sun size={13} className="text-amber-600 dark:text-amber-400" /> Sunlight:
            </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {ghState.secondaryReadings.sunlight !== null
                ? `${Math.round(ghState.secondaryReadings.sunlight)} lux`
                : 'Unavailable'}
            </span>
          </div>
          <div className="flex items-center justify-between sm:justify-start sm:gap-2">
            <span className="text-muted-foreground">Battery:</span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {ghState.secondaryReadings.batteryVoltage !== null
                ? `${ghState.secondaryReadings.batteryVoltage.toFixed(1)} V`
                : 'Unavailable'}
            </span>
          </div>
          <div className="flex items-center justify-between sm:justify-start sm:gap-2">
            <span className="text-muted-foreground">Weather Sensor:</span>
            <span className="font-semibold text-foreground">
              {ghState.secondaryReadings.rain === null
                ? 'Unavailable'
                : ghState.secondaryReadings.rain
                  ? 'Rain Detected'
                  : 'Dry / Clear'}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Key Environmental Readings vs Targets */}
      <section aria-label="Environmental Readings" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Greenhouse Conditions</h2>
          <Link
            to="/settings?tab=targets"
            className="text-xs font-medium text-primary hover:underline underline-offset-4"
          >
            Adjust crop targets
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            metric={ghState.metrics.temperature}
            icon={Thermometer}
            lastUpdatedText={lastUpdatedText}
          />
          <MetricCard
            metric={ghState.metrics.humidity}
            icon={Droplets}
            lastUpdatedText={lastUpdatedText}
          />
          <MetricCard
            metric={ghState.metrics.soilMoisture}
            icon={Sprout}
            lastUpdatedText={lastUpdatedText}
          />
        </div>
      </section>

      {/* 3. Two-Column Actionable Alerts + Ask EDENS AI & Crop Health */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Needs Attention & Actionable Alerts */}
        <section className="lg:col-span-7 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">What Needs Attention</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plain-language alerts explaining what happened and what to do next.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">
              {ghState.alerts.length} {ghState.alerts.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Pending simulated/local approval actions if any */}
          {Object.entries(pendingActions).length > 0 && (
            <div className="space-y-2.5">
              {Object.entries(pendingActions).map(([id, act]: [string, any]) => (
                <div
                  key={id}
                  className="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">{act.action}</p>
                    <p className="text-xs text-amber-900 dark:text-amber-200/90">{act.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleApprovePendingAction(id, act)}
                      className="h-9 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                    >
                      <Check size={14} className="mr-1" /> Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleDismissPendingAction(id)}
                      className="h-9 px-3 text-xs font-semibold cursor-pointer"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {ghState.alerts.filter((a) => !a.id.startsWith('pending-')).length === 0 &&
          Object.keys(pendingActions).length === 0 ? (
            <div className="rounded-xl bg-muted/50 p-6 text-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/45 dark:border-emerald-800/60 text-primary flex items-center justify-center mx-auto">
                <ShieldCheck size={20} />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {ghState.provenance === 'UNAVAILABLE'
                  ? 'No active alerts while hardware is offline'
                  : 'Everything is within your target range'}
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                {ghState.provenance === 'UNAVAILABLE'
                  ? 'Connect your greenhouse controller to start receiving automatic temperature, humidity, and watering alerts.'
                  : `Your ${ghState.cropName} environment looks steady. Check Plant Vision periodically to inspect leaves.`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {ghState.alerts
                .filter((a) => !a.id.startsWith('pending-'))
                .map((alert) => {
                  const Icon =
                    alert.severity === 'critical' || alert.severity === 'warning'
                      ? AlertTriangle
                      : Info;
                  const iconColor =
                    alert.severity === 'critical'
                      ? 'text-red-600 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/45 dark:border-red-800/60'
                      : alert.severity === 'warning'
                        ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/45 dark:border-amber-800/60'
                        : 'text-primary bg-accent border-primary/20';

                  return (
                    <div key={alert.id} className="py-4 first:pt-1 last:pb-1 flex items-start gap-3.5">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5',
                          iconColor
                        )}
                      >
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">{alert.title}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          <strong className="font-medium text-foreground">What happened:</strong>{' '}
                          {alert.whatHappened}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          <strong className="font-medium text-foreground">What to do next:</strong>{' '}
                          {alert.nextStep}
                        </p>
                        {alert.actionLabel && alert.actionTo && (
                          <div className="pt-1.5">
                            <Link
                              to={alert.actionTo}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline underline-offset-4"
                            >
                              <span>{alert.actionLabel}</span>
                              <ArrowRight size={13} />
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* Right Column: Prominent Ask EDENS AI + Crop Health & Harvest */}
        <div className="lg:col-span-5 space-y-6">
          {/* Ask EDENS AI Card */}
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <MessageSquareText size={19} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Ask EDENS AI</h2>
                  <p className="text-xs text-muted-foreground">
                    Farming advice in English, Hausa, Yoruba, Igbo, Pidgin &amp; more
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Tap a question to ask:</p>
              <div className="space-y-2">
                {quickQuestions.map((q) => (
                  <Link
                    key={q}
                    to={`/assistant?q=${encodeURIComponent(q)}`}
                    className="block rounded-xl border border-border bg-muted/40 hover:bg-accent/60 hover:border-primary/30 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors"
                  >
                    “{q}”
                  </Link>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <Link
                to="/assistant?voice=1"
                className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition-colors whitespace-nowrap"
              >
                <Mic size={15} className="text-primary" />
                <span>Speak Question</span>
              </Link>
              <Link
                to="/assistant"
                className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <MessageSquareText size={15} />
                <span>Open AI Assistant</span>
              </Link>
            </div>
          </section>

          {/* Crop Health Summary Card (Only from genuine assessments) */}
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-accent text-primary flex items-center justify-center shrink-0">
                  <Leaf size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Crop Health Check</h2>
                  <p className="text-xs text-muted-foreground">Based on verified leaf photos</p>
                </div>
              </div>
              <Link
                to="/vision"
                className="text-xs font-semibold text-primary hover:underline underline-offset-4 whitespace-nowrap"
              >
                Open Plant Vision
              </Link>
            </div>

            {latestCropCheck ? (
              <div className="rounded-xl bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {latestCropCheck.species} — {latestCropCheck.healthStatus}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                    {latestCropCheck.timestamp
                      ? formatRelativeAge(null, latestCropCheck.timestamp)
                      : latestCropCheck.sourceLabel}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {latestCropCheck.recommendation}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/50 p-4 space-y-2.5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No plant leaf inspection has been run yet. Check a fresh greenhouse camera snapshot or upload a leaf photo from your phone.
                </p>
                <Link
                  to="/vision"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline underline-offset-4"
                >
                  <Camera size={14} />
                  <span>Inspect a Plant Photo</span>
                </Link>
              </div>
            )}
          </section>

          {/* Harvest Timeline Card */}
          <HarvestWidget />
        </div>
      </div>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
