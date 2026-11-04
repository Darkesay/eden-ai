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
  ShieldCheck,
  Snowflake,
  Sprout,
  Sun,
  Thermometer,
  Umbrella,
  Waves,
  Wifi,
  Wrench
} from 'lucide-react';
import { apiFetch, resolveApiUrl, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { formatExplicitDeviceState, formatRelativeAge } from '../lib/greenhouseState';
import { hardwareService, DEFAULT_CROPS } from '../lib/hardwareService';
import { useMqtt } from '../lib/mqtt';
import { useStoreValue } from '../lib/store';
import { QrCodeCard } from '../components/QrScannerModal';
import { CropIntelligenceControlPanel } from '../components/CropIntelligenceControlPanel';
import { MonitoringModeBanner } from '../components/MonitoringModeBanner';
import { ConnectExistingHardwarePanel } from '../components/ConnectExistingHardwarePanel';
import { UniversalHardwareFleetPanel } from '../components/UniversalHardwareFleetPanel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
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
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setErrorMsg(!parsed.ok ? parsed.message : parsed.data?.message || 'Unable to load greenhouse.');
        return;
      }
      const data = parsed.data;
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

  const monitoringModeLocked = true;

  const handleToggleEquipment = async (
    device: 'pump' | 'fan' | 'light' | 'heater' | 'peltier' | 'roof',
    currentlyOn: boolean
  ) => {
    if (monitoringModeLocked) {
      setControlFeedback({
        tone: 'err',
        text: 'MONITORING MODE — PHYSICAL CONTROL DISABLED. Physical actuator commands are locked during hardware verification.'
      });
      return;
    }
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
  const tel = selectedZoneId === 'all' ? detail.latestTelemetry : zoneTelemetry || null;
  const canManage = (gh.role === 'owner' || gh.role === 'operator') && !isGuest;
  const zonesList: any[] = detail.zones || [];
  const activeDevices: any[] = (detail.devices || []).filter(
    (d: any) => !d.replacedByDeviceId && d.provisioningStatus !== 'revoked'
  );
  const retiredDevices: any[] = (detail.devices || []).filter(
    (d: any) => Boolean(d.replacedByDeviceId) || d.provisioningStatus === 'revoked'
  );

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

      <MonitoringModeBanner />

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

      {/* 1. Sensor Readings, Zones & Environmental Trend */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-5">
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

        {/* Multi-Zone Filter & Quick Add Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-1 inline-flex items-center gap-1">
              <Layers size={13} className="text-primary" />
              Zones:
            </span>
            <button
              type="button"
              onClick={() => setSelectedZoneId('all')}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer',
                selectedZoneId === 'all'
                  ? 'border-primary bg-accent text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              )}
            >
              All Zones
            </button>
            {zonesList.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setSelectedZoneId(z.id)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer',
                  selectedZoneId === z.id
                    ? 'border-primary bg-accent text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                )}
              >
                {z.name}
              </button>
            ))}
          </div>

          {canManage && (
            <div className="flex items-center gap-1.5">
              <Input
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="New zone name..."
                className="h-8 text-xs w-36 sm:w-44 bg-background"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={addingZone || !newZoneName.trim()}
                onClick={handleCreateZone}
                className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <Plus size={13} className="mr-1" />
                Add Zone
              </Button>
            </div>
          )}
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

      {/* 1B. Phase 3 Crop Intelligence, 8-Point Recommendations & Farmer-Authorized Control */}
      <CropIntelligenceControlPanel
        greenhouseId={gh.id}
        selectedZoneId={selectedZoneId}
        isGuest={isGuest}
        canManage={canManage}
        onUpdated={fetchDetails}
      />

      {/* 2. Two-Column Camera Snapshot Summary + Safe Equipment Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Plant Camera Summary */}
        <section className="lg:col-span-6 rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
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
        <section className="lg:col-span-6 rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Equipment Controls &amp; Safety Locks
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                MONITORING MODE — PHYSICAL CONTROL DISABLED. Physical equipment actuation is locked during hardware verification.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300 shrink-0 whitespace-nowrap">
              <ShieldCheck size={13} /> Monitoring Lock
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
                    variant="outline"
                    disabled={monitoringModeLocked || item.locked || isBusy || !canManage}
                    onClick={() => handleToggleEquipment(item.id, item.active)}
                    className="h-9 px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isBusy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : monitoringModeLocked ? (
                      'Monitoring Only'
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
            Physical actuator commands (pump, fan, heater, grow lights, cooler, roof) are disabled while Monitoring Mode is active.
          </p>
        </section>
      </div>

      {/* 2B. Connect Existing ESP32-CAM & ESP32 Controller over Current HTTP Endpoints */}
      <ConnectExistingHardwarePanel
        greenhouseId={gh.id}
        onCameraFrameVerified={fetchDetails}
      />

      {/* 2C. Stage 2 Universal Device Adapter & Real-Time Normalized Telemetry */}
      <UniversalHardwareFleetPanel greenhouseId={gh.id} />

      {/* 3. Hardware Fleet, Plug-and-Play Pairing & Lifecycle Management */}
      <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTechSection((prev) => !prev)}
          className="w-full px-4 sm:px-6 py-4 flex items-center justify-between gap-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Hardware Fleet, Plug-and-Play Pairing &amp; Activity History ({activeDevices.length} Active)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pair ESP32 controllers &amp; cameras over Wi-Fi, add 1-to-N zone boards, rotate keys, replace faulty units, and inspect capabilities.
            </p>
          </div>
          {showTechSection ? (
            <ChevronUp size={18} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={18} className="text-muted-foreground shrink-0" />
          )}
        </button>

        {showTechSection && (
          <div className="px-4 sm:px-6 pb-5 sm:pb-6 pt-4 border-t border-border space-y-6">
            {isGuest && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-100 p-3.5 text-xs">
                Guest sessions operate in read-only / practice mode. Sign in with a Farmer account to pair, rotate, replace, or revoke physical greenhouse hardware.
              </div>
            )}

            {fleetBanner && (
              <div
                className={cn(
                  'rounded-xl border px-4 py-3 text-xs font-medium',
                  fleetBanner.tone === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200'
                    : 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200'
                )}
              >
                {fleetBanner.text}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Enrolled Hardware Fleet (8 cols on lg) */}
              <div className="lg:col-span-8 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Enrolled Hardware Boards
                  </h3>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      {zonesList.length > 0 && (
                        <select
                          aria-label="Zone for new board"
                          value={fleetZoneSelect}
                          onChange={(e) => setFleetZoneSelect(e.target.value)}
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                        >
                          {zonesList.map((z) => (
                            <option key={z.id} value={z.id}>
                              Zone: {z.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fleetBusy}
                        onClick={() => handleAddFleetDevice('esp32_controller')}
                        className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
                      >
                        <Plus size={13} className="mr-1" />
                        Add Controller
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fleetBusy}
                        onClick={() => handleAddFleetDevice('esp32_cam')}
                        className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
                      >
                        <Plus size={13} className="mr-1" />
                        Add Camera
                      </Button>
                    </div>
                  )}
                </div>

                <div className="divide-y divide-border rounded-xl border border-border bg-background">
                  {activeDevices.map((d: any) => {
                    const st = formatExplicitDeviceState(d.explicitState || d.connectionStatus);
                    const zoneName =
                      zonesList.find((z) => z.id === d.zoneId)?.name || 'Main Growing Zone';
                    const pairing = devicePairingMap[d.id];
                    const rotated = rotatedKeyMap[d.id];
                    const diag = diagnosticsMap[d.id];
                    const isReplacing = replacingDeviceId === d.id;

                    return (
                      <div key={d.id} className="p-4 space-y-3 text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                {d.deviceType === 'esp32_cam' ? (
                                  <Camera size={14} className="text-primary shrink-0" />
                                ) : (
                                  <Cpu size={14} className="text-primary shrink-0" />
                                )}
                                {d.label}
                              </span>
                              <span className="px-2 py-0.5 rounded border border-border bg-muted/50 text-[11px] text-muted-foreground">
                                {zoneName}
                              </span>
                              <span className="font-medium text-muted-foreground">{st.label}</span>
                            </div>

                            <div className="text-[11px] font-mono tabular-nums text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>ID: {d.id}</span>
                              <span>Key: {d.keyPrefix ? `${d.keyPrefix}••••` : 'Unpaired'}</span>
                              <span>FW: {d.firmwareVersion || 'Unreported'}</span>
                              <span>
                                Seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleTimeString() : 'Never'}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {canManage && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={fleetBusy}
                                  onClick={() => handlePairViaWifi(d.id)}
                                  className="h-8 px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  <Wifi size={12} className="mr-1" />
                                  Pair via Wi-Fi
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={fleetBusy}
                                  onClick={() => handleRotateKey(d.id)}
                                  className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  <KeyRound size={12} className="mr-1" />
                                  Rotate Key
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={fleetBusy}
                                  onClick={() => {
                                    setReplacingDeviceId(isReplacing ? null : d.id);
                                    setReplaceLabel(`${d.label} (Replacement)`);
                                  }}
                                  className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  <Repeat size={12} className="mr-1" />
                                  Replace
                                </Button>
                              </>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleDiagnostics(d.id)}
                              className="h-8 px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer"
                            >
                              <Activity size={12} className="mr-1" />
                              {diag ? 'Hide Info' : 'Capabilities'}
                            </Button>
                          </div>
                        </div>

                        {/* Wi-Fi SoftAP Pairing Drawer */}
                        {pairing && (
                          <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            {pairing.qrDataUrl && (
                              <img
                                src={pairing.qrDataUrl}
                                alt={`Pairing QR for ${d.label}`}
                                className="w-20 h-20 rounded border border-border bg-white p-1 shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0 space-y-1.5 w-full">
                              <p className="font-semibold text-foreground">
                                WPA2 SoftAP Pairing Code (Join <span className="font-mono">EDENS-SETUP-XXXX</span> with the board&apos;s unique 12-char WPA2 Setup Key &rarr; <span className="font-mono">http://192.168.4.1</span>)
                              </p>
                              <div className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono tabular-nums text-[11px]">
                                <span className="truncate">{pairing.enrollmentCode}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(`pair-${d.id}`, pairing.enrollmentCode)}
                                  className="text-primary font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  {copiedKeyId === `pair-${d.id}` ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Portal closes automatically after pairing or 15 minutes. Rotated or revoked boards enter safe HTTP 401 Credential Recovery Mode automatically after verified auth rejections.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Rotated One-Time Key Drawer */}
                        {rotated && (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/60 dark:bg-emerald-950/40 p-3 space-y-2">
                            <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                              New One-Time Device Key (Previous Key Invalidated)
                            </p>
                            <div className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono tabular-nums text-[11px]">
                              <span className="truncate">{rotated.oneTimeDeviceKey}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyText(`rot-${d.id}`, rotated.oneTimeDeviceKey)}
                                className="text-primary font-semibold whitespace-nowrap cursor-pointer"
                              >
                                {copiedKeyId === `rot-${d.id}` ? <Copy size={12} /> : 'Copy Key'}
                              </button>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => downloadHeader(rotated.filename, rotated.content)}
                              className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap cursor-pointer"
                            >
                              <Download size={12} className="mr-1.5" />
                              Download {rotated.filename}
                            </Button>
                          </div>
                        )}

                        {/* Faulty Board Atomic Replacement Drawer */}
                        {isReplacing && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-950/35 p-3.5 space-y-2.5">
                            <p className="font-semibold text-foreground">
                              Replace Faulty Board (Preserves 100% of Historical Telemetry)
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <Input
                                value={replaceLabel}
                                onChange={(e) => setReplaceLabel(e.target.value)}
                                placeholder="New board label"
                                className="h-8 text-xs bg-background"
                              />
                              <Input
                                value={replaceReason}
                                onChange={(e) => setReplaceReason(e.target.value)}
                                placeholder="Reason (e.g., lightning surge)"
                                className="h-8 text-xs bg-background"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={fleetBusy}
                                onClick={() => handleConfirmReplaceDevice(d.id)}
                                className="h-8 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                Confirm Replace &amp; Issue New Code
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setReplacingDeviceId(null)}
                                className="h-8 px-3 text-xs cursor-pointer"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Capabilities & Firmware History Diagnostics */}
                        {diag && (
                          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-[11px]">
                            <div className="flex flex-wrap justify-between gap-2 font-mono tabular-nums text-muted-foreground">
                              <span>EFuse UID: {diag.device?.hardwareIdentityUid || 'Unreported'}</span>
                              <span>MAC: {diag.device?.macAddress || 'Unreported'}</span>
                              <span>OTA Status: {diag.ota?.otaStatus || 'idle'}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-foreground">Reported Capabilities: </span>
                              {(diag.capabilities || []).length === 0 ? (
                                <span className="text-muted-foreground">None reported yet</span>
                              ) : (
                                <span className="font-mono text-muted-foreground">
                                  {(diag.capabilities || [])
                                    .map((c: any) => `${c.capabilityType}:${c.capabilityKey}`)
                                    .join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Revoke Action */}
                        {canManage && (
                          <div className="pt-0.5 flex items-center gap-2">
                            {confirmRevokeId === d.id ? (
                              <>
                                <span className="text-[11px] text-red-700 dark:text-red-400 font-medium">
                                  Revoke board access immediately?
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleRevokeDevice(d.id)}
                                  className="h-7 px-2.5 bg-red-600 hover:bg-red-700 text-white text-xs cursor-pointer"
                                >
                                  Confirm Revoke
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setConfirmRevokeId(null)}
                                  className="h-7 px-2.5 text-xs cursor-pointer"
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRevokeId(d.id)}
                                className="text-[11px] font-medium text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                              >
                                Revoke Device Key
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {retiredDevices.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowRetiredBoards((prev) => !prev)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showRetiredBoards ? 'Hide' : 'Show'} Retired / Replaced Boards ({retiredDevices.length})
                    </button>
                    {showRetiredBoards && (
                      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-muted/20 text-xs">
                        {retiredDevices.map((rd) => (
                          <div key={rd.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">{rd.label}</span>
                              <span className="ml-2 font-mono tabular-nums text-[11px]">{rd.id}</span>
                            </div>
                            <span className="font-mono tabular-nums text-[11px]">
                              {rd.replacedByDeviceId
                                ? `Replaced by ${rd.replacedByDeviceId}`
                                : 'Revoked'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Active Invites & Audit Log (4 cols on lg) */}
              <div className="lg:col-span-4 space-y-4">
                {(detail.enrollmentTokens || []).filter((t: any) => t.status === 'active').length >
                  0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Active Pairing &amp; Invite Tokens
                    </h4>
                    <div className="divide-y divide-border rounded-xl border border-border bg-background">
                      {detail.enrollmentTokens
                        .filter((t: any) => t.status === 'active')
                        .map((tok: any) => (
                          <div
                            key={tok.id}
                            className="flex items-center justify-between px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-mono tabular-nums font-medium">{tok.tokenPrefix}••••</span>
                              <span className="ml-2 text-[11px] text-muted-foreground">{tok.purpose}</span>
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => handleRevokeToken(tok.id)}
                                className="text-red-700 dark:text-red-400 font-medium hover:underline cursor-pointer"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent Greenhouse Events
                  </h3>
                  {(detail.auditEvents || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No events logged yet.</p>
                  ) : (
                    <div className="divide-y divide-border rounded-xl border border-border bg-background px-3.5 py-1.5 max-h-72 overflow-y-auto">
                      {(detail.auditEvents || []).slice(0, 12).map((ev: any) => (
                        <div key={ev.id} className="py-2 text-xs flex items-start justify-between gap-3">
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
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
