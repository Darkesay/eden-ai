import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Compass,
  Download,
  History,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { apiFetch, resolveApiUrl } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { useStoreValue } from '../lib/store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface StandardDeviceSensor {
  sensor_id: string;
  sensor_type: string;
  label: string;
  unit: string;
  last_value: number | null;
  quality: 'valid' | 'out_of_range' | 'stale' | 'sensor_fault' | 'unavailable';
  source: 'real_hardware' | 'simulated';
  timestamp: string | null;
}

interface StandardDeviceModel {
  device_id: string;
  greenhouse_id: string;
  zone_id: string | null;
  device_type: 'greenhouse_controller' | 'greenhouse_camera';
  manufacturer: string;
  model: string;
  firmware_version: string;
  protocol: 'mqtt' | 'http_rest' | 'websocket' | 'esphome_api' | 'thingsboard_v1';
  connection_state: 'online' | 'stale' | 'reconnecting' | 'offline' | 'pending_setup' | 'revoked';
  last_seen: string | null;
  capabilities: string[];
  sensors: StandardDeviceSensor[];
  cameras: Array<{
    camera_id: string;
    freshness_state: string;
    last_capture_at: string | null;
    stream_configured: boolean;
  }>;
  actuators: Array<{
    actuator_id: string;
    actuator_type: string;
    label: string;
    physical_dispatch_enabled: false;
  }>;
}

interface StandardTelemetryRecord {
  device_id: string;
  sensor_id: string;
  sensor_type: string;
  value: number;
  unit: string;
  timestamp: string;
  quality: 'valid' | 'out_of_range' | 'stale' | 'sensor_fault' | 'unavailable';
  source: 'real_hardware' | 'simulated';
}

interface ConnectionHistoryEntry {
  id: string;
  protocol: string;
  previousState: string | null;
  newState: string;
  reason: string | null;
  remoteAddr: string | null;
  recordedAt: string;
}

function mapConnectionStateLabel(
  state: StandardDeviceModel['connection_state']
): 'CONNECTED' | 'STALE DATA' | 'RECONNECTING' | 'DISCONNECTED' {
  if (state === 'online') return 'CONNECTED';
  if (state === 'stale') return 'STALE DATA';
  if (state === 'reconnecting') return 'RECONNECTING';
  return 'DISCONNECTED';
}

function formatProtocolLabel(protocol: StandardDeviceModel['protocol']): string {
  if (protocol === 'mqtt') return 'MQTT v3.1.1/v5';
  if (protocol === 'esphome_api') return 'ESPHome 2026.10.2';
  if (protocol === 'thingsboard_v1') return 'ThingsBoard v1 HTTP';
  if (protocol === 'websocket') return 'Authenticated WebSocket';
  return 'HTTPS REST';
}

