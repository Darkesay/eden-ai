import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Download,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Wifi
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { DEFAULT_CROPS } from '../lib/hardwareService';
import { store } from '../lib/store';
import { QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

interface IssuedCredentialBundle {
  deviceId: string;
  oneTimeDeviceKey: string;
  authHeaderName: string;
  uploadEndpoint: string;
  firmwareHeader: {
    filename: string;
    content: string;
  };
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS: { step: WizardStep; title: string }[] = [
  { step: 1, title: 'Create Greenhouse' },
  { step: 2, title: 'Select Crop' },
  { step: 3, title: 'Connect Hardware' },
  { step: 4, title: 'Review Targets' },
  { step: 5, title: 'Connection Check' },
  { step: 6, title: 'Start Monitoring' }
];

export default function GreenhouseSetupWizard() {
  const { greenhouseId: routeGhId } = useParams<{ greenhouseId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshSession, setActiveGreenhouseId } = useAuth();

  const [step, setStep] = useState<WizardStep>(routeGhId ? 2 : 1);
  const [ghId, setGhId] = useState<string | null>(routeGhId || null);

  // Step 1 & 2 state
  const [name, setName] = useState('Main Farm Greenhouse');
  const [locationLabel, setLocationLabel] = useState('Plot A');
  const [selectedCropId, setSelectedCropId] = useState('tomato');
  const [customCropName, setCustomCropName] = useState('');

  // Step 3 (Hardware & Technician Area)
  const [showTechArea, setShowTechArea] = useState(false);
  const [wifiMethod, setWifiMethod] = useState<'guided_secrets_header' | 'softap_portal_pending'>(
    'guided_secrets_header'
  );
  const [wifiSsidHint, setWifiSsidHint] = useState('');
  const [devices, setDevices] = useState<any[]>([]);
  const [issuedMap, setIssuedMap] = useState<Record<string, IssuedCredentialBundle>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Step 4 (Targets & Incoming Readings)
  const [tempMin, setTempMin] = useState(20);
  const [tempMax, setTempMax] = useState(28);
  const [humMin, setHumMin] = useState(55);
  const [humMax, setHumMax] = useState(75);
  const [soilMin, setSoilMin] = useState(45);
  const [soilMax, setSoilMax] = useState(65);
  const [latestTelemetry, setLatestTelemetry] = useState<any | null>(null);

  // Step 5 (Connection Check)
  const [connectionCheck, setConnectionCheck] = useState<{
    allHardwareVerifiedOnline: boolean;
    actuationCommandsSent: number;
    checkedAt: string;
    checks: { id: string; label: string; status: string; detail: string }[];
  } | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const applyCropPreset = useCallback((cropId: string) => {
    setSelectedCropId(cropId);
    const preset = DEFAULT_CROPS.find((c) => c.id === cropId);
    if (preset) {
      setTempMin(preset.tempMin);
      setTempMax(preset.tempMax);
      setHumMin(preset.humMin);
      setHumMax(preset.humMax);
      setSoilMin(preset.soilMin);
      setSoilMax(preset.soilMax);
    }
  }, []);

  const loadGreenhouseState = useCallback(
    async (targetId: string) => {
      const res = await apiFetch(`/api/greenhouses/${targetId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.greenhouse) {
        setName(data.greenhouse.name);
        setLocationLabel(data.greenhouse.locationLabel);
        const rawCrop = String(data.greenhouse.cropType || 'Tomato');
        const matched = DEFAULT_CROPS.find(
          (c) =>
            c.id.toLowerCase() === rawCrop.toLowerCase() ||
            c.name.toLowerCase().includes(rawCrop.toLowerCase())
        );
        if (matched) {
          applyCropPreset(matched.id);
        } else {
          setSelectedCropId('custom');
          setCustomCropName(rawCrop);
        }
        setWifiMethod(data.greenhouse.wifiProvisioningMethod || 'guided_secrets_header');
        setWifiSsidHint(data.greenhouse.wifiSsidHint || '');
      }
      if (Array.isArray(data.devices)) {
        setDevices(data.devices);
      }
      if (data.latestTelemetry) {
        setLatestTelemetry(data.latestTelemetry);
      }
    },
    [applyCropPreset]
  );

  useEffect(() => {
    if (ghId) {
      loadGreenhouseState(ghId);
    }
  }, [ghId, loadGreenhouseState]);

  // Handle ?code=enr_... QR URL automatic redemption
  useEffect(() => {
    const qrCodeParam = searchParams.get('code');
    if (qrCodeParam && !ghId) {
      (async () => {
        setBusy(true);
        setErrorMsg('');
        try {
          const res = await apiFetch('/api/enrollments/redeem', {
            method: 'POST',
            body: JSON.stringify({ code: qrCodeParam })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            setErrorMsg(data.message || 'QR enrollment code could not be redeemed.');
            return;
          }
          setGhId(data.greenhouse.id);
          setActiveGreenhouseId(data.greenhouse.id);
          setName(data.greenhouse.name);
          setLocationLabel(data.greenhouse.locationLabel);
          setDevices(data.devices || []);
          setInfoMsg(
            'Kit QR code linked to your account. Continue below to select your crop and connect hardware.'
          );
          await refreshSession();
          setStep(2);
        } catch (err: any) {
          setErrorMsg(err?.message || 'Failed redeeming QR code.');
        } finally {
          setBusy(false);
        }
      })();
    }
  }, [searchParams, ghId, refreshSession, setActiveGreenhouseId]);

  const resolvedCropName =
    selectedCropId === 'custom'
      ? customCropName.trim() || 'Custom Crop'
      : DEFAULT_CROPS.find((c) => c.id === selectedCropId)?.name.split(' (')[0] || 'Tomato';

  // Step 1: Create or Save Greenhouse Name & Location
  const handleSaveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    try {
      if (!ghId) {
        const res = await apiFetch('/api/greenhouses', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            locationLabel: locationLabel.trim(),
            cropType: resolvedCropName,
            wifiProvisioningMethod: wifiMethod
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMsg(data.message || 'Could not create greenhouse.');
          return;
        }
        setGhId(data.greenhouse.id);
        setActiveGreenhouseId(data.greenhouse.id);
        setDevices(data.devices || []);
      } else {
        await apiFetch(`/api/greenhouses/${ghId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), locationLabel: locationLabel.trim() })
        });
      }
      store.setValue('farmName', name.trim());
      store.setValue('location', locationLabel.trim());
      await refreshSession();
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  // Step 2: Save Crop Selection
  const handleSaveStep2 = async () => {
    if (!ghId) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch(`/api/greenhouses/${ghId}`, {
        method: 'PATCH',
        body: JSON.stringify({ cropType: resolvedCropName })
      });
      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.message || 'Could not save crop choice.');
        return;
      }
      store.setValue('cropType', resolvedCropName);
      await refreshSession();
      setStep(3);
    } finally {
      setBusy(false);
    }
  };

  // Step 3: Save Wi-Fi hint & continue
  const handleSaveStep3 = async () => {
    if (!ghId) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await apiFetch(`/api/greenhouses/${ghId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          wifiProvisioningMethod: wifiMethod,
          wifiSsidHint: wifiSsidHint.trim() || null
        })
      });
      await loadGreenhouseState(ghId);
      setStep(4);
    } finally {
      setBusy(false);
    }
  };

  const handleIssueCredential = async (deviceId: string) => {
    if (!ghId) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch(`/api/greenhouses/${ghId}/devices/${deviceId}/issue-credentials`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Could not generate device key.');
        return;
      }
      setIssuedMap((prev) => ({
        ...prev,
        [deviceId]: {
          deviceId,
          oneTimeDeviceKey: data.oneTimeDeviceKey,
          authHeaderName: data.authHeaderName,
          uploadEndpoint: data.uploadEndpoint,
          firmwareHeader: data.firmwareHeader
        }
      }));
      await loadGreenhouseState(ghId);
      await refreshSession();
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

  // Step 4: Save Environmental Targets
  const handleSaveStep4 = () => {
    store.setValue('tempMinThreshold', String(tempMin));
    store.setValue('tempMaxThreshold', String(tempMax));
    store.setValue('humMinThreshold', String(humMin));
    store.setValue('humMaxThreshold', String(humMax));
    store.setValue('soilMinThreshold', String(soilMin));
    store.setValue('soilMaxThreshold', String(soilMax));
    setStep(5);
  };

  // Step 5: Safe Read-Only Connection Check
  const runReadOnlyConnectionTest = useCallback(async () => {
    if (!ghId) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch(`/api/greenhouses/${ghId}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Connection check could not run.');
        return;
      }
      setConnectionCheck(data);
      await loadGreenhouseState(ghId);
      await refreshSession();
    } finally {
      setBusy(false);
    }
  }, [ghId, loadGreenhouseState, refreshSession]);

  useEffect(() => {
    if (step === 5 && ghId) {
      runReadOnlyConnectionTest();
      const interval = window.setInterval(() => {
        runReadOnlyConnectionTest();
      }, 10000);
      return () => window.clearInterval(interval);
    }
  }, [step, ghId, runReadOnlyConnectionTest]);

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const handleQrDetected = async (rawCodeOrUri: string) => {
    setErrorMsg('');
    const res = await apiFetch('/api/enrollments/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrPayload: rawCodeOrUri })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Invalid or expired QR code.');
    }
    setScannerOpen(false);
    setGhId(data.greenhouse.id);
    setActiveGreenhouseId(data.greenhouse.id);
    setName(data.greenhouse.name);
    setLocationLabel(data.greenhouse.locationLabel);
    setDevices(data.devices || []);
    setInfoMsg('Kit QR verified. Select your crop below to continue.');
    await refreshSession();
    setStep(2);
  };

  const readings =
    latestTelemetry?.dataSource !== 'DISCONNECTED' ? latestTelemetry?.readings || null : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/greenhouses')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-1 cursor-pointer"
          >
            <ArrowLeft size={14} /> Back to My Greenhouse
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Greenhouse Setup Guide
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step {step} of 6 — {STEP_LABELS[step - 1].title}
          </p>
        </div>
      </div>

      {/* Clean 6-Step Progress Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {STEP_LABELS.map((item) => {
          const active = step === item.step;
          const completed = step > item.step && Boolean(ghId);
          const canJump = Boolean(ghId) || item.step === 1;
          return (
            <button
              key={item.step}
              type="button"
              disabled={!canJump}
              onClick={() => canJump && setStep(item.step)}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'border-primary bg-accent text-foreground'
                  : completed
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 cursor-pointer'
                    : 'border-border bg-card text-muted-foreground',
                canJump && !active && 'hover:bg-muted/60 cursor-pointer'
              )}
            >
              <div className="text-[11px] font-mono tabular-nums font-semibold flex items-center justify-between">
                <span>Step {item.step}</span>
                {completed && <Check size={12} className="text-primary" />}
              </div>
              <div className="text-xs font-medium truncate mt-0.5">{item.title}</div>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0 text-red-700" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {infoMsg}
        </div>
      )}

      {/* STEP 1: Create Greenhouse */}
      {step === 1 && (
        <section className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">1. Name Your Greenhouse</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Have an EDENS AI hardware kit box? Scan its QR sticker first, or type a name below.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setScannerOpen(true)}
              className="h-10 px-3.5 text-xs font-semibold shrink-0 cursor-pointer"
            >
              <QrCode size={15} className="mr-1.5 text-primary" />
              Scan Kit QR
            </Button>
          </div>

          <form onSubmit={handleSaveStep1} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Greenhouse Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Kano Plot 1 Greenhouse"
                  required
                  className="h-11 bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Farm Location</label>
                <Input
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  placeholder="e.g., Zaria Road Farm"
                  className="h-11 bg-background"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={busy || !name.trim()}
                className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
              >
                {busy ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                Continue to Crop Selection
                <ArrowRight size={16} className="ml-2" />
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* STEP 2: Select Crop */}
      {step === 2 && (
        <section className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">2. What Crop Are You Growing?</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              EDENS AI sets recommended temperature, humidity, and soil moisture targets for your crop.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEFAULT_CROPS.map((crop) => {
              const selected = selectedCropId === crop.id;
              return (
                <button
                  key={crop.id}
                  type="button"
                  onClick={() => applyCropPreset(crop.id)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors cursor-pointer',
                    selected
                      ? 'border-primary bg-accent/70'
                      : 'border-border bg-background hover:bg-muted/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Sprout size={15} className="text-primary shrink-0" />
                      {crop.name}
                    </span>
                    {selected && <CheckCircle2 size={16} className="text-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {crop.description}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-2">
                    Ideal: {crop.tempMin}–{crop.tempMax}°C · Soil {crop.soilMin}–{crop.soilMax}% · ~
                    {crop.daysToHarvest} days
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
                  ? 'border-primary bg-accent/70'
                  : 'border-border bg-background hover:bg-muted/60'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Other / Custom Crop</span>
                {selectedCropId === 'custom' && <CheckCircle2 size={16} className="text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Enter any vegetable, fruit, or seedling variety and customize targets in Step 4.
              </p>
            </button>
          </div>

          {selectedCropId === 'custom' && (
            <div className="space-y-1.5 max-w-sm">
              <label className="text-sm font-medium text-foreground">Custom Crop Name</label>
              <Input
                value={customCropName}
                onChange={(e) => setCustomCropName(e.target.value)}
                placeholder="e.g., Bell Pepper, Okra, Scent Leaf"
                className="h-11 bg-background"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-10 cursor-pointer">
              Back
            </Button>
            <Button
              type="button"
              disabled={busy || (selectedCropId === 'custom' && !customCropName.trim())}
              onClick={handleSaveStep2}
              className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              {busy ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Save Crop &amp; Continue
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </section>
      )}

      {/* STEP 3: Connect Controller & Camera */}
      {step === 3 && (
        <section className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">3. Connect Controller &amp; Camera</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Follow this simple checklist to bring your greenhouse sensors and plant camera online.
            </p>
          </div>

          {/* Simple Farmer Hardware Checklist */}
          <div className="rounded-xl bg-muted/50 p-5 space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <div>
                <p className="font-semibold text-foreground">Use 2.4 GHz Wi-Fi or Hotspot</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ESP32 greenhouse controllers and cameras connect to 2.4 GHz Wi-Fi networks (not 5 GHz-only bands).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p className="font-semibold text-foreground">Plug In Stable 5V Power</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect the main sensor box and ESP32-CAM to their 5V power supply inside the greenhouse weatherproof enclosure.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p className="font-semibold text-foreground">Pre-Configured Kit vs Technician Flash</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  If an installer already flashed your boards, simply power them on. If a technician is flashing new boards now, open the Advanced Technician Area below to download the `.h` credential files.
                </p>
              </div>
            </div>
          </div>

          {/* Collapsible Advanced Technician Area */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTechArea((prev) => !prev)}
              className="w-full px-4 py-3.5 bg-muted/30 hover:bg-muted/60 flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div>
                <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                  <KeyRound size={14} className="text-primary" />
                  Advanced Technician Area (Device Keys &amp; Firmware Headers)
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Generate one-time X-Hardware-Key / X-Camera-Key credentials and download Arduino `.h` files.
                </p>
              </div>
              {showTechArea ? (
                <ChevronUp size={16} className="text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown size={16} className="text-muted-foreground shrink-0" />
              )}
            </button>

            {showTechArea && (
              <div className="p-4 border-t border-border space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Wifi size={13} className="text-primary" />
                    2.4 GHz Wi-Fi Network Name (Optional label for firmware header)
                  </label>
                  <Input
                    value={wifiSsidHint}
                    onChange={(e) => setWifiSsidHint(e.target.value)}
                    placeholder="e.g., Farm_Router_2.4G"
                    className="h-10 bg-background text-xs max-w-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Your Wi-Fi password is never entered into or stored by EDENS AI.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {devices.map((device) => {
                    const isCamera = device.deviceType === 'esp32_cam';
                    const issued = issuedMap[device.id];
                    return (
                      <div key={device.id} className="rounded-xl bg-muted/40 p-4 space-y-3 border border-border">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              {isCamera ? (
                                <Camera size={14} className="text-primary" />
                              ) : (
                                <Cpu size={14} className="text-primary" />
                              )}
                              {device.label}
                            </p>
                            <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-0.5">
                              {device.id}
                            </p>
                          </div>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-card border border-border font-medium text-muted-foreground">
                            {device.keyPrefix ? 'Key Issued' : 'Needs Key'}
                          </span>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleIssueCredential(device.id)}
                          className="w-full h-9 text-xs font-semibold cursor-pointer"
                        >
                          <KeyRound size={13} className="mr-1.5 text-primary" />
                          {device.keyPrefix ? 'Rotate Device Key' : 'Generate Unique Key'}
                        </Button>

                        {issued && (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-2 text-xs">
                            <p className="font-semibold text-emerald-950 flex items-center gap-1">
                              <ShieldCheck size={13} className="text-emerald-700" />
                              One-Time Key (Save Now)
                            </p>
                            <div className="flex items-center justify-between gap-2 bg-white border border-border rounded px-2.5 py-1.5 font-mono text-[11px]">
                              <span className="truncate">{issued.oneTimeDeviceKey}</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(device.id, issued.oneTimeDeviceKey)}
                                className="text-primary font-semibold shrink-0 cursor-pointer"
                              >
                                {copiedId === device.id ? 'Copied' : <Copy size={13} />}
                              </button>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                downloadHeaderFile(
                                  issued.firmwareHeader.filename,
                                  issued.firmwareHeader.content
                                )
                              }
                              className="w-full h-8 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                            >
                              <Download size={13} className="mr-1.5" />
                              Download {issued.firmwareHeader.filename}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)} className="h-10 cursor-pointer">
              Back
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={handleSaveStep3}
              className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              Continue to Sensor Targets
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </section>
      )}

      {/* STEP 4: Review Sensor Readings & Targets */}
      {step === 4 && (
        <section className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              4. Review Readings &amp; Safe Ranges for {resolvedCropName}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              EDENS AI alerts you whenever greenhouse conditions drift outside these ranges.
            </p>
          </div>

          {/* Current Incoming Readings Preview */}
          <div className="rounded-xl bg-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">Current Incoming Hardware Readings</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {readings ? 'Verified reading received' : 'Waiting for first controller upload'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-1 text-xs">
              <div>
                <span className="text-muted-foreground">Temperature:</span>{' '}
                <strong className="font-mono tabular-nums">
                  {readings?.temperature !== null && readings?.temperature !== undefined
                    ? `${readings.temperature.toFixed(1)}°C`
                    : 'Unavailable'}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground">Humidity:</span>{' '}
                <strong className="font-mono tabular-nums">
                  {readings?.humidity !== null && readings?.humidity !== undefined
                    ? `${Math.round(readings.humidity)}%`
                    : 'Unavailable'}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground">Soil Moisture:</span>{' '}
                <strong className="font-mono tabular-nums">
                  {readings?.soilMoisture !== null && readings?.soilMoisture !== undefined
                    ? `${Math.round(readings.soilMoisture)}%`
                    : 'Unavailable'}
                </strong>
              </div>
            </div>
          </div>

          {/* Editable Target Ranges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Temperature (°C)</p>
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

            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Air Humidity (%)</p>
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

            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Soil Moisture (%)</p>
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

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(3)} className="h-10 cursor-pointer">
              Back
            </Button>
            <Button
              type="button"
              onClick={handleSaveStep4}
              className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              Save Targets &amp; Check Connection
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </section>
      )}

      {/* STEP 5: Safe Read-Only Connection Check */}
      {step === 5 && (
        <section className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">5. Safe Connection Check</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Checks your controller and camera status without turning on any pumps, fans, or roof motors.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={runReadOnlyConnectionTest}
              className="h-10 px-3.5 text-xs font-semibold shrink-0 cursor-pointer"
            >
              <RefreshCw size={14} className={cn('mr-1.5', busy && 'animate-spin')} />
              Re-Check Now
            </Button>
          </div>

          {connectionCheck ? (
            <div className="space-y-4">
              <div
                className={cn(
                  'rounded-xl border p-4 text-sm flex items-start gap-3',
                  connectionCheck.allHardwareVerifiedOnline
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-amber-200 bg-amber-50 text-amber-950'
                )}
              >
                {connectionCheck.allHardwareVerifiedOnline ? (
                  <CheckCircle2 size={18} className="text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <Clock size={18} className="text-amber-700 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">
                    {connectionCheck.allHardwareVerifiedOnline
                      ? 'Controller and plant camera are both online!'
                      : 'Greenhouse saved — waiting for hardware check-in'}
                  </p>
                  <p className="text-xs opacity-90 mt-0.5">
                    {connectionCheck.allHardwareVerifiedOnline
                      ? 'Verified live readings and camera snapshots are reaching EDENS AI.'
                      : 'You can continue to your dashboard now. Readings will appear automatically as soon as your ESP32 boards connect to Wi-Fi.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {connectionCheck.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className="rounded-xl bg-muted/50 px-4 py-3 flex items-start justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-foreground">{chk.label}</p>
                      <p className="text-muted-foreground mt-0.5">{chk.detail}</p>
                    </div>
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-md font-semibold border shrink-0',
                        chk.status === 'PASS'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : chk.status === 'WAITING'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-red-50 text-red-800 border-red-200'
                      )}
                    >
                      {chk.status === 'PASS' ? 'Ready' : chk.status === 'WAITING' ? 'Waiting' : 'Check'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={18} className="animate-spin text-primary" />
              <span>Checking hardware connection...</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(4)} className="h-10 cursor-pointer">
              Back
            </Button>
            <Button
              type="button"
              onClick={() => setStep(6)}
              className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              Continue to Finish
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </section>
      )}

      {/* STEP 6: Start Monitoring */}
      {step === 6 && (
        <section className="rounded-2xl border border-border bg-card p-8 text-center shadow-xs space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-primary flex items-center justify-center mx-auto">
            <CheckCircle2 size={24} />
          </div>

          <div className="space-y-1.5 max-w-lg mx-auto">
            <h2 className="text-xl font-bold text-foreground">{name} Is Ready to Monitor</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your greenhouse profile for <strong className="text-foreground">{resolvedCropName}</strong> is saved with safe temperature ({tempMin}–{tempMax}°C), humidity ({humMin}–{humMax}%), and soil moisture ({soilMin}–{soilMax}%) targets.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/')}
              className="h-11 px-5 rounded-xl font-semibold cursor-pointer"
            >
              Go to Home Overview
            </Button>
            <Button
              type="button"
              onClick={() => navigate(ghId ? `/greenhouses/${ghId}` : '/greenhouses')}
              className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              Open My Greenhouse
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </section>
      )}

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
