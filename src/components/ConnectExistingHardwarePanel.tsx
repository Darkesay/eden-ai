import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Globe,
  Leaf,
  Loader2,
  PowerOff,
  RefreshCw,
  Save,
  ShieldCheck,
  Video,
  Wifi,
  WifiOff
} from 'lucide-react';
import { apiFetch, resolveApiUrl } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import {
  diagnoseLatestCameraFrame,
  NIGERIAN_LANGUAGES,
  type PlantAnalysisResult
} from '../lib/gemini';
import { hardwareService } from '../lib/hardwareService';
import { useCameraConnection } from '../lib/cameraConnectionManager';
import { useStoreValue } from '../lib/store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

export type UiHardwareConnectionState =
  | 'CONNECTED'
  | 'IMAGE_RECEIVED'
  | 'RECONNECTING'
  | 'OFFLINE'
  | 'CONNECTION_BLOCKED'
  | 'INVALID_ADDRESS';

export type UiDataCategory =
  | 'REAL_HARDWARE_DATA'
  | 'SIMULATED_DATA'
  | 'STALE_DATA'
  | 'OFFLINE';

export type UiConnectionMethod = 'LOCAL' | 'CLOUD';

export interface UiDiscoveredSensor {
  key: string;
  label: string;
  value: number | boolean | null;
  formattedValue: string;
  unit: string;
  connected: boolean;
  validity: 'VALID' | 'UNAVAILABLE' | 'DISCONNECTED' | 'OUT_OF_RANGE' | 'STALE';
  timestamp: string;
  sourceDevice: string;
}

const STATE_DISPLAY_LABEL: Record<UiHardwareConnectionState, string> = {
  CONNECTED: 'CONNECTED',
  IMAGE_RECEIVED: 'IMAGE RECEIVED',
  RECONNECTING: 'RECONNECTING',
  OFFLINE: 'OFFLINE',
  CONNECTION_BLOCKED: 'CONNECTION BLOCKED',
  INVALID_ADDRESS: 'INVALID ADDRESS'
};

const DATA_CATEGORY_LABEL: Record<UiDataCategory, string> = {
  REAL_HARDWARE_DATA: 'REAL HARDWARE DATA',
  SIMULATED_DATA: 'SIMULATED DATA',
  STALE_DATA: 'STALE DATA',
  OFFLINE: 'OFFLINE'
};

function getStateToneClasses(state: UiHardwareConnectionState): string {
  switch (state) {
    case 'CONNECTED':
    case 'IMAGE_RECEIVED':
      return 'text-emerald-800 dark:text-emerald-300';
    case 'RECONNECTING':
    case 'CONNECTION_BLOCKED':
      return 'text-amber-800 dark:text-amber-300';
    case 'INVALID_ADDRESS':
      return 'text-red-700 dark:text-red-400';
    case 'OFFLINE':
    default:
      return 'text-muted-foreground';
  }
}

function getDataCategoryToneClasses(cat: UiDataCategory): string {
  switch (cat) {
    case 'REAL_HARDWARE_DATA':
      return 'text-emerald-800 dark:text-emerald-300';
    case 'STALE_DATA':
      return 'text-amber-800 dark:text-amber-300';
    case 'SIMULATED_DATA':
      return 'text-indigo-800 dark:text-indigo-300';
    case 'OFFLINE':
    default:
      return 'text-muted-foreground';
  }
}

function formatIsoTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'None recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'None recorded';
  return d.toLocaleString();
}

export interface ConnectExistingHardwarePanelProps {
  greenhouseId?: string | null;
  onCameraFrameVerified?: () => void;
}

