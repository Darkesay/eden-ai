import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  Cpu,
  Droplets,
  Loader2,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Wrench
} from 'lucide-react';
import { apiFetch, type GreenhouseSummary, useAuth } from '../lib/auth';
import { QrCodeCard, QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';

function overallStatusBadge(status: GreenhouseSummary['overallStatus']) {
  switch (status) {
    case 'ONLINE':
      return { label: 'Online', cls: 'bg-success/10 text-success' };
    case 'PARTIAL':
      return { label: 'Partial check-in', cls: 'bg-info/10 text-info' };
    case 'STALE':
      return { label: 'Stale signal', cls: 'bg-warning/10 text-warning' };
    case 'SETUP_INCOMPLETE':
      return { label: 'Setup needed', cls: 'bg-muted text-muted-foreground' };
    default:
      return { label: 'Offline', cls: 'bg-destructive/10 text-destructive' };
  }
}

function DeviceStatus({ label, icon: Icon, status, detail }: {
  label: string;
  icon: React.ElementType;
  status: string;
  detail: string;
}) {
  const statusCls =
    status === 'CONNECTED' ? 'text-success' : status === 'STALE' ? 'text-warning' : 'text-muted-foreground';
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon size={13} aria-hidden="true" /> {label}
        </span>
        <span className={`text-xs font-medium ${statusCls}`}>{status.toLowerCase()}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Greenhouses() {
  const { greenhouses, refreshSession, setActiveGreenhouseId } = useAuth();
  const navigate = useNavigate();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showKitGenerator, setShowKitGenerator] = useState(false);
  const [kitSerial, setKitSerial] = useState('EDENS-NG-KIT-01');
  const [generatedKitQr, setGeneratedKitQr] = useState<{
    qrDataUrl: string;
    enrollmentCode: string;
    expiresAt: string;
    kitSerial: string;
  } | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refreshSession();
    setRefreshing(false);
  };

  const handleQrDetected = async (rawCodeOrUri: string) => {
    setFeedback(null);
    const res = await apiFetch('/api/enrollments/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrPayload: rawCodeOrUri })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'QR enrollment verification failed.');
    }
    setScannerOpen(false);
    await refreshSession();
    if (data.greenhouse?.id) {
      setActiveGreenhouseId(data.greenhouse.id);
      if (data.action === 'claimed_kit') {
        navigate(`/greenhouses/${data.greenhouse.id}/setup`);
      } else {
        navigate(`/greenhouses/${data.greenhouse.id}`);
      }
    }
  };

  const handleGenerateKitQr = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingQr(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/kits/generate-qr', {
        method: 'POST',
        body: JSON.stringify({ kitSerial, ttlMinutes: 60 })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFeedback({ type: 'err', text: data.message || 'Failed to generate kit QR code.' });
        return;
      }
      setGeneratedKitQr({
        qrDataUrl: data.qrDataUrl,
        enrollmentCode: data.enrollmentCode,
        expiresAt: data.expiresAt,
        kitSerial: data.kitSerial
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Network error generating QR.' });
    } finally {
      setGeneratingQr(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Greenhouses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Claim a kit with a QR scan, enroll its devices, and check verified live data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={handleManualRefresh}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </Button>
          <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
            <QrCode size={15} aria-hidden="true" />
            Scan QR
          </Button>
          <Button type="button" onClick={() => navigate('/greenhouses/setup')}>
            <Plus size={15} aria-hidden="true" />
            Add greenhouse
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {greenhouses.length === 0 ? (
        <div className="mx-auto max-w-lg rounded-xl border border-border bg-card px-6 py-10 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <QrCode size={22} aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-base font-semibold">No greenhouses yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Scan the QR label on your EDENS AI kit to claim it, or start the guided setup
            wizard to enroll the controller and camera by hand.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => setScannerOpen(true)}>
              <QrCode size={15} aria-hidden="true" />
              Scan kit QR
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/greenhouses/setup')}>
              <Wrench size={15} aria-hidden="true" />
              Setup wizard
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {greenhouses.map((gh) => {
            const badge = overallStatusBadge(gh.overallStatus);
            const readings = gh.controller.readings;

            return (
              <Card key={gh.id} className="transition-colors hover:border-brand/40">
                <CardHeader className="border-b border-border pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{gh.name}</CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MapPin size={12} aria-hidden="true" /> {gh.locationLabel}
                        </span>
                        <span className="capitalize">{gh.cropType}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium capitalize">
                          {gh.role.toLowerCase()}
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <DeviceStatus
                      label="ESP32-CAM"
                      icon={Camera}
                      status={gh.camera.connectionStatus}
                      detail={
                        gh.camera.lastCaptureAt
                          ? `Snapshot (${gh.camera.freshness.toLowerCase()}) · ${gh.camera.ageSeconds ?? 0}s ago`
                          : 'No snapshot uploaded yet'
                      }
                    />
                    <DeviceStatus
                      label="Main ESP32"
                      icon={Cpu}
                      status={gh.controller.connectionStatus}
                      detail={
                        gh.controller.lastTelemetryAt
                          ? `${gh.controller.dataSource.toLowerCase()} · ${gh.controller.ageSeconds ?? 0}s ago`
                          : 'No controller check-in yet'
                      }
                    />
                  </div>

                  {readings && gh.controller.dataSource !== 'DISCONNECTED' ? (
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-3 text-center">
                      <div>
                        <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                          <Thermometer size={11} aria-hidden="true" /> Temp
                        </div>
                        <div className="mt-0.5 font-mono tabular text-sm font-semibold">
                          {readings.temperature.toFixed(1)}°C
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                          <Droplets size={11} aria-hidden="true" /> Humidity
                        </div>
                        <div className="mt-0.5 font-mono tabular text-sm font-semibold">
                          {readings.humidity.toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">Soil</div>
                        <div className="mt-0.5 font-mono tabular text-sm font-semibold">
                          {readings.soilMoisture.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-center text-xs text-muted-foreground">
                      Waiting for the first controller reading — no values are simulated.
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Link
                      to={`/greenhouses/${gh.id}/setup`}
                      onClick={() => setActiveGreenhouseId(gh.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Wrench size={13} aria-hidden="true" /> Device setup
                    </Link>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setActiveGreenhouseId(gh.id);
                        navigate(`/greenhouses/${gh.id}`);
                      }}
                    >
                      Open <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Printable / testable kit box QR generator */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck size={15} className="text-muted-foreground" aria-hidden="true" />
                Kit QR label generator
              </CardTitle>
              <CardDescription className="mt-0.5">
                Print a one-time QR label to test or ship with a physical kit.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowKitGenerator((v) => !v)}
              aria-expanded={showKitGenerator}
            >
              {showKitGenerator ? 'Hide' : 'Generate label'}
            </Button>
          </div>
        </CardHeader>

        {showKitGenerator && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
              <form onSubmit={handleGenerateKitQr} className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="kit-serial" className="block text-xs font-medium">
                    Kit serial
                  </label>
                  <Input
                    id="kit-serial"
                    value={kitSerial}
                    onChange={(e) => setKitSerial(e.target.value)}
                    placeholder="EDENS-NG-KIT-01"
                    className="font-mono text-sm"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The label holds a revocable 60-minute enrollment code. Permanent device keys
                  are issued after you sign in.
                </p>
                <Button type="submit" disabled={generatingQr}>
                  {generatingQr ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <QrCode size={15} aria-hidden="true" />
                  )}
                  Issue QR label
                </Button>
              </form>

              {generatedKitQr && (
                <QrCodeCard
                  qrDataUrl={generatedKitQr.qrDataUrl}
                  enrollmentCode={generatedKitQr.enrollmentCode}
                  expiresAt={generatedKitQr.expiresAt}
                  title={`Kit QR: ${generatedKitQr.kitSerial}`}
                />
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
