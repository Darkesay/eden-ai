import React, { useState, useEffect } from 'react';
import { hardwareService } from '../lib/hardwareService';
import { HardwareConfig, DataSource, DiagnosticLog } from '../lib/hardwareTypes';
import { DataSourceBadge } from '../components/DataSourceBadge';
import { CameraStream } from '../components/CameraStream';
import { HardwareSetupGuide } from '../components/HardwareSetupGuide';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { 
  Cpu, 
  Video, 
  Wifi, 
  ShieldAlert, 
  AlertTriangle, 
  RefreshCw, 
  Sliders, 
  Check, 
  Eye, 
  EyeOff, 
  Server, 
  Activity, 
  Terminal, 
  CloudRain, 
  Thermometer, 
  Droplet, 
  Save, 
  FileText, 
  CheckCircle,
  X,
  Radio,
  Zap,
  Upload,
  Copy,
  Globe
} from 'lucide-react';
import { cn } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function SectionTitle({ icon: Icon, children, action }: {
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={16} className="text-muted-foreground" aria-hidden="true" />
        {children}
      </span>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HardwareConfigPage() {
  const [config, setConfig] = useState<HardwareConfig>(hardwareService.getConfig());
  const [logs, setLogs] = useState<DiagnosticLog[]>(hardwareService.getDiagnosticLogs());
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Camera Upload Gateway state
  const [uploadInfo, setUploadInfo] = useState<any>(null);
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [sampleUploadResult, setSampleUploadResult] = useState<any>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [testCameraKey, setTestCameraKey] = useState('');

  // Diagnostic tests state
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [lastTestResult, setLastTestResult] = useState<any>(null);
  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [suiteResults, setSuiteResults] = useState<Array<{ name: string; endpoint: string; pass: boolean; latencyMs: number; details: string }> | null>(null);

  // Simulation test sandbox state
  const [simRain, setSimRain] = useState(false);
  const [simTemp, setSimTemp] = useState(25);
  const [simWater, setSimWater] = useState(80);

  useEffect(() => {
    hardwareService.getCameraUploadInfo().then(setUploadInfo).catch(() => {});
    const interval = setInterval(() => {
      hardwareService.getCameraUploadInfo().then(setUploadInfo).catch(() => {});
    }, 6000);

    const unsub = hardwareService.subscribe(() => {
      setLogs(hardwareService.getDiagnosticLogs());
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, []);

  const handleCopySnippet = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleSendSampleUpload = async () => {
    setIsUploadingSample(true);
    setSampleUploadResult(null);
    try {
      // User must provide key via inline password input - never hardcode secrets or use window.prompt
      const keyToUse = testCameraKey.trim();
      if (!keyToUse) {
        setSampleUploadResult({
          success: false,
          error: 'Enter your CAMERA_UPLOAD_KEY in the X-Camera-Key test input before running the upload check.'
        });
        return;
      }

      // Create a valid synthetic botanical JPEG canvas
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a1f0a';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        ctx.arc(160, 120, 60, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px monospace';
        ctx.fillText('EDENS-ESP32-CAM', 90, 125);
      }
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.85);
      });
      const arrayBuf = await blob.arrayBuffer();
      const res = await hardwareService.uploadCameraImage(arrayBuf, keyToUse);
      setSampleUploadResult({ success: true, data: res });
      const info = await hardwareService.getCameraUploadInfo();
      setUploadInfo(info);
    } catch (err: any) {
      setSampleUploadResult({ success: false, error: err.message || String(err) });
    } finally {
      setIsUploadingSample(false);
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    hardwareService.updateConfig(config);
    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    }, 400);
  };

  const handleRunDiagnostic = async (testName: string, testFn: () => Promise<any>) => {
    setTestingEndpoint(testName);
    setLastTestResult(null);
    try {
      const res = await testFn();
      setLastTestResult({ success: true, data: res, testName });
    } catch (err: any) {
      setLastTestResult({ success: false, error: err.message || String(err), testName });
    } finally {
      setTestingEndpoint(null);
    }
  };

  const handleRunFullSuite = async () => {
    setIsRunningSuite(true);
    setSuiteResults(null);
    const results: Array<{ name: string; endpoint: string; pass: boolean; latencyMs: number; details: string }> = [];

    const runStep = async (name: string, endpoint: string, fn: () => Promise<any>) => {
      const t0 = performance.now();
      try {
        const data = await fn();
        const latencyMs = Math.round(performance.now() - t0);
        results.push({ name, endpoint, pass: true, latencyMs, details: data?.message || 'Handshake successful' });
      } catch (err: any) {
        const latencyMs = Math.round(performance.now() - t0);
        results.push({ name, endpoint, pass: false, latencyMs, details: err.message || String(err) });
      }
    };

    // 1. Telemetry /status
    await runStep('Controller Status & Telemetry', 'GET /status', () => hardwareService.getStatus());
    // 2. Botanical crops /crops
    await runStep('Botanical Profiles', 'GET /crops', () => hardwareService.getCrops());
    // 3. Set active crop /setPlant
    await runStep('Crop Selection', 'GET /setPlant?crop=tomato', () => hardwareService.setPlant('tomato'));
    // 4. Custom thresholds /setCustom
    await runStep('Environmental Limits', 'GET /setCustom', () => hardwareService.setCustom({
      tempMin: 20, tempMax: 28, humMin: 50, humMax: 70, soilMin: 45, soilMax: 65
    }));
    // 5. Ventilation roof /roof
    await runStep('Greenhouse Roof Vent', 'GET /roof?state=open', () => hardwareService.setRoof('open'));
    // 6. Actuator override /override
    await runStep('Actuator Manual Relay', 'GET /override?device=fan&state=on', () => hardwareService.setOverride('fan', 'on', 10));
    // 7. Automation pause /pause
    await runStep('Automation Pause Hold', 'GET /pause?duration=15', () => hardwareService.pauseAutonomous(15));
    // 8. Custom parameter /setOption
    await runStep('Firmware Option Setting', 'GET /setOption', () => hardwareService.setOption('ventSpeed', 85));
    // 9. Camera Snapshot /capture
    await runStep('ESP32-CAM Image Capture', 'GET /capture', () => hardwareService.getCameraSnapshot());

    setSuiteResults(results);
    setIsRunningSuite(false);
  };

  const FIRMWARE_SNIPPET = `// 1. Copy firmware/esp32_cam_cloud_sync/edens_cloud_upload.h into your sketch folder
// 2. Create camera_secrets.h (gitignored) with EDENS_CAMERA_UPLOAD_KEY
#include "edens_cloud_upload.h"

// Inside setup(), right after WiFi connection and startCameraServer():
edensStartCloudUploadTask(); // Verified Root CA TLS (setCACert + NTP) + X-Camera-Key`;

  const diagnosticTests: Array<{ name: string; path: string; description?: string; run: () => Promise<any> }> = [
    { name: 'GET /status', path: '/status', description: 'Telemetry & interlocks', run: () => hardwareService.getStatus() },
    { name: 'GET /crops', path: '/crops', description: 'Crop profiles', run: () => hardwareService.getCrops() },
    { name: 'GET /setPlant?crop=tomato', path: '/setPlant?crop=tomato', description: 'Select active crop', run: () => hardwareService.setPlant('tomato') },
    { name: 'GET /setCustom', path: '/setCustom', description: 'Thresholds', run: () => hardwareService.setCustom({
      tempMin: 21, tempMax: 29, humMin: 55, humMax: 75, soilMin: 45, soilMax: 65
    }) },
    { name: 'GET /roof?state=open', path: '/roof?state=open', description: 'Roof vent', run: () => hardwareService.setRoof('open') },
    { name: 'GET /override?device=fan&state=on', path: '/override?device=fan', description: 'Manual relay', run: () => hardwareService.setOverride('fan', 'on', 10) },
    { name: 'GET /pause?duration=15', path: '/pause?duration=15', description: 'Automation hold', run: () => hardwareService.pauseAutonomous(15) },
    { name: 'GET /setOption?key=ventSpeed&value=80', path: '/setOption', description: 'Parameter', run: () => hardwareService.setOption('ventSpeed', 80) },
    { name: 'Camera /capture', path: '/capture', description: 'Still frame', run: () => hardwareService.getCameraSnapshot() },
  ];

  const modeOptions: Array<{ mode: 'simulation' | 'direct' | 'proxy'; icon: React.ElementType; title: string; description: string }> = [
    { mode: 'simulation', icon: Cpu, title: 'Simulation', description: 'Test with simulated greenhouse physics. No hardware required.' },
    { mode: 'direct', icon: Wifi, title: 'Direct HTTP (LAN)', description: 'Calls the ESP32 directly over your local greenhouse Wi-Fi.' },
    { mode: 'proxy', icon: Server, title: 'Gateway / proxy', description: 'Routes through your local gateway to avoid browser mixed-content blocks.' },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Hardware setup</h1>
            <DataSourceBadge variant="badge" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Main ESP32 controller, ESP32-CAM, and firmware safety interlocks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <HardwareSetupGuide variant="button" />
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
            ) : saveSuccess ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Save size={15} aria-hidden="true" />
            )}
            {saveSuccess ? 'Saved' : 'Save settings'}
          </Button>
        </div>
      </div>

      {/* Connection Mode & Status Banner */}
      <DataSourceBadge variant="banner" />

      {/* Main Grid: Settings & Diagnostics */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Column 1 & 2: Controller & Camera Settings */}
        <div className="space-y-6 lg:col-span-2">

          {/* 1. Main ESP32 Controller Settings */}
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle icon={Cpu}>Main controller (ESP32)</SectionTitle>
              <CardDescription className="text-xs">
                Reads greenhouse sensors (temperature, humidity, soil, rain) and drives actuators (pump, fan, light, roof).
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 pt-4">
              {/* Operation Mode radio */}
              <div className="space-y-2">
                <Label>Operation mode</Label>
                <div role="radiogroup" aria-label="Operation mode" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {modeOptions.map((opt) => {
                    const selected = config.mode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setConfig({ ...config, mode: opt.mode })}
                        className={cn(
                          'rounded-lg border p-3.5 text-left transition-colors cursor-pointer',
                          selected
                            ? 'border-brand/40 bg-accent'
                            : 'border-border bg-card hover:bg-muted/50'
                        )}
                      >
                        <span className="mb-1 flex items-center justify-between gap-2">
                          <span className={cn('text-sm font-medium', selected ? 'text-accent-foreground' : 'text-foreground')}>
                            {opt.title}
                          </span>
                          <opt.icon size={15} className={cn(selected ? 'text-brand' : 'text-muted-foreground')} aria-hidden="true" />
                        </span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {opt.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Host & Port Configuration */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="controller-host">Controller IP or hostname</Label>
                  <Input
                    id="controller-host"
                    type="text"
                    value={config.controllerHost}
                    onChange={(e) => setConfig({ ...config, controllerHost: e.target.value })}
                    placeholder="e.g. 192.168.1.100 or edens-main.local"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    The static IP or mDNS name of your main ESP32 controller.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="controller-port">HTTP port</Label>
                  <Input
                    id="controller-port"
                    type="number"
                    value={config.controllerPort}
                    onChange={(e) => setConfig({ ...config, controllerPort: Number(e.target.value) || 80 })}
                    placeholder="80"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Default: 80</p>
                </div>
              </div>

              {/* API Key / Token Authentication */}
              <div className="space-y-1.5">
                <Label htmlFor="controller-api-key">Hardware API key</Label>
                <div className="relative">
                  <Input
                    id="controller-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={config.controllerApiKey}
                    onChange={(e) => setConfig({ ...config, controllerApiKey: e.target.value })}
                    placeholder="e.g. edens-auth-key-xxxx"
                    className="pr-10 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowApiKey(!showApiKey)}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    title={showApiKey ? 'Hide API key' : 'Show API key'}
                    className="absolute top-0.5 right-0.5 text-muted-foreground"
                  >
                    {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sent as a <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">?auth=</code> query or <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">X-API-Key</code> header so only your farm can send actuator commands.
                </p>
              </div>

              {/* Advanced Parameters: Polling & Safety Interlocks */}
              <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="poll-interval">Telemetry polling interval (ms)</Label>
                  <Input
                    id="poll-interval"
                    type="number"
                    value={config.pollIntervalMs}
                    onChange={(e) => setConfig({ ...config, pollIntervalMs: Number(e.target.value) || 3000 })}
                    min="1000"
                    max="60000"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Recommended: 3000 ms (3 seconds)</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="request-timeout">Request timeout (ms)</Label>
                  <Input
                    id="request-timeout"
                    type="number"
                    value={config.timeoutMs}
                    onChange={(e) => setConfig({ ...config, timeoutMs: Number(e.target.value) || 5000 })}
                    min="1000"
                    max="15000"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">How long to wait before giving up on the controller</p>
                </div>
              </div>

              {/* Safety Interlocks Toggle */}
              <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <div className="flex items-center gap-3">
                  <ShieldAlert size={18} className="shrink-0 text-warning" aria-hidden="true" />
                  <div>
                    <h4 className="text-sm font-semibold">
                      Firmware safety interlocks
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Blocks the roof from opening in rain, stops dry-running the pump, and caps overheating. AI agents cannot override these.
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  aria-label="Enable firmware safety interlocks"
                  checked={config.safetyInterlocksEnabled}
                  onChange={(e) => setConfig({ ...config, safetyInterlocksEnabled: e.target.checked })}
                  className="size-5 shrink-0 cursor-pointer accent-primary"
                />
              </div>
            </CardContent>
          </Card>

          {/* 2. ESP32-CAM Configuration */}
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle icon={Video}>Camera (ESP32-CAM)</SectionTitle>
              <CardDescription className="text-xs">
                Live MJPEG video stream and high-resolution JPEG capture used for AI leaf diagnosis.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="camera-host">Camera IP or hostname</Label>
                  <Input
                    id="camera-host"
                    type="text"
                    value={config.cameraHost}
                    onChange={(e) => setConfig({ ...config, cameraHost: e.target.value })}
                    placeholder="e.g. 192.168.1.101 or edens-cam.local"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="camera-port">Camera port</Label>
                  <Input
                    id="camera-port"
                    type="number"
                    value={config.cameraPort}
                    onChange={(e) => setConfig({ ...config, cameraPort: Number(e.target.value) || 81 })}
                    placeholder="81"
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="camera-stream-path">Stream path</Label>
                  <Input
                    id="camera-stream-path"
                    type="text"
                    value={config.cameraStreamPath}
                    onChange={(e) => setConfig({ ...config, cameraStreamPath: e.target.value })}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="camera-capture-path">Capture path</Label>
                  <Input
                    id="camera-capture-path"
                    type="text"
                    value={config.cameraCapturePath}
                    onChange={(e) => setConfig({ ...config, cameraCapturePath: e.target.value })}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="camera-status-path">Status path</Label>
                  <Input
                    id="camera-status-path"
                    type="text"
                    value={config.cameraStatusPath}
                    onChange={(e) => setConfig({ ...config, cameraStatusPath: e.target.value })}
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              {/* Embedded Camera Preview */}
              <div className="border-t border-border pt-4">
                <span className="mb-2 block text-xs font-medium text-muted-foreground">
                  Camera feed preview
                </span>
                <CameraStream showControls={true} allowAdminTestUpload={true} />
              </div>
            </CardContent>
          </Card>

          {/* 3. ESP32-CAM Push Upload Gateway Card */}
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle
                icon={Upload}
                action={
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    HTTP POST intake
                  </span>
                }
              >
                Camera push upload gateway
              </SectionTitle>
              <CardDescription className="text-xs">
                Where the camera firmware uploads JPEG snapshots directly to the cloud.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 pt-4">
              {/* Endpoint Specifications Grid */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
                  <span className="block text-xs font-medium text-muted-foreground">
                    Upload endpoint
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-xs font-medium text-accent-foreground">POST</span>
                    <code className="font-mono tabular text-sm font-medium">/api/camera/upload</code>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Accepts raw JPEG frames (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">image/jpeg</code>).
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
                  <span className="block text-xs font-medium text-muted-foreground">
                    Authentication
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">HEADER</span>
                    <code className="break-all font-mono tabular text-xs">X-Camera-Key: &lt;configured_key&gt;</code>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Checked against the server-side <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">CAMERA_UPLOAD_KEY</code>. Never put keys in URLs.
                  </p>
                </div>
              </div>

              {/* Network Reachability & Deployment Guidance */}
              <div className="space-y-2.5 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Globe size={14} aria-hidden="true" /> Direct camera-to-cloud
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Recommended
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1 rounded-lg bg-muted/40 p-3">
                    <span className="text-xs font-medium">Direct HTTPS upload from the ESP32-CAM</span>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Include <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">firmware/esp32_cam_cloud_sync/edens_cloud_upload.h</code> in your sketch for non-blocking, CA-verified TLS uploads:
                    </p>
                    <code className="block break-all rounded-lg bg-muted/50 p-2 font-mono tabular text-xs">
                      POST https://edens-ai.onrender.com/api/camera/upload
                    </code>
                  </div>
                  <div className="space-y-1 rounded-lg bg-muted/40 p-3">
                    <span className="text-xs font-medium">Local endpoints stay available on the LAN</span>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      The background FreeRTOS upload copies each JPEG into PSRAM in about 4ms, so local <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">/photo</code>, <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">/status</code>, and <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">:81/stream</code> keep working without a PC relay.
                    </p>
                  </div>
                </div>
              </div>

              {/* Live Intake Status & Telemetry */}
              <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-muted/40 p-4">
                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Activity size={14} aria-hidden="true" /> Intake status
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular text-xs text-muted-foreground">
                    <span>
                      Frames received: <strong className="font-medium text-foreground">{uploadInfo?.totalUploadsReceived ?? 0}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Latest: <strong className="font-medium text-foreground">{uploadInfo?.latestUploadTimestamp ? new Date(uploadInfo.latestUploadTimestamp).toLocaleTimeString() : 'None'}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Max size: <strong className="font-medium text-foreground">{uploadInfo?.maxSizeMb ?? 10} MB</strong>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="test-camera-key">X-Camera-Key</Label>
                    <Input
                      id="test-camera-key"
                      type="password"
                      autoComplete="off"
                      placeholder="Key for the test upload"
                      value={testCameraKey}
                      onChange={(e) => setTestCameraKey(e.target.value)}
                      className="w-52 font-mono text-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendSampleUpload}
                    disabled={isUploadingSample}
                  >
                    <Upload size={15} aria-hidden="true" />
                    {isUploadingSample ? 'Uploading test frame…' : 'Test upload'}
                  </Button>
                </div>
              </div>

              {/* Sample Upload Test Result Banner */}
              {sampleUploadResult && (
                <div className={cn(
                  "rounded-lg border p-3.5 text-xs",
                  sampleUploadResult.success 
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                )}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      {sampleUploadResult.success ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                      {sampleUploadResult.success ? 'Test upload succeeded (HTTP 200)' : 'Test upload failed'}
                    </span>
                    <span className="font-mono tabular text-muted-foreground">{new Date().toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono tabular text-xs">
                    {JSON.stringify(sampleUploadResult.data || sampleUploadResult.error, null, 2)}
                  </pre>
                </div>
              )}

              {/* Firmware Integration Code Snippet */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Firmware integration (C++ / Arduino)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopySnippet(FIRMWARE_SNIPPET)}
                  >
                    {copiedCode ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copiedCode ? 'Copied' : 'Copy code'}
                  </Button>
                </div>

                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono tabular text-xs leading-relaxed">
                  {FIRMWARE_SNIPPET}
                </pre>
              </div>
            </CardContent>
          </Card>

          {/* 4. Simulation Sandbox (Available in Simulation Mode) */}
          {config.mode === 'simulation' && (
            <Card>
              <CardHeader className="border-b border-border pb-3">
                <SectionTitle
                  icon={Sliders}
                  action={
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Test mode
                    </span>
                  }
                >
                  Simulation sandbox
                </SectionTitle>
                <CardDescription className="text-xs">
                  Inject mock sensor conditions to check agent reactions and safety interlocks before deploying real hardware.
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {/* Rain Toggle */}
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <CloudRain size={14} aria-hidden="true" /> Rain sensor
                      </span>
                      <Button
                        type="button"
                        variant={simRain ? 'default' : 'outline'}
                        size="sm"
                        aria-pressed={simRain}
                        onClick={() => {
                          const next = !simRain;
                          setSimRain(next);
                          hardwareService.setSimulationRain(next);
                        }}
                      >
                        {simRain ? 'Raining' : 'Dry'}
                      </Button>
                    </div>
                    <p className={cn('text-xs', simRain ? 'text-info' : 'text-muted-foreground')}>
                      {simRain ? 'Rain interlock engaged: the roof vent cannot open.' : 'Normal weather.'}
                    </p>
                  </div>

                  {/* Temp Slider */}
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Thermometer size={14} aria-hidden="true" /> Temperature
                      <span className="font-mono tabular font-medium text-foreground">{simTemp}°C</span>
                    </span>
                    <input
                      type="range"
                      aria-label="Simulated temperature"
                      min="12"
                      max="40"
                      value={simTemp}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSimTemp(val);
                        hardwareService.setSimulationTemperature(val);
                      }}
                      className="w-full cursor-pointer accent-primary"
                    />
                    <p className={cn('text-xs', simTemp > 35 ? 'text-warning' : 'text-muted-foreground')}>
                      {simTemp > 35 ? 'Extreme heat: emergency cooling triggers' : 'Healthy tropical range'}
                    </p>
                  </div>

                  {/* Water Reservoir Slider */}
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Droplet size={14} aria-hidden="true" /> Reservoir
                      <span className="font-mono tabular font-medium text-foreground">{simWater}%</span>
                    </span>
                    <input
                      type="range"
                      aria-label="Simulated water reservoir level"
                      min="0"
                      max="100"
                      value={simWater}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSimWater(val);
                        hardwareService.setSimulationWaterLevel(val);
                      }}
                      className="w-full cursor-pointer accent-primary"
                    />
                    <p className={cn('text-xs', simWater < 10 ? 'text-destructive' : 'text-muted-foreground')}>
                      {simWater < 10 ? 'Low water: pump lockout engaged' : 'Adequate irrigation water'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Column 3: Live Endpoint Diagnostics & Testing Panel */}
        <div className="space-y-6">

          {/* Diagnostic Endpoint Tester */}
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle icon={Activity}>Live endpoint diagnostics</SectionTitle>
              <CardDescription className="text-xs">
                Test each firmware endpoint on its own, or run the whole suite.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3 pt-4">
              {/* Full Automated Suite Button */}
              <Button
                type="button"
                variant="outline"
                onClick={handleRunFullSuite}
                disabled={isRunningSuite}
                className="w-full"
              >
                {isRunningSuite ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
                    Running diagnostics…
                  </>
                ) : (
                  <>
                    <Zap size={15} aria-hidden="true" />
                    Run full diagnostic suite
                  </>
                )}
              </Button>

              {/* Suite Results Drawer */}
              {suiteResults && (
                <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle size={14} className="text-success" aria-hidden="true" /> Suite results
                    </span>
                    <span className="font-mono tabular text-muted-foreground">
                      {suiteResults.filter(r => r.pass).length}/{suiteResults.length} passed
                    </span>
                  </div>
                  <div className="custom-scrollbar max-h-48 space-y-1.5 overflow-y-auto">
                    {suiteResults.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          {r.pass
                            ? <Check size={13} className="shrink-0 text-success" aria-hidden="true" />
                            : <X size={13} className="shrink-0 text-destructive" aria-hidden="true" />}
                          <span className="truncate text-xs font-medium">{r.name}</span>
                          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">({r.endpoint})</span>
                        </span>
                        <span className="shrink-0 font-mono tabular text-xs text-muted-foreground">{r.latencyMs} ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-1 text-xs font-medium text-muted-foreground">
                Individual endpoint tests
              </div>

              {/* 9 individual tests */}
              {diagnosticTests.map((test) => (
                <button
                  key={test.name}
                  type="button"
                  disabled={testingEndpoint !== null}
                  onClick={() => handleRunDiagnostic(test.name, test.run)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono tabular text-xs font-medium">{test.path}</span>
                    {test.description && (
                      <span className="text-xs text-muted-foreground">{test.description}</span>
                    )}
                  </span>
                  {testingEndpoint === test.name ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand">
                      <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> Testing…
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">Run test</span>
                  )}
                </button>
              ))}

              {/* Test Result Inspector */}
              {lastTestResult && (
                <div className={cn(
                  "mt-2 rounded-lg border p-3",
                  lastTestResult.success 
                    ? "border-success/30 bg-success/10"
                    : "border-destructive/30 bg-destructive/10"
                )}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium">
                    <span className="text-foreground">{lastTestResult.testName}</span>
                    <span className={lastTestResult.success ? 'text-success' : 'text-destructive'}>
                      {lastTestResult.success ? 'Passed' : 'Failed'}
                    </span>
                  </div>
                  <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap font-mono tabular text-xs text-muted-foreground">
                    {JSON.stringify(lastTestResult.data || lastTestResult.error, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Diagnostic Event Log Console */}
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <SectionTitle
                icon={Terminal}
                action={
                  <span className="text-xs text-muted-foreground">
                    {logs.length} event{logs.length === 1 ? '' : 's'}
                  </span>
                }
              >
                Connection log
              </SectionTitle>
            </CardHeader>

            <CardContent className="pt-4">
              <div className="custom-scrollbar max-h-64 space-y-2 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No connection events recorded yet.</p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="space-y-0.5 rounded-lg bg-muted/50 p-3 font-mono tabular text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          "font-medium",
                          log.status === 'SUCCESS' && "text-success",
                          log.status === 'WARNING' && "text-warning",
                          (log.status === 'ERROR' || log.status === 'TIMEOUT') && "text-destructive"
                        )}>
                          {log.endpoint}
                        </span>
                        <span className="text-muted-foreground">{log.latencyMs} ms</span>
                      </div>
                      <div className="break-words text-muted-foreground">{log.message}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Hardware Engineer Checklist Box */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText size={15} aria-hidden="true" />
              <h4 className="text-[13px] font-semibold">What your hardware engineer needs to provide</h4>
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Static IP or mDNS hostname for the main ESP32 controller</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Static IP for the ESP32-CAM module</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>API authorization token (shared secret)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>CORS header <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">Access-Control-Allow-Origin: *</code> on the firmware web server</span>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
}
