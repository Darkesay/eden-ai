import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Download,
  Droplets,
  Fan,
  Flame,
  KeyRound,
  Layers,
  Lightbulb,
  Loader2,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Umbrella,
  Waves,
  Wifi,
  Wrench
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { useMqtt } from '../lib/mqtt';
import { useStoreValue } from '../lib/store';
import { QrCodeCard } from '../components/QrScannerModal';
import { CropIntelligenceControlPanel } from '../components/CropIntelligenceControlPanel';
import { MonitoringModeBanner } from '../components/MonitoringModeBanner';
import { ConnectExistingHardwarePanel } from '../components/ConnectExistingHardwarePanel';
import { UniversalHardwareFleetPanel } from '../components/UniversalHardwareFleetPanel';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { DEFAULT_CROPS } from '../lib/hardwareService';

function overallStatusBadge(status: string) {
  switch (status) {
    case 'ONLINE':
      return { label: 'Online', cls: 'bg-success/10 text-success' };
    case 'PARTIAL':
      return { label: 'Partial check-in', cls: 'bg-info/10 text-info' };
    case 'STALE':
      return { label: 'Stale signal', cls: 'bg-warning/10 text-warning' };
    case 'SETUP_INCOMPLETE':
      return { label: 'Setup needed', cls: 'bg-muted text-muted-foreground' };
    default:
      return { label: 'Offline', cls: 'bg-destructive/10 text-destructive' };
  }
}

function cameraFreshnessBadge(cam: any) {
  if (!cam?.exists) return { label: 'Disconnected', cls: 'bg-destructive/10 text-destructive' };
  if (cam.isFresh) return { label: cam.freshness, cls: 'bg-success/10 text-success' };
  return { label: cam.freshness, cls: 'bg-warning/10 text-warning' };
}

function dataSourceBadge(tel: any) {
  const ds = tel?.dataSource;
  if (ds === 'REAL_HARDWARE') return { label: 'Real hardware', cls: 'bg-success/10 text-success' };
  if (ds === 'CACHED') return { label: 'Cached', cls: 'bg-warning/10 text-warning' };
  if (ds === 'STALE') return { label: 'Stale', cls: 'bg-warning/10 text-warning' };
  return { label: 'Disconnected', cls: 'bg-destructive/10 text-destructive' };
}

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
            ? 'First reading recorded ΓÇö collecting trend history'
            : 'Trend chart appears once sensor readings arrive'}
        </p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          EDENS AI plots only genuine sensor updates as they arrive during your monitoring session ΓÇö never synthetic trend curves.
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
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
        <span>Recent Temperature Trend (┬░C)</span>
        <span className="font-mono tabular-nums">
          Target band: {tempMin}ΓÇô{tempMax}┬░C ({validTempSamples.length} readings)
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
            fill="var(--chart-1)"
            fillOpacity={0.1}
            rx={4}
          />
          <line
            x1={padX}
            y1={bandTop}
            x2={width - padX}
            y2={bandTop}
            stroke="var(--chart-1)"
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />
          <line
            x1={padX}
            y1={bandBottom}
            x2={width - padX}
            y2={bandBottom}
            stroke="var(--chart-1)"
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />

          {/* Area Fill & Line */}
          <polygon points={areaPoints} fill="var(--chart-1)" fillOpacity={0.14} />
          <polyline
            fill="none"
            stroke="var(--chart-1)"
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
              stroke="var(--chart-1)"
              strokeWidth={2}
            />
          ))}

          {/* Y Axis Labels */}
          <text
            x={4}
            y={padY + 4}
            className="fill-muted-foreground text-[11px] font-mono"
          >
            {maxVal.toFixed(0)}┬░
          </text>
          <text
            x={4}
            y={padY + innerH}
            className="fill-muted-foreground text-[11px] font-mono"
          >
            {minVal.toFixed(0)}┬░
          </text>
        </svg>
      </div>
    </div>
  );
}