export function UniversalHardwareFleetPanel({
  greenhouseId
}: {
  greenhouseId?: string | null;
}) {
  const [devices, setDevices] = useState<StandardDeviceModel[]>([]);
  const [telemetry, setTelemetry] = useState<StandardTelemetryRecord[]>([]);
  const [platformInfo, setPlatformInfo] = useState<{
    selectedArchitecture?: string;
    mqttOverWsEndpoint?: string;
  } | null>(null);
  const [wsState, setWsState] = useState<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  const [dataViewFilter, setDataViewFilter] = useState<'real_hardware' | 'simulated'>('real_hardware');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Device history & ESPHome YAML state
  const [selectedHistoryDeviceId, setSelectedHistoryDeviceId] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ConnectionHistoryEntry[]>([]);
  const [esphomeYamlPreview, setEsphomeYamlPreview] = useState<{
    deviceId: string;
    filename: string;
    yaml: string;
  } | null>(null);

  // Local ESPHome HTTP discovery state
  const [discoverDeviceId, setDiscoverDeviceId] = useState<string>('');
  const [discoverBaseUrl, setDiscoverBaseUrl] = useState<string>('');
  const [discoverSensorIds, setDiscoverSensorIds] = useState<string>(
    'greenhouse_air_temperature,greenhouse_relative_humidity,root_zone_soil_moisture'
  );
  const [discoverBusy, setDiscoverBusy] = useState(false);

  // Local simulation store values (shown ONLY when farmer explicitly selects SIMULATED DATA view)
  const simTemp = Number(useStoreValue('temperature', 24.5) ?? 24.5);
  const simHum = Number(useStoreValue('humidity', 64) ?? 64);
  const simSoil = Number(useStoreValue('soilMoisture', 58) ?? 58);
  const simWater = Number(useStoreValue('waterLevel', 76) ?? 76);

  const reconnectTimerRef = useRef<number | null>(null);

  const loadNormalizedFleet = useCallback(async () => {
    if (!greenhouseId) {
      setDevices([]);
      setTelemetry([]);
      return;
    }
    setLoading(true);
    try {
      const [statusRes, devRes, telRes] = await Promise.all([
        apiFetch('/api/iot/platform-status'),
        apiFetch(`/api/greenhouses/${greenhouseId}/iot/devices`),
        apiFetch(`/api/greenhouses/${greenhouseId}/iot/telemetry?source=real_hardware`)
      ]);

      const statusParsed = await parseApiJsonResponse<any>(statusRes);
      if (statusParsed.ok && statusParsed.data) {
        const arch = statusParsed.data.selectedArchitecture;
        setPlatformInfo({
          selectedArchitecture:
            typeof arch === 'string'
              ? arch
              : arch?.strategy || 'ESPHome + Embedded Multi-Tenant MQTT + ThingsBoard v1 Adapter',
          mqttOverWsEndpoint:
            arch?.embeddedGateway?.mqttOverWsPath || statusParsed.data.endpoints?.mqttOverWebSocket
        });
      }

      const devParsed = await parseApiJsonResponse<any>(devRes);
      if (devParsed.ok && Array.isArray(devParsed.data?.devices)) {
        const list = devParsed.data.devices as StandardDeviceModel[];
        setDevices(list);
        if (!discoverDeviceId && list.length > 0) {
          setDiscoverDeviceId(list[0].device_id);
        }
      }

      const telParsed = await parseApiJsonResponse<any>(telRes);
      if (telParsed.ok && Array.isArray(telParsed.data?.telemetry)) {
        setTelemetry(telParsed.data.telemetry as StandardTelemetryRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }, [greenhouseId, discoverDeviceId]);

  useEffect(() => {
    void loadNormalizedFleet();
  }, [loadNormalizedFleet]);

  // Real-time server-authoritative WebSocket subscription (/api/iot/ws)
  useEffect(() => {
    if (!greenhouseId || typeof window === 'undefined') {
      setWsState('DISCONNECTED');
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let attempt = 0;

    const buildWsUrl = () => {
      const resolvedHttp = resolveApiUrl(`/api/iot/ws?greenhouseId=${encodeURIComponent(greenhouseId)}`);
      if (/^https?:\/\//i.test(resolvedHttp)) {
        return resolvedHttp.replace(/^http/i, 'ws');
      }
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${window.location.host}${resolvedHttp}`;
    };

    const connectSocket = () => {
      if (cancelled) return;
      if (attempt > 0) {
        setWsState('RECONNECTING');
      }
      try {
        socket = new WebSocket(buildWsUrl());
      } catch {
        setWsState('DISCONNECTED');
        return;
      }

      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setWsState('CONNECTED');
      };

      socket.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(ev.data));
          const evKind = msg.event || msg.type;
          if (evKind === 'iot:init') {
            if (Array.isArray(msg.devices)) {
              setDevices(msg.devices);
            }
            if (Array.isArray(msg.telemetry)) {
              setTelemetry(
                (msg.telemetry as StandardTelemetryRecord[]).filter(
                  (t) => t.source === 'real_hardware'
                )
              );
            }
          } else if (evKind === 'device:updated' && msg.payload) {
            const incoming = msg.payload as StandardDeviceModel;
            setDevices((prev) => {
              const exists = prev.some((d) => d.device_id === incoming.device_id);
              if (!exists) return [...prev, incoming];
              return prev.map((d) => (d.device_id === incoming.device_id ? incoming : d));
            });
          } else if (evKind === 'telemetry:received' && Array.isArray(msg.payload)) {
            const batch = (msg.payload as StandardTelemetryRecord[]).filter(
              (r) => r.source === 'real_hardware'
            );
            if (batch.length > 0) {
              setTelemetry((prev) => {
                const map = new Map<string, StandardTelemetryRecord>();
                for (const item of prev) map.set(item.sensor_id, item);
                for (const item of batch) map.set(item.sensor_id, item);
                return Array.from(map.values());
              });
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = (ev) => {
        if (cancelled) return;
        if (ev.code === 4401 || ev.code === 4403) {
          setWsState('DISCONNECTED');
          return;
        }
        attempt += 1;
        setWsState(attempt <= 4 ? 'RECONNECTING' : 'DISCONNECTED');
        if (attempt <= 4) {
          const delayMs = Math.min(8000, 1500 * attempt);
          reconnectTimerRef.current = window.setTimeout(connectSocket, delayMs);
        }
      };

      socket.onerror = () => {
        // Handled cleanly in onclose
      };
    };

    connectSocket();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // Ignore close error
        }
      }
    };
  }, [greenhouseId]);

  const handleLoadHistory = async (deviceId: string) => {
    if (!greenhouseId) return;
    if (selectedHistoryDeviceId === deviceId) {
      setSelectedHistoryDeviceId(null);
      return;
    }
    setSelectedHistoryDeviceId(deviceId);
    const res = await apiFetch(`/api/greenhouses/${greenhouseId}/iot/devices/${deviceId}/history`);
    const parsed = await parseApiJsonResponse<any>(res);
    if (parsed.ok && Array.isArray(parsed.data?.connectionTransitions)) {
      setHistoryEntries(parsed.data.connectionTransitions);
    } else {
      setHistoryEntries([]);
    }
  };

  const handlePreviewEspHomeYaml = async (deviceId: string) => {
    if (!greenhouseId) return;
    if (esphomeYamlPreview?.deviceId === deviceId) {
      setEsphomeYamlPreview(null);
      return;
    }
    const res = await apiFetch(
      `/api/greenhouses/${greenhouseId}/iot/devices/${deviceId}/esphome-yaml`
    );
    const parsed = await parseApiJsonResponse<any>(res);
    if (parsed.ok && parsed.data?.yaml) {
      setEsphomeYamlPreview({
        deviceId,
        filename: parsed.data.filename || `edens-esphome-${deviceId}.yaml`,
        yaml: parsed.data.yaml
      });
    } else {
      setFeedback({
        tone: 'err',
        text: !parsed.ok ? parsed.message : 'Unable to generate ESPHome configuration.'
      });
    }
  };

  const handleDownloadEspHomeYaml = () => {
    if (!esphomeYamlPreview) return;
    const blob = new Blob([esphomeYamlPreview.yaml], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = esphomeYamlPreview.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunEspHomeDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!greenhouseId || !discoverDeviceId || !discoverBaseUrl.trim()) return;
    setDiscoverBusy(true);
    setFeedback(null);
    try {
      const ids = discoverSensorIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/iot/discover-esphome`, {
        method: 'POST',
        body: JSON.stringify({
          deviceId: discoverDeviceId,
          baseUrl: discoverBaseUrl.trim(),
          sensorIds: ids
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || (!parsed.data?.ok && !parsed.data?.success)) {
        setFeedback({
          tone: 'err',
          text: !parsed.ok
            ? parsed.message
            : parsed.data?.message || 'ESPHome capability discovery rejected.'
        });
        return;
      }
      setFeedback({
        tone: 'ok',
        text: `Verified ESPHome node (${parsed.data.discoveredEntitiesCount} sensor channel(s) discovered).`
      });
      await loadNormalizedFleet();
    } finally {
      setDiscoverBusy(false);
    }
  };

  const simulatedRecords: StandardTelemetryRecord[] = useMemo(() => {
    const nowIso = new Date().toISOString();
    return [
      {
        device_id: 'sandbox_simulator',
        sensor_id: 'sandbox:temperature',
        sensor_type: 'temperature',
        value: simTemp,
        unit: 'celsius',
        timestamp: nowIso,
        quality: 'valid',
        source: 'simulated'
      },
      {
        device_id: 'sandbox_simulator',
        sensor_id: 'sandbox:humidity',
        sensor_type: 'humidity',
        value: simHum,
        unit: 'percent',
        timestamp: nowIso,
        quality: 'valid',
        source: 'simulated'
      },
      {
        device_id: 'sandbox_simulator',
        sensor_id: 'sandbox:soil_moisture',
        sensor_type: 'soil_moisture',
        value: simSoil,
        unit: 'percent',
        timestamp: nowIso,
        quality: 'valid',
        source: 'simulated'
      },
      {
        device_id: 'sandbox_simulator',
        sensor_id: 'sandbox:water_level',
        sensor_type: 'water_level',
        value: simWater,
        unit: 'percent',
        timestamp: nowIso,
        quality: 'valid',
        source: 'simulated'
      }
    ];
  }, [simTemp, simHum, simSoil, simWater]);

  if (!greenhouseId) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-6">
      {/* Header & Real-Time Stream Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Universal Device Adapter &amp; Normalized Sensor Fleet
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{platformInfo?.selectedArchitecture || 'ESPHome + Embedded Multi-Tenant MQTT + ThingsBoard v1 Adapter'}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              {wsState === 'CONNECTED' && (
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              )}
              <span>Live Telemetry Socket: {wsState}</span>
            </span>
            {platformInfo?.mqttOverWsEndpoint && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{platformInfo.mqttOverWsEndpoint}</span>
              </>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => void loadNormalizedFleet()}
          disabled={loading}
          className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
        >
          <RefreshCw size={14} className={cn('mr-1.5', loading && 'animate-spin')} />
          Sync Fleet
        </Button>
      </div>

      {feedback && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-xs font-medium',
            feedback.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200'
          )}
        >
          {feedback.text}
        </div>
      )}

      {/* Registered Devices List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Normalized Greenhouse Devices ({devices.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            MQTT · ESPHome · ThingsBoard v1 · HTTPS REST · WebSocket
          </p>
        </div>

        {devices.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            No hardware boards registered for this greenhouse yet. Use the Setup Guide to enroll a controller or camera.
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {devices.map((dev) => {
              const stateLabel = mapConnectionStateLabel(dev.connection_state);
              return (
                <div key={dev.device_id} className="py-4 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-foreground">
                        {dev.model} ({dev.device_type === 'greenhouse_camera' ? 'Camera' : 'Controller'})
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            'font-semibold',
                            stateLabel === 'CONNECTED'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : stateLabel === 'STALE DATA' || stateLabel === 'RECONNECTING'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-muted-foreground'
                          )}
                        >
                          {stateLabel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Protocol: {formatProtocolLabel(dev.protocol)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Firmware: {dev.firmware_version}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">ID: {dev.device_id}</span>
                        {dev.zone_id && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">Zone: {dev.zone_id}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleLoadHistory(dev.device_id)}
                        className="h-9 px-3 text-xs font-medium cursor-pointer"
                      >
                        <History size={13} className="mr-1.5" />
                        Device History
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handlePreviewEspHomeYaml(dev.device_id)}
                        className="h-9 px-3 text-xs font-medium cursor-pointer"
                      >
                        <Activity size={13} className="mr-1.5" />
                        ESPHome YAML
                      </Button>
                    </div>
                  </div>

                  {dev.last_seen && (
                    <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      Last check-in: {new Date(dev.last_seen).toLocaleString()} · Discovered sensors: {dev.sensors.length} · Actuators: {dev.actuators.length} (Monitoring Only)
                    </p>
                  )}

                  {selectedHistoryDeviceId === dev.device_id && (
                    <div className="pt-2 space-y-1.5 text-xs">
                      <p className="font-semibold text-foreground">Recent Connection State Transitions</p>
                      {historyEntries.length === 0 ? (
                        <p className="text-muted-foreground">No protocol transitions recorded yet for this board.</p>
                      ) : (
                        <div className="space-y-1 font-mono tabular-nums text-[11px] text-muted-foreground">
                          {historyEntries.slice(0, 6).map((h) => (
                            <div key={h.id}>
                              {new Date(h.recordedAt).toLocaleTimeString()} · {h.protocol} · {h.previousState || 'initial'} → {h.newState}
                              {h.reason ? ` · ${h.reason}` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {esphomeYamlPreview?.deviceId === dev.device_id && (
                    <div className="pt-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-foreground">
                          ESPHome 2026.10.2 Reference Configuration ({esphomeYamlPreview.filename})
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleDownloadEspHomeYaml}
                          className="h-8 px-3 text-xs font-medium cursor-pointer"
                        >
                          <Download size={13} className="mr-1.5" />
                          Download YAML
                        </Button>
                      </div>
                      <pre className="max-h-56 overflow-auto rounded-lg bg-muted/60 p-3 text-[11px] font-mono leading-relaxed text-foreground">
                        {esphomeYamlPreview.yaml}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Strict Separation of REAL HARDWARE DATA vs SIMULATED DATA */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Normalized Sensor Telemetry</h3>
            <p className="text-xs text-muted-foreground">
              EDENS AI strictly isolates verified physical hardware readings from practice simulation values.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg self-start">
            <button
              type="button"
              onClick={() => setDataViewFilter('real_hardware')}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                dataViewFilter === 'real_hardware'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              REAL HARDWARE DATA
            </button>
            <button
              type="button"
              onClick={() => setDataViewFilter('simulated')}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                dataViewFilter === 'simulated'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              SIMULATED DATA
            </button>
          </div>
        </div>

        {dataViewFilter === 'real_hardware' ? (
          telemetry.length === 0 ? (
            <div className="py-5 text-xs text-muted-foreground">
              DISCONNECTED · No REAL HARDWARE DATA received yet for this greenhouse. Connect an ESP32 via MQTT, ESPHome, ThingsBoard v1 HTTP, or HTTPS upload to populate verified sensor channels.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Sensor Channel</th>
                    <th className="py-2 pr-4 font-medium">Reading</th>
                    <th className="py-2 pr-4 font-medium">Quality</th>
                    <th className="py-2 pr-4 font-medium">Source Identity</th>
                    <th className="py-2 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono tabular-nums">
                  {telemetry.map((t) => (
                    <tr key={t.sensor_id}>
                      <td className="py-2.5 pr-4 font-sans font-medium text-foreground">
                        {t.sensor_type} <span className="text-muted-foreground font-mono">({t.sensor_id})</span>
                      </td>
                      <td className="py-2.5 pr-4 font-semibold text-foreground">
                        {t.value} {t.unit}
                      </td>
                      <td className="py-2.5 pr-4">
                        {t.quality === 'stale' ? 'STALE DATA' : t.quality.toUpperCase()}
                      </td>
                      <td className="py-2.5 pr-4 text-emerald-700 dark:text-emerald-400 font-sans font-semibold">
                        REAL HARDWARE DATA
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {new Date(t.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Sandbox Channel</th>
                  <th className="py-2 pr-4 font-medium">Simulated Value</th>
                  <th className="py-2 pr-4 font-medium">Source Identity</th>
                  <th className="py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono tabular-nums">
                {simulatedRecords.map((t) => (
                  <tr key={t.sensor_id}>
                    <td className="py-2.5 pr-4 font-sans font-medium text-foreground">{t.sensor_type}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">
                      {t.value} {t.unit}
                    </td>
                    <td className="py-2.5 pr-4 text-amber-700 dark:text-amber-400 font-sans font-semibold">
                      SIMULATED DATA
                    </td>
                    <td className="py-2.5 font-sans text-muted-foreground">
                      Isolated practice value — never mixed into SQLite hardware telemetry
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Authenticated Local ESPHome Discovery */}
      {devices.length > 0 && (
        <form onSubmit={handleRunEspHomeDiscovery} className="pt-4 border-t border-border space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">
              Local Network ESPHome Protocol Discovery
            </h3>
            <p className="text-xs text-muted-foreground">
              Verify an ESPHome v3 HTTP sensor node on your local network before marking it compatible. Arbitrary non-ESPHome hosts are rejected.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Target Enrolled Device</label>
              <select
                value={discoverDeviceId}
                onChange={(e) => setDiscoverDeviceId(e.target.value)}
                className="w-full h-10 rounded-lg border border-input bg-background px-3 text-xs font-medium"
              >
                {devices.map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.model} ({d.device_id})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Local ESPHome Base URL</label>
              <Input
                value={discoverBaseUrl}
                onChange={(e) => setDiscoverBaseUrl(e.target.value)}
                placeholder="http://esphome-greenhouse.local"
                className="h-10 font-mono text-xs bg-background"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">ESPHome Sensor Object IDs</label>
              <Input
                value={discoverSensorIds}
                onChange={(e) => setDiscoverSensorIds(e.target.value)}
                placeholder="greenhouse_air_temperature,greenhouse_relative_humidity"
                className="h-10 font-mono text-xs bg-background"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="outline"
              disabled={discoverBusy || !discoverBaseUrl.trim()}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              {discoverBusy ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Compass size={14} className="mr-1.5" />
              )}
              Discover ESPHome Capabilities
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
