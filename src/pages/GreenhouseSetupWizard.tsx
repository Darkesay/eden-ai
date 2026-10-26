import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Download,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Wifi
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

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

export default function GreenhouseSetupWizard() {
  const { greenhouseId: routeGhId } = useParams<{ greenhouseId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshSession, setActiveGreenhouseId } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(routeGhId ? 2 : 1);
  const [ghId, setGhId] = useState<string | null>(routeGhId || null);

  const [name, setName] = useState('Kano Bay 1 Greenhouse');
  const [locationLabel, setLocationLabel] = useState('Northern Farm Plot A');
  const [cropType, setCropType] = useState('Tomato');

  const [wifiMethod, setWifiMethod] = useState<'guided_secrets_header' | 'softap_portal_pending'>(
    'guided_secrets_header'
  );
  const [wifiSsidHint, setWifiSsidHint] = useState('');

  const [devices, setDevices] = useState<any[]>([]);
  const [issuedMap, setIssuedMap] = useState<Record<string, IssuedCredentialBundle>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const loadGreenhouseState = useCallback(async (targetId: string) => {
    const res = await apiFetch(`/api/greenhouses/${targetId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.greenhouse) {
      setName(data.greenhouse.name);
      setLocationLabel(data.greenhouse.locationLabel);
      setCropType(data.greenhouse.cropType);
      setWifiMethod(data.greenhouse.wifiProvisioningMethod || 'guided_secrets_header');
      setWifiSsidHint(data.greenhouse.wifiSsidHint || '');
    }
    if (Array.isArray(data.devices)) {
      setDevices(data.devices);
    }
  }, []);

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
          setCropType(data.greenhouse.cropType);
          setDevices(data.devices || []);
          setInfoMsg(
            'QR enrollment token redeemed. Note: hardware is NOT connected yet — proceed through Wi-Fi & credential provisioning below.'
          );
          await refreshSession();
          setStep(2);
        } catch (err: any) {
          setErrorMsg(err?.message || 'Failed redeeming QR token.');
        } finally {
          setBusy(false);
        }
      })();
    }
  }, [searchParams, ghId, refreshSession, setActiveGreenhouseId]);

  const handleCreateOrSaveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    try {
      if (!ghId) {
        const res = await apiFetch('/api/greenhouses', {
          method: 'POST',
          body: JSON.stringify({ name, locationLabel, cropType, wifiProvisioningMethod: wifiMethod })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMsg(data.message || 'Could not create greenhouse.');
          return;
        }
        setGhId(data.greenhouse.id);
        setActiveGreenhouseId(data.greenhouse.id);
        setDevices(data.devices || []);
        await refreshSession();
      } else {
        await apiFetch(`/api/greenhouses/${ghId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, locationLabel, cropType })
        });
        await refreshSession();
      }
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStep2 = async () => {
    if (!ghId) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch(`/api/greenhouses/${ghId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          wifiProvisioningMethod: wifiMethod,
          wifiSsidHint: wifiSsidHint.trim() || null
        })
      });
      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.message || 'Failed saving Wi-Fi provisioning settings.');
        return;
      }
      await loadGreenhouseState(ghId);
      setStep(3);
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
        setErrorMsg(data.message || 'Failed to issue device credential.');
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
        setErrorMsg(data.message || 'Connection test failed.');
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
    if (step === 4 && ghId) {
      runReadOnlyConnectionTest();
      const interval = window.setInterval(() => {
        runReadOnlyConnectionTest();
      }, 10000);
      return () => window.clearInterval(interval);
    }
  }, [step, ghId, runReadOnlyConnectionTest]);

  const handleQrScan = async (rawCodeOrUri: string) => {
    const res = await apiFetch('/api/enrollments/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrPayload: rawCodeOrUri, greenhouseName: name, locationLabel, cropType })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'QR code could not be redeemed.');
    }
    setScannerOpen(false);
    setGhId(data.greenhouse.id);
    setActiveGreenhouseId(data.greenhouse.id);
    setName(data.greenhouse.name);
    setLocationLabel(data.greenhouse.locationLabel);
    setCropType(data.greenhouse.cropType);
    setDevices(data.devices || []);
    setInfoMsg(
      'QR enrollment succeeded! Hardware is still unconfigured until you complete Steps 2–4 below.'
    );
    await refreshSession();
    setStep(2);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/greenhouses')}
          className="text-xs font-medium opacity-75 hover:opacity-100 flex items-center gap-1.5"
        >
          <ArrowLeft size={15} /> Back to My Greenhouses
        </button>
        {ghId && (
          <span className="text-xs font-mono opacity-60">Greenhouse ID: {ghId}</span>
        )}
      </div>

      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Greenhouse Hardware Setup Wizard</h1>
        <p className="text-sm opacity-75 mt-1">
          Secure self-service onboarding for your ESP32-CAM crop camera and Main ESP32 controller.
        </p>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { num: 1, label: '1. Identity / QR' },
          { num: 2, label: '2. Wi-Fi Method' },
          { num: 3, label: '3. Device Keys' },
          { num: 4, label: '4. Verify Check-In' }
        ].map((item) => (
          <button
            key={item.num}
            type="button"
            disabled={item.num > 1 && !ghId}
            onClick={() => setStep(item.num as 1 | 2 | 3 | 4)}
            className={`py-2.5 px-3 rounded-xl text-xs font-semibold border text-left transition-all ${
              step === item.num
                ? 'border-[#10B981] bg-[#10B981]/15 text-[#10B981]'
                : item.num < step
                  ? 'border-[#10B981]/30 bg-[#10B981]/5 opacity-90'
                  : 'border-[#D1E8D1] dark:border-[#1A2A1A] opacity-50'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {infoMsg && (
        <div className="rounded-2xl border border-[#10B981]/40 bg-[#10B981]/10 px-4 py-3 text-xs text-[#10B981]">
          {infoMsg}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* STEP 1: QR Claim or Name Greenhouse */}
      {step === 1 && (
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <CardTitle className="text-lg">Step 1 — Claim Kit QR or Register Greenhouse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-2xl border border-[#10B981]/30 bg-[#10B981]/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="font-semibold text-sm flex items-center gap-2">
                  <QrCode size={17} className="text-[#10B981]" /> Have an EDENS AI Kit QR Sticker?
                </div>
                <p className="text-xs opacity-75">
                  Scan the one-time QR code with your phone camera to bind the kit to your account.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold shrink-0"
              >
                <QrCode size={15} className="mr-1.5" /> Scan Kit QR
              </Button>
            </div>

            <form onSubmit={handleCreateOrSaveStep1} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium opacity-80">Greenhouse Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium opacity-80">Location / Plot Label</label>
                  <Input
                    value={locationLabel}
                    onChange={(e) => setLocationLabel(e.target.value)}
                    required
                    className="bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium opacity-80">Primary Crop</label>
                  <Input
                    value={cropType}
                    onChange={(e) => setCropType(e.target.value)}
                    required
                    className="bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A]"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={busy}
                  className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
                >
                  {busy ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
                  Continue to Wi-Fi Setup <ArrowRight size={15} className="ml-1.5" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Honest Wi-Fi Provisioning Selection */}
      {step === 2 && (
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wifi size={18} className="text-[#10B981]" /> Step 2 — Greenhouse 2.4 GHz Wi-Fi Provisioning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setWifiMethod('guided_secrets_header')}
                className={`text-left rounded-2xl border p-4 space-y-2 transition-all ${
                  wifiMethod === 'guided_secrets_header'
                    ? 'border-[#10B981] bg-[#10B981]/10'
                    : 'border-[#D1E8D1] dark:border-[#1A2A1A]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">Guided Header Provisioning</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#10B981]/20 text-[#10B981]">
                    SUPPORTED NOW
                  </span>
                </div>
                <p className="text-xs opacity-75 leading-relaxed">
                  Compatible with existing `edens_cloud_upload.h` firmware. Download pre-filled `camera_secrets.h` &
                  `controller_secrets.h`, add your local 2.4 GHz Wi-Fi password offline, and flash once via USB.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setWifiMethod('softap_portal_pending')}
                className={`text-left rounded-2xl border p-4 space-y-2 transition-all ${
                  wifiMethod === 'softap_portal_pending'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-[#D1E8D1] dark:border-[#1A2A1A]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">Phone SoftAP / BLE Captive Portal</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                    PENDING_FIRMWARE_SUPPORT
                  </span>
                </div>
                <p className="text-xs opacity-75 leading-relaxed">
                  Cloud bootstrap endpoint (`POST /api/devices/bootstrap`) is ready, but current ESP32 sketches do not
                  yet host an `EDENS-SETUP-XXXX` Wi-Fi AP or NVS portal. Use Guided Header Provisioning for today&apos;s
                  physical boards.
                </p>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium opacity-80">
                2.4 GHz Greenhouse Wi-Fi SSID Label (Optional — pre-fills downloaded header; password is NEVER sent to cloud)
              </label>
              <Input
                value={wifiSsidHint}
                onChange={(e) => setWifiSsidHint(e.target.value)}
                placeholder="e.g. Greenhouse_2.4G"
                className="bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A] max-w-md"
              />
            </div>

            {wifiMethod === 'softap_portal_pending' && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-300 flex items-start gap-2.5">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <strong>Honest Hardware Capability Note:</strong> ESP32 chips only connect to 2.4 GHz Wi-Fi (not 5 GHz).
                  Until Victor flashes SoftAP/NVS portal code onto the ESP32-CAM and Main ESP32 sketches, phone-only
                  Wi-Fi entry cannot configure the boards wirelessly. Proceed to Step 3 to issue unique per-device keys.
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={handleSaveStep2}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
              >
                Continue to Device Credentials <ArrowRight size={15} className="ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Per-Device Credential Issuance */}
      {step === 3 && (
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound size={18} className="text-[#10B981]" /> Step 3 — Issue Unique Per-Device Credentials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs opacity-75">
              Each device receives its own revocable secret (`X-Camera-Key` / `X-Hardware-Key`). Only SHA-256 hashes are
              stored in SQLite; download the generated `.h` file immediately after issuing.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.map((dev) => {
                const issued = issuedMap[dev.id];
                const isCam = dev.deviceType === 'esp32_cam';

                return (
                  <div
                    key={dev.id}
                    className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm flex items-center gap-1.5">
                          {isCam ? (
                            <Camera size={15} className="text-[#14B8A6]" />
                          ) : (
                            <Cpu size={15} className="text-[#10B981]" />
                          )}
                          {dev.label}
                        </div>
                        <div className="text-[11px] font-mono opacity-65 mt-0.5">ID: {dev.id}</div>
                      </div>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/5 dark:bg-white/5">
                        {dev.provisioningStatus}
                      </span>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleIssueCredential(dev.id)}
                      className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
                    >
                      {dev.hasCredentialIssued ? 'Rotate Unique Key' : 'Issue Unique Device Key'}
                    </Button>

                    {issued && (
                      <div className="rounded-xl bg-[#060A07] border border-[#10B981]/40 p-3 space-y-2 text-xs text-[#E5E7EB]">
                        <div className="flex items-center justify-between text-[11px] text-[#10B981]">
                          <span>{issued.authHeaderName} (Shown Once)</span>
                          <button
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard.writeText(issued.oneTimeDeviceKey);
                              setCopiedId(dev.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="flex items-center gap-1 hover:underline"
                          >
                            {copiedId === dev.id ? <Check size={12} /> : <Copy size={12} />}
                            {copiedId === dev.id ? 'Copied' : 'Copy Key'}
                          </button>
                        </div>
                        <div className="font-mono text-[11px] break-all bg-black/60 p-2 rounded border border-white/10">
                          {issued.oneTimeDeviceKey}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadHeaderFile(
                              issued.firmwareHeader.filename,
                              issued.firmwareHeader.content
                            )
                          }
                          className="w-full border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981]/10 text-xs"
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

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => setStep(4)}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
              >
                Continue to Safe Connection Test <ArrowRight size={15} className="ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: Read-Only Non-Actuating Connection Test */}
      {step === 4 && (
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck size={18} className="text-[#10B981]" /> Step 4 — Read-Only Hardware Check-In Verification
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={runReadOnlyConnectionTest}
              >
                <RefreshCw size={14} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
                Re-Test Now
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-xs opacity-75">
              Zero actuator commands are ever sent during verification (`actuationCommandsSent: 0`). Your greenhouse
              turns green only after genuine authenticated uploads arrive from your ESP32 boards.
            </div>

            {connectionCheck && (
              <div className="space-y-3">
                {connectionCheck.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3.5 flex items-start gap-3"
                  >
                    {chk.status === 'PASS' ? (
                      <CheckCircle2 size={18} className="text-[#10B981] shrink-0 mt-0.5" />
                    ) : (
                      <Clock size={18} className="text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {chk.label}
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-black/5 dark:bg-white/5">
                          {chk.status}
                        </span>
                      </div>
                      <p className="text-xs opacity-75">{chk.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-3">
              <Button type="button" variant="outline" onClick={() => setStep(3)}>
                Back to Credentials
              </Button>
              <Button
                type="button"
                onClick={() => navigate(`/greenhouses/${ghId}`)}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
              >
                Open Greenhouse Dashboard <ArrowRight size={15} className="ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrScan}
      />
    </div>
  );
}
