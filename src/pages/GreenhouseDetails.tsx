import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Sprout,
  Sun,
  Thermometer,
  Umbrella,
  Waves,
  Wrench
} from 'lucide-react';
import { apiFetch, resolveApiUrl, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { formatExplicitDeviceState, formatRelativeAge } from '../lib/greenhouseState';
import { hardwareService, DEFAULT_CROPS } from '../lib/hardwareService';
import { useMqtt } from '../lib/mqtt';
import { useStoreValue } from '../lib/store';
import { QrCodeCard } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

interface TrendSample {
  timestamp: string;
  temperature: number | null;
  humidity: number | null;
  soilMoisture: number | null;
}

function EnvironmentalTrendChart({
  samples,
  tempMin,
  tempMax
}: {
  samples: TrendSample[];
  tempMin: number;
  tempMax: number;
}) {
  const validTempSamples = samples.filter(
    (s) => s.temperature !== null && Number.isFinite(s.temperature)
  );

  if (validTempSamples.length < 2) {
    return (
      <div className="rounded-xl bg-muted/50 p-6 text-center space-y-1.5">
        <p className="text-sm font-semibold text-foreground">
          {validTempSamples.length === 1
            ? 'First reading recorded — collecting trend history'
            : 'Trend chart appears once sensor readings arrive'}
        </p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          EDENS AI plots only genuine sensor updates as they arrive during your monitoring session — never synthetic trend curves.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 180;
  const padX = 36;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const temps = validTempSamples.map((s) => Number(s.temperature));
  const minVal = Math.min(tempMin - 2, ...temps);
  const maxVal = Math.max(tempMax + 2, ...temps);
  const range = Math.max(1, maxVal - minVal);

  const toX = (idx: number) =>
    padX + (idx / Math.max(1, validTempSamples.length - 1)) * innerW;
  const toY = (v: number) => padY + innerH - ((v - minVal) / range) * innerH;

  const linePoints = validTempSamples
    .map((s, idx) => `${toX(idx).toFixed(1)},${toY(Number(s.temperature)).toFixed(1)}`)
    .join(' ');

  const areaPoints = `${toX(0).toFixed(1)},${(padY + innerH).toFixed(1)} ${linePoints} ${toX(
    validTempSamples.length - 1
  ).toFixed(1)},${(padY + innerH).toFixed(1)}`;

  const bandTop = toY(tempMax);
  const bandBottom = toY(tempMin);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Recent Temperature Trend (°C)</span>
        <span className="font-mono tabular-nums">
          Target band: {tempMin}–{tempMax}°C ({validTempSamples.length} readings)
        </span>
      </div>
      <div className="w-full overflow-hidden rounded-xl bg-muted/30 p-3 border border-border">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-40 overflow-visible"
          role="img"
          aria-label="Greenhouse temperature trend chart"
        >
          {/* Target Range Band */}
          <rect
            x={padX}
            y={Math.min(bandTop, bandBottom)}
            width={innerW}
            height={Math.max(4, Math.abs(bandBottom - bandTop))}
            fill="var(--primary)"
            fillOpacity={0.1}
            rx={4}
          />
          <line
            x1={padX}
            y1={bandTop}
            x2={width - padX}
            y2={bandTop}
            stroke="var(--primary)"
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />
          <line
            x1={padX}
            y1={bandBottom}
            x2={width - padX}
            y2={bandBottom}
            stroke="var(--primary)"
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />

          {/* Area Fill & Line */}
          <polygon points={areaPoints} fill="var(--primary)" fillOpacity={0.14} />
          <polyline
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={linePoints}
          />

          {/* Data Points */}
          {validTempSamples.map((s, idx) => (
            <circle
              key={`${s.timestamp}-${idx}`}
              cx={toX(idx)}
              cy={toY(Number(s.temperature))}
              r={3.5}
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth={2}
            />
          ))}

          {/* Y Axis Labels */}
          <text
            x={4}
            y={padY + 4}
            className="fill-muted-foreground text-[10px] font-mono"
          >
            {maxVal.toFixed(0)}°
          </text>
          <text
            x={4}
            y={padY + innerH}
            className="fill-muted-foreground text-[10px] font-mono"
          >
            {minVal.toFixed(0)}°
          </text>
        </svg>
      </div>
    </div>
  );
}

export default function GreenhouseDetails() {
  const { greenhouseId } = useParams<{ greenhouseId: string }>();
  const navigate = useNavigate();
  const { setActiveGreenhouseId, refreshSession } = useAuth();
  const { publish } = useMqtt();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [samples, setSamples] = useState<TrendSample[]>([]);

  const [testingConn, setTestingConn] = useState(false);
  const [connBanner, setConnBanner] = useState<string | null>(null);

  const [controlFeedback, setControlFeedback] = useState<{
    tone: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [busyControl, setBusyControl] = useState<string | null>(null);

  const [shareQr, setShareQr] = useState<{
    tokenId: string;
    qrDataUrl: string;
    enrollmentCode: string;
    expiresAt: string;
  } | null>(null);
  const [issuingQr, setIssuingQr] = useState(false);
  const [showTechSection, setShowTechSection] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  // Actuator states from store / controller
  const pumpActive = Boolean(useStoreValue('pumpActive', false));
  const fanActive = Boolean(useStoreValue('fanActive', false));
  const lightActive = Boolean(useStoreValue('lightActive', false));
  const heaterActive = Boolean(useStoreValue('heaterActive', false));
  const peltierActive = Boolean(useStoreValue('peltierActive', false));
  const roofActive = Boolean(useStoreValue('roofActive', false));

  const fetchDetails = useCallback(async () => {
    if (!greenhouseId) return;
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setErrorMsg(!parsed.ok ? parsed.message : parsed.data?.message || 'Unable to load greenhouse.');
        return;
      }
      const data = parsed.data;
      setDetail(data);
      setActiveGreenhouseId(greenhouseId);

      // Append genuine telemetry reading to session trend history if fresh/present
      const tel = data.latestTelemetry;
      if (tel && tel.receivedAt && tel.dataSource !== 'DISCONNECTED') {
        setSamples((prev) => {
          if (prev.some((p) => p.timestamp === tel.receivedAt)) return prev;
          return [
            ...prev.slice(-23),
            {
              timestamp: tel.receivedAt,
              temperature: tel.readings?.temperature ?? null,
              humidity: tel.readings?.humidity ?? null,
              soilMoisture: tel.readings?.soilMoisture ?? null
            }
          ];
        });
      }
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error loading greenhouse.');
    } finally {
      setLoading(false);
    }
  }, [greenhouseId, setActiveGreenhouseId]);

  useEffect(() => {
    fetchDetails();
    const poll = window.setInterval(fetchDetails, 10000);
    return () => window.clearInterval(poll);
  }, [fetchDetails]);

  const handleRetryConnectionTest = async () => {
    if (!greenhouseId) return;
    setTestingConn(true);
    setConnBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (parsed.ok && parsed.data?.success) {
        const data = parsed.data;
        const passed = data.checks.filter((c: any) => c.status === 'PASS').length;
        setConnBanner(
          `Connection check completed: ${passed} of ${data.checks.length} checks verified (read-only, 0 equipment commands sent).`
        );
      }
      await fetchDetails();
      await refreshSession();
    } finally {
      setTestingConn(false);
    }
  };

  const handleToggleEquipment = async (
    device: 'pump' | 'fan' | 'light' | 'heater' | 'peltier' | 'roof',
    currentlyOn: boolean
  ) => {
    setBusyControl(device);
    setControlFeedback(null);
    const nextState = currentlyOn ? 'off' : 'on';
    try {
      if (device === 'roof') {
        const res = await hardwareService.setRoof(currentlyOn ? 'close' : 'open', false);
        publish('greenhouse/control/roof', currentlyOn ? 'OFF' : 'ON');
        setControlFeedback({
          tone: res.success ? 'ok' : 'err',
          text: res.message
        });
      } else {
        const res = await hardwareService.setOverride(
          device,
          nextState,
          device === 'pump' && nextState === 'on' ? 30 : 0
        );
        publish(`greenhouse/control/${device}`, nextState.toUpperCase());
        setControlFeedback({
          tone: res.success ? 'ok' : 'err',
          text: res.message
        });
      }
    } catch (err: any) {
      setControlFeedback({
        tone: 'err',
        text:
          err?.message ||
          'Local controller is not reachable right now. Check Hardware Connections in Settings.'
      });
    } finally {
      setBusyControl(null);
    }
  };

  const handleIssueShareQr = async () => {
    if (!greenhouseId) return;
    setIssuingQr(true);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/qr-token`, {
        method: 'POST',
        body: JSON.stringify({ purpose: 'member_share_qr', roleGranted: 'operator', ttlMinutes: 30 })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (parsed.ok && parsed.data?.success) {
        const data = parsed.data;
        setShareQr({
          tokenId: data.tokenId,
          qrDataUrl: data.qrDataUrl,
          enrollmentCode: data.enrollmentCode,
          expiresAt: data.expiresAt
        });
        await fetchDetails();
      }
    } finally {
      setIssuingQr(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!greenhouseId) return;
    await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${deviceId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    setConfirmRevokeId(null);
    await fetchDetails();
    await refreshSession();
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!greenhouseId) return;
    await apiFetch(`/api/greenhouses/${greenhouseId}/qr-tokens/${tokenId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (shareQr?.tokenId === tokenId) setShareQr(null);
    await fetchDetails();
  };

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 size={26} className="animate-spin text-primary" />
        <span className="text-sm">Loading greenhouse status...</span>
      </div>
    );
  }

  if (errorMsg || !detail?.greenhouse) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/45 p-8 text-center space-y-4">
        <AlertTriangle size={26} className="mx-auto text-red-700 dark:text-red-400" />
        <p className="text-sm text-red-900 dark:text-red-200 font-medium">{errorMsg || 'Greenhouse not found.'}</p>
        <Button type="button" variant="outline" onClick={() => navigate('/greenhouses')}>
          Back to My Greenhouse
        </Button>
      </div>
    );
  }

  const gh = detail.greenhouse;
  const cam = detail.latestCamera;
  const tel = detail.latestTelemetry;
  const canManage = gh.role === 'owner' || gh.role === 'operator';

  const matchedCrop =
    DEFAULT_CROPS.find(
      (c) =>
        c.id.toLowerCase() === String(gh.cropType || '').toLowerCase() ||
        c.name.toLowerCase().includes(String(gh.cropType || '').toLowerCase())
    ) || DEFAULT_CROPS[0];

  const readings = tel?.dataSource !== 'DISCONNECTED' ? tel?.readings || null : null;
  const valOrUnavail = (v: number | null | undefined, dec: number, unit: string) =>
    v !== null && v !== undefined && Number.isFinite(v) ? `${v.toFixed(dec)}${unit}` : 'Unavailable';

  const rainLocked = readings?.rain === true;
  const waterLowLocked =
    readings?.waterLevel !== null && readings?.waterLevel !== undefined && readings.waterLevel < 10;
  const thermalLocked =
    readings?.temperature !== null &&
    readings?.temperature !== undefined &&
    readings.temperature > 32;

  const equipmentItems = [
    {
      id: 'pump' as const,
      label: 'Water Pump',
      hint: waterLowLocked ? 'Locked: tank below 10%' : 'Runs safe 30s watering cycle',
      active: pumpActive,
      locked: waterLowLocked,
      icon: Waves
    },
    {
      id: 'fan' as const,
      label: 'Air Circulation Fan',
      hint: 'Moves warm or humid air',
      active: fanActive,
      locked: false,
      icon: Fan
    },
    {
      id: 'roof' as const,
      label: 'Roof Vent',
      hint: rainLocked ? 'Locked closed during rain' : roofActive ? 'Currently open' : 'Currently closed',
      active: roofActive,
      locked: rainLocked && !roofActive,
      icon: Umbrella
    },
    {
      id: 'light' as const,
      label: 'Grow Lights',
      hint: 'Supplemental canopy lighting',
      active: lightActive,
      locked: false,
      icon: Lightbulb
    },
    {
      id: 'heater' as const,
      label: 'Warmth Heater',
      hint: thermalLocked ? 'Locked: air above 32°C' : 'Nighttime cold protection',
      active: heaterActive,
      locked: thermalLocked,
      icon: Flame
    },
    {
      id: 'peltier' as const,
      label: 'Spot Cooling',
      hint: 'Auxiliary cooling unit',
      active: peltierActive,
      locked: false,
      icon: Snowflake
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            to="/greenhouses"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> All Greenhouses
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{gh.name}</h1>
            <span
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-md border',
                gh.overallStatus === 'ONLINE'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800/60'
                  : gh.overallStatus === 'PARTIAL' || gh.overallStatus === 'STALE'
                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
                    : 'bg-muted text-muted-foreground border-border'
              )}
            >
              {gh.overallStatus === 'ONLINE'
                ? 'Connected'
                : gh.overallStatus === 'PARTIAL'
                  ? 'Partial Connection'
                  : gh.overallStatus === 'STALE'
                    ? 'Delayed Signal'
                    : gh.overallStatus === 'SETUP_INCOMPLETE'
                      ? 'Setup Needed'
                      : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <MapPin size={13} />
            <span>{gh.locationLabel || 'Location not set'}</span>
            <span>·</span>
            <span className="font-medium text-foreground">Crop: {gh.cropType}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            disabled={testingConn}
            onClick={handleRetryConnectionTest}
            className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
          >
            <RefreshCw size={14} className={cn('mr-1.5', testingConn && 'animate-spin')} />
            Check Connection
          </Button>

          {canManage && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={issuingQr}
                onClick={handleIssueShareQr}
                className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <QrCode size={14} className="mr-1.5 text-primary" />
                Share Access QR
              </Button>
              <Button
                type="button"
                onClick={() => navigate(`/greenhouses/${gh.id}/setup`)}
                className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                <Wrench size={14} className="mr-1.5" />
                Setup Guide
              </Button>
            </>
          )}
        </div>
      </div>

      {connBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-4 py-3 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>{connBanner}</span>
        </div>
      )}

      {shareQr && (
        <div className="max-w-sm">
          <QrCodeCard
            qrDataUrl={shareQr.qrDataUrl}
            enrollmentCode={shareQr.enrollmentCode}
            expiresAt={shareQr.expiresAt}
            title={`Invite Co-Farmer to ${gh.name}`}
            subtitle="Have your co-farmer scan this code from their EDENS AI account within 30 minutes."
          />
        </div>
      )}

      {/* 1. Sensor Readings & Environmental Trend */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sensor Readings &amp; Trend</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tel?.receivedAt
                ? `Last controller update ${formatRelativeAge(tel.ageSeconds, tel.receivedAt)}`
                : 'Waiting for first verified sensor reading from your ESP32 controller'}
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">
            {tel?.dataSource === 'REAL_HARDWARE'
              ? 'Live Hardware'
              : tel?.dataSource === 'CACHED'
                ? 'Recent Hardware'
                : tel?.dataSource === 'STALE'
                  ? 'Delayed Reading'
                  : 'No Live Signal'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Thermometer size={12} className="text-primary" /> Temperature
            </span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.temperature, 1, '°C')}
            </p>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
              Target {matchedCrop.tempMin}–{matchedCrop.tempMax}°C
            </span>
          </div>

          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Droplets size={12} className="text-primary" /> Humidity
            </span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.humidity, 0, '%')}
            </p>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
              Target {matchedCrop.humMin}–{matchedCrop.humMax}%
            </span>
          </div>

          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Sprout size={12} className="text-primary" /> Soil Moisture
            </span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.soilMoisture, 0, '%')}
            </p>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
              Target {matchedCrop.soilMin}–{matchedCrop.soilMax}%
            </span>
          </div>

          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground">Water Tank</span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.waterLevel, 0, '%')}
            </p>
            <span className="text-[11px] text-muted-foreground">Reservoir level</span>
          </div>

          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Sun size={12} className="text-amber-600 dark:text-amber-400" /> Sunlight
            </span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.sunlight, 0, ' lx')}
            </p>
            <span className="text-[11px] text-muted-foreground">Canopy light</span>
          </div>

          <div className="rounded-xl bg-muted/50 p-3.5">
            <span className="text-[11px] text-muted-foreground">Battery / Rain</span>
            <p className="text-lg font-bold font-mono tabular-nums text-foreground mt-1">
              {valOrUnavail(readings?.batteryVoltage, 1, 'V')}
            </p>
            <span className="text-[11px] text-muted-foreground">
              {readings?.rain === null || readings?.rain === undefined
                ? 'Rain: Unavailable'
                : readings.rain
                  ? 'Rain detected'
                  : 'Weather dry'}
            </span>
          </div>
        </div>

        <EnvironmentalTrendChart
          samples={samples}
          tempMin={matchedCrop.tempMin}
          tempMax={matchedCrop.tempMax}
        />
      </section>

      {/* 2. Two-Column Camera Snapshot Summary + Safe Equipment Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Plant Camera Summary */}
        <section className="lg:col-span-6 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Camera size={18} className="text-primary" />
                Plant Camera Snapshot
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Uploaded Photograph (Not Live Video)
              </p>
            </div>

            <span
              className={cn(
                'text-xs font-medium px-2.5 py-1 rounded-md border whitespace-nowrap shrink-0',
                cam?.exists && cam?.isFresh
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800/60'
                  : cam?.exists
                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
                    : 'bg-muted text-muted-foreground border-border'
              )}
            >
              {cam?.exists ? (cam.isFresh ? 'Fresh Photo' : 'Outdated Photo') : 'No Photo Yet'}
            </span>
          </div>

          <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-muted/60 flex items-center justify-center">
            {cam?.exists && cam?.url ? (
              <img
                src={resolveApiUrl(cam.url)}
                alt={`Latest snapshot from ${gh.name}`}
                className="w-full h-full object-contain bg-stone-950"
              />
            ) : (
              <div className="p-6 text-center space-y-1.5">
                <Camera size={24} className="mx-auto text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No Camera Snapshot Uploaded Yet</p>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  Once your ESP32-CAM is powered on 2.4 GHz Wi-Fi, its latest crop photo appears here automatically.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground font-mono tabular-nums flex items-center gap-1.5">
              <Clock size={13} />
              {cam?.capturedAt
                ? `Captured ${formatRelativeAge(cam.ageSeconds, cam.capturedAt)}`
                : 'Awaiting first upload'}
            </span>

            <Link
              to="/vision"
              className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <span>Inspect in Plant Vision</span>
            </Link>
          </div>
        </section>

        {/* Safe Equipment Controls & Hardware Safety Locks */}
        <section className="lg:col-span-6 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Equipment Controls &amp; Safety Locks
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Built-in hardware safety locks prevent roof opening in rain or dry-running the water pump.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-accent px-2.5 py-1 rounded-md shrink-0">
              <ShieldCheck size={13} /> Safety Active
            </span>
          </div>

          {controlFeedback && (
            <div
              className={cn(
                'rounded-xl border px-3.5 py-2.5 text-xs font-medium',
                controlFeedback.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-200'
              )}
            >
              {controlFeedback.text}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {equipmentItems.map((item) => {
              const Icon = item.icon;
              const isBusy = busyControl === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-xl bg-muted/50 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Icon size={14} className={item.active ? 'text-primary' : 'text-muted-foreground'} />
                      <span>{item.label}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.hint}</p>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={item.active ? 'default' : 'outline'}
                    disabled={item.locked || isBusy || !canManage}
                    onClick={() => handleToggleEquipment(item.id, item.active)}
                    className={cn(
                      'h-9 px-3 rounded-lg text-xs font-semibold shrink-0 cursor-pointer',
                      item.active && 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    )}
                  >
                    {isBusy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : item.locked ? (
                      'Locked'
                    ) : item.active ? (
                      'On'
                    ) : (
                      'Off'
                    )}
                  </Button>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Note: Direct equipment toggles require local network or configured gateway access to your ESP32 controller, or Practice Mode in Settings.
          </p>
        </section>
      </div>

      {/* 3. Collapsible Technician & Security Details */}
      <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTechSection((prev) => !prev)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Technician Details: Enrolled Boards &amp; Activity History
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              View enrolled device IDs, key prefixes, active QR invites, and audit logs.
            </p>
          </div>
          {showTechSection ? (
            <ChevronUp size={18} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={18} className="text-muted-foreground shrink-0" />
          )}
        </button>

        {showTechSection && (
          <div className="px-6 pb-6 pt-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Enrolled Hardware Devices */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Enrolled Hardware Boards
              </h3>
              {(detail.devices || []).map((d: any) => {
                const st = formatExplicitDeviceState(d.explicitState || d.connectionStatus);
                return (
                  <div key={d.id} className="rounded-xl bg-muted/50 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        {d.deviceType === 'esp32_cam' ? (
                          <Camera size={14} className="text-primary" />
                        ) : (
                          <Cpu size={14} className="text-primary" />
                        )}
                        {d.label}
                      </span>
                      <span className="font-medium text-muted-foreground">{st.label}</span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-muted-foreground space-y-0.5">
                      <div>Device ID: {d.id}</div>
                      <div>Key Prefix: {d.keyPrefix ? `${d.keyPrefix}••••••••` : 'Not issued yet'}</div>
                      <div>
                        Last Seen:{' '}
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never checked in'}
                      </div>
                    </div>

                    {canManage && d.provisioningStatus !== 'revoked' && (
                      <div className="pt-1 flex items-center gap-2">
                        {confirmRevokeId === d.id ? (
                          <>
                            <span className="text-[11px] text-red-700 dark:text-red-400 font-medium">Revoke key?</span>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleRevokeDevice(d.id)}
                              className="h-8 px-2.5 bg-red-600 hover:bg-red-700 text-white text-xs cursor-pointer"
                            >
                              Confirm Revoke
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmRevokeId(null)}
                              className="h-8 px-2.5 text-xs cursor-pointer"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(d.id)}
                            className="text-xs font-medium text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                          >
                            Revoke Device Key
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {(detail.enrollmentTokens || []).filter((t: any) => t.status === 'active').length >
                0 && (
                <div className="pt-2 space-y-2">
                  <h4 className="text-xs font-semibold text-foreground">Active QR Invites</h4>
                  {detail.enrollmentTokens
                    .filter((t: any) => t.status === 'active')
                    .map((tok: any) => (
                      <div
                        key={tok.id}
                        className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"
                      >
                        <span className="font-mono tabular-nums">{tok.tokenPrefix}••••</span>
                        <button
                          type="button"
                          onClick={() => handleRevokeToken(tok.id)}
                          className="text-red-700 dark:text-red-400 font-medium hover:underline cursor-pointer"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Security & Observation Log */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Greenhouse Events
              </h3>
              {(detail.auditEvents || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No events logged yet.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl bg-muted/40 px-4 py-2 max-h-64 overflow-y-auto">
                  {(detail.auditEvents || []).slice(0, 10).map((ev: any) => (
                    <div key={ev.id} className="py-2.5 text-xs flex items-start justify-between gap-3">
                      <span className="text-foreground">{ev.summary}</span>
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
