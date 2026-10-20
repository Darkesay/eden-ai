import React, { useState, useEffect } from 'react';
import { hardwareService, DEFAULT_CROPS } from '../lib/hardwareService';
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
  ShieldCheck, 
  ShieldAlert, 
  AlertTriangle, 
  RefreshCw, 
  Play, 
  Sliders, 
  Check, 
  Lock, 
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
  Clock,
  Radio,
  Zap,
  ExternalLink,
  Upload,
  Copy,
  CheckCheck,
  Globe,
  Camera as CameraIcon
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function HardwareConfigPage() {
  const [config, setConfig] = useState<HardwareConfig>(hardwareService.getConfig());
  const [dataSource, setDataSource] = useState<DataSource>(hardwareService.getDataSource());
  const [logs, setLogs] = useState<DiagnosticLog[]>(hardwareService.getDiagnosticLogs());
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Camera Upload Gateway state
  const [uploadInfo, setUploadInfo] = useState<any>(null);
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [sampleUploadResult, setSampleUploadResult] = useState<any>(null);
  const [copiedCode, setCopiedCode] = useState(false);

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
      setDataSource(hardwareService.getDataSource());
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
      const res = await hardwareService.uploadCameraImage(arrayBuf, 'edens_camera_secret_2026');
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

  return (
    <div className="space-y-8 pb-16 max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">Hardware Configuration</h1>
            <DataSourceBadge variant="badge" />
          </div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] font-bold text-[#10B981] mt-1">
            ESP32 Main Controller · ESP32-CAM · Firmware Safety Interlocks
          </p>
        </div>

        <div className="flex items-center gap-3">
          <HardwareSetupGuide variant="button" />
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-10 px-5 rounded-xl cursor-pointer shadow-[0_2px_10px_rgba(16,185,129,0.3)] transition-all"
          >
            {isSaving ? (
              <RefreshCw size={16} className="animate-spin mr-2" />
            ) : saveSuccess ? (
              <Check size={16} className="mr-2 text-black" />
            ) : (
              <Save size={16} className="mr-2" />
            )}
            {saveSuccess ? 'Saved!' : 'Save Hardware Settings'}
          </Button>
        </div>
      </div>

      {/* Connection Mode & Status Banner */}
      <DataSourceBadge variant="banner" />

      {/* Main Grid: Settings & Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1 & 2: Controller & Camera Settings */}
        <div className="lg:col-span-2 space-y-6">

          {/* 1. Main ESP32 Controller Settings */}
          <Card className="border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm overflow-hidden">
            <CardHeader className="pb-4 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#10B981]/15 text-[#10B981] flex items-center justify-center border border-[#10B981]/30">
                    <Cpu size={20} />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Main ESP32 Controller Connection</CardTitle>
                    <CardDescription className="text-xs">
                      Manages greenhouse sensors (temperature, humidity, soil, rain) and actuators (pump, fan, light, roof)
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-5">
              {/* Connection Mode Radio Switch */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Operation Mode</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, mode: 'simulation' })}
                    className={cn(
                      "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                      config.mode === 'simulation'
                        ? "bg-purple-500/15 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 opacity-70 hover:opacity-100"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-purple-400">Simulation Mode</span>
                      <Cpu size={14} className="text-purple-400" />
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Safe testing with synthetic greenhouse physics. No physical hardware required.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, mode: 'direct' })}
                    className={cn(
                      "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                      config.mode === 'direct'
                        ? "bg-[#10B981]/15 border-[#10B981]/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                        : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 opacity-70 hover:opacity-100"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-[#10B981]">Direct HTTP (LAN)</span>
                      <Wifi size={14} className="text-[#10B981]" />
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Direct browser-to-ESP32 calls on local greenhouse Wi-Fi network.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, mode: 'proxy' })}
                    className={cn(
                      "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                      config.mode === 'proxy'
                        ? "bg-blue-500/15 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                        : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 opacity-70 hover:opacity-100"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-blue-400">Gateway / Proxy</span>
                      <Server size={14} className="text-blue-400" />
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Routes through local gateway server to avoid HTTPS mixed-content restrictions.
                    </p>
                  </button>
                </div>
              </div>

              {/* Host & Port Configuration */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs font-semibold">Controller IP / Hostname</Label>
                  <Input
                    type="text"
                    value={config.controllerHost}
                    onChange={(e) => setConfig({ ...config, controllerHost: e.target.value })}
                    placeholder="e.g. 192.168.1.100 or edens-main.local"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                  <p className="text-[10px] text-gray-400">
                    Enter the static IP or mDNS name assigned to your main ESP32 controller.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">HTTP Port</Label>
                  <Input
                    type="number"
                    value={config.controllerPort}
                    onChange={(e) => setConfig({ ...config, controllerPort: Number(e.target.value) || 80 })}
                    placeholder="80"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                  <p className="text-[10px] text-gray-400">Default: 80</p>
                </div>
              </div>

              {/* API Key / Token Authentication */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Hardware API Key / Auth Token</span>
                  <span className="text-[10px] text-gray-400 font-mono">Protected: never committed to git</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={config.controllerApiKey}
                    onChange={(e) => setConfig({ ...config, controllerApiKey: e.target.value })}
                    placeholder="Enter firmware authorization key (e.g. edens-auth-key-xxxx)"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-white cursor-pointer"
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Transmitted securely via <code className="bg-black/10 dark:bg-white/10 px-1 rounded">?auth=TOKEN</code> or <code className="bg-black/10 dark:bg-white/10 px-1 rounded">X-API-Key</code> header to prevent unauthorized actuator commands.
                </p>
              </div>

              {/* Advanced Parameters: Polling & Safety Interlocks */}
              <div className="pt-3 border-t border-black/5 dark:border-white/5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Telemetry Polling Interval (ms)</Label>
                  <Input
                    type="number"
                    value={config.pollIntervalMs}
                    onChange={(e) => setConfig({ ...config, pollIntervalMs: Number(e.target.value) || 3000 })}
                    min="1000"
                    max="60000"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                  <p className="text-[10px] text-gray-400">Recommended: 3000ms (3 seconds)</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Request Timeout (ms)</Label>
                  <Input
                    type="number"
                    value={config.timeoutMs}
                    onChange={(e) => setConfig({ ...config, timeoutMs: Number(e.target.value) || 5000 })}
                    min="1000"
                    max="15000"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                  <p className="text-[10px] text-gray-400">Abort threshold for unresponsive controller</p>
                </div>
              </div>

              {/* Safety Interlocks Toggle */}
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="text-amber-500 shrink-0" size={24} />
                  <div>
                    <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wide">
                      Firmware Safety Interlocks Enforced
                    </h4>
                    <p className="text-[11px] text-foreground/80 mt-0.5">
                      Prevents opening the roof in rain, dry-run pump burns, and overheating. AI cannot override without safety approval.
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={config.safetyInterlocksEnabled}
                  onChange={(e) => setConfig({ ...config, safetyInterlocksEnabled: e.target.checked })}
                  className="w-5 h-5 accent-amber-500 cursor-pointer"
                />
              </div>
            </CardContent>
          </Card>

          {/* 2. ESP32-CAM Configuration */}
          <Card className="border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm overflow-hidden">
            <CardHeader className="pb-4 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/15 text-blue-400 flex items-center justify-center border border-blue-500/30">
                  <Video size={20} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">ESP32-CAM Video & Snapshot Settings</CardTitle>
                  <CardDescription className="text-xs">
                    Provides continuous MJPEG video stream and high-resolution JPEG capture for AI leaf diagnosis
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs font-semibold">Camera IP / Host</Label>
                  <Input
                    type="text"
                    value={config.cameraHost}
                    onChange={(e) => setConfig({ ...config, cameraHost: e.target.value })}
                    placeholder="e.g. 192.168.1.101 or edens-cam.local"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Camera Port</Label>
                  <Input
                    type="number"
                    value={config.cameraPort}
                    onChange={(e) => setConfig({ ...config, cameraPort: Number(e.target.value) || 81 })}
                    placeholder="81"
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-gray-400">Stream Path</Label>
                  <Input
                    type="text"
                    value={config.cameraStreamPath}
                    onChange={(e) => setConfig({ ...config, cameraStreamPath: e.target.value })}
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-gray-400">Capture Path</Label>
                  <Input
                    type="text"
                    value={config.cameraCapturePath}
                    onChange={(e) => setConfig({ ...config, cameraCapturePath: e.target.value })}
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-gray-400">Status Path</Label>
                  <Input
                    type="text"
                    value={config.cameraStatusPath}
                    onChange={(e) => setConfig({ ...config, cameraStatusPath: e.target.value })}
                    className="bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              {/* Embedded Camera Preview */}
              <div className="pt-3 border-t border-black/5 dark:border-white/5">
                <Label className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 block">
                  Camera Feed Preview
                </Label>
                <CameraStream showControls={true} />
              </div>
            </CardContent>
          </Card>

          {/* 3. ESP32-CAM Push Upload Gateway Card */}
          <Card className="border border-emerald-500/30 bg-emerald-950/10 dark:bg-emerald-950/20 backdrop-blur-xl rounded-3xl shadow-sm overflow-hidden">
            <CardHeader className="pb-4 border-b border-emerald-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#10B981]/20 text-[#10B981] flex items-center justify-center border border-[#10B981]/40">
                    <Upload size={20} />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-emerald-400">
                      ESP32-CAM Push Upload Gateway
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Dedicated intake endpoint for receiving uploaded JPEG snapshots directly from greenhouse camera firmware
                    </CardDescription>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold uppercase tracking-wider">
                  HTTP POST Intake
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6">
              {/* Endpoint Specifications Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-black/40 border border-emerald-500/20 space-y-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Upload Endpoint Route
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-xs font-mono">POST</span>
                    <code className="text-sm font-mono font-bold text-white">/api/camera/upload</code>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed mt-1">
                    Accepts raw binary JPEG frames (<code className="text-emerald-400">image/jpeg</code>).
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-black/40 border border-emerald-500/20 space-y-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Authentication Credentials
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-xs font-mono">HEADER</span>
                    <code className="text-xs font-mono text-gray-300">X-Camera-Key: &lt;configured_key&gt;</code>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed mt-1">
                    Also supports URL query token: <code className="text-gray-300">?token=&lt;key&gt;</code>.
                  </p>
                </div>
              </div>

              {/* Network Reachability & Deployment Guidance */}
              <div className="p-4 rounded-2xl bg-black/20 border border-black/10 dark:border-white/10 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
                    <Globe size={14} className="text-emerald-400" /> Network Reachability Architecture
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-gray-300">
                    Dual Mode Support
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
                    <span className="font-bold text-emerald-400 text-[11px]">Option A: Local Greenhouse Gateway</span>
                    <p className="text-[11px] text-gray-400">
                      Run EDENS AI server on a local Raspberry Pi or mini PC on the greenhouse Wi-Fi:
                    </p>
                    <code className="block text-[11px] font-mono text-emerald-300 bg-black/50 p-1.5 rounded">
                      http://192.168.x.x:3000/api/camera/upload
                    </code>
                  </div>
                  <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
                    <span className="font-bold text-blue-400 text-[11px]">Option B: Public Cloud Deployment</span>
                    <p className="text-[11px] text-gray-400">
                      Deploy backend to Cloud Run, Render, or VPS if camera has internet access:
                    </p>
                    <code className="block text-[11px] font-mono text-blue-300 bg-black/50 p-1.5 rounded">
                      https://your-domain.com/api/camera/upload
                    </code>
                  </div>
                </div>
              </div>

              {/* Live Intake Status & Telemetry */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={14} /> Intake Status & Metrics
                  </span>
                  <div className="flex items-center gap-3 text-xs text-gray-300">
                    <span>
                      Total Frames: <strong className="text-white font-mono">{uploadInfo?.totalUploadsReceived ?? 0}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Latest Upload: <strong className="text-white font-mono">{uploadInfo?.latestUploadTimestamp ? new Date(uploadInfo.latestUploadTimestamp).toLocaleTimeString() : 'None'}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Max Size: <strong className="text-white font-mono">{uploadInfo?.maxSizeMb ?? 10} MB</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSendSampleUpload}
                    disabled={isUploadingSample}
                    className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-9 px-4 rounded-xl text-xs cursor-pointer shadow-md"
                  >
                    <Upload size={14} className="mr-1.5" />
                    {isUploadingSample ? 'Uploading Test Frame...' : 'Test Upload Endpoint'}
                  </Button>
                </div>
              </div>

              {/* Sample Upload Test Result Banner */}
              {sampleUploadResult && (
                <div className={cn(
                  "p-3.5 rounded-2xl border text-xs font-mono transition-all",
                  sampleUploadResult.success 
                    ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                    : "bg-red-950/60 border-red-500/40 text-red-300"
                )}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold flex items-center gap-1.5">
                      {sampleUploadResult.success ? <Check size={14} /> : <AlertTriangle size={14} />}
                      {sampleUploadResult.success ? 'Upload Endpoint Test PASSED (HTTP 200)' : 'Upload Endpoint Test FAILED'}
                    </span>
                    <span className="text-[10px] opacity-75">{new Date().toLocaleTimeString()}</span>
                  </div>
                  <pre className="text-[11px] overflow-x-auto p-2 rounded bg-black/60 mt-2">
                    {JSON.stringify(sampleUploadResult.data || sampleUploadResult.error, null, 2)}
                  </pre>
                </div>
              )}

              {/* Firmware Integration Code Snippet */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    ESP32-CAM Firmware Upload Snippet (C++ / Arduino)
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopySnippet(`// ESP32-CAM HTTP POST Upload
camera_fb_t *fb = esp_camera_fb_get();
if (fb) {
  HTTPClient http;
  http.begin("http://<SERVER_IP>:3000/api/camera/upload");
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Camera-Key", "edens_camera_secret_2026");
  int httpResponseCode = http.POST(fb->buf, fb->len);
  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("Upload success: " + response);
  }
  esp_camera_fb_return(fb);
  http.end();
}`)}
                    className="h-7 px-2.5 text-xs text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                  >
                    {copiedCode ? <CheckCheck size={13} className="mr-1" /> : <Copy size={13} className="mr-1" />}
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </Button>
                </div>

                <div className="p-3.5 rounded-2xl bg-black/70 border border-white/10 font-mono text-[11px] text-gray-300 overflow-x-auto leading-relaxed">
                  <pre>{`// ESP32-CAM HTTP POST Upload
camera_fb_t *fb = esp_camera_fb_get();
if (fb) {
  HTTPClient http;
  http.begin("http://<SERVER_IP>:3000/api/camera/upload");
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Camera-Key", "edens_camera_secret_2026");
  int httpResponseCode = http.POST(fb->buf, fb->len);
  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("Upload success: " + response);
  }
  esp_camera_fb_return(fb);
  http.end();
}`}</pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Simulation Sandbox (Available in Simulation Mode) */}
          {config.mode === 'simulation' && (
            <Card className="border border-purple-500/30 bg-purple-500/5 backdrop-blur-xl rounded-3xl overflow-hidden shadow-sm">
              <CardHeader className="pb-3 border-b border-purple-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders size={18} className="text-purple-400" />
                    <CardTitle className="text-sm font-bold text-purple-300">
                      Simulation Environmental Testing Sandbox
                    </CardTitle>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold uppercase">
                    Interactive Testbed
                  </span>
                </div>
                <CardDescription className="text-xs">
                  Inject mock sensor conditions to verify automated agent reactions and hardware safety interlocks before physical deployment
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Rain Toggle */}
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-purple-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                        <CloudRain size={14} className="text-blue-400" /> Rain Sensor
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !simRain;
                          setSimRain(next);
                          hardwareService.setSimulationRain(next);
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                          simRain ? "bg-blue-500 text-white" : "bg-white/10 text-gray-400"
                        )}
                      >
                        {simRain ? 'RAINING (ACTIVE)' : 'DRY'}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {simRain ? 'Rain interlock engaged: Roof vent cannot open.' : 'Normal weather.'}
                    </p>
                  </div>

                  {/* Temp Slider */}
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-purple-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                        <Thermometer size={14} className="text-amber-400" /> Temp: {simTemp}°C
                      </span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="40"
                      value={simTemp}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSimTemp(val);
                        hardwareService.setSimulationTemperature(val);
                      }}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                    <p className="text-[10px] text-gray-400">
                      {simTemp > 35 ? '⚠️ Extreme heat: Emergency cooling triggers' : 'Healthy tropical range'}
                    </p>
                  </div>

                  {/* Water Reservoir Slider */}
                  <div className="p-3.5 rounded-2xl bg-black/40 border border-purple-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                        <Droplet size={14} className="text-emerald-400" /> Reservoir: {simWater}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={simWater}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSimWater(val);
                        hardwareService.setSimulationWaterLevel(val);
                      }}
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                    <p className="text-[10px] text-gray-400">
                      {simWater < 10 ? '🚨 Low water: Pump lockout engaged' : 'Adequate irrigation water'}
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
          <Card className="border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-[#10B981]" />
                <CardTitle className="text-sm font-bold">Live Endpoint Diagnostics</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Test communication with each supported firmware endpoint
              </CardDescription>
            </CardHeader>

            <CardContent className="p-4 space-y-3">
              {/* Full Automated Suite Button */}
              <Button
                type="button"
                onClick={handleRunFullSuite}
                disabled={isRunningSuite}
                className="w-full bg-gradient-to-r from-[#10B981] to-[#059669] hover:from-[#059669] hover:to-[#047857] text-black font-extrabold text-xs h-10 rounded-xl cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2"
              >
                {isRunningSuite ? (
                  <>
                    <RefreshCw size={15} className="animate-spin text-black" />
                    <span>Executing Hardware Handshakes...</span>
                  </>
                ) : (
                  <>
                    <Zap size={15} className="fill-black text-black" />
                    <span>Run Full Automated Diagnostic Suite</span>
                  </>
                )}
              </Button>

              {/* Suite Results Drawer */}
              {suiteResults && (
                <div className="p-3.5 rounded-2xl bg-black/40 border border-[#10B981]/30 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold">
                    <span className="text-[#10B981] flex items-center gap-1.5">
                      <CheckCircle size={14} /> Diagnostic Suite Results
                    </span>
                    <span className="text-gray-400">
                      {suiteResults.filter(r => r.pass).length}/{suiteResults.length} Passed
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin font-mono text-[10px]">
                    {suiteResults.map((r, i) => (
                      <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/5 border border-white/5">
                        <div className="flex items-center gap-2">
                          <span className={r.pass ? "text-[#10B981]" : "text-red-400"}>
                            {r.pass ? '✓' : '✗'}
                          </span>
                          <span className="font-semibold text-gray-200">{r.name}</span>
                          <span className="opacity-50 text-[9px]">({r.endpoint})</span>
                        </div>
                        <span className="opacity-60">{r.latencyMs}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] uppercase font-mono tracking-wider font-bold opacity-50 pt-1">
                Individual Endpoint Tests
              </div>

              {/* Test 1: GET /status */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /status', () => hardwareService.getStatus())}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#10B981]">GET</span>
                  <span>/status</span>
                  <span className="opacity-50 text-[10px]">— Telemetry & interlocks</span>
                </div>
                {testingEndpoint === 'GET /status' ? (
                  <RefreshCw size={13} className="animate-spin text-[#10B981]" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 2: GET /crops */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /crops', () => hardwareService.getCrops())}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-blue-400">GET</span>
                  <span>/crops</span>
                  <span className="opacity-50 text-[10px]">— Crop profiles</span>
                </div>
                {testingEndpoint === 'GET /crops' ? (
                  <RefreshCw size={13} className="animate-spin text-blue-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 3: GET /setPlant */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /setPlant?crop=tomato', () => hardwareService.setPlant('tomato'))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-400">GET</span>
                  <span>/setPlant?crop=tomato</span>
                </div>
                {testingEndpoint === 'GET /setPlant?crop=tomato' ? (
                  <RefreshCw size={13} className="animate-spin text-emerald-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 4: GET /setCustom */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /setCustom', () => hardwareService.setCustom({
                  tempMin: 21, tempMax: 29, humMin: 55, humMax: 75, soilMin: 45, soilMax: 65
                }))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-teal-400">GET</span>
                  <span>/setCustom</span>
                  <span className="opacity-50 text-[10px]">— Thresholds</span>
                </div>
                {testingEndpoint === 'GET /setCustom' ? (
                  <RefreshCw size={13} className="animate-spin text-teal-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 5: GET /roof */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /roof?state=open', () => hardwareService.setRoof('open'))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-amber-400">GET</span>
                  <span>/roof?state=open</span>
                </div>
                {testingEndpoint === 'GET /roof?state=open' ? (
                  <RefreshCw size={13} className="animate-spin text-amber-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 6: GET /override */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /override?device=fan&state=on', () => hardwareService.setOverride('fan', 'on', 10))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-orange-400">GET</span>
                  <span>/override?device=fan</span>
                </div>
                {testingEndpoint === 'GET /override?device=fan&state=on' ? (
                  <RefreshCw size={13} className="animate-spin text-orange-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 7: GET /pause */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /pause?duration=15', () => hardwareService.pauseAutonomous(15))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-indigo-400">GET</span>
                  <span>/pause?duration=15</span>
                </div>
                {testingEndpoint === 'GET /pause?duration=15' ? (
                  <RefreshCw size={13} className="animate-spin text-indigo-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 8: GET /setOption */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('GET /setOption?key=ventSpeed&value=80', () => hardwareService.setOption('ventSpeed', 80))}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-pink-400">GET</span>
                  <span>/setOption</span>
                  <span className="opacity-50 text-[10px]">— Parameter</span>
                </div>
                {testingEndpoint === 'GET /setOption?key=ventSpeed&value=80' ? (
                  <RefreshCw size={13} className="animate-spin text-pink-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test 9: Camera /capture */}
              <button
                type="button"
                disabled={testingEndpoint !== null}
                onClick={() => handleRunDiagnostic('Camera /capture', () => hardwareService.getCameraSnapshot())}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 border border-black/10 dark:border-white/10 text-xs font-mono transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-purple-400">CAM</span>
                  <span>/capture</span>
                  <span className="opacity-50 text-[10px]">— Still Frame</span>
                </div>
                {testingEndpoint === 'Camera /capture' ? (
                  <RefreshCw size={13} className="animate-spin text-purple-400" />
                ) : (
                  <Play size={12} className="opacity-50" />
                )}
              </button>

              {/* Test Result Inspector */}
              {lastTestResult && (
                <div className={cn(
                  "p-3 rounded-xl border text-[11px] font-mono mt-3 overflow-x-auto max-h-48",
                  lastTestResult.success 
                    ? "bg-[#10B981]/10 border-[#10B981]/30 text-foreground"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                )}>
                  <div className="flex items-center justify-between mb-1 font-bold">
                    <span>{lastTestResult.testName} Result:</span>
                    <span>{lastTestResult.success ? 'HTTP 200 OK' : 'FAILED'}</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-[10px] opacity-80">
                    {JSON.stringify(lastTestResult.data || lastTestResult.error, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Diagnostic Event Log Console */}
          <Card className="border border-[#D1E8D1] dark:border-[#1A2A1A] bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal size={16} className="text-gray-400" />
                  <CardTitle className="text-sm font-bold">Connection Log</CardTitle>
                </div>
                <span className="text-[10px] font-mono opacity-50">
                  {logs.length} events
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-3">
              <div className="h-64 overflow-y-auto space-y-2 font-mono text-[10px] scrollbar-thin">
                {logs.length === 0 ? (
                  <p className="text-gray-500 text-center py-6">No diagnostic events recorded yet.</p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={cn(
                        "p-2 rounded-lg border leading-tight space-y-0.5",
                        log.status === 'SUCCESS' && "bg-[#10B981]/5 border-[#10B981]/20 text-[#10B981]",
                        log.status === 'ERROR' && "bg-red-500/5 border-red-500/20 text-red-400",
                        log.status === 'WARNING' && "bg-amber-500/5 border-amber-500/20 text-amber-400",
                        log.status === 'TIMEOUT' && "bg-red-500/5 border-red-500/20 text-red-400"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{log.endpoint}</span>
                        <span className="opacity-60">{log.latencyMs}ms</span>
                      </div>
                      <div className="opacity-90">{log.message}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Hardware Engineer Checklist Box */}
          <div className="p-5 rounded-3xl bg-gradient-to-br from-[#10B981]/10 via-[#059669]/5 to-transparent border border-[#10B981]/30 space-y-3">
            <div className="flex items-center gap-2 text-[#10B981]">
              <FileText size={16} />
              <h4 className="text-xs font-bold uppercase tracking-wider">Required From Hardware Engineer</h4>
            </div>
            <ul className="text-[11px] space-y-1.5 opacity-90 text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="text-[#10B981] shrink-0 mt-0.5" />
                <span>Static IP / mDNS hostname for main ESP32 controller</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="text-[#10B981] shrink-0 mt-0.5" />
                <span>Static IP for ESP32-CAM module</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="text-[#10B981] shrink-0 mt-0.5" />
                <span>API Authorization token / Shared secret</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={13} className="text-[#10B981] shrink-0 mt-0.5" />
                <span>CORS header <code className="bg-black/10 dark:bg-white/10 px-1 rounded">Access-Control-Allow-Origin: *</code> on firmware webserver</span>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
}