export default function GreenhouseDetails() {
  const { greenhouseId } = useParams<{ greenhouseId: string }>();
  const navigate = useNavigate();
  const { user, setActiveGreenhouseId, refreshSession } = useAuth();
  const isGuest = Boolean(user?.isGuest);
  const { publish } = useMqtt();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [samples, setSamples] = useState<TrendSample[]>([]);

  const [selectedZoneId, setSelectedZoneId] = useState<string>('all');
  const [zoneTelemetry, setZoneTelemetry] = useState<any | null>(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [addingZone, setAddingZone] = useState(false);

  const [testingConn, setTestingConn] = useState(false);
  const [connBanner, setConnBanner] = useState<string | null>(null);

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagLang, setDiagLang] = useState('en');
  const [diagnosisError, setDiagnosisError] = useState('');
  const [diagnosisResult, setDiagnosisResult] = useState<any | null>(null);

  const [shareQr, setShareQr] = useState<{
    tokenId: string;
    qrDataUrl: string;
    enrollmentCode: string;
    expiresAt: string;
  } | null>(null);
  const [issuingQr, setIssuingQr] = useState(false);
  const [showTechSection, setShowTechSection] = useState(true);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  // Phase 2 Hardware Fleet Lifecycle state
  const [fleetZoneSelect, setFleetZoneSelect] = useState<string>('');
  const [fleetBusy, setFleetBusy] = useState(false);
  const [fleetBanner, setFleetBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [devicePairingMap, setDevicePairingMap] = useState<
    Record<
      string,
      {
        enrollmentCode: string;
        qrDataUrl: string;
        expiresAt: string;
      }
    >
  >({});
  const [rotatedKeyMap, setRotatedKeyMap] = useState<
    Record<
      string,
      {
        oneTimeDeviceKey: string;
        filename: string;
        content: string;
      }
    >
  >({});
  const [replacingDeviceId, setReplacingDeviceId] = useState<string | null>(null);
  const [replaceReason, setReplaceReason] = useState('Sensor or board fault');
  const [replaceLabel, setReplaceLabel] = useState('');
  const [diagnosticsMap, setDiagnosticsMap] = useState<Record<string, any>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [showRetiredBoards, setShowRetiredBoards] = useState(false);

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
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Unable to load greenhouse.');
        return;
      }
      setDetail(data);
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        setFleetZoneSelect((prev) => prev || data.zones[0].id);
      }
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
      if (data.latestCamera?.analysis && !diagnosisResult) {
        setDiagnosisResult(data.latestCamera.analysis);
      }
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error loading greenhouse.');
    } finally {
      setLoading(false);
    }
  }, [greenhouseId, setActiveGreenhouseId, diagnosisResult]);

  useEffect(() => {
    fetchDetails();
    const poll = window.setInterval(fetchDetails, 12000);
    return () => window.clearInterval(poll);
  }, [fetchDetails]);

  useEffect(() => {
    if (!greenhouseId || selectedZoneId === 'all') {
      setZoneTelemetry(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiFetch(
        `/api/greenhouses/${greenhouseId}/telemetry/latest?zoneId=${encodeURIComponent(selectedZoneId)}`
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!cancelled && parsed.ok && parsed.data) {
        setZoneTelemetry(parsed.data.telemetry || parsed.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [greenhouseId, selectedZoneId, detail?.latestTelemetry?.receivedAt]);

  const handleRetryConnectionTest = async () => {
    if (!greenhouseId) return;
    setTestingConn(true);
    setConnBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const passed = data.checks.filter((c: any) => c.status === 'PASS').length;
        setConnBanner(
          `Safe read-only check complete — ${passed}/${data.checks.length} checks verified, no actuator commands sent.`
        );
      }
      await fetchDetails();
      await refreshSession();
    } finally {
      setTestingConn(false);
    }
  };

  const handleRunVisionDiagnosis = async () => {
    if (!greenhouseId) return;
    setDiagnosing(true);
    setDiagnosisError('');
    try {
      const res = await apiFetch('/api/ai/diagnose', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId,
          useLatestCameraFrame: true,
          requireFresh: true,
          languageId: diagLang
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDiagnosisError(data.message || 'Vision diagnosis could not be completed.');
        return;
      }
      setDiagnosisResult(data.result);
      await fetchDetails();
    } catch (err: any) {
      setDiagnosisError(err?.message || 'Network error during crop diagnosis.');
    } finally {
      setDiagnosing(false);
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
      const data = await res.json();
      if (res.ok && data.success) {
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

  const handleCopyText = async (id: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKeyId(id);
      window.setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {}
  };

  const downloadHeader = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCreateZone = async () => {
    if (!greenhouseId || !newZoneName.trim()) return;
    setAddingZone(true);
    setFleetBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/zones`, {
        method: 'POST',
        body: JSON.stringify({
          name: newZoneName.trim(),
          cropType: detail?.greenhouse?.cropType || 'Tomato',
          growthStage: 'vegetative'
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFleetBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Unable to create zone.'
        });
        return;
      }
      setNewZoneName('');
      await fetchDetails();
    } finally {
      setAddingZone(false);
    }
  };

  const handleAddFleetDevice = async (deviceType: 'esp32_controller' | 'esp32_cam') => {
    if (!greenhouseId) return;
    setFleetBusy(true);
    setFleetBanner(null);
    try {
      const zonesList = detail?.zones || [];
      const z = zonesList.find((item: any) => item.id === fleetZoneSelect);
      const activeCount = (detail?.devices || []).filter(
        (d: any) => d.deviceType === deviceType && !d.replacedByDeviceId && d.provisioningStatus !== 'revoked'
      ).length;
      const label =
        deviceType === 'esp32_cam'
          ? `${z ? `${z.name} ` : ''}ESP32-CAM #${activeCount + 1}`
          : `${z ? `${z.name} ` : ''}ESP32 Controller #${activeCount + 1}`;
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/devices`, {
        method: 'POST',
        body: JSON.stringify({
          deviceType,
          label,
          zoneId: fleetZoneSelect || null,
          createAdditionalSlot: true
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFleetBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not register hardware board.'
        });
        return;
      }
      setFleetBanner({ tone: 'ok', text: `Registered ${label}. Click "Pair via Wi-Fi" to get its one-time code.` });
      await fetchDetails();
      await refreshSession();
    } finally {
      setFleetBusy(false);
    }
  };

  const handlePairViaWifi = async (deviceId: string) => {
    if (!greenhouseId) return;
    setFleetBusy(true);
    setFleetBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${deviceId}/bootstrap-token`, {
        method: 'POST',
        body: JSON.stringify({ ttlMinutes: 45 })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFleetBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not issue pairing code.'
        });
        return;
      }
      setDevicePairingMap((prev) => ({
        ...prev,
        [deviceId]: {
          enrollmentCode: parsed.data.enrollmentCode,
          qrDataUrl: parsed.data.qrDataUrl,
          expiresAt: parsed.data.expiresAt
        }
      }));
    } finally {
      setFleetBusy(false);
    }
  };

  const handleRotateKey = async (deviceId: string) => {
    if (!greenhouseId) return;
    setFleetBusy(true);
    setFleetBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${deviceId}/issue-credentials`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFleetBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not rotate device key.'
        });
        return;
      }
      setRotatedKeyMap((prev) => ({
        ...prev,
        [deviceId]: {
          oneTimeDeviceKey: parsed.data.oneTimeDeviceKey,
          filename: parsed.data.firmwareHeader.filename,
          content: parsed.data.firmwareHeader.content
        }
      }));
      setFleetBanner({
        tone: 'ok',
        text: 'Device key rotated. Any previous key for this board is immediately invalidated.'
      });
      await fetchDetails();
      await refreshSession();
    } finally {
      setFleetBusy(false);
    }
  };

  const handleConfirmReplaceDevice = async (oldDeviceId: string) => {
    if (!greenhouseId) return;
    setFleetBusy(true);
    setFleetBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${oldDeviceId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          newLabel: replaceLabel.trim() || undefined,
          reason: replaceReason.trim() || 'Faulty hardware replacement',
          issueBootstrapToken: true
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFleetBanner({
          tone: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not replace faulty board.'
        });
        return;
      }
      const d = parsed.data;
      if (d.replacementDevice?.id && d.bootstrapToken) {
        setDevicePairingMap((prev) => ({
          ...prev,
          [d.replacementDevice.id]: {
            enrollmentCode: d.bootstrapToken.enrollmentCode,
            qrDataUrl: d.bootstrapToken.qrDataUrl,
            expiresAt: d.bootstrapToken.expiresAt
          }
        }));
      }
      setReplacingDeviceId(null);
      setReplaceLabel('');
      setFleetBanner({
        tone: 'ok',
        text: `Replaced board cleanly (${d.preservedTelemetryCount} historical telemetry readings preserved). Pair the new board below.`
      });
      await fetchDetails();
      await refreshSession();
    } finally {
      setFleetBusy(false);
    }
  };

  const handleToggleDiagnostics = async (deviceId: string) => {
    if (!greenhouseId) return;
    if (diagnosticsMap[deviceId]) {
      setDiagnosticsMap((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
      return;
    }
    const res = await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${deviceId}/diagnostics`);
    const parsed = await parseApiJsonResponse<any>(res);
    if (parsed.ok && parsed.data?.success) {
      setDiagnosticsMap((prev) => ({ ...prev, [deviceId]: parsed.data }));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 size={24} className="animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">Loading greenhouse state…</span>
      </div>
    );
  }

  if (errorMsg || !detail?.greenhouse) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-destructive/30 bg-destructive/10 p-8 text-center">
        <AlertTriangle size={24} className="mx-auto text-destructive" aria-hidden="true" />
        <p className="text-sm text-destructive">{errorMsg || 'Greenhouse not found.'}</p>
        <Button type="button" variant="outline" onClick={() => navigate('/greenhouses')}>
          Back to greenhouses
        </Button>
      </div>
    );
  }

  const gh = detail.greenhouse;
  const cam = detail.latestCamera;
  const tel = selectedZoneId === 'all' ? detail.latestTelemetry : zoneTelemetry || null;
  const canManage = (gh.role === 'owner' || gh.role === 'operator') && !isGuest;
  const matchedCrop =
    DEFAULT_CROPS.find(
      (c) =>
        c.id.toLowerCase() === String(gh.cropType || '').toLowerCase() ||
        c.name.toLowerCase().includes(String(gh.cropType || '').toLowerCase())
    ) || DEFAULT_CROPS[0];
  const zonesList: any[] = detail.zones || [];
  const activeDevices: any[] = (detail.devices || []).filter(
    (d: any) => !d.replacedByDeviceId && d.provisioningStatus !== 'revoked'
  );
  const retiredDevices: any[] = (detail.devices || []).filter(
    (d: any) => Boolean(d.replacedByDeviceId) || d.provisioningStatus === 'revoked'
  );

  const statusBadge = overallStatusBadge(gh.overallStatus);
  const freshBadge = cameraFreshnessBadge(cam);
  const sourceBadge = dataSourceBadge(tel);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <Link
            to="/greenhouses"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={13} aria-hidden="true" /> All greenhouses
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{gh.name}</h1>
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin size={12} aria-hidden="true" /> {gh.locationLabel}
            </span>
            <span className="capitalize">{gh.cropType}</span>
            <span className="font-mono tabular">ID {gh.id}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testingConn}
            onClick={handleRetryConnectionTest}
          >
            <RefreshCw size={14} className={testingConn ? 'animate-spin' : ''} aria-hidden="true" />
            Retry connection
          </Button>
          {canManage && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={issuingQr}
                onClick={handleIssueShareQr}
              >
                <QrCode size={14} aria-hidden="true" />
                Share invite QR
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => navigate(`/greenhouses/${gh.id}/setup`)}
              >
                <Wrench size={14} aria-hidden="true" />
                Setup help & keys
              </Button>
            </>
          )}
        </div>
      </div>

      <MonitoringModeBanner />

      {connBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          <span>{connBanner}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setConnBanner(null)}
            className="shrink-0 text-success hover:text-success"
          >
            Dismiss
          </Button>
        </div>
      )}

      {shareQr && (
        <div className="max-w-sm">
          <QrCodeCard
            qrDataUrl={shareQr.qrDataUrl}
            enrollmentCode={shareQr.enrollmentCode}
            expiresAt={shareQr.expiresAt}
            title={`Member invite QR (${gh.name})`}
            subtitle="Valid for 30 minutes, single use. Grants operator access."
          />
        </div>
      )}

      {/* 1B. Phase 3 Crop Intelligence, 8-Point Recommendations & Farmer-Authorized Control */}
      <CropIntelligenceControlPanel
        greenhouseId={gh.id}
        selectedZoneId={selectedZoneId}
        isGuest={isGuest}
        canManage={canManage}
        onUpdated={fetchDetails}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ESP32-CAM crop snapshot & manual AI diagnosis */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Camera size={16} className="text-muted-foreground" aria-hidden="true" />
                Crop snapshot
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Snapshot, not live video
                </span>
                <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${freshBadge.cls}`}>
                  {freshBadge.label}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {cam?.exists ? (
              <div className="space-y-2">
                <div className="aspect-video overflow-hidden rounded-lg border border-border bg-black">
                  <img
                    src={cam.base64 || cam.url}
                    alt="Latest verified greenhouse snapshot"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular text-[11px] text-muted-foreground">
                  <span>Captured {new Date(cam.timestamp).toLocaleTimeString()}</span>
                  <span>
                    {cam.ageSeconds}s ago · {(cam.sizeBytes / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-dashed border-border p-8 text-center">
                <Camera size={24} className="mx-auto text-muted-foreground" aria-hidden="true" />
                <div className="text-sm font-medium">No snapshot uploaded yet</div>
                <p className="text-xs text-muted-foreground">
                  Issue a camera credential in Setup help & keys and flash camera_secrets.h so your
                  ESP32-CAM posts verified JPEGs to /api/camera/upload.
                </p>
              </div>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  value={diagLang}
                  onChange={(e) => setDiagLang(e.target.value)}
                  aria-label="Diagnosis language"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="en">English (Nigeria)</option>
                  <option value="pcm">Nigerian Pidgin</option>
                  <option value="ha">Hausa</option>
                  <option value="yo">Yoruba</option>
                  <option value="ig">Igbo</option>
                </select>

                <Button
                  type="button"
                  size="sm"
                  disabled={!cam?.isFresh || diagnosing}
                  onClick={handleRunVisionDiagnosis}
                >
                  {diagnosing ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles size={14} aria-hidden="true" />
                  )}
                  Analyze fresh snapshot
                </Button>
              </div>

              {!cam?.isFresh && cam?.exists && (
                <p className="text-xs text-warning">
                  Snapshot is {cam.freshness} ({cam.ageSeconds}s old). Live diagnosis needs a fresh
                  upload — no more than 90 seconds old.
                </p>
              )}

              {diagnosisError && (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {diagnosisError}
                </div>
              )}

              {diagnosisResult && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{diagnosisResult.species}</span>
                    <span className="text-sm font-medium">{diagnosisResult.healthStatus}</span>
                  </div>
                  <p>
                    <span className="font-semibold">Symptoms:</span> {diagnosisResult.symptoms}
                  </p>
                  <p>
                    <span className="font-semibold">Likely cause:</span> {diagnosisResult.cause}
                  </p>
                  <p>
                    <span className="font-semibold">Recommendation:</span>{' '}
                    {diagnosisResult.recommendation}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main ESP32 controller telemetry & hardware interlocks */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity size={16} className="text-muted-foreground" aria-hidden="true" />
                Controller telemetry
              </CardTitle>
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${sourceBadge.cls}`}>
                {sourceBadge.label}
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {tel?.exists && tel.readings ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Thermometer size={12} aria-hidden="true" /> Air temp
                    </div>
                    <div className="mt-1 font-mono tabular text-lg font-semibold">
                      {tel.readings.temperature.toFixed(1)}°C
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Droplets size={12} aria-hidden="true" /> Humidity
                    </div>
                    <div className="mt-1 font-mono tabular text-lg font-semibold">
                      {tel.readings.humidity.toFixed(0)}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[11px] text-muted-foreground">Soil moisture</div>
                    <div className="mt-1 font-mono tabular text-lg font-semibold">
                      {tel.readings.soilMoisture.toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <span className="block text-[11px] text-muted-foreground">Reservoir</span>
                    <span className="mt-0.5 block font-mono tabular font-medium">
                      {tel.readings.waterLevel !== null ? `${tel.readings.waterLevel}%` : 'Unreported'}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Sun size={12} aria-hidden="true" /> Sunlight
                    </span>
                    <span className="mt-0.5 block font-mono tabular font-medium">
                      {tel.readings.sunlight !== null ? `${tel.readings.sunlight} lx` : 'Unreported'}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <span className="block text-[11px] text-muted-foreground">Battery</span>
                    <span className="mt-0.5 block font-mono tabular font-medium">
                      {tel.readings.batteryVoltage !== null ? `${tel.readings.batteryVoltage}V` : 'Unreported'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <ShieldCheck size={14} aria-hidden="true" /> Safety interlocks (autonomous)
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {Object.entries(tel.interlocks || {}).map(([key, locked]) => (
                      <div
                        key={key}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                          locked
                            ? 'border-warning/30 bg-warning/10 text-warning'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        <span className="truncate font-mono">{key}</span>
                        <span className="shrink-0 font-medium">{locked ? 'Locked' : 'Clear'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2 rounded-lg border border-dashed border-border p-8 text-center">
                <Cpu size={24} className="mx-auto text-muted-foreground" aria-hidden="true" />
                <div className="text-sm font-medium">No controller telemetry yet</div>
                <p className="text-xs text-muted-foreground">
                  No synthetic values are shown here. Configure controller_secrets.h on the main
                  ESP32 to push verified sensor JSON to /api/telemetry/upload.
                </p>
              </div>
            )}

            <EnvironmentalTrendChart
              samples={samples}
              tempMin={matchedCrop.tempMin}
              tempMax={matchedCrop.tempMax}
            />
          </CardContent>
        </Card>
      </div>
      {/* 2B. Connect Existing ESP32-CAM & ESP32 Controller over Current HTTP Endpoints */}
      <ConnectExistingHardwarePanel
        greenhouseId={gh.id}
        onCameraFrameVerified={fetchDetails}
      />

      {/* 2C. Stage 2 Universal Device Adapter & Real-Time Normalized Telemetry */}
      <UniversalHardwareFleetPanel greenhouseId={gh.id} />

      {/* Enrolled hardware devices & audit trail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu size={16} className="text-muted-foreground" aria-hidden="true" />
              Enrolled hardware
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {(detail.devices || []).map((dev: any) => (
              <div
                key={dev.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-semibold">{dev.label}</div>
                  <div className="break-all font-mono text-[11px] text-muted-foreground">
                    {dev.id}
                    {dev.credentialPrefix ? ` · Key ${dev.credentialPrefix}…` : ' · No key issued'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="capitalize">{dev.provisioningStatus}</span>
                    {dev.lastSeenAt
                      ? ` · Last seen ${new Date(dev.lastSeenAt).toLocaleTimeString()}`
                      : ''}
                  </div>
                </div>
                {canManage && dev.provisioningStatus !== 'revoked' && dev.hasCredentialIssued && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevokeDevice(dev.id)}
                    className="shrink-0"
                  >
                    <ShieldAlert size={13} aria-hidden="true" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck size={16} className="text-muted-foreground" aria-hidden="true" />
              Security & onboarding log
            </CardTitle>
          </CardHeader>
          <CardContent className="custom-scrollbar max-h-72 space-y-2 overflow-y-auto pt-4 text-xs">
            {(detail.enrollmentTokens || [])
              .filter((t: any) => !t.usedAt && !t.revokedAt)
              .map((tok: any) => (
                <div
                  key={tok.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5"
                >
                  <div className="min-w-0 truncate text-success">
                    <span className="font-mono font-medium">{tok.tokenPrefix}…</span>
                    <span className="text-xs"> · Active {tok.purpose}</span>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    onClick={() => handleRevokeToken(tok.id)}
                    className="shrink-0"
                  >
                    Revoke
                  </Button>
                </div>
              ))}

            {(detail.auditEvents || []).map((ev: any) => (
              <div key={ev.id} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{ev.summary}</div>
                  <div className="mt-0.5 break-all font-mono tabular text-[11px] text-muted-foreground">
                    {ev.eventType} · {new Date(ev.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