export function ConnectExistingHardwarePanel({
  greenhouseId,
  onCameraFrameVerified
}: ConnectExistingHardwarePanelProps) {
  const cameraManager = useCameraConnection();
  const savedLangId = String(useStoreValue('aiLanguage', 'en') || 'en');

  // Environment & Monitoring Mode state
  const [cloudHosted, setCloudHosted] = useState<boolean>(false);
  const [browserSecurityNote, setBrowserSecurityNote] = useState<string>(
    'Modern browsers on HTTPS pages block direct plain-HTTP requests to private LAN IPs (10.x / 192.168.x) via Mixed Content & Private Network Access policies. Never expose unauthenticated ESP32 boards directly to the public internet.'
  );
  const [loadingState, setLoadingState] = useState<boolean>(true);

  // =========================================================================
  // 1. ESP32 CONTROLLER CONFIGURATION & STATUS STATE
  // =========================================================================
  const [ctrlDeviceName, setCtrlDeviceName] = useState<string>('Main Greenhouse ESP32 Controller');
  const [ctrlMethod, setCtrlMethod] = useState<UiConnectionMethod>('LOCAL');
  const [ctrlHost, setCtrlHost] = useState<string>('edens-esp32.local');
  const [ctrlPort, setCtrlPort] = useState<number>(80);
  const [ctrlStatusUrl, setCtrlStatusUrl] = useState<string>('http://edens-esp32.local/status');
  const [ctrlTelemetryUrl, setCtrlTelemetryUrl] = useState<string>('http://edens-esp32.local/status');

  const [ctrlState, setCtrlState] = useState<UiHardwareConnectionState>('OFFLINE');
  const [ctrlDataCategory, setCtrlDataCategory] = useState<UiDataCategory>('OFFLINE');
  const [ctrlLastHeartbeat, setCtrlLastHeartbeat] = useState<string | null>(null);
  const [ctrlLastTelemetry, setCtrlLastTelemetry] = useState<string | null>(null);
  const [ctrlFirmwareVersion, setCtrlFirmwareVersion] = useState<string | null>(null);
  const [ctrlSourceLabel, setCtrlSourceLabel] = useState<string>('Greenhouse ESP32 Controller');
  const [discoveredSensors, setDiscoveredSensors] = useState<UiDiscoveredSensor[]>([]);

  const [testingController, setTestingController] = useState<boolean>(false);
  const [savingController, setSavingController] = useState<boolean>(false);
  const [disconnectingController, setDisconnectingController] = useState<boolean>(false);
  const [ctrlMessage, setCtrlMessage] = useState<{
    tone: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);
  const [ctrlProbedEndpoints, setCtrlProbedEndpoints] = useState<any[]>([]);

  // =========================================================================
  // 2. ESP32-CAM CONFIGURATION & STATUS STATE
  // =========================================================================
  const [cameraName, setCameraName] = useState<string>('Greenhouse ESP32-CAM');
  const [camMethod, setCamMethod] = useState<UiConnectionMethod>('LOCAL');
  const [cameraIp, setCameraIp] = useState<string>('');
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [statusUrl, setStatusUrl] = useState<string>('');

  const [cameraState, setCameraState] = useState<UiHardwareConnectionState>('OFFLINE');
  const [camDataCategory, setCamDataCategory] = useState<UiDataCategory>('OFFLINE');
  const [camLastImageAt, setCamLastImageAt] = useState<string | null>(null);
  const [camStreamStatusLabel, setCamStreamStatusLabel] = useState<string>(
    'Offline — no active camera stream'
  );
  const [camFirmwareVersion, setCamFirmwareVersion] = useState<string | null>(null);

  const [testingCamera, setTestingCamera] = useState<boolean>(false);
  const [capturingCamera, setCapturingCamera] = useState<boolean>(false);
  const [savingCamera, setSavingCamera] = useState<boolean>(false);
  const [disconnectingCamera, setDisconnectingCamera] = useState<boolean>(false);
  const [cameraMessage, setCameraMessage] = useState<{
    tone: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  const [verifiedFrame, setVerifiedFrame] = useState<{
    url: string;
    base64DataUri?: string;
    capturedAt: string;
    sizeBytes?: number;
    sha256?: string;
  } | null>(null);
  const [proxyStreamUrl, setProxyStreamUrl] = useState<string | null>(null);
  const [previewStreamActive, setPreviewStreamActive] = useState<boolean>(false);
  const [streamLoadedOk, setStreamLoadedOk] = useState<boolean>(false);
  const [remediationOptions, setRemediationOptions] = useState<
    Array<{ id: string; title: string; description: string; command?: string }>
  >([]);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  // Inline Plant Vision Diagnosis on Real Verified Camera Image
  const [diagnosingCam, setDiagnosingCam] = useState<boolean>(false);
  const [camDiagnosis, setCamDiagnosis] = useState<PlantAnalysisResult | null>(null);
  const [camDiagnosisErr, setCamDiagnosisErr] = useState<string | null>(null);

  const loadHardwareHttpState = useCallback(async () => {
    setLoadingState(true);
    try {
      const qs = greenhouseId ? `?greenhouseId=${encodeURIComponent(greenhouseId)}` : '';
      const res = await apiFetch(`/api/hardware-http/state${qs}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) return;
      const data = parsed.data;

      setCloudHosted(Boolean(data.environment?.cloudHosted));
      if (data.environment?.browserMixedContentNote) {
        setBrowserSecurityNote(String(data.environment.browserMixedContentNote));
      }

      // Populate Controller Status Card
      if (data.controllerStatusCard) {
        const cc = data.controllerStatusCard;
        setCtrlState((cc.connectionStatus as UiHardwareConnectionState) || 'OFFLINE');
        setCtrlDataCategory((cc.dataCategory as UiDataCategory) || 'OFFLINE');
        setCtrlLastHeartbeat(cc.lastHeartbeatAt || null);
        setCtrlLastTelemetry(cc.lastTelemetryAt || null);
        setCtrlFirmwareVersion(cc.firmwareVersion || null);
        setCtrlSourceLabel(cc.sourceDeviceLabel || 'Greenhouse ESP32 Controller');
        setDiscoveredSensors(
          Array.isArray(cc.discoveredSensors) ? cc.discoveredSensors : []
        );
      }

      // Populate Saved Controller Config (or authenticated backend example defaults)
      if (data.savedController) {
        const sc = data.savedController;
        if (sc.controllerName) setCtrlDeviceName(sc.controllerName);
        if (sc.connectionMethod === 'CLOUD' || sc.connectionMethod === 'LOCAL') {
          setCtrlMethod(sc.connectionMethod);
        }
        if (sc.host) setCtrlHost(sc.host);
        if (sc.port) setCtrlPort(Number(sc.port) || 80);
        if (sc.statusUrl) setCtrlStatusUrl(sc.statusUrl);
        if (sc.telemetryUrl) setCtrlTelemetryUrl(sc.telemetryUrl);
      } else if (data.defaultControllerExamples) {
        const dc = data.defaultControllerExamples;
        if (dc.host) setCtrlHost((prev) => prev || dc.host);
        if (dc.statusUrl) setCtrlStatusUrl((prev) => prev || dc.statusUrl);
        if (dc.telemetryUrl) setCtrlTelemetryUrl((prev) => prev || dc.telemetryUrl);
      }

      // Populate Camera Status Card
      if (data.cameraStatusCard) {
        const cmc = data.cameraStatusCard;
        setCameraState((cmc.connectionStatus as UiHardwareConnectionState) || 'OFFLINE');
        setCamDataCategory((cmc.dataCategory as UiDataCategory) || 'OFFLINE');
        setCamLastImageAt(cmc.lastImageReceivedAt || null);
        setCamStreamStatusLabel(cmc.streamStatusLabel || 'Offline — no active camera stream');
        setCamFirmwareVersion(cmc.firmwareVersion || null);
      }

      // Populate Saved Camera Config (or authenticated backend example defaults)
      if (data.savedCamera) {
        const scam = data.savedCamera;
        if (scam.cameraName) setCameraName(scam.cameraName);
        if (scam.connectionMethod === 'CLOUD' || scam.connectionMethod === 'LOCAL') {
          setCamMethod(scam.connectionMethod);
        }
        if (scam.cameraIp) setCameraIp(scam.cameraIp);
        if (scam.streamUrl) setStreamUrl(scam.streamUrl);
        if (scam.photoUrl) setPhotoUrl(scam.photoUrl);
        if (scam.statusUrl) setStatusUrl(scam.statusUrl);

        if (scam.streamUrl && !data.environment?.cloudHosted && !scam.disconnectedByUser) {
          setProxyStreamUrl(
            `/api/hardware-http/camera/stream?streamUrl=${encodeURIComponent(scam.streamUrl)}${greenhouseId ? `&greenhouseId=${encodeURIComponent(greenhouseId)}` : ''}`
          );
        }
      } else if (data.defaultCameraExamples) {
        const ex = data.defaultCameraExamples;
        setCameraIp((prev) => prev || ex.cameraIp || '');
        setStreamUrl((prev) => prev || ex.streamUrl || '');
        setPhotoUrl((prev) => prev || ex.photoUrl || '');
        setStatusUrl((prev) => prev || ex.statusUrl || '');
      }

      if (data.latestCamera?.exists && data.latestCamera.url) {
        setVerifiedFrame({
          url: resolveApiUrl(data.latestCamera.url),
          capturedAt: data.latestCamera.capturedAt || data.latestCamera.timestamp,
          sizeBytes: data.latestCamera.sizeBytes,
          sha256: data.latestCamera.sha256
        });
      } else {
        setVerifiedFrame(null);
      }
    } catch {
      // Preserve safe OFFLINE defaults on network failure
    } finally {
      setLoadingState(false);
    }
  }, [greenhouseId]);

  useEffect(() => {
    void loadHardwareHttpState();
  }, [loadHardwareHttpState]);

  // Smart helper when user edits Controller Host or Port: update default URLs if they still match previous host
  const handleCtrlHostChange = (nextHost: string) => {
    const prevClean = ctrlHost.trim();
    const nextClean = nextHost.trim();
    setCtrlHost(nextHost);
    if (nextClean && !nextClean.includes('/')) {
      const prevOrigin = ctrlPort === 80 ? `http://${prevClean}` : `http://${prevClean}:${ctrlPort}`;
      const nextOrigin = ctrlPort === 80 ? `http://${nextClean}` : `http://${nextClean}:${ctrlPort}`;
      if (!ctrlStatusUrl || ctrlStatusUrl.startsWith(prevOrigin)) {
        const suffix = ctrlStatusUrl.startsWith(prevOrigin)
          ? ctrlStatusUrl.slice(prevOrigin.length) || '/status'
          : '/status';
        setCtrlStatusUrl(`${nextOrigin}${suffix}`);
      }
      if (!ctrlTelemetryUrl || ctrlTelemetryUrl.startsWith(prevOrigin)) {
        const suffix = ctrlTelemetryUrl.startsWith(prevOrigin)
          ? ctrlTelemetryUrl.slice(prevOrigin.length) || '/status'
          : '/status';
        setCtrlTelemetryUrl(`${nextOrigin}${suffix}`);
      }
    }
  };

  const handleCtrlPortChange = (nextPortRaw: string) => {
    const parsedPort = Number.parseInt(nextPortRaw, 10);
    const safePort = Number.isFinite(parsedPort) ? parsedPort : 80;
    const prevOrigin = ctrlPort === 80 ? `http://${ctrlHost.trim()}` : `http://${ctrlHost.trim()}:${ctrlPort}`;
    const nextOrigin = safePort === 80 ? `http://${ctrlHost.trim()}` : `http://${ctrlHost.trim()}:${safePort}`;
    setCtrlPort(safePort);
    if (ctrlHost.trim()) {
      if (ctrlStatusUrl.startsWith(prevOrigin)) {
        setCtrlStatusUrl(`${nextOrigin}${ctrlStatusUrl.slice(prevOrigin.length) || '/status'}`);
      }
      if (ctrlTelemetryUrl.startsWith(prevOrigin)) {
        setCtrlTelemetryUrl(`${nextOrigin}${ctrlTelemetryUrl.slice(prevOrigin.length) || '/status'}`);
      }
    }
  };

  // Smart helper when user edits Camera IP: update Stream / Photo / Status URLs if they match previous IP
  const handleCameraIpChange = (nextIp: string) => {
    const prevClean = cameraIp.trim();
    const nextClean = nextIp.trim();
    setCameraIp(nextIp);
    if (prevClean && nextClean && !nextClean.includes('/')) {
      if (streamUrl === `http://${prevClean}:81/stream`) {
        setStreamUrl(`http://${nextClean}:81/stream`);
      }
      if (photoUrl === `http://${prevClean}/photo`) {
        setPhotoUrl(`http://${nextClean}/photo`);
      }
      if (statusUrl === `http://${prevClean}/status`) {
        setStatusUrl(`http://${nextClean}/status`);
      }
    }
  };

  // =========================================================================
  // CONTROLLER ACTIONS: Test Connection, Save Configuration, Disconnect
  // =========================================================================
  const handleTestController = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setTestingController(true);
    setCtrlMessage(null);
    setCtrlProbedEndpoints([]);

    try {
      const res = await apiFetch('/api/hardware-http/controller/test', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined,
          deviceName: ctrlDeviceName.trim(),
          controllerName: ctrlDeviceName.trim(),
          connectionMethod: ctrlMethod,
          host: ctrlHost.trim(),
          port: ctrlPort,
          statusUrl: ctrlMethod === 'LOCAL' ? ctrlStatusUrl.trim() : '',
          telemetryUrl: ctrlMethod === 'LOCAL' ? ctrlTelemetryUrl.trim() : ''
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      const data = parsed.ok ? parsed.data : (parsed as any).raw || null;

      if (!parsed.ok && !data?.connectionState) {
        setCtrlState('OFFLINE');
        setCtrlDataCategory('OFFLINE');
        setCtrlMessage({ tone: 'err', text: parsed.message });
        return;
      }

      const nextState: UiHardwareConnectionState = data?.connectionState || 'OFFLINE';
      setCtrlState(nextState);
      setCtrlDataCategory((data?.dataCategory as UiDataCategory) || 'OFFLINE');
      if (data?.firmwareVersion) setCtrlFirmwareVersion(data.firmwareVersion);
      if (data?.lastHeartbeatAt) setCtrlLastHeartbeat(data.lastHeartbeatAt);
      if (data?.lastSuccessfulConnAt) setCtrlLastTelemetry(data.lastSuccessfulConnAt);
      if (Array.isArray(data?.discoveredSensors)) {
        setDiscoveredSensors(data.discoveredSensors);
      }
      if (Array.isArray(data?.probedEndpoints)) {
        setCtrlProbedEndpoints(data.probedEndpoints);
      }

      setCtrlMessage({
        tone:
          nextState === 'CONNECTED' && data?.dataCategory === 'REAL_HARDWARE_DATA'
            ? 'ok'
            : nextState === 'CONNECTION_BLOCKED' || nextState === 'CONNECTED'
              ? 'warn'
              : 'err',
        text: data?.message || 'Controller connection test finished.'
      });

      await loadHardwareHttpState();
    } catch (err: any) {
      setCtrlState('OFFLINE');
      setCtrlDataCategory('OFFLINE');
      setCtrlMessage({
        tone: 'err',
        text: err?.message || 'Controller connection test could not complete.'
      });
    } finally {
      setTestingController(false);
    }
  };

  const handleSaveController = async () => {
    setSavingController(true);
    setCtrlMessage(null);
    try {
      const res = await apiFetch('/api/hardware-http/controller/save', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined,
          deviceName: ctrlDeviceName.trim(),
          controllerName: ctrlDeviceName.trim(),
          connectionMethod: ctrlMethod,
          host: ctrlHost.trim(),
          port: ctrlPort,
          statusUrl: ctrlMethod === 'LOCAL' ? ctrlStatusUrl.trim() : '',
          telemetryUrl: ctrlMethod === 'LOCAL' ? ctrlTelemetryUrl.trim() : ''
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      const data = parsed.ok ? parsed.data : (parsed as any).raw || null;

      if (!parsed.ok || !data?.success) {
        if (data?.connectionState === 'INVALID_ADDRESS') {
          setCtrlState('INVALID_ADDRESS');
        }
        setCtrlMessage({
          tone: 'err',
          text: data?.message || (!parsed.ok ? parsed.message : 'Could not save controller configuration.')
        });
        return;
      }

      if (ctrlMethod === 'LOCAL' && ctrlHost.trim()) {
        hardwareService.updateConfig({
          controllerHost: ctrlHost.trim(),
          controllerPort: Number(ctrlPort) || 80
        });
      }

      setCtrlState(data.connectionState || 'OFFLINE');
      setCtrlMessage({
        tone: 'ok',
        text: data.message
      });
      await loadHardwareHttpState();
    } catch (err: any) {
      setCtrlMessage({
        tone: 'err',
        text: err?.message || 'Failed to save controller configuration.'
      });
    } finally {
      setSavingController(false);
    }
  };

  const handleDisconnectController = async () => {
    setDisconnectingController(true);
    setCtrlMessage(null);
    try {
      const res = await apiFetch('/api/hardware-http/controller/disconnect', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok) {
        setCtrlMessage({ tone: 'err', text: parsed.message });
        return;
      }
      setCtrlState('OFFLINE');
      setCtrlDataCategory('OFFLINE');
      setDiscoveredSensors([]);
      setCtrlMessage({
        tone: 'warn',
        text: parsed.data?.message || 'Controller disconnected.'
      });
      await loadHardwareHttpState();
    } finally {
      setDisconnectingController(false);
    }
  };

  // =========================================================================
  // CAMERA ACTIONS: Test, Preview, Capture, Save, Disconnect
  // =========================================================================
  const handleTestCamera = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setTestingCamera(true);
    setCameraMessage(null);
    setRemediationOptions([]);
    setPreviewStreamActive(false);
    setStreamLoadedOk(false);

    try {
      const res = await apiFetch('/api/hardware-http/camera/test', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined,
          cameraName: cameraName.trim(),
          connectionMethod: camMethod,
          cameraIp: cameraIp.trim(),
          streamUrl: camMethod === 'LOCAL' ? streamUrl.trim() : '',
          photoUrl: camMethod === 'LOCAL' ? photoUrl.trim() : '',
          statusUrl: camMethod === 'LOCAL' ? statusUrl.trim() : ''
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      const data = parsed.ok ? parsed.data : (parsed as any).raw || null;

      if (!parsed.ok && !data?.connectionState) {
        setCameraState('OFFLINE');
        setCamDataCategory('OFFLINE');
        setCameraMessage({ tone: 'err', text: parsed.message });
        return;
      }

      const nextState: UiHardwareConnectionState = data?.connectionState || 'OFFLINE';
      setCameraState(nextState);

      if (Array.isArray(data?.remediationOptions)) {
        setRemediationOptions(data.remediationOptions);
      }

      if (data?.success && data?.frame) {
        setCamDataCategory('REAL_HARDWARE_DATA');
        setCamLastImageAt(data.frame.capturedAt || data.frame.timestamp);
        if (data.firmwareVersion) setCamFirmwareVersion(data.firmwareVersion);
        setVerifiedFrame({
          url: resolveApiUrl(data.frame.url),
          base64DataUri: data.frame.base64DataUri,
          capturedAt: data.frame.capturedAt || data.frame.timestamp,
          sizeBytes: data.frame.sizeBytes,
          sha256: data.frame.sha256
        });
        setProxyStreamUrl(data.proxyStreamUrl ? resolveApiUrl(data.proxyStreamUrl) : null);
        setCameraMessage({
          tone: 'ok',
          text: data.message || 'Verified JPEG photograph received from camera.'
        });
        onCameraFrameVerified?.();
      } else {
        setCamDataCategory('OFFLINE');
        setCameraMessage({
          tone: nextState === 'CONNECTION_BLOCKED' ? 'warn' : 'err',
          text: data?.message || 'Camera connection could not be verified.'
        });
      }

      await loadHardwareHttpState();
    } catch (err: any) {
      setCameraState('OFFLINE');
      setCamDataCategory('OFFLINE');
      setCameraMessage({
        tone: 'err',
        text: err?.message || 'Network error while testing camera connection.'
      });
    } finally {
      setTestingCamera(false);
    }
  };

  const handleTogglePreviewCamera = () => {
    if (previewStreamActive) {
      setPreviewStreamActive(false);
      setStreamLoadedOk(false);
      return;
    }

    if (camMethod === 'CLOUD' || cloudHosted) {
      setCameraState('CONNECTION_BLOCKED');
      setCameraMessage({
        tone: 'warn',
        text:
          'Live MJPEG streaming over plain HTTP (port 81) is blocked across cloud/HTTPS boundaries by browser Mixed Content and private-LAN routing rules. Use "Capture Image" on a local gateway or view verified snapshots.'
      });
      return;
    }

    const cleanStream = streamUrl.trim();
    if (!cleanStream) {
      setCameraMessage({
        tone: 'err',
        text: 'Enter a valid Stream URL (for example, http://<camera-ip>:81/stream) before starting preview.'
      });
      return;
    }

    const resolvedProxy = resolveApiUrl(
      `/api/hardware-http/camera/stream?streamUrl=${encodeURIComponent(cleanStream)}${greenhouseId ? `&greenhouseId=${encodeURIComponent(greenhouseId)}` : ''}&t=${Date.now()}`
    );
    setProxyStreamUrl(resolvedProxy);
    setStreamLoadedOk(false);
    setPreviewStreamActive(true);
    setCameraMessage({
      tone: 'ok',
      text: 'Opening live MJPEG stream through local gateway proxy...'
    });
  };

  const handleCaptureCameraImage = async () => {
    setCapturingCamera(true);
    setCameraMessage(null);
    setPreviewStreamActive(false);
    setStreamLoadedOk(false);

    try {
      const res = await apiFetch('/api/hardware-http/camera/capture', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined,
          photoUrl: photoUrl.trim() || undefined
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      const data = parsed.ok ? parsed.data : (parsed as any).raw || null;

      if (!parsed.ok || !data?.success) {
        const nextSt: UiHardwareConnectionState = data?.connectionState || 'OFFLINE';
        setCameraState(nextSt);
        setCameraMessage({
          tone: nextSt === 'CONNECTION_BLOCKED' ? 'warn' : 'err',
          text:
            data?.message ||
            (!parsed.ok ? parsed.message : 'Could not capture a live JPEG from the camera.')
        });
        return;
      }

      setCameraState('IMAGE_RECEIVED');
      setCamDataCategory('REAL_HARDWARE_DATA');
      setCamLastImageAt(data.frame.capturedAt || data.frame.timestamp);
      setVerifiedFrame({
        url: resolveApiUrl(data.frame.url),
        base64DataUri: data.frame.base64DataUri,
        capturedAt: data.frame.capturedAt || data.frame.timestamp,
        sizeBytes: data.frame.sizeBytes,
        sha256: data.frame.sha256
      });
      setCameraMessage({
        tone: 'ok',
        text: `Captured and stored verified JPEG (${Math.max(1, Math.round((data.frame.sizeBytes || 0) / 1024))} KB) in EDENS AI backend.`
      });
      onCameraFrameVerified?.();
      await loadHardwareHttpState();
    } catch (err: any) {
      setCameraMessage({
        tone: 'err',
        text: err?.message || 'Camera capture failed.'
      });
    } finally {
      setCapturingCamera(false);
    }
  };

  const handleSaveCamera = async () => {
    setSavingCamera(true);
    setCameraMessage(null);
    try {
      const res = await apiFetch('/api/hardware-http/camera/save', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined,
          cameraName: cameraName.trim(),
          connectionMethod: camMethod,
          cameraIp: cameraIp.trim(),
          streamUrl: camMethod === 'LOCAL' ? streamUrl.trim() : '',
          photoUrl: camMethod === 'LOCAL' ? photoUrl.trim() : '',
          statusUrl: camMethod === 'LOCAL' ? statusUrl.trim() : ''
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      const data = parsed.ok ? parsed.data : (parsed as any).raw || null;

      if (!parsed.ok || !data?.success) {
        if (data?.connectionState === 'INVALID_ADDRESS') {
          setCameraState('INVALID_ADDRESS');
        }
        setCameraMessage({
          tone: 'err',
          text:
            data?.message || (!parsed.ok ? parsed.message : 'Could not save camera configuration.')
        });
        return;
      }

      if (cameraIp.trim()) {
        cameraManager.updateConfig({ host: cameraIp.trim() });
      }

      setCameraState(data.connectionState || 'OFFLINE');
      setCameraMessage({
        tone: 'ok',
        text: data.message
      });
      await loadHardwareHttpState();
    } catch (err: any) {
      setCameraMessage({
        tone: 'err',
        text: err?.message || 'Failed to save camera configuration.'
      });
    } finally {
      setSavingCamera(false);
    }
  };

  const handleDisconnectCamera = async () => {
    setDisconnectingCamera(true);
    setPreviewStreamActive(false);
    setStreamLoadedOk(false);
    setCameraMessage(null);
    try {
      const res = await apiFetch('/api/hardware-http/camera/disconnect', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: greenhouseId || undefined
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok) {
        setCameraMessage({ tone: 'err', text: parsed.message });
        return;
      }
      setCameraState('OFFLINE');
      setCamDataCategory('OFFLINE');
      setVerifiedFrame(null);
      setCameraMessage({
        tone: 'warn',
        text: parsed.data?.message || 'Camera disconnected.'
      });
      await loadHardwareHttpState();
    } finally {
      setDisconnectingCamera(false);
    }
  };

  const handleDiagnoseRealCamera = async () => {
    setDiagnosingCam(true);
    setCamDiagnosisErr(null);
    setCamDiagnosis(null);

    try {
      if (!cloudHosted && camMethod === 'LOCAL' && photoUrl.trim()) {
        const capRes = await apiFetch('/api/hardware-http/camera/capture', {
          method: 'POST',
          body: JSON.stringify({
            greenhouseId: greenhouseId || undefined,
            photoUrl: photoUrl.trim()
          })
        });
        const capParsed = await parseApiJsonResponse<any>(capRes);
        if (capParsed.ok && capParsed.data?.success && capParsed.data?.frame) {
          setVerifiedFrame({
            url: resolveApiUrl(capParsed.data.frame.url),
            base64DataUri: capParsed.data.frame.base64DataUri,
            capturedAt: capParsed.data.frame.capturedAt || capParsed.data.frame.timestamp,
            sizeBytes: capParsed.data.frame.sizeBytes,
            sha256: capParsed.data.frame.sha256
          });
          setCameraState('IMAGE_RECEIVED');
          setCamDataCategory('REAL_HARDWARE_DATA');
          onCameraFrameVerified?.();
        }
      }

      const lang = NIGERIAN_LANGUAGES.some((l) => l.id === savedLangId) ? savedLangId : 'en';
      const diagnosis = await diagnoseLatestCameraFrame(lang);
      setCamDiagnosis(diagnosis);
    } catch (err: any) {
      setCamDiagnosisErr(
        err?.message ||
          'Cannot run live camera diagnosis until a fresh (<90s) verified JPEG from your ESP32-CAM is stored.'
      );
    } finally {
      setDiagnosingCam(false);
    }
  };

  const connectedSensorCount = discoveredSensors.filter((s) => s.connected).length;

  return (
    <div className="space-y-6">
      {/* =====================================================================
          LIVE STATUS DASHBOARD (Controller & Camera Side-by-Side Status Cards)
         ===================================================================== */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Activity size={17} className="text-primary shrink-0" />
              Live Hardware Status Dashboard
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time verification state, data provenance, firmware versions, and dynamically discovered sensors.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => void loadHardwareHttpState()}
            disabled={loadingState}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={13} className={cn('mr-1.5', loadingState && 'animate-spin')} />
            Refresh Status
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {/* STATUS CARD 1: ESP32 CONTROLLER */}
          <div className="rounded-xl border border-border bg-background p-4 sm:p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Cpu size={16} className="text-primary shrink-0" />
                  <h3 className="text-sm font-semibold text-foreground">ESP32 CONTROLLER</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                  <span className={cn('font-semibold', getStateToneClasses(ctrlState))}>
                    {STATE_DISPLAY_LABEL[ctrlState]}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className={cn('font-semibold', getDataCategoryToneClasses(ctrlDataCategory))}>
                    {DATA_CATEGORY_LABEL[ctrlDataCategory]}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div>
                  <dt className="text-muted-foreground">Last heartbeat</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {formatIsoTimestamp(ctrlLastHeartbeat)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last telemetry</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {formatIsoTimestamp(ctrlLastTelemetry)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Firmware version</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {ctrlFirmwareVersion || 'Unreported'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Discovered sensors</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {connectedSensorCount > 0
                      ? `${connectedSensorCount} Connected · ${discoveredSensors.length - connectedSensorCount} Unavailable`
                      : '0 Connected'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="pt-2.5 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground font-mono tabular-nums">
              <span className="truncate">Device: {ctrlSourceLabel}</span>
              <span className="shrink-0 ml-2">Mode: {ctrlMethod}</span>
            </div>
          </div>

          {/* STATUS CARD 2: ESP32-CAM */}
          <div className="rounded-xl border border-border bg-background p-4 sm:p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Camera size={16} className="text-primary shrink-0" />
                  <h3 className="text-sm font-semibold text-foreground">ESP32-CAM</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                  <span
                    className={cn(
                      'font-semibold',
                      getStateToneClasses(previewStreamActive && streamLoadedOk ? 'CONNECTED' : cameraState)
                    )}
                  >
                    {previewStreamActive && streamLoadedOk
                      ? 'CONNECTED'
                      : STATE_DISPLAY_LABEL[cameraState]}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className={cn('font-semibold', getDataCategoryToneClasses(camDataCategory))}>
                    {DATA_CATEGORY_LABEL[camDataCategory]}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div>
                  <dt className="text-muted-foreground">Last image received</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {formatIsoTimestamp(camLastImageAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Firmware version</dt>
                  <dd className="font-mono tabular-nums font-medium text-foreground mt-0.5">
                    {camFirmwareVersion || 'Unreported'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Stream status</dt>
                  <dd className="font-medium text-foreground mt-0.5">
                    {previewStreamActive && streamLoadedOk
                      ? 'Live MJPEG Stream Active (Local Gateway Proxy)'
                      : camStreamStatusLabel}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="pt-2.5 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground font-mono tabular-nums">
              <span className="truncate">Camera IP: {cameraIp || 'Unset'}</span>
              <span className="shrink-0 ml-2">Mode: {camMethod}</span>
            </div>
          </div>
        </div>

        {/* DYNAMICALLY DISCOVERED SENSOR CAPABILITIES TABLE */}
        {discoveredSensors.length > 0 && (
          <div className="space-y-2.5 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-foreground">
                Discovered Controller Sensor Capabilities
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                Unavailable sensors are never marked connected
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="py-2.5 px-3 font-medium">Sensor</th>
                    <th className="py-2.5 px-3 font-medium text-right">Reading</th>
                    <th className="py-2.5 px-3 font-medium">Unit</th>
                    <th className="py-2.5 px-3 font-medium">Validity State</th>
                    <th className="py-2.5 px-3 font-medium">Timestamp</th>
                    <th className="py-2.5 px-3 font-medium">Source Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {discoveredSensors.map((sensor) => (
                    <tr key={sensor.key} className="hover:bg-muted/25 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">
                        {sensor.label}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap',
                          sensor.connected ? 'font-semibold text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {sensor.formattedValue}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-muted-foreground whitespace-nowrap">
                        {sensor.unit}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-3 font-mono text-[11px] font-semibold whitespace-nowrap',
                          sensor.validity === 'VALID'
                            ? 'text-emerald-800 dark:text-emerald-300'
                            : sensor.validity === 'STALE'
                              ? 'text-amber-800 dark:text-amber-300'
                              : 'text-muted-foreground'
                        )}
                      >
                        {sensor.connected ? sensor.validity : `${sensor.validity} (Not Connected)`}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                        {formatIsoTimestamp(sensor.timestamp)}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[180px]">
                        {sensor.sourceDevice}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
          DEDICATED CONFIGURATION PANELS (CONTROLLER + CAMERA)
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: GREENHOUSE SENSOR CONTROLLER */}
        <section className="xl:col-span-6 rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Cpu size={17} className="text-primary shrink-0" />
                GREENHOUSE SENSOR CONTROLLER
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure main ESP32 environmental telemetry via Local HTTP or Cloud HTTPS push.
              </p>
            </div>
            <span className={cn('text-xs font-mono font-semibold', getStateToneClasses(ctrlState))}>
              {STATE_DISPLAY_LABEL[ctrlState]}
            </span>
          </div>

          <form onSubmit={handleTestController} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="ctrl-device-name">
                  Device Name
                </label>
                <Input
                  id="ctrl-device-name"
                  value={ctrlDeviceName}
                  onChange={(e) => setCtrlDeviceName(e.target.value)}
                  placeholder="Main Greenhouse ESP32 Controller"
                  className="h-10 text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground block">
                  Connection Method
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted border border-border h-10">
                  <button
                    type="button"
                    onClick={() => setCtrlMethod('LOCAL')}
                    className={cn(
                      'rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                      ctrlMethod === 'LOCAL'
                        ? 'bg-card text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Local (LAN HTTP)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCtrlMethod('CLOUD')}
                    className={cn(
                      'rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                      ctrlMethod === 'CLOUD'
                        ? 'bg-card text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Cloud (HTTPS Push)
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="ctrl-host">
                  Controller IP / Hostname
                </label>
                <Input
                  id="ctrl-host"
                  value={ctrlHost}
                  onChange={(e) => handleCtrlHostChange(e.target.value)}
                  placeholder="192.168.1.50 or edens-esp32.local"
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="ctrl-port">
                  Controller Port
                </label>
                <Input
                  id="ctrl-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={ctrlPort}
                  onChange={(e) => handleCtrlPortChange(e.target.value)}
                  className="h-10 font-mono tabular-nums text-xs bg-background"
                />
              </div>
            </div>

            {ctrlMethod === 'LOCAL' ? (
              <div className="grid grid-cols-1 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="ctrl-status-url">
                    Controller Status URL
                  </label>
                  <Input
                    id="ctrl-status-url"
                    value={ctrlStatusUrl}
                    onChange={(e) => setCtrlStatusUrl(e.target.value)}
                    placeholder="http://edens-esp32.local/status"
                    className="h-10 font-mono text-xs bg-background"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="ctrl-tel-url">
                    Sensor Telemetry URL
                  </label>
                  <Input
                    id="ctrl-tel-url"
                    value={ctrlTelemetryUrl}
                    onChange={(e) => setCtrlTelemetryUrl(e.target.value)}
                    placeholder="http://edens-esp32.local/status"
                    className="h-10 font-mono text-xs bg-background"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-1.5 text-xs">
                <p className="font-semibold text-foreground">
                  Outbound Cloud Protocol Active (Supported by Checked-In Firmware)
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Checked-in <code className="font-mono">esp32_controller_reference.ino</code> +{' '}
                  <code className="font-mono">edens_controller_sync.h</code> push verified JSON sensor
                  readings outbound over TLS to{' '}
                  <code className="font-mono text-foreground">POST /api/telemetry/upload</code> using
                  per-device <code className="font-mono text-foreground">X-Hardware-Key</code>. No inbound
                  port-forwarding is required.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                type="submit"
                disabled={testingController || savingController || disconnectingController}
                className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {testingController ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Wifi size={14} className="mr-1.5" />
                    <span>Test Connection</span>
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testingController || savingController || disconnectingController}
                onClick={handleSaveController}
                className="h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savingController ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <Save size={14} className="mr-1.5 text-primary" />
                )}
                <span>Save Configuration</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testingController || savingController || disconnectingController}
                onClick={handleDisconnectController}
                className="h-10 px-3.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0 cursor-pointer"
              >
                {disconnectingController ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <PowerOff size={14} className="mr-1.5" />
                )}
                <span>Disconnect</span>
              </Button>
            </div>
          </form>

          {ctrlMessage && (
            <div
              className={cn(
                'rounded-xl border px-3.5 py-3 text-xs flex items-start gap-2.5',
                ctrlMessage.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : ctrlMessage.tone === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100'
                    : 'border-red-200 bg-red-50 text-red-950 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-100'
              )}
            >
              {ctrlMessage.tone === 'ok' ? (
                <CheckCircle2 size={15} className="text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  size={15}
                  className={cn(
                    'shrink-0 mt-0.5',
                    ctrlMessage.tone === 'warn'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-700 dark:text-red-400'
                  )}
                />
              )}
              <span className="leading-relaxed">{ctrlMessage.text}</span>
            </div>
          )}

          {ctrlProbedEndpoints.length > 0 && (
            <div className="space-y-1.5 text-xs border-t border-border pt-3">
              <p className="font-semibold text-foreground">Probed Read-Only Controller Endpoints</p>
              {ctrlProbedEndpoints.map((p, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums text-[11px] text-muted-foreground"
                >
                  <span className="truncate">{p.endpoint}</span>
                  <span>
                    {p.httpStatus ? `HTTP ${p.httpStatus}` : 'No HTTP'} · {p.latencyMs}ms · {p.note}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-border bg-muted/35 p-3.5 text-[11px] text-muted-foreground leading-relaxed space-y-1">
            <p className="font-semibold text-foreground">Firmware Protocol Audit</p>
            <p>
              • <strong>Cloud Push (Default in Firmware):</strong>{' '}
              <code className="font-mono">esp32_controller_reference.ino</code> sends telemetry via{' '}
              <code className="font-mono">POST /api/telemetry/upload</code> and does not listen on
              port 80 during normal Wi-Fi STA operation unless a local web handler is compiled in.
            </p>
            <p>
              • <strong>Local HTTP Mode:</strong> Probes only your configured{' '}
              <code className="font-mono">GET /status</code> / telemetry URL and SoftAP{' '}
              <code className="font-mono">GET /api/identity</code>. Zero actuator endpoints are ever called.
            </p>
          </div>
        </section>

        {/* PANEL 2: GREENHOUSE CAMERA */}
        <section className="xl:col-span-6 rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Camera size={17} className="text-primary shrink-0" />
                GREENHOUSE CAMERA
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure existing ESP32-CAM HTTP endpoints or outbound JPEG uploads for Plant Vision.
              </p>
            </div>
            <span
              className={cn(
                'text-xs font-mono font-semibold',
                getStateToneClasses(previewStreamActive && streamLoadedOk ? 'CONNECTED' : cameraState)
              )}
            >
              {previewStreamActive && streamLoadedOk
                ? 'CONNECTED'
                : STATE_DISPLAY_LABEL[cameraState]}
            </span>
          </div>

          <form onSubmit={handleTestCamera} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="cam-name">
                  Camera Name
                </label>
                <Input
                  id="cam-name"
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value)}
                  placeholder="Greenhouse ESP32-CAM"
                  className="h-10 text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground block">
                  Connection Method
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted border border-border h-10">
                  <button
                    type="button"
                    onClick={() => setCamMethod('LOCAL')}
                    className={cn(
                      'rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                      camMethod === 'LOCAL'
                        ? 'bg-card text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Local (LAN HTTP)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCamMethod('CLOUD')}
                    className={cn(
                      'rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                      camMethod === 'CLOUD'
                        ? 'bg-card text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Cloud (HTTPS Upload)
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="cam-ip">
                  Camera IP
                </label>
                <Input
                  id="cam-ip"
                  value={cameraIp}
                  onChange={(e) => handleCameraIpChange(e.target.value)}
                  placeholder="192.168.1.60"
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="cam-status-url">
                  Status URL
                </label>
                <Input
                  id="cam-status-url"
                  value={statusUrl}
                  onChange={(e) => setStatusUrl(e.target.value)}
                  placeholder="http://<camera-ip>/status"
                  disabled={camMethod === 'CLOUD'}
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="cam-photo-url">
                  Photo URL
                </label>
                <Input
                  id="cam-photo-url"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  placeholder="http://<camera-ip>/photo"
                  disabled={camMethod === 'CLOUD'}
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="cam-stream-url">
                  Stream URL
                </label>
                <Input
                  id="cam-stream-url"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="http://<camera-ip>:81/stream"
                  disabled={camMethod === 'CLOUD'}
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>
            </div>

            {camMethod === 'CLOUD' && (
              <div className="rounded-xl border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Cloud Upload Mode:</strong> Your ESP32-CAM (or{' '}
                <code className="font-mono">npm run camera:relay</code> running on local Wi-Fi) uploads
                verified JPEG snapshots outbound to{' '}
                <code className="font-mono text-foreground">POST /api/camera/upload</code> with{' '}
                <code className="font-mono text-foreground">X-Camera-Key</code>.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="submit"
                disabled={testingCamera || capturingCamera || savingCamera || disconnectingCamera}
                className="h-10 px-3.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {testingCamera ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Wifi size={14} className="mr-1.5" />
                    <span>Test Camera Connection</span>
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testingCamera || capturingCamera || disconnectingCamera}
                onClick={handleTogglePreviewCamera}
                className="h-10 px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Video size={14} className="mr-1.5 text-primary" />
                <span>{previewStreamActive ? 'Stop Preview' : 'Preview Camera'}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={
                  camMethod === 'CLOUD' ||
                  testingCamera ||
                  capturingCamera ||
                  savingCamera ||
                  disconnectingCamera
                }
                onClick={handleCaptureCameraImage}
                className="h-10 px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {capturingCamera ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <Camera size={14} className="mr-1.5 text-primary" />
                )}
                <span>Capture Image</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testingCamera || capturingCamera || savingCamera || disconnectingCamera}
                onClick={handleSaveCamera}
                className="h-10 px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savingCamera ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <Save size={14} className="mr-1.5 text-primary" />
                )}
                <span>Save Camera Configuration</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testingCamera || capturingCamera || savingCamera || disconnectingCamera}
                onClick={handleDisconnectCamera}
                className="h-10 px-3 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0 cursor-pointer"
              >
                {disconnectingCamera ? (
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                ) : (
                  <PowerOff size={14} className="mr-1.5" />
                )}
                <span>Disconnect Camera</span>
              </Button>
            </div>
          </form>

          {cameraMessage && (
            <div
              className={cn(
                'rounded-xl border px-3.5 py-3 text-xs flex items-start gap-2.5',
                cameraMessage.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : cameraMessage.tone === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100'
                    : 'border-red-200 bg-red-50 text-red-950 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-100'
              )}
            >
              {cameraMessage.tone === 'ok' ? (
                <CheckCircle2 size={15} className="text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  size={15}
                  className={cn(
                    'shrink-0 mt-0.5',
                    cameraMessage.tone === 'warn'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-700 dark:text-red-400'
                  )}
                />
              )}
              <span className="leading-relaxed">{cameraMessage.text}</span>
            </div>
          )}

          {/* Remediation Options when Cloud-to-Private-LAN is Blocked */}
          {cameraState === 'CONNECTION_BLOCKED' && remediationOptions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30 p-4 space-y-3 text-xs">
              <p className="font-semibold text-amber-950 dark:text-amber-100">
                Supported Local-to-Cloud Camera Mechanisms (Zero Public Device Exposure)
              </p>
              <div className="space-y-2.5">
                {remediationOptions.map((opt) => (
                  <div key={opt.id} className="space-y-1">
                    <p className="font-semibold text-foreground">{opt.title}</p>
                    <p className="text-muted-foreground leading-relaxed">{opt.description}</p>
                    {opt.command && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[11px] text-foreground">
                        <span className="truncate">{opt.command}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(opt.command || '');
                            setCopiedCmd(true);
                            setTimeout(() => setCopiedCmd(false), 2000);
                          }}
                          className="inline-flex items-center gap-1 text-primary font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedCmd ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Camera Viewport: Strictly Distinguishes Live MJPEG Stream vs Static JPEG Photograph */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-muted-foreground">
              <span>
                {previewStreamActive && streamLoadedOk
                  ? 'LIVE MJPEG STREAM · Local Gateway Proxy'
                  : verifiedFrame
                    ? 'REAL CAMERA IMAGE · Static JPEG Photograph (Not Live Stream)'
                    : 'Camera Viewport · Waiting for Verified JPEG'}
              </span>
              {verifiedFrame?.capturedAt && !previewStreamActive && (
                <span>Captured {formatIsoTimestamp(verifiedFrame.capturedAt)}</span>
              )}
            </div>

            <div className="aspect-video w-full rounded-xl overflow-hidden border border-border bg-muted/50 flex items-center justify-center relative">
              {previewStreamActive && proxyStreamUrl ? (
                <img
                  src={proxyStreamUrl}
                  alt={`Live MJPEG stream from ${cameraName}`}
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    setStreamLoadedOk(true);
                    setCameraState('CONNECTED');
                  }}
                  onError={() => {
                    setPreviewStreamActive(false);
                    setStreamLoadedOk(false);
                    setCameraState(verifiedFrame ? 'RECONNECTING' : 'OFFLINE');
                    setCameraMessage({
                      tone: 'warn',
                      text:
                        'MJPEG stream interrupted or unreachable. Switched safely back to verified snapshot mode.'
                    });
                  }}
                  className="w-full h-full object-contain bg-stone-950"
                />
              ) : verifiedFrame ? (
                <img
                  src={verifiedFrame.base64DataUri || verifiedFrame.url}
                  alt={`Verified JPEG snapshot from ${cameraName}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain bg-stone-950"
                />
              ) : (
                <div className="p-6 text-center max-w-sm space-y-1.5">
                  <WifiOff size={22} className="mx-auto text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground">No Verified Camera Image</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Click <strong>Test Camera Connection</strong> or <strong>Capture Image</strong> to
                    verify JPEG SOI/EOI bytes before displaying or diagnosing.
                  </p>
                </div>
              )}
            </div>

            {verifiedFrame && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[11px] font-mono tabular-nums text-muted-foreground">
                  {verifiedFrame.sizeBytes
                    ? `${Math.max(1, Math.round(verifiedFrame.sizeBytes / 1024))} KB`
                    : 'JPEG verified'}
                  {verifiedFrame.sha256 ? ` · SHA-256 ${verifiedFrame.sha256.slice(0, 12)}…` : ''}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={diagnosingCam}
                    onClick={handleDiagnoseRealCamera}
                    className="h-9 px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {diagnosingCam ? (
                      <>
                        <Loader2 size={13} className="animate-spin mr-1.5" />
                        <span>Diagnosing...</span>
                      </>
                    ) : (
                      <>
                        <Leaf size={13} className="mr-1.5 text-primary" />
                        <span>Diagnose Real Camera Image</span>
                      </>
                    )}
                  </Button>

                  <Link
                    to="/vision"
                    className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    Open Plant Vision
                  </Link>
                </div>
              </div>
            )}

            {camDiagnosisErr && (
              <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200 px-3.5 py-2.5 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{camDiagnosisErr}</span>
              </div>
            )}

            {camDiagnosis && (
              <div className="rounded-xl border border-border bg-background p-4 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums border-b border-border pb-2">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                    REAL CAMERA IMAGE
                  </span>
                  <span className="text-muted-foreground">
                    {camDiagnosis.capturedAt
                      ? `Captured ${formatIsoTimestamp(camDiagnosis.capturedAt)}`
                      : 'Live Camera Capture'}
                  </span>
                </div>
                <p className="font-semibold text-foreground text-sm">
                  {camDiagnosis.species} — {camDiagnosis.healthStatus}
                </p>
                <p className="text-muted-foreground leading-relaxed">{camDiagnosis.symptoms}</p>
                {Array.isArray(camDiagnosis.recommendedActions) &&
                camDiagnosis.recommendedActions.length > 0 ? (
                  <ol className="list-decimal pl-4 space-y-1 text-foreground font-medium">
                    {camDiagnosis.recommendedActions.map((act, i) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-foreground font-medium whitespace-pre-line">
                    {camDiagnosis.recommendation}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
                  {camDiagnosis.confidenceNote ||
                    'Confidence percentage omitted: visual LLM plant inspection is not calibrated as a statistical probability.'}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-muted/35 p-3.5 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
            <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" />
            <span>{browserSecurityNote}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
