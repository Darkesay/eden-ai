import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Droplets,
  Loader2,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  Sprout,
  Thermometer,
  Wrench
} from 'lucide-react';
import { apiFetch, type GreenhouseSummary, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { formatExplicitDeviceState, formatRelativeAge } from '../lib/greenhouseState';
import { QrCodeCard, QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

function overallStatusBadge(status: GreenhouseSummary['overallStatus']) {
  switch (status) {
    case 'ONLINE':
      return {
        label: 'Connected',
        cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800/60'
      };
    case 'PARTIAL':
      return {
        label: 'Partial Signal',
        cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
      };
    case 'STALE':
      return {
        label: 'Delayed Signal',
        cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800/60'
      };
    case 'SETUP_INCOMPLETE':
      return {
        label: 'Setup Needed',
        cls: 'bg-muted text-muted-foreground border-border'
      };
    default:
      return {
        label: 'Offline',
        cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/45 dark:text-red-300 dark:border-red-800/60'
      };
  }
}

function formatNullableReading(val: number | null | undefined, decimals: number, unit: string): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'Unavailable';
  return `${val.toFixed(decimals)}${unit}`;
}

export default function Greenhouses() {
  const { greenhouses, activeGreenhouse, refreshSession, setActiveGreenhouseId } = useAuth();
  const navigate = useNavigate();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showTechTools, setShowTechTools] = useState(false);
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
    const parsed = await parseApiJsonResponse<any>(res);
    if (!parsed.ok || !parsed.data?.success) {
      throw new Error(!parsed.ok ? parsed.message : parsed.data?.message || 'QR code verification failed.');
    }
    const data = parsed.data;
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
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setFeedback({
          type: 'err',
          text: !parsed.ok ? parsed.message : parsed.data?.message || 'Could not generate kit QR code.'
        });
        return;
      }
      const data = parsed.data;
      setGeneratedKitQr({
        qrDataUrl: data.qrDataUrl,
        enrollmentCode: data.enrollmentCode,
        expiresAt: data.expiresAt,
        kitSerial: data.kitSerial
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Network error generating QR code.' });
    } finally {
      setGeneratingQr(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Greenhouse</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your greenhouse kit, check controller and camera status, and monitor real sensor readings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setScannerOpen(true)}
            className="h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <QrCode size={15} className="mr-1.5 text-primary" />
            Scan Kit QR
          </Button>
          <Button
            type="button"
            onClick={() => navigate('/greenhouses/setup')}
            className="h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus size={15} className="mr-1.5" />
            Set Up Greenhouse
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200'
          )}
        >
          {feedback.text}
        </div>
      )}

      {/* Enrolled Greenhouses List or Friendly Empty State */}
      {greenhouses.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card p-8 md:p-10 text-center shadow-xs max-w-2xl mx-auto space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-accent border border-primary/20 flex items-center justify-center mx-auto text-primary">
            <Sprout size={24} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Connect Your First Greenhouse</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
              Scan the QR sticker on your EDENS AI greenhouse kit, or follow our simple 6-step setup guide to register your crop, sensor controller, and plant camera.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="h-11 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold cursor-pointer"
            >
              <QrCode size={17} className="mr-2" />
              Scan Kit QR Code
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/greenhouses/setup')}
              className="h-11 px-5 rounded-xl text-sm font-semibold cursor-pointer"
            >
              Start 6-Step Setup Guide
            </Button>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {greenhouses.map((gh) => {
            const badge = overallStatusBadge(gh.overallStatus);
            const ctrlState = formatExplicitDeviceState(gh.controller.explicitState || gh.controller.connectionStatus);
            const camState = formatExplicitDeviceState(gh.camera.explicitState || gh.camera.connectionStatus);
            const isSelected = activeGreenhouse?.id === gh.id;
            const hasReadings =
              gh.controller.dataSource !== 'DISCONNECTED' && gh.controller.readings !== null;

            return (
              <div
                key={gh.id}
                className={cn(
                  'rounded-2xl border bg-card p-6 shadow-xs flex flex-col justify-between gap-5 transition-colors',
                  isSelected ? 'border-primary/40' : 'border-border'
                )}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-foreground truncate">{gh.name}</h2>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-accent px-2 py-0.5 rounded-md">
                            <CheckCircle2 size={11} /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                        <MapPin size={13} className="shrink-0" />
                        <span>{gh.locationLabel || 'Location not set'}</span>
                        <span>·</span>
                        <span className="font-medium text-foreground">{gh.cropType}</span>
                      </p>
                    </div>

                    <span
                      className={cn(
                        'text-xs font-semibold px-2.5 py-1 rounded-md border whitespace-nowrap shrink-0',
                        badge.cls
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Key Readings Summary */}
                  <div className="grid grid-cols-3 gap-2.5 rounded-xl bg-muted/50 p-3.5">
                    <div>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Thermometer size={12} className="text-primary" /> Temp
                      </span>
                      <p className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">
                        {hasReadings
                          ? formatNullableReading(gh.controller.readings?.temperature, 1, '°C')
                          : 'Unavailable'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Droplets size={12} className="text-primary" /> Humidity
                      </span>
                      <p className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">
                        {hasReadings
                          ? formatNullableReading(gh.controller.readings?.humidity, 0, '%')
                          : 'Unavailable'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Sprout size={12} className="text-primary" /> Soil
                      </span>
                      <p className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">
                        {hasReadings
                          ? formatNullableReading(gh.controller.readings?.soilMoisture, 0, '%')
                          : 'Unavailable'}
                      </p>
                    </div>
                  </div>

                  {/* Device Status Rows */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Cpu size={14} className="text-primary" /> Sensor Controller
                      </span>
                      <span className="font-medium text-foreground">
                        {ctrlState.label}
                        {gh.controller.lastTelemetryAt && (
                          <span className="text-muted-foreground font-mono tabular-nums ml-1.5">
                            ({formatRelativeAge(gh.controller.ageSeconds, gh.controller.lastTelemetryAt)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 border-t border-border">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Camera size={14} className="text-primary" /> Plant Camera
                      </span>
                      <span className="font-medium text-foreground">
                        {camState.label}
                        {gh.camera.lastCaptureAt && (
                          <span className="text-muted-foreground font-mono tabular-nums ml-1.5">
                            ({formatRelativeAge(gh.camera.ageSeconds, gh.camera.lastCaptureAt)})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setActiveGreenhouseId(gh.id);
                      navigate(`/greenhouses/${gh.id}/setup`);
                    }}
                    className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <Wrench size={14} className="mr-1.5" />
                    Setup Guide
                  </Button>

                  <Link
                    to={`/greenhouses/${gh.id}`}
                    onClick={() => setActiveGreenhouseId(gh.id)}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    <span>Open Greenhouse</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible Installer / Technician Kit QR Generator */}
      <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTechTools((prev) => !prev)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-muted/40 transition-colors cursor-pointer"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">
              Installer &amp; Technician Tools: Print Kit QR Sticker
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generate a single-use enrollment QR sticker when preparing a new physical greenhouse kit.
            </p>
          </div>
          {showTechTools ? (
            <ChevronUp size={18} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={18} className="text-muted-foreground shrink-0" />
          )}
        </button>

        {showTechTools && (
          <div className="px-6 pb-6 pt-2 border-t border-border space-y-4">
            <form onSubmit={handleGenerateKitQr} className="flex flex-col sm:flex-row gap-3 max-w-lg pt-2">
              <Input
                value={kitSerial}
                onChange={(e) => setKitSerial(e.target.value)}
                placeholder="Kit Serial (e.g., EDENS-NG-KIT-01)"
                className="h-10 font-mono text-xs bg-background"
                required
              />
              <Button
                type="submit"
                disabled={generatingQr || !kitSerial.trim()}
                className="h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shrink-0 cursor-pointer"
              >
                {generatingQr ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <QrCode size={14} className="mr-1.5" />}
                Generate QR Sticker
              </Button>
            </form>

            {generatedKitQr && (
              <div className="max-w-sm">
                <QrCodeCard
                  qrDataUrl={generatedKitQr.qrDataUrl}
                  enrollmentCode={generatedKitQr.enrollmentCode}
                  expiresAt={generatedKitQr.expiresAt}
                  title={`Kit Label: ${generatedKitQr.kitSerial}`}
                  subtitle="Attach to the greenhouse enclosure. Contains zero Wi-Fi passwords or API keys."
                />
              </div>
            )}
          </div>
        )}
      </section>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
