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
import { Label } from '../components/ui/label';

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
            'QR token redeemed. The hardware is not connected yet — continue through the Wi-Fi and credential steps below.'
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
    setInfoMsg('QR scan succeeded. The hardware is still unconfigured until you finish steps 2 to 4 below.');
    await refreshSession();
    setStep(2);
  };

  const steps = [
    { num: 1, label: 'Identity & QR' },
    { num: 2, label: 'Wi-Fi method' },
    { num: 3, label: 'Device keys' },
    { num: 4, label: 'Verify check-in' }
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button
        type="button"
        onClick={() => navigate('/greenhouses')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={13} aria-hidden="true" /> All greenhouses
      </button>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Greenhouse setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Claim the kit, choose how it joins Wi-Fi, issue each device its own key, then verify
            the first authenticated check-in.
          </p>
        </div>
        {ghId && (
          <span className="font-mono tabular text-xs text-muted-foreground">ID {ghId}</span>
        )}
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((item) => {
          const isActive = step === item.num;
          const isDone = item.num < step;
          return (
            <button
              key={item.num}
              type="button"
              disabled={item.num > 1 && !ghId}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => setStep(item.num as 1 | 2 | 3 | 4)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                isActive
                  ? 'border-brand/40 bg-accent text-accent-foreground'
                  : isDone
                    ? 'border-border text-foreground hover:bg-muted/50'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
              } ${item.num > 1 && !ghId ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {isDone ? (
                <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
              ) : (
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    isActive ? 'border-brand/40 bg-background text-brand' : 'border-border'
                  }`}
                  aria-hidden="true"
                >
                  {item.num}
                </span>
              )}
              {item.label}
            </button>
          );
        })}
      </div>

      {infoMsg && (
        <div
          role="status"
          className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          {infoMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {errorMsg}
        </div>
      )}

      {/* STEP 1: QR claim or register greenhouse */}
      {step === 1 && (
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
              <QrCode size={16} className="text-muted-foreground" aria-hidden="true" />
              Claim a kit or register a greenhouse
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <QrCode size={16} className="text-muted-foreground" aria-hidden="true" />
                  Have a kit QR sticker?
                </div>
                <p className="text-xs text-muted-foreground">
                  Scan the one-time code with your phone camera to bind the kit to your account.
                </p>
              </div>
              <Button type="button" onClick={() => setScannerOpen(true)} className="shrink-0">
                <QrCode size={15} aria-hidden="true" /> Scan kit QR
              </Button>
            </div>

            <form onSubmit={handleCreateOrSaveStep1} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gh-name">Greenhouse name</Label>
                  <Input
                    id="gh-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gh-location">Location or plot label</Label>
                  <Input
                    id="gh-location"
                    value={locationLabel}
                    onChange={(e) => setLocationLabel(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gh-crop">Primary crop</Label>
                  <Input
                    id="gh-crop"
                    value={cropType}
                    onChange={(e) => setCropType(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                  Continue to Wi-Fi setup <ArrowRight size={15} aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Wi-Fi provisioning selection */}
      {step === 2 && (
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
              <Wifi size={16} className="text-muted-foreground" aria-hidden="true" />
              Wi-Fi provisioning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setWifiMethod('guided_secrets_header')}
                aria-pressed={wifiMethod === 'guided_secrets_header'}
                className={`space-y-2 rounded-lg border p-4 text-left transition-colors ${
                  wifiMethod === 'guided_secrets_header'
                    ? 'border-brand/40 bg-accent text-accent-foreground'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Guided header files</span>
                  <span className="rounded-md bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    Available now
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Works with the existing edens_cloud_upload.h firmware. Download pre-filled
                  camera_secrets.h and controller_secrets.h, add your local 2.4 GHz Wi-Fi password
                  offline, then flash once over USB.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setWifiMethod('softap_portal_pending')}
                aria-pressed={wifiMethod === 'softap_portal_pending'}
                className={`space-y-2 rounded-lg border p-4 text-left transition-colors ${
                  wifiMethod === 'softap_portal_pending'
                    ? 'border-brand/40 bg-accent text-accent-foreground'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Phone hotspot portal</span>
                  <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    Not yet on firmware
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The cloud bootstrap endpoint is ready, but current ESP32 sketches do not yet host
                  a setup access point or on-device portal. Use guided header files for today&apos;s
                  boards.
                </p>
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wifi-ssid">
                2.4 GHz Wi-Fi network name
                <span className="font-normal text-muted-foreground"> (optional)</span>
              </Label>
              <Input
                id="wifi-ssid"
                value={wifiSsidHint}
                onChange={(e) => setWifiSsidHint(e.target.value)}
                placeholder="e.g. Greenhouse_2.4G"
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                Pre-fills the downloaded header files. Your password is never sent to the cloud.
              </p>
            </div>

            {wifiMethod === 'softap_portal_pending' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-4 text-xs leading-relaxed text-warning">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <span className="font-semibold">Hardware note:</span> ESP32 boards only connect
                  to 2.4 GHz Wi-Fi, not 5 GHz. Until the setup-portal firmware is flashed onto the
                  camera and controller, phone-only Wi-Fi entry cannot configure them wirelessly.
                  Continue to step 3 to issue unique per-device keys.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft size={15} aria-hidden="true" /> Back
              </Button>
              <Button type="button" disabled={busy} onClick={handleSaveStep2}>
                Continue to device keys <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Per-device credential issuance */}
      {step === 3 && (
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
              <KeyRound size={16} className="text-muted-foreground" aria-hidden="true" />
              Device keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <p className="text-xs text-muted-foreground">
              Each device gets its own revocable key, sent as the X-Camera-Key or X-Hardware-Key
              header. Only SHA-256 hashes are stored. Download the generated .h file right after
              issuing — the key is shown once.
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {devices.map((dev) => {
                const issued = issuedMap[dev.id];
                const isCam = dev.deviceType === 'esp32_cam';

                return (
                  <div key={dev.id} className="space-y-3 rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold">
                          {isCam ? (
                            <Camera size={15} className="text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <Cpu size={15} className="text-muted-foreground" aria-hidden="true" />
                          )}
                          {dev.label}
                        </div>
                        <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                          ID {dev.id}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                        {dev.provisioningStatus}
                      </span>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleIssueCredential(dev.id)}
                      className="w-full"
                    >
                      {dev.hasCredentialIssued ? 'Rotate device key' : 'Issue device key'}
                    </Button>

                    {issued && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-muted-foreground">
                            {issued.authHeaderName} — shown once
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={async () => {
                              await navigator.clipboard.writeText(issued.oneTimeDeviceKey);
                              setCopiedId(dev.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="shrink-0"
                            aria-label="Copy device key"
                            title="Copy device key"
                          >
                            {copiedId === dev.id ? (
                              <Check size={12} aria-hidden="true" />
                            ) : (
                              <Copy size={12} aria-hidden="true" />
                            )}
                            {copiedId === dev.id ? 'Copied' : 'Copy key'}
                          </Button>
                        </div>
                        <div className="break-all rounded-lg border border-border bg-background p-2 font-mono text-[11px]">
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
                          className="w-full"
                        >
                          <Download size={13} aria-hidden="true" />
                          Download {issued.firmwareHeader.filename}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft size={15} aria-hidden="true" /> Back
              </Button>
              <Button type="button" onClick={() => setStep(4)}>
                Continue to verification <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: Read-only connection test */}
      {step === 4 && (
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck size={16} className="text-muted-foreground" aria-hidden="true" />
                Check-in verification
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={runReadOnlyConnectionTest}
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                Retry connection
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Verification sends no actuator commands. Your greenhouse only shows as online once
              genuine, authenticated uploads arrive from your own ESP32 boards.
            </p>

            {connectionCheck && (
              <div className="space-y-2">
                {connectionCheck.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className="flex items-start gap-3 rounded-lg border border-border p-3.5"
                  >
                    {chk.status === 'PASS' ? (
                      <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <Clock size={17} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {chk.label}
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                            chk.status === 'PASS'
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning'
                          }`}
                        >
                          {chk.status === 'PASS' ? 'Passed' : 'Waiting'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{chk.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-3">
              <Button type="button" variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft size={15} aria-hidden="true" /> Back to keys
              </Button>
              <Button type="button" onClick={() => navigate(`/greenhouses/${ghId}`)}>
                Open dashboard <ArrowRight size={15} aria-hidden="true" />
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
