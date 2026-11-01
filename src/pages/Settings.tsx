import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Cpu,
  Download,
  FlaskConical,
  Globe,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sprout,
  Sun,
  Trash2,
  Upload,
  User,
  Wrench
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { useCameraConnection } from '../lib/cameraConnectionManager';
import { NIGERIAN_LANGUAGES } from '../lib/gemini';
import { formatExplicitDeviceState } from '../lib/greenhouseState';
import { DEFAULT_CROPS, hardwareService } from '../lib/hardwareService';
import { store, useStoreTable, useStoreValue } from '../lib/store';
import { type ThemeMode, useTheme } from '../lib/theme';
import { QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

type SettingsTab = 'general' | 'crop' | 'targets' | 'hardware' | 'diagnostics';

const TABS: { id: SettingsTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'general', label: 'General & Language', icon: User },
  { id: 'crop', label: 'Crop Preferences', icon: Sprout },
  { id: 'targets', label: 'Environmental Targets', icon: Sliders },
  { id: 'hardware', label: 'Hardware Connections', icon: Cpu },
  { id: 'diagnostics', label: 'Advanced Diagnostics', icon: Activity }
];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeGreenhouse, greenhouses, setActiveGreenhouseId, refreshSession } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const camera = useCameraConnection();

  const rawTab = searchParams.get('tab') as SettingsTab | null;
  const activeTab: SettingsTab = TABS.some((t) => t.id === rawTab) ? (rawTab as SettingsTab) : 'general';

  const setTab = (tab: SettingsTab) => {
    setSearchParams({ tab }, { replace: true });
    setSavedBanner(null);
  };

  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Store values
  const storeFarmName = String(useStoreValue('farmName', activeGreenhouse?.name || 'My Greenhouse'));
  const storeLocation = String(useStoreValue('location', activeGreenhouse?.locationLabel || ''));
  const storeLanguage = String(useStoreValue('aiLanguage', 'en'));
  const browserNotifs = useStoreValue<boolean>('browserNotifs', true) !== false;

  const storeCrop = String(useStoreValue('cropType', activeGreenhouse?.cropType || 'Tomato'));
  const storePlantingDate = String(
    useStoreValue(
      'plantingDate',
      new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    )
  );
  const storeBatchNotes = String(useStoreValue('cropBatchNotes', ''));

  const storeTempMin = Number(useStoreValue('tempMinThreshold', 20)) || 20;
  const storeTempMax = Number(useStoreValue('tempMaxThreshold', 28)) || 28;
  const storeHumMin = Number(useStoreValue('humMinThreshold', 55)) || 55;
  const storeHumMax = Number(useStoreValue('humMaxThreshold', 75)) || 75;
  const storeSoilMin = Number(useStoreValue('soilMinThreshold', 45)) || 45;
  const storeSoilMax = Number(useStoreValue('soilMaxThreshold', 65)) || 65;

  const climateAlertsOn = Boolean(useStoreValue('agent_ClimateAgent_enabled', true));
  const irrigationAlertsOn = Boolean(useStoreValue('agent_IrrigationAgent_enabled', true));
  const safetyAlertsOn = Boolean(useStoreValue('agent_AlertAgent_enabled', true));
  const harvestForecastOn = Boolean(useStoreValue('agent_HarvestAgent_enabled', true));

  // Local form state
  const [farmName, setFarmName] = useState(storeFarmName);
  const [locationLabel, setLocationLabel] = useState(storeLocation);
  const [languageId, setLanguageId] = useState(storeLanguage);

  const [hwConfig, setHwConfig] = useState(() => hardwareService.getConfig());
  const [diagLogs, setDiagLogs] = useState(() => hardwareService.getDiagnosticLogs());

  useEffect(() => {
    const unsub = hardwareService.subscribe(() => {
      setHwConfig(hardwareService.getConfig());
      setDiagLogs(hardwareService.getDiagnosticLogs());
    });
    return unsub;
  }, []);

  // Crop tab local state
  const [selectedCropId, setSelectedCropId] = useState(() => {
    const m = DEFAULT_CROPS.find(
      (c) =>
        c.id.toLowerCase() === storeCrop.toLowerCase() ||
        c.name.toLowerCase().includes(storeCrop.toLowerCase())
    );
    return m ? m.id : 'custom';
  });
  const [customCrop, setCustomCrop] = useState(storeCrop);
  const [plantingDate, setPlantingDate] = useState(storePlantingDate);
  const [batchNotes, setBatchNotes] = useState(storeBatchNotes);

  // Targets tab local state
  const [tempMin, setTempMin] = useState(storeTempMin);
  const [tempMax, setTempMax] = useState(storeTempMax);
  const [humMin, setHumMin] = useState(storeHumMin);
  const [humMax, setHumMax] = useState(storeHumMax);
  const [soilMin, setSoilMin] = useState(storeSoilMin);
  const [soilMax, setSoilMax] = useState(storeSoilMax);

  // Hardware tab state (enrolled greenhouse devices)
  const [ghDevices, setGhDevices] = useState<any[]>([]);
  const [issuedCredentials, setIssuedCredentials] = useState<Record<string, any>>({});
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  // Local LAN host settings (optional advanced technician config)
  const [localCtrlHost, setLocalCtrlHost] = useState(hwConfig.controllerHost || '');
  const [localCtrlPort, setLocalCtrlPort] = useState(hwConfig.controllerPort || 80);
  const [localCamHost, setLocalCamHost] = useState(camera.config.host || '');

  // Diagnostics tab state
  const [connCheckResult, setConnCheckResult] = useState<any | null>(null);
  const [testCamKey, setTestCamKey] = useState('');
  const [testUploadMsg, setTestUploadMsg] = useState<string | null>(null);
  const testFileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmClearLogs, setConfirmClearLogs] = useState(false);

  const activityLogTable = useStoreTable('activityLog') || {};
  const simTemp = Number(useStoreValue('temperature', 24.5) ?? 24.5);
  const simWater = Number(useStoreValue('waterLevel', 76) ?? 76);
  const simRain = Boolean(useStoreValue('rain', false));

  const loadEnrolledDevices = useCallback(async () => {
    if (!activeGreenhouse?.id) {
      setGhDevices([]);
      return;
    }
    try {
      const res = await apiFetch(`/api/greenhouses/${activeGreenhouse.id}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok) return;
      setGhDevices(Array.isArray(parsed.data.devices) ? parsed.data.devices : []);
    } catch {}
  }, [activeGreenhouse?.id]);

  useEffect(() => {
    void loadEnrolledDevices();
  }, [loadEnrolledDevices]);

  const showSaved = (msg: string) => {
    setErrorBanner(null);
    setSavedBanner(msg);
    setTimeout(() => setSavedBanner(null), 4000);
  };

  // Save General Settings
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      store.setValue('farmName', farmName.trim());
      store.setValue('location', locationLabel.trim());
      store.setValue('aiLanguage', languageId);
      if (activeGreenhouse?.id) {
        await apiFetch(`/api/greenhouses/${activeGreenhouse.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: farmName.trim(),
            locationLabel: locationLabel.trim()
          })
        });
        await refreshSession();
      }
      showSaved('General preferences saved.');
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchMode = (mode: 'proxy' | 'simulation') => {
    hardwareService.updateConfig({ mode });
    showSaved(
      mode === 'simulation'
        ? 'Practice Simulation Mode enabled. Readings are clearly labeled as simulated.'
        : 'Real Hardware Mode enabled. EDENS AI will only display genuine sensor updates.'
    );
  };

  // Save Crop Preferences
  const handleSaveCrop = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const preset = DEFAULT_CROPS.find((c) => c.id === selectedCropId);
    const cropLabel = preset ? preset.name.split(' (')[0] : customCrop.trim() || 'Tomato';
    try {
      store.setValue('cropType', cropLabel);
      store.setValue('plantingDate', plantingDate);
      store.setValue('cropBatchNotes', batchNotes);

      if (preset) {
        setTempMin(preset.tempMin);
        setTempMax(preset.tempMax);
        setHumMin(preset.humMin);
        setHumMax(preset.humMax);
        setSoilMin(preset.soilMin);
        setSoilMax(preset.soilMax);
        store.setValue('tempMinThreshold', String(preset.tempMin));
        store.setValue('tempMaxThreshold', String(preset.tempMax));
        store.setValue('humMinThreshold', String(preset.humMin));
        store.setValue('humMaxThreshold', String(preset.humMax));
        store.setValue('soilMinThreshold', String(preset.soilMin));
        store.setValue('soilMaxThreshold', String(preset.soilMax));
      }

      if (activeGreenhouse?.id) {
        await apiFetch(`/api/greenhouses/${activeGreenhouse.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ cropType: cropLabel })
        });
        await refreshSession();
      }
      showSaved(`Crop profile updated to ${cropLabel}.`);
    } finally {
      setBusy(false);
    }
  };

  // Save Environmental Targets
  const handleSaveTargets = async (e: React.FormEvent) => {
    e.preventDefault();
    store.setValue('tempMinThreshold', String(tempMin));
    store.setValue('tempMaxThreshold', String(tempMax));
    store.setValue('humMinThreshold', String(humMin));
    store.setValue('humMaxThreshold', String(humMax));
    store.setValue('soilMinThreshold', String(soilMin));
    store.setValue('soilMaxThreshold', String(soilMax));
    try {
      if (hwConfig.mode === 'simulation') {
        await hardwareService.setCustom({ tempMin, tempMax, humMin, humMax, soilMin, soilMax });
      }
    } catch {}
    showSaved('Environmental target ranges updated.');
  };

  // Hardware Credentials Management
  const handleIssueKey = async (deviceId: string) => {
    if (!activeGreenhouse?.id) return;
    setBusy(true);
    setErrorBanner(null);
    try {
      const res = await apiFetch(
        `/api/greenhouses/${activeGreenhouse.id}/devices/${deviceId}/issue-credentials`,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setErrorBanner(!parsed.ok ? parsed.message : parsed.data?.message || 'Could not issue device key.');
        return;
      }
      setIssuedCredentials((prev) => ({ ...prev, [deviceId]: parsed.data }));
      await loadEnrolledDevices();
      await refreshSession();
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeKey = async (deviceId: string) => {
    if (!activeGreenhouse?.id) return;
    setBusy(true);
    try {
      await apiFetch(`/api/greenhouses/${activeGreenhouse.id}/devices/${deviceId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setConfirmRevokeId(null);
      await loadEnrolledDevices();
      await refreshSession();
      showSaved('Device credential revoked.');
    } finally {
      setBusy(false);
    }
  };

  const downloadHeaderFile = (filename: string, content: string) => {
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

  const handleSaveLocalHosts = (e: React.FormEvent) => {
    e.preventDefault();
    hardwareService.updateConfig({
      controllerHost: localCtrlHost.trim(),
      controllerPort: Number(localCtrlPort) || 80
    });
    camera.updateConfig({
      host: localCamHost.trim()
    });
    showSaved('Local network host settings saved.');
  };

  const handleQrDetected = async (rawCodeOrUri: string) => {
    const res = await apiFetch('/api/enrollments/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrPayload: rawCodeOrUri })
    });
    const parsed = await parseApiJsonResponse<any>(res);
    if (!parsed.ok || !parsed.data?.success) {
      throw new Error(!parsed.ok ? parsed.message : parsed.data?.message || 'QR code could not be redeemed.');
    }
    const data = parsed.data;
    setScannerOpen(false);
    await refreshSession();
    if (data.greenhouse?.id) {
      setActiveGreenhouseId(data.greenhouse.id);
    }
    showSaved(`Linked greenhouse: ${data.greenhouse?.name || 'Success'}`);
  };

  // Diagnostics Actions
  const handleRunSafeConnectionCheck = async () => {
    if (!activeGreenhouse?.id) return;
    setBusy(true);
    setErrorBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${activeGreenhouse.id}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (parsed.ok && parsed.data?.success) {
        setConnCheckResult(parsed.data);
      } else {
        setErrorBanner(!parsed.ok ? parsed.message : parsed.data?.message || 'Connection check failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTestCameraUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!testCamKey.trim()) {
      setErrorBanner('Enter your X-Camera-Key before uploading a test JPEG.');
      if (testFileInputRef.current) testFileInputRef.current.value = '';
      return;
    }
    setBusy(true);
    setTestUploadMsg(null);
    setErrorBanner(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await hardwareService.uploadCameraImage(buf, testCamKey.trim());
      setTestUploadMsg(
        `Test JPEG accepted (${Math.max(1, Math.round(res.sizeBytes / 1024))} KB, ID ${res.imageId}).`
      );
      await camera.refreshNow(false);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Camera test upload failed.');
    } finally {
      setBusy(false);
      if (testFileInputRef.current) testFileInputRef.current.value = '';
    }
  };

  const handleExportActivityCsv = () => {
    const rows = Object.values(activityLogTable) as any[];
    const csvLines = [
      'timestamp,type,message',
      ...rows.map(
        (r) =>
          `"${String(r.timestamp || '').replace(/"/g, '""')}","${String(r.type || '').replace(
            /"/g,
            '""'
          )}","${String(r.message || '').replace(/"/g, '""')}"`
      )
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edens-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearActivityLog = () => {
    store.delTable('activityLog');
    setConfirmClearLogs(false);
    showSaved('Activity history cleared.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your language, crop profile, environmental alert ranges, and greenhouse hardware connections.
        </p>
      </div>

      {/* Horizontal Accessible Tab Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                isActive
                  ? 'border-primary text-primary bg-accent/50'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {savedBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-4 py-3 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>{savedBanner}</span>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200 px-4 py-3 text-xs font-medium flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* TAB 1: General & Language */}
      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveGeneral}
            className="lg:col-span-7 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5"
          >
            <div>
              <h2 className="text-base font-semibold text-foreground">Farm &amp; Language Preferences</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose how EDENS AI addresses your farm and which language the AI Assistant speaks by default.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Signed-In Farmer</label>
                <Input
                  value={`${user?.displayName || 'Farmer'} (${user?.email || ''})`}
                  disabled
                  className="h-10 bg-muted text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Globe size={13} className="text-primary" /> Preferred Language
                </label>
                <select
                  value={languageId}
                  onChange={(e) => setLanguageId(e.target.value)}
                  className="w-full h-10 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {NIGERIAN_LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.nativeName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Greenhouse / Farm Name</label>
                <Input
                  value={farmName}
                  onChange={(e) => setFarmName(e.target.value)}
                  className="h-10 bg-background text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Farm Location</label>
                <Input
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  placeholder="e.g., Kano, Ibadan, Enugu"
                  className="h-10 bg-background text-sm"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Bell size={14} className="text-primary" /> Browser Alerts
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Show desktop or phone notifications when greenhouse conditions need attention.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => store.setValue('browserNotifs', !browserNotifs)}
                className="h-9 px-3.5 text-xs font-semibold cursor-pointer"
              >
                {browserNotifs ? 'Enabled' : 'Paused'}
              </Button>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                disabled={busy}
                className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                Save Preferences
              </Button>
            </div>
          </form>

          {/* Appearance, Operating Mode & Quick Walkthrough */}
          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Appearance</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose Light Mode for bright outdoor daylight or Dark Mode for evening greenhouse checks.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'light' as ThemeMode, label: 'Light', icon: Sun },
                    { id: 'dark' as ThemeMode, label: 'Dark', icon: Moon },
                    { id: 'system' as ThemeMode, label: 'System', icon: Monitor }
                  ] as const
                ).map((option) => {
                  const Icon = option.icon;
                  const selected = themeMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setThemeMode(option.id);
                        showSaved(
                          option.id === 'system'
                            ? 'Appearance set to match your device preference.'
                            : `Switched to ${option.label} Mode.`
                        );
                      }}
                      className={cn(
                        'h-11 rounded-xl border px-3 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer',
                        selected
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                    >
                      <Icon size={15} className={selected ? 'text-primary' : 'text-muted-foreground'} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Data Mode</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose between real greenhouse hardware monitoring or clearly labeled Practice Mode.
                </p>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('proxy')}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-colors cursor-pointer',
                    hwConfig.mode !== 'simulation'
                      ? 'border-primary bg-accent/60'
                      : 'border-border bg-background hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck size={15} className="text-primary" />
                      Real Hardware Mode (Recommended)
                    </span>
                    {hwConfig.mode !== 'simulation' && (
                      <CheckCircle2 size={15} className="text-primary" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Displays only verified readings from your physical ESP32 controller and camera. Shows “Unavailable” when offline.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchMode('simulation')}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-colors cursor-pointer',
                    hwConfig.mode === 'simulation'
                      ? 'border-indigo-400 bg-indigo-50/70 dark:border-indigo-700/70 dark:bg-indigo-950/40'
                      : 'border-border bg-background hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <FlaskConical size={15} className="text-indigo-700 dark:text-indigo-300" />
                      Practice Simulation Mode
                    </span>
                    {hwConfig.mode === 'simulation' && (
                      <CheckCircle2 size={15} className="text-indigo-700 dark:text-indigo-300" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Lets you explore EDENS AI with simulated readings when you do not have physical sensors connected yet.
                  </p>
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-3">
              <h2 className="text-base font-semibold text-foreground">App Walkthrough</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                New to EDENS AI? Open the quick 5-step tour anytime to review where everything lives.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.dispatchEvent(new Event('edens-open-tour'))}
                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                <Compass size={15} className="mr-1.5 text-primary" />
                Replay Quick Tour
              </Button>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: Crop Preferences */}
      {activeTab === 'crop' && (
        <form
          onSubmit={handleSaveCrop}
          className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-6 max-w-3xl"
        >
          <div>
            <h2 className="text-base font-semibold text-foreground">Active Crop Profile</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Selecting your crop automatically updates recommended temperature, humidity, soil moisture, and harvest estimates.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEFAULT_CROPS.map((crop) => {
              const selected = selectedCropId === crop.id;
              return (
                <button
                  key={crop.id}
                  type="button"
                  onClick={() => setSelectedCropId(crop.id)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors cursor-pointer',
                    selected
                      ? 'border-primary bg-accent/60'
                      : 'border-border bg-background hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{crop.name}</span>
                    {selected && <CheckCircle2 size={15} className="text-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{crop.description}</p>
                  <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-2">
                    {crop.tempMin}–{crop.tempMax}°C · Humidity {crop.humMin}–{crop.humMax}% · Soil{' '}
                    {crop.soilMin}–{crop.soilMax}%
                  </p>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setSelectedCropId('custom')}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors cursor-pointer',
                selectedCropId === 'custom'
                  ? 'border-primary bg-accent/60'
                  : 'border-border bg-background hover:bg-muted/50'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Custom Crop</span>
                {selectedCropId === 'custom' && <CheckCircle2 size={15} className="text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Specify another vegetable, herb, or seedling crop.
              </p>
            </button>
          </div>

          {selectedCropId === 'custom' && (
            <div className="space-y-1.5 max-w-sm">
              <label className="text-xs font-medium text-foreground">Custom Crop Name</label>
              <Input
                value={customCrop}
                onChange={(e) => setCustomCrop(e.target.value)}
                placeholder="e.g., Sweet Pepper, Okra"
                className="h-10 bg-background"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Planting / Transplanting Date</label>
              <Input
                type="date"
                value={plantingDate}
                onChange={(e) => setPlantingDate(e.target.value)}
                className="h-10 font-mono tabular-nums bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Crop Batch Notes (Optional)</label>
              <Input
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                placeholder="e.g., Padma F1 hybrid seedlings, 120 stands"
                className="h-10 bg-background"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={busy}
              className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
            >
              Save Crop Profile
            </Button>
          </div>
        </form>
      )}

      {/* TAB 3: Environmental Targets & Smart Monitoring Alerts */}
      {activeTab === 'targets' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveTargets}
            className="lg:col-span-7 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5"
          >
            <div>
              <h2 className="text-base font-semibold text-foreground">Safe Environmental Ranges</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                EDENS AI compares every sensor reading against these ranges on your Home and My Greenhouse screens.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
                <p className="text-xs font-semibold text-foreground">Temperature (°C)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Min</label>
                    <Input
                      type="number"
                      value={tempMin}
                      onChange={(e) => setTempMin(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max</label>
                    <Input
                      type="number"
                      value={tempMax}
                      onChange={(e) => setTempMax(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
                <p className="text-xs font-semibold text-foreground">Air Humidity (%)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Min</label>
                    <Input
                      type="number"
                      value={humMin}
                      onChange={(e) => setHumMin(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max</label>
                    <Input
                      type="number"
                      value={humMax}
                      onChange={(e) => setHumMax(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
                <p className="text-xs font-semibold text-foreground">Soil Moisture (%)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Min</label>
                    <Input
                      type="number"
                      value={soilMin}
                      onChange={(e) => setSoilMin(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max</label>
                    <Input
                      type="number"
                      value={soilMax}
                      onChange={(e) => setSoilMax(Number(e.target.value))}
                      className="h-10 font-mono tabular-nums bg-background"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                Save Target Ranges
              </Button>
            </div>
          </form>

          {/* Simple Background Advisory Monitors */}
          <section className="lg:col-span-5 rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Automatic Monitoring Alerts</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose which background checks watch your greenhouse readings and post helpful recommendations.
              </p>
            </div>

            <div className="divide-y divide-border text-xs">
              {[
                {
                  key: 'agent_ClimateAgent_enabled',
                  label: 'Heat & Humidity Alerts',
                  desc: 'Notifies you when air gets too warm, cold, or humid.',
                  enabled: climateAlertsOn
                },
                {
                  key: 'agent_IrrigationAgent_enabled',
                  label: 'Soil Watering Reminders',
                  desc: 'Suggests watering cycles when root moisture drops low.',
                  enabled: irrigationAlertsOn
                },
                {
                  key: 'agent_AlertAgent_enabled',
                  label: 'Low Water Tank & Battery Warnings',
                  desc: 'Flags critical reservoir or 12V battery drops immediately.',
                  enabled: safetyAlertsOn
                },
                {
                  key: 'agent_HarvestAgent_enabled',
                  label: 'Harvest Timeline Updates',
                  desc: 'Updates your expected harvest window based on crop growth.',
                  enabled: harvestForecastOn
                }
              ].map((item) => (
                <div key={item.key} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.enabled ? 'default' : 'outline'}
                    onClick={() => store.setValue(item.key, !item.enabled)}
                    className={cn(
                      'h-8 px-3 text-xs font-semibold shrink-0 cursor-pointer',
                      item.enabled && 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    )}
                  >
                    {item.enabled ? 'On' : 'Off'}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: Hardware Connections */}
      {activeTab === 'hardware' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Enrolled Greenhouse Hardware
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manage your ESP32 sensor controller and ESP32-CAM credentials for internet monitoring.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScannerOpen(true)}
                  className="h-10 px-3.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <QrCode size={15} className="mr-1.5 text-primary" />
                  Scan Kit QR
                </Button>
                <Link
                  to={
                    activeGreenhouse
                      ? `/greenhouses/${activeGreenhouse.id}/setup`
                      : '/greenhouses/setup'
                  }
                  className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
                >
                  <Wrench size={14} />
                  <span>Open 6-Step Setup Guide</span>
                </Link>
              </div>
            </div>

            {greenhouses.length > 1 && (
              <div className="max-w-xs space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Selected Greenhouse
                </label>
                <select
                  value={activeGreenhouse?.id || ''}
                  onChange={(e) => setActiveGreenhouseId(e.target.value)}
                  className="w-full h-10 rounded-lg border border-input bg-background px-3 text-xs font-semibold"
                >
                  {greenhouses.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.cropType})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!activeGreenhouse ? (
              <div className="rounded-xl bg-muted/50 p-6 text-center space-y-2">
                <p className="text-sm font-semibold text-foreground">No Greenhouse Enrolled Yet</p>
                <p className="text-xs text-muted-foreground">
                  Scan your kit QR code or launch the 6-Step Setup Guide above to register your controller and camera.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ghDevices.map((dev) => {
                  const isCam = dev.deviceType === 'esp32_cam';
                  const st = formatExplicitDeviceState(dev.explicitState || dev.connectionStatus);
                  const issued = issuedCredentials[dev.id];
                  return (
                    <div
                      key={dev.id}
                      className="rounded-xl border border-border bg-muted/30 p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                            {isCam ? (
                              <Camera size={16} className="text-primary" />
                            ) : (
                              <Cpu size={16} className="text-primary" />
                            )}
                            {dev.label}
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-0.5">
                            ID: {dev.id}
                          </p>
                        </div>
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-card border border-border text-foreground">
                          {st.label}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground">{st.explanation}</p>

                      <div className="text-[11px] font-mono tabular-nums text-muted-foreground">
                        Key Prefix: {dev.keyPrefix ? `${dev.keyPrefix}••••••••` : 'Not generated yet'}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleIssueKey(dev.id)}
                          className="h-9 px-3 text-xs font-semibold cursor-pointer"
                        >
                          <KeyRound size={13} className="mr-1.5 text-primary" />
                          {dev.keyPrefix ? 'Rotate Key' : 'Generate Key'}
                        </Button>

                        {dev.keyPrefix && dev.provisioningStatus !== 'revoked' && (
                          <>
                            {confirmRevokeId === dev.id ? (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleRevokeKey(dev.id)}
                                  className="h-9 px-2.5 bg-red-600 hover:bg-red-700 text-white text-xs cursor-pointer"
                                >
                                  Confirm Revoke
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setConfirmRevokeId(null)}
                                  className="h-9 px-2.5 text-xs cursor-pointer"
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setConfirmRevokeId(dev.id)}
                                className="h-9 px-3 text-xs font-semibold text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 cursor-pointer"
                              >
                                Revoke
                              </Button>
                            )}
                          </>
                        )}
                      </div>

                      {issued && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40 p-3.5 space-y-2 text-xs">
                          <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                            One-Time Key (Shown Once — Download Header Now)
                          </p>
                          <div className="flex items-center justify-between gap-2 bg-background border border-border rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                            <span className="truncate">{issued.oneTimeDeviceKey}</span>
                            <button
                              type="button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(issued.oneTimeDeviceKey);
                                setCopiedDeviceId(dev.id);
                                setTimeout(() => setCopiedDeviceId(null), 2000);
                              }}
                              className="text-primary font-semibold shrink-0 cursor-pointer"
                            >
                              {copiedDeviceId === dev.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                          {issued.firmwareHeader && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                downloadHeaderFile(
                                  issued.firmwareHeader.filename,
                                  issued.firmwareHeader.content
                                )
                              }
                              className="w-full h-9 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                            >
                              <Download size={13} className="mr-1.5" />
                              Download {issued.firmwareHeader.filename}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Optional Local LAN Hostname Configuration */}
          <form
            onSubmit={handleSaveLocalHosts}
            className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4 max-w-3xl"
          >
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Optional Local Wi-Fi Network Addresses
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only needed if running EDENS AI on a local farm computer on the same Wi-Fi router as your ESP32 boards. Cloud internet uploads do not need local IP addresses.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Controller Hostname</label>
                <Input
                  value={localCtrlHost}
                  onChange={(e) => setLocalCtrlHost(e.target.value)}
                  placeholder="e.g., edens-esp32.local"
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Controller Port</label>
                <Input
                  type="number"
                  value={localCtrlPort}
                  onChange={(e) => setLocalCtrlPort(Number(e.target.value))}
                  className="h-10 font-mono tabular-nums text-xs bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Camera Hostname</label>
                <Input
                  value={localCamHost}
                  onChange={(e) => setLocalCamHost(e.target.value)}
                  placeholder="e.g., edens-cam.local"
                  className="h-10 font-mono text-xs bg-background"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="outline" className="h-10 px-4 text-xs font-semibold cursor-pointer">
                Save Local Network Settings
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: Advanced Diagnostics (Separated for Installers & Technicians) */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground flex items-center justify-between gap-3">
            <span>
              <strong className="text-foreground">Installer &amp; Technician Tools:</strong> Read-only connection checks, camera upload verification, and diagnostic logs. Everyday farming does not require these settings.
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Safe Read-Only Cloud Connection Check */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Safe Read-Only Connection Check
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Verifies controller &amp; camera check-ins with zero equipment actuation commands.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeGreenhouse || busy}
                  onClick={handleRunSafeConnectionCheck}
                  className="h-9 px-3.5 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  <RefreshCw size={13} className={cn('mr-1.5', busy && 'animate-spin')} />
                  Run Check
                </Button>
              </div>

              {!activeGreenhouse ? (
                <p className="text-xs text-muted-foreground">
                  Enroll a greenhouse first to run cloud hardware verification.
                </p>
              ) : connCheckResult ? (
                <div className="space-y-2">
                  {(connCheckResult.checks || []).map((c: any) => (
                    <div
                      key={c.id}
                      className="rounded-xl bg-muted/50 px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{c.label}</p>
                        <p className="text-muted-foreground mt-0.5">{c.detail}</p>
                      </div>
                      <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded border border-border bg-card shrink-0">
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Click “Run Check” to inspect current telemetry and camera upload status.
                </p>
              )}
            </section>

            {/* Camera Upload Endpoint Tester */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Camera Upload Gateway Test
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Send a test JPEG to <code className="font-mono">POST /api/camera/upload</code> using a valid one-time or active <code className="font-mono">X-Camera-Key</code>.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <Input
                  type="password"
                  autoComplete="off"
                  value={testCamKey}
                  onChange={(e) => setTestCamKey(e.target.value)}
                  placeholder="Paste X-Camera-Key (never saved)"
                  className="h-10 font-mono text-xs bg-background"
                />
                <input
                  ref={testFileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg"
                  onChange={handleTestCameraUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => testFileInputRef.current?.click()}
                  className="h-10 px-4 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  <Upload size={14} className="mr-1.5 text-primary" />
                  Send Test JPEG
                </Button>
              </div>

              {testUploadMsg && (
                <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 dark:text-emerald-200 dark:bg-emerald-950/45 dark:border-emerald-800/60 rounded-xl px-3.5 py-2">
                  {testUploadMsg}
                </p>
              )}
            </section>
          </div>

          {/* Practice Mode Sandbox (Only shown when Practice Mode is enabled) */}
          {hwConfig.mode === 'simulation' && (
            <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800/60 dark:bg-indigo-950/30 p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-indigo-950 dark:text-indigo-100 flex items-center gap-2">
                  <FlaskConical size={18} className="text-indigo-700 dark:text-indigo-300" />
                  Practice Mode Test Sliders
                </h2>
                <p className="text-xs text-indigo-900 dark:text-indigo-200/90 mt-0.5">
                  Test how EDENS AI safety locks and alerts respond to simulated rain, heat, or low tank water.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="rounded-xl bg-card p-4 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                  <div className="flex justify-between font-semibold text-foreground">
                    <span>Simulated Temperature</span>
                    <span className="font-mono tabular-nums">{simTemp.toFixed(1)}°C</span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={40}
                    step={0.5}
                    value={simTemp}
                    onChange={(e) => hardwareService.setSimulationTemperature(Number(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="rounded-xl bg-card p-4 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                  <div className="flex justify-between font-semibold text-foreground">
                    <span>Simulated Water Tank</span>
                    <span className="font-mono tabular-nums">{Math.round(simWater)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={simWater}
                    onChange={(e) => hardwareService.setSimulationWaterLevel(Number(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="rounded-xl bg-card p-4 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">Simulated Rain Sensor</p>
                    <p className="text-[11px] text-muted-foreground">Tests roof rain interlock</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={simRain ? 'default' : 'outline'}
                    onClick={() => hardwareService.setSimulationRain(!simRain)}
                    className="h-9 px-3 text-xs font-semibold cursor-pointer"
                  >
                    {simRain ? 'Raining' : 'Dry'}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Diagnostic Logs & Data Export */}
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Hardware Diagnostic Log &amp; Export
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Recent controller/camera communication events (keys are automatically redacted).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExportActivityCsv}
                  className="h-9 px-3.5 text-xs font-semibold cursor-pointer"
                >
                  <Download size={13} className="mr-1.5 text-primary" />
                  Export Activity CSV
                </Button>

                {confirmClearLogs ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleClearActivityLog}
                      className="h-9 px-3 bg-red-600 hover:bg-red-700 text-white text-xs cursor-pointer"
                    >
                      Confirm Clear
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmClearLogs(false)}
                      className="h-9 px-3 text-xs cursor-pointer"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmClearLogs(true)}
                    className="h-9 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Trash2 size={13} className="mr-1.5" />
                    Clear Activity Log
                  </Button>
                )}
              </div>
            </div>

            {diagLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">
                No hardware diagnostic events recorded in this session yet.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-xl bg-muted/40 px-4 py-2 max-h-64 overflow-y-auto text-xs font-mono tabular-nums">
                {diagLogs.slice(0, 25).map((log) => (
                  <div
                    key={log.id}
                    className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0',
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : log.status === 'WARNING'
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                        )}
                      >
                        {log.status}
                      </span>
                      <span className="text-foreground truncate">{log.message}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {log.latencyMs}ms · {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
