import React, { useCallback, useEffect, useState } from 'react';
import { useAuth, apiFetch } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import {
  Copy,
  Check,
  Fingerprint,
  Calendar,
  Cpu,
  Network,
  Plus,
  Server,
  Terminal,
  Settings as SettingsIcon,
  Wifi,
  Radio,
  Plug,
  Camera,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Download,
  Eye,
  EyeOff,
  Activity,
  Layers,
  Thermometer,
  Droplet,
  Sun,
  CloudRain,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FileCode
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';

export type UiConnectionState =
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'OFFLINE'
  | 'SIMULATED'
  | 'STALE DATA'
  | 'AUTHENTICATION FAILED';

interface EnrolledDevice {
  id: string;
  greenhouseId: string;
  zoneId?: string | null;
  deviceType: 'esp32_controller' | 'esp32_cam' | 'environmental_node';
  label: string;
  serialNumber?: string;
  keyPrefix?: string;
  hasCredentialIssued: boolean;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
  lastSuccessfulUploadAt?: string | null;
  explicitState?: string;
  capabilities?: string[];
  lastErrorCategory?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
}

const DEVICE_TYPES = [
  { id: 'esp32_controller', name: 'ESP32 Sensor Controller', icon: Cpu, desc: 'Pushes temperature, humidity, soil moisture, water level via HTTPS or MQTT-WS.' },
  { id: 'esp32_cam', name: 'ESP32-CAM (AI-Thinker)', icon: Camera, desc: 'Streams or uploads periodic canopy JPEGs for automated agronomic Plant Vision.' },
  { id: 'environmental_node', name: 'Python Edge Gateway', icon: Terminal, desc: 'Local Raspberry Pi / Linux daemon buffering telemetry and relaying LAN cameras.' }
];

const PROTOCOLS = [
  { id: 'https_outbound', name: 'HTTPS Direct Outbound (Recommended)', desc: 'Device pushes to /api/telemetry/upload with X-Hardware-Key over TLS.' },
  { id: 'mqtt_ws', name: 'MQTT over WebSocket (WSS)', desc: 'Device connects to /api/iot/mqtt-ws on port 3000 (Render compatible).' },
  { id: 'lan_relay', name: 'Local LAN Relay Bridge', desc: 'Edge daemon pulls http://<LAN_CAMERA_IP>/photo and forwards to cloud.' },
  { id: 'thingsboard', name: 'ThingsBoard v1 HTTP', desc: 'Device pushes telemetry via /api/v1/:deviceToken/telemetry.' }
];

export default function DeviceManagement() {
  const { user, activeGreenhouse, greenhouses, setActiveGreenhouseId } = useAuth();
  
  const [devices, setDevices] = useState<EnrolledDevice[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Enrollment Modal state
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [newDeviceType, setNewDeviceType] = useState<'esp32_controller' | 'esp32_cam' | 'environmental_node'>('esp32_controller');
  const [newDeviceLabel, setNewDeviceLabel] = useState('');
  const [newDeviceZoneId, setNewDeviceZoneId] = useState<string>('');
  const [selectedProtocol, setSelectedProtocol] = useState('https_outbound');
  const [enrollBusy, setEnrollBusy] = useState(false);

  // Post-enrollment credential modal
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false);
  const [issuedCreds, setIssuedCreds] = useState<{
    deviceId: string;
    label: string;
    deviceType: string;
    oneTimeDeviceKey: string;
    authHeaderName: string;
    uploadEndpoint: string;
    firmwareHeader?: string;
  } | null>(null);

  // Diagnostics modal
  const [diagModalOpen, setDiagModalOpen] = useState(false);
  const [diagDevice, setDiagDevice] = useState<EnrolledDevice | null>(null);

  // Action states
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const activeGhId = activeGreenhouse?.id || (greenhouses && greenhouses[0]?.id) || '';

  // Load devices and zones for active greenhouse
  const loadFleet = useCallback(async () => {
    if (!activeGhId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/greenhouses/${activeGhId}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (parsed.ok && parsed.data?.greenhouse) {
        setDevices(parsed.data.devices || []);
        setZones(parsed.data.zones || []);
      }
    } catch (err: any) {
      console.error('Failed to load greenhouse fleet:', err);
    } finally {
      setLoading(false);
    }
  }, [activeGhId]);

  useEffect(() => {
    loadFleet();
    const timer = setInterval(loadFleet, 15000);
    return () => clearInterval(timer);
  }, [loadFleet, refreshKey]);

  // Map server device status to unmistakable UI connection state
  const mapConnectionState = (device: EnrolledDevice): UiConnectionState => {
    if (device.revokedAt) return 'AUTHENTICATION FAILED';
    if (!device.hasCredentialIssued) return 'OFFLINE';

    const explicit = device.explicitState || '';
    if (explicit === 'AUTHENTICATION_ERROR') return 'AUTHENTICATION FAILED';
    if (explicit === 'ONLINE') return 'CONNECTED';
    if (explicit === 'STALE') return 'STALE DATA';
    if (explicit === 'CONNECTION_ERROR') return 'RECONNECTING';

    const lastSeen = device.lastSeenAt || device.lastSuccessfulUploadAt;
    if (!lastSeen) return 'OFFLINE';

    const ageSec = (Date.now() - new Date(lastSeen).getTime()) / 1000;
    if (ageSec <= 30) return 'CONNECTED';
    if (ageSec <= 90) return 'RECONNECTING';
    if (ageSec <= 300) return 'STALE DATA';
    return 'OFFLINE';
  };

  const handleRegisterDevice = async () => {
    if (!activeGhId || !newDeviceLabel.trim()) return;
    setEnrollBusy(true);
    setActionMessage(null);
    try {
      // 1. Register device slot
      const regRes = await apiFetch(`/api/greenhouses/${activeGhId}/devices`, {
        method: 'POST',
        body: JSON.stringify({
          deviceType: newDeviceType === 'environmental_node' ? 'esp32_controller' : newDeviceType,
          label: newDeviceLabel.trim(),
          zoneId: newDeviceZoneId || undefined,
          createAdditionalSlot: true,
          capabilities: newDeviceType === 'esp32_cam'
            ? ['ov2640_jpeg_snapshot', 'plant_vision']
            : ['temperature', 'humidity', 'soilMoisture', 'waterLevel', 'rainDetected']
        })
      });

      const parsedReg = await parseApiJsonResponse<any>(regRes);
      if (!parsedReg.ok || !parsedReg.data?.device) {
        throw new Error(parsedReg.message || 'Failed to create device slot');
      }

      const createdDev = parsedReg.data.device;

      // 2. Issue cryptographic credentials
      const credRes = await apiFetch(`/api/greenhouses/${activeGhId}/devices/${createdDev.id}/issue-credentials`, {
        method: 'POST'
      });

      const parsedCred = await parseApiJsonResponse<any>(credRes);
      if (!parsedCred.ok || !parsedCred.data?.oneTimeDeviceKey) {
        throw new Error(parsedCred.message || 'Failed to issue hardware credentials');
      }

      setIssuedCreds({
        deviceId: createdDev.id,
        label: createdDev.label,
        deviceType: newDeviceType,
        oneTimeDeviceKey: parsedCred.data.oneTimeDeviceKey,
        authHeaderName: parsedCred.data.authHeaderName,
        uploadEndpoint: parsedCred.data.uploadEndpoint,
        firmwareHeader: parsedCred.data.firmwareHeader
      });

      setEnrollModalOpen(false);
      setNewDeviceLabel('');
      setCredentialsModalOpen(true);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setActionMessage(`Enrollment error: ${err.message || String(err)}`);
    } finally {
      setEnrollBusy(false);
    }
  };

  const handleRotateCredentials = async (deviceId: string) => {
    if (!activeGhId) return;
    try {
      const credRes = await apiFetch(`/api/greenhouses/${activeGhId}/devices/${deviceId}/issue-credentials`, {
        method: 'POST'
      });
      const parsedCred = await parseApiJsonResponse<any>(credRes);
      if (parsedCred.ok && parsedCred.data?.oneTimeDeviceKey) {
        const dev = devices.find((d) => d.id === deviceId);
        setIssuedCreds({
          deviceId,
          label: dev?.label || deviceId,
          deviceType: dev?.deviceType || 'esp32_controller',
          oneTimeDeviceKey: parsedCred.data.oneTimeDeviceKey,
          authHeaderName: parsedCred.data.authHeaderName,
          uploadEndpoint: parsedCred.data.uploadEndpoint,
          firmwareHeader: parsedCred.data.firmwareHeader
        });
        setCredentialsModalOpen(true);
        setRefreshKey((k) => k + 1);
      }
    } catch (err: any) {
      alert(`Rotate failed: ${err.message}`);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!activeGhId) return;
    if (confirmRevokeId !== deviceId) {
      setConfirmRevokeId(deviceId);
      setTimeout(() => setConfirmRevokeId((prev) => (prev === deviceId ? null : prev)), 5000);
      return;
    }

    try {
      await apiFetch(`/api/greenhouses/${activeGhId}/devices/${deviceId}/revoke`, {
        method: 'POST'
      });
      setConfirmRevokeId(null);
      setRefreshKey((k) => k + 1);
      setActionMessage('Device credential immediately revoked. Active socket closed.');
    } catch (err: any) {
      alert(`Revoke failed: ${err.message}`);
    }
  };

  const handleDownloadHeader = (headerContent?: string, deviceType?: string) => {
    if (!headerContent) return;
    const filename = deviceType === 'esp32_cam' ? 'camera_secrets.h' : 'controller_secrets.h';
    const blob = new Blob([headerContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (state: UiConnectionState) => {
    switch (state) {
      case 'CONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            CONNECTED
          </span>
        );
      case 'RECONNECTING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
            RECONNECTING
          </span>
        );
      case 'STALE DATA':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
            STALE DATA (&gt;90s)
          </span>
        );
      case 'AUTHENTICATION FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
            <XCircle size={12} />
            AUTHENTICATION FAILED
          </span>
        );
      case 'SIMULATED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            SIMULATED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
            OFFLINE
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#D1E8D1] dark:border-[#1A2A1A] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Endpoint Fleet & Hardware</h1>
            <span className="px-2 py-0.5 rounded text-xs font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Universal Connector
            </span>
          </div>
          <p className="opacity-70 text-sm mt-1">
            Manage physical ESP32 controllers, ESP32-CAMs, and edge gateways across greenhouse zones.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Greenhouse Selector */}
          {greenhouses && greenhouses.length > 1 && (
            <select
              value={activeGhId}
              onChange={(e) => setActiveGreenhouseId(e.target.value)}
              className="h-10 rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF] dark:bg-[#080808] px-3 text-sm font-medium"
            >
              {greenhouses.map((gh) => (
                <option key={gh.id} value={gh.id}>
                  {gh.name}
                </option>
              ))}
            </select>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            title="Refresh Fleet"
            className="rounded-xl border-[#D1E8D1] dark:border-[#1A2A1A]"
          >
            <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
          </Button>

          <Button
            onClick={() => setEnrollModalOpen(true)}
            className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold h-10 px-4 rounded-xl gap-2 shadow-sm"
          >
            <Plus size={18} /> Add Device
          </Button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-xs font-bold underline">Dismiss</button>
        </div>
      )}

      {/* Hardware Fleet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {devices.map((device) => {
          const state = mapConnectionState(device);
          const isController = device.deviceType === 'esp32_controller';
          const isCamera = device.deviceType === 'esp32_cam';
          const DeviceIcon = isCamera ? Camera : Cpu;
          const assignedZone = zones.find((z) => z.id === device.zoneId);

          return (
            <Card
              key={device.id}
              className="border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF] dark:bg-[#080808] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.05)] hover:scale-[1.01] transition-all flex flex-col"
            >
              <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-[#F8FAF8] dark:bg-[#040404] rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A]">
                      <DeviceIcon size={22} className="text-[#10B981]" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-semibold leading-tight">{device.label}</CardTitle>
                      <div className="text-xs opacity-60 mt-0.5 flex gap-2 items-center font-mono">
                        <span>{device.id}</span>
                        {assignedZone && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1 font-sans">
                              <Layers size={11} /> {assignedZone.label}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>{getStatusBadge(state)}</div>
                </div>
              </CardHeader>

              <CardContent className="pt-4 space-y-4 flex-1 flex flex-col text-sm">
                {/* Capability Badges */}
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wider font-semibold opacity-60">Discovered Capabilities</span>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {isController && (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Thermometer size={11} className="text-red-500" /> Air Temp
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Droplet size={11} className="text-blue-500" /> Humidity
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Droplet size={11} className="text-emerald-500" /> Soil Moisture
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Sun size={11} className="text-amber-500" /> Sunlight Lux
                        </span>
                      </>
                    )}
                    {isCamera && (
                      <>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Camera size={11} className="text-indigo-500" /> OV2640 Snapshot
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                          <Activity size={11} className="text-emerald-500" /> Plant Vision
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Identity & Protocol */}
                <div className="p-2.5 rounded-lg bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A] space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="opacity-60">Key Prefix:</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                      {device.keyPrefix || (isCamera ? 'edcam_••••' : 'edctrl_••••')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Last Seen:</span>
                    <span className="font-mono">
                      {device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : 'Never'}
                    </span>
                  </div>
                  {device.lastErrorCode && (
                    <div className="flex justify-between text-red-500 pt-1 border-t border-red-500/20">
                      <span>Recent Fault:</span>
                      <span className="font-mono font-bold">{device.lastErrorCode}</span>
                    </div>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="pt-3 border-t border-[#D1E8D1] dark:border-[#1A2A1A] mt-auto flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDiagDevice(device);
                      setDiagModalOpen(true);
                    }}
                    className="text-xs h-8 rounded-lg border-[#D1E8D1] dark:border-[#1A2A1A]"
                  >
                    Diagnostics
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRotateCredentials(device.id)}
                      className="text-xs h-8 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                      title="Rotate Device Credentials"
                    >
                      <RotateCcw size={13} className="mr-1" /> Rotate
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeDevice(device.id)}
                      className="text-xs h-8 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                    >
                      {confirmRevokeId === device.id ? 'Confirm Revoke' : 'Revoke'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {devices.length === 0 && !loading && (
          <div className="col-span-full border-2 border-dashed border-[#D1E8D1] dark:border-[#1A2A1A] rounded-2xl p-12 text-center flex flex-col items-center justify-center opacity-75">
            <Cpu size={44} className="mb-3 text-[#10B981] opacity-60" />
            <h3 className="text-lg font-bold">No hardware nodes enrolled</h3>
            <p className="max-w-md mx-auto text-sm opacity-70 mt-1 mb-4">
              Provision an ESP32 Controller, ESP32-CAM, or Edge Gateway to begin streaming real botanical telemetry.
            </p>
            <Button
              onClick={() => setEnrollModalOpen(true)}
              className="bg-[#10B981] text-black font-semibold h-9 px-4 rounded-xl"
            >
              <Plus size={16} className="mr-1.5" /> Provision First Node
            </Button>
          </div>
        )}
      </div>

      {/* Provision Device Modal */}
      <Dialog open={enrollModalOpen} onOpenChange={setEnrollModalOpen}>
        <DialogContent className="max-w-xl bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A]">
          <DialogHeader>
            <DialogTitle>Provision New Endpoint Node</DialogTitle>
            <DialogDescription>
              Assign hardware identity, protocol, and zone to securely connect to EDENS AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            {/* Device Type Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-70">Hardware Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {DEVICE_TYPES.map((dt) => {
                  const Icon = dt.icon;
                  const isSelected = newDeviceType === dt.id;
                  return (
                    <button
                      key={dt.id}
                      type="button"
                      onClick={() => setNewDeviceType(dt.id as any)}
                      className={cn(
                        'p-3 rounded-xl border text-left flex flex-col justify-between transition-all',
                        isSelected
                          ? 'border-[#10B981] bg-emerald-500/5 ring-1 ring-[#10B981]'
                          : 'border-[#D1E8D1] dark:border-[#1A2A1A] hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      )}
                    >
                      <Icon size={20} className={isSelected ? 'text-[#10B981]' : 'opacity-60'} />
                      <div className="mt-2">
                        <div className="font-semibold text-xs">{dt.name}</div>
                        <div className="text-[11px] opacity-60 leading-tight mt-0.5">{dt.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Device Name / Label */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-70">Node Label Alias</label>
              <Input
                placeholder="e.g. ESP32-Controller-Zone-South"
                value={newDeviceLabel}
                onChange={(e) => setNewDeviceLabel(e.target.value)}
                className="bg-[#F8FAF8] dark:bg-[#040404] border-[#D1E8D1] dark:border-[#1A2A1A] text-sm"
              />
            </div>

            {/* Zone Assignment */}
            {zones.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider opacity-70">Greenhouse Zone (Optional)</label>
                <select
                  value={newDeviceZoneId}
                  onChange={(e) => setNewDeviceZoneId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] px-3 text-sm"
                >
                  <option value="">General Greenhouse (No specific zone)</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label} ({z.id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Protocol Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-70">Communication Transport</label>
              <select
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
                className="w-full h-10 rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#F8FAF8] dark:bg-[#040404] px-3 text-sm"
              >
                {PROTOCOLS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            onClick={handleRegisterDevice}
            disabled={!newDeviceLabel.trim() || enrollBusy}
            className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-semibold h-10 rounded-xl"
          >
            {enrollBusy ? 'Generating Cryptographic Keys...' : 'Generate Keys & Register'}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Credential Issuance Modal */}
      <Dialog open={credentialsModalOpen} onOpenChange={setCredentialsModalOpen}>
        <DialogContent className="max-w-2xl bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="text-emerald-500" size={22} />
              Hardware Credentials Issued
            </DialogTitle>
            <DialogDescription>
              Copy or download this secret credential now. Only its salted SHA-256 hash is retained on the server.
            </DialogDescription>
          </DialogHeader>

          {issuedCreds && (
            <div className="space-y-5 py-3">
              {/* Secret Token Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-semibold tracking-wider opacity-70">
                    {issuedCreds.authHeaderName} Header Token
                  </span>
                  <span className="text-xs text-amber-500 font-medium">Keep strictly secret</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2.5 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A] text-xs font-mono break-all text-amber-600 dark:text-amber-400">
                    {issuedCreds.oneTimeDeviceKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(issuedCreds.oneTimeDeviceKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="shrink-0 h-10 w-10 rounded-xl border-[#D1E8D1] dark:border-[#1A2A1A]"
                  >
                    {copiedKey ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                  </Button>
                </div>
              </div>

              {/* Upload Endpoint Notice */}
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                <div className="font-semibold">Endpoint: <span className="font-mono text-emerald-600 dark:text-emerald-400">POST {issuedCreds.uploadEndpoint}</span></div>
                <div className="opacity-70">Header: <span className="font-mono">{issuedCreds.authHeaderName}: {issuedCreds.oneTimeDeviceKey.substring(0, 10)}...</span></div>
              </div>

              {/* Download C++ Header / Config */}
              {issuedCreds.firmwareHeader && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase font-semibold tracking-wider opacity-70">
                      Arduino / PlatformIO Configuration Header
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadHeader(issuedCreds.firmwareHeader, issuedCreds.deviceType)}
                      className="h-8 rounded-lg gap-1.5 text-xs border-[#D1E8D1] dark:border-[#1A2A1A]"
                    >
                      <Download size={13} /> Download .h
                    </Button>
                  </div>
                  <pre className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A] text-[11px] font-mono overflow-x-auto max-h-48 text-[#1A2A1A] dark:text-[#E2E8F0]">
                    <code>{issuedCreds.firmwareHeader}</code>
                  </pre>
                </div>
              )}

              <Button
                onClick={() => setCredentialsModalOpen(false)}
                className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-semibold h-10 rounded-xl"
              >
                I have saved this credential
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Diagnostics Modal */}
      <Dialog open={diagModalOpen} onOpenChange={setDiagModalOpen}>
        <DialogContent className="max-w-lg bg-[#FFFFFF] dark:bg-[#080808] border-[#D1E8D1] dark:border-[#1A2A1A]">
          <DialogHeader>
            <DialogTitle>Hardware Diagnostics</DialogTitle>
            <DialogDescription>{diagDevice?.label} ({diagDevice?.id})</DialogDescription>
          </DialogHeader>

          {diagDevice && (
            <div className="space-y-4 py-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A]">
                  <div className="text-xs opacity-60">Status</div>
                  <div className="font-semibold mt-1">{mapConnectionState(diagDevice)}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A]">
                  <div className="text-xs opacity-60">Device Type</div>
                  <div className="font-mono mt-1 text-xs">{diagDevice.deviceType}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A]">
                  <div className="text-xs opacity-60">First Enrolled</div>
                  <div className="text-xs mt-1">{new Date(diagDevice.createdAt).toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAF8] dark:bg-[#040404] border border-[#D1E8D1] dark:border-[#1A2A1A]">
                  <div className="text-xs opacity-60">Last Seen</div>
                  <div className="text-xs mt-1">
                    {diagDevice.lastSeenAt ? new Date(diagDevice.lastSeenAt).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>

              {diagDevice.lastErrorMessage && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                  <div className="font-bold mb-0.5">Last Reported Fault:</div>
                  <div>{diagDevice.lastErrorMessage}</div>
                </div>
              )}

              <Button
                onClick={() => setDiagModalOpen(false)}
                className="w-full bg-[#10B981] text-black font-semibold h-9 rounded-xl"
              >
                Close Diagnostics
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
