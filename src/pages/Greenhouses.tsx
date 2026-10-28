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
  Sprout,
  Thermometer,
  Wrench
} from 'lucide-react';
import { apiFetch, type GreenhouseSummary, useAuth } from '../lib/auth';
import { QrCodeCard, QrScannerModal } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

function overallStatusBadge(status: GreenhouseSummary['overallStatus']) {
  switch (status) {
    case 'ONLINE':
      return {
        label: 'VERIFIED ONLINE',
        cls: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40'
      };
    case 'PARTIAL':
      return {
        label: 'PARTIAL CHECK-IN',
        cls: 'bg-teal-500/15 text-teal-400 border-teal-500/40'
      };
    case 'STALE':
      return {
        label: 'STALE SIGNAL',
        cls: 'bg-amber-500/15 text-amber-400 border-amber-500/40'
      };
    case 'SETUP_INCOMPLETE':
      return {
        label: 'SETUP REQUIRED',
        cls: 'bg-slate-500/15 text-slate-300 border-slate-500/40'
      };
    default:
      return {
        label: 'OFFLINE',
        cls: 'bg-red-500/15 text-red-400 border-red-500/40'
      };
  }
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
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
            <Sprout className="text-[#10B981]" size={28} />
            My Greenhouses
          </h1>
          <p className="text-sm opacity-75 mt-1">
            Claim an EDENS AI hardware kit via QR scan, enroll ESP32 devices, and monitor verified live data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleManualRefresh}
            className="border-[#D1E8D1] dark:border-[#1A2A1A]"
          >
            <RefreshCw size={15} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setScannerOpen(true)}
            className="border-[#10B981]/50 text-[#059669] dark:text-[#10B981] hover:bg-[#10B981]/10"
          >
            <QrCode size={16} className="mr-1.5" />
            Scan Kit / Invite QR
          </Button>
          <Button
            type="button"
            onClick={() => navigate('/greenhouses/setup')}
            className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
          >
            <Plus size={16} className="mr-1.5" />
            Add Greenhouse
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]'
              : 'border-red-500/40 bg-red-500/10 text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {greenhouses.length === 0 ? (
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/80 dark:bg-[#080808]/90 p-8 text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
            <QrCode size={32} />
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <h2 className="text-xl font-bold">No Greenhouses Enrolled Yet</h2>
            <p className="text-sm opacity-75">
              Scan the QR label on your EDENS AI greenhouse kit or start the Guided Setup Wizard to register your
              ESP32-CAM and Main ESP32 controller.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
            >
              <QrCode size={16} className="mr-2" />
              Scan Greenhouse Kit QR
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/greenhouses/setup')}
              className="border-[#10B981]/40"
            >
              <Wrench size={16} className="mr-2" />
              Manual Setup Wizard
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {greenhouses.map((gh) => {
            const badge = overallStatusBadge(gh.overallStatus);
            const readings = gh.controller.readings;

            return (
              <Card
                key={gh.id}
                className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90 overflow-hidden shadow-sm hover:border-[#10B981]/40 transition-all"
              >
                <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-xl font-bold">{gh.name}</CardTitle>
                      <div className="flex items-center gap-3 text-xs opacity-70 mt-1">
                        <span className="flex items-center gap-1">
                          <MapPin size={12} /> {gh.locationLabel}
                        </span>
                        <span className="font-mono uppercase">{gh.cropType}</span>
                        <span className="uppercase font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5">
                          {gh.role}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border shrink-0 ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="opacity-70 flex items-center gap-1.5 font-medium">
                          <Camera size={13} className="text-[#14B8A6]" /> ESP32-CAM
                        </span>
                        <span
                          className={`font-mono text-[10px] font-bold ${
                            (gh.camera.explicitState || gh.camera.connectionStatus) === 'ONLINE' ||
                            gh.camera.connectionStatus === 'CONNECTED'
                              ? 'text-[#10B981]'
                              : (gh.camera.explicitState || gh.camera.connectionStatus) === 'STALE'
                                ? 'text-amber-400'
                                : gh.camera.explicitState === 'AUTHENTICATION_ERROR' ||
                                    gh.camera.explicitState === 'CONNECTION_ERROR'
                                  ? 'text-red-400'
                                  : 'opacity-65'
                          }`}
                        >
                          {gh.camera.explicitState || gh.camera.connectionStatus}
                        </span>
                      </div>
                      <div className="text-[11px] opacity-75">
                        {gh.camera.lastCaptureAt
                          ? `Snapshot (${gh.camera.freshness}) • ${gh.camera.ageSeconds ?? 0}s ago`
                          : 'No snapshot uploaded yet'}
                      </div>
                      {gh.camera.lastError && (
                        <div className="text-[10px] text-red-400 font-mono truncate">
                          {gh.camera.lastError.code}: {gh.camera.lastError.message}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="opacity-70 flex items-center gap-1.5 font-medium">
                          <Cpu size={13} className="text-[#10B981]" /> Main ESP32
                        </span>
                        <span
                          className={`font-mono text-[10px] font-bold ${
                            (gh.controller.explicitState || gh.controller.connectionStatus) === 'ONLINE' ||
                            gh.controller.connectionStatus === 'CONNECTED'
                              ? 'text-[#10B981]'
                              : (gh.controller.explicitState || gh.controller.connectionStatus) === 'STALE'
                                ? 'text-amber-400'
                                : gh.controller.explicitState === 'AUTHENTICATION_ERROR' ||
                                    gh.controller.explicitState === 'CONNECTION_ERROR'
                                  ? 'text-red-400'
                                  : 'opacity-65'
                          }`}
                        >
                          {gh.controller.explicitState || gh.controller.connectionStatus}
                        </span>
                      </div>
                      <div className="text-[11px] opacity-75">
                        {gh.controller.lastTelemetryAt
                          ? `Source: ${gh.controller.dataSource} • ${gh.controller.ageSeconds ?? 0}s ago`
                          : 'No controller check-in yet'}
                      </div>
                      {gh.controller.lastError && (
                        <div className="text-[10px] text-red-400 font-mono truncate">
                          {gh.controller.lastError.code}: {gh.controller.lastError.message}
                        </div>
                      )}
                    </div>
                  </div>

                  {readings && gh.controller.dataSource !== 'DISCONNECTED' ? (
                    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-black/5 dark:bg-[#0D130F] p-3 text-center">
                      <div>
                        <div className="text-[10px] uppercase opacity-60 flex items-center justify-center gap-1">
                          <Thermometer size={11} /> Temp
                        </div>
                        <div className="font-mono font-bold text-sm mt-0.5">
                          {readings.temperature !== null && readings.temperature !== undefined
                            ? `${readings.temperature.toFixed(1)}°C`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase opacity-60 flex items-center justify-center gap-1">
                          <Droplets size={11} /> Humidity
                        </div>
                        <div className="font-mono font-bold text-sm mt-0.5">
                          {readings.humidity !== null && readings.humidity !== undefined
                            ? `${readings.humidity.toFixed(0)}%`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase opacity-60">Soil</div>
                        <div className="font-mono font-bold text-sm mt-0.5">
                          {readings.soilMoisture !== null && readings.soilMoisture !== undefined
                            ? `${readings.soilMoisture.toFixed(0)}%`
                            : 'Unavailable'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#D1E8D1] dark:border-[#1A2A1A] px-3 py-2.5 text-xs opacity-70 text-center">
                      Awaiting verified physical controller readings (no synthetic values shown).
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Link
                      to={`/greenhouses/${gh.id}/setup`}
                      onClick={() => setActiveGreenhouseId(gh.id)}
                      className="text-xs font-medium text-[#059669] dark:text-[#10B981] hover:underline flex items-center gap-1"
                    >
                      <Wrench size={13} /> Device Setup Wizard
                    </Link>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setActiveGreenhouseId(gh.id);
                        navigate(`/greenhouses/${gh.id}`);
                      }}
                      className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold rounded-xl"
                    >
                      Open Greenhouse <ArrowRight size={14} className="ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Printable / Testable Kit Box QR Generator */}
      <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/70 dark:bg-[#080808]/70">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ShieldCheck size={16} className="text-[#10B981]" />
                EDENS Kit Box QR Label Generator (Non-Secret One-Time Token)
              </h3>
              <p className="text-xs opacity-70 mt-0.5">
                Generate a printable QR label for a new EDENS AI greenhouse kit to test or ship with physical hardware.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowKitGenerator((v) => !v)}
              className="border-[#10B981]/40 text-xs"
            >
              {showKitGenerator ? 'Hide Generator' : 'Generate Kit QR Label'}
            </Button>
          </div>

          {showKitGenerator && (
            <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <form onSubmit={handleGenerateKitQr} className="space-y-3">
                <label className="block text-xs font-medium opacity-80">Kit Serial Label</label>
                <Input
                  value={kitSerial}
                  onChange={(e) => setKitSerial(e.target.value)}
                  placeholder="EDENS-NG-KIT-01"
                  className="bg-transparent border-[#D1E8D1] dark:border-[#1A2A1A] font-mono text-sm"
                />
                <p className="text-[11px] opacity-70">
                  Contains only a revocable 60-minute enrollment code (`edens://enroll?...`). Permanent device keys are
                  issued separately after account authentication.
                </p>
                <Button
                  type="submit"
                  disabled={generatingQr}
                  className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
                >
                  {generatingQr ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <QrCode size={15} className="mr-1.5" />}
                  Issue One-Time Kit QR
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
          )}
        </CardContent>
      </Card>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
}
