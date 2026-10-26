import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Cpu,
  Droplets,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Thermometer,
  Wrench
} from 'lucide-react';
import { apiFetch, useAuth } from '../lib/auth';
import { QrCodeCard } from '../components/QrScannerModal';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export default function GreenhouseDetails() {
  const { greenhouseId } = useParams<{ greenhouseId: string }>();
  const navigate = useNavigate();
  const { setActiveGreenhouseId, refreshSession } = useAuth();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [detail, setDetail] = useState<any | null>(null);

  const [testingConn, setTestingConn] = useState(false);
  const [connBanner, setConnBanner] = useState<string | null>(null);

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagLang, setDiagLang] = useState('en');
  const [diagnosisError, setDiagnosisError] = useState('');
  const [diagnosisResult, setDiagnosisResult] = useState<any | null>(null);

  const [shareQr, setShareQr] = useState<{
    tokenId: string;
    qrDataUrl: string;
    enrollmentCode: string;
    expiresAt: string;
  } | null>(null);
  const [issuingQr, setIssuingQr] = useState(false);

  const fetchDetails = useCallback(async () => {
    if (!greenhouseId) return;
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Unable to load greenhouse.');
        return;
      }
      setDetail(data);
      setActiveGreenhouseId(greenhouseId);
      if (data.latestCamera?.analysis && !diagnosisResult) {
        setDiagnosisResult(data.latestCamera.analysis);
      }
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error loading greenhouse.');
    } finally {
      setLoading(false);
    }
  }, [greenhouseId, setActiveGreenhouseId, diagnosisResult]);

  useEffect(() => {
    fetchDetails();
    const poll = window.setInterval(fetchDetails, 12000);
    return () => window.clearInterval(poll);
  }, [fetchDetails]);

  const handleRetryConnectionTest = async () => {
    if (!greenhouseId) return;
    setTestingConn(true);
    setConnBanner(null);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const passed = data.checks.filter((c: any) => c.status === 'PASS').length;
        setConnBanner(
          `Safe Read-Only Check Complete (${passed}/${data.checks.length} checks verified, 0 actuator commands sent).`
        );
      }
      await fetchDetails();
      await refreshSession();
    } finally {
      setTestingConn(false);
    }
  };

  const handleRunVisionDiagnosis = async () => {
    if (!greenhouseId) return;
    setDiagnosing(true);
    setDiagnosisError('');
    try {
      const res = await apiFetch('/api/ai/diagnose', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId,
          useLatestCameraFrame: true,
          requireFresh: true,
          languageId: diagLang
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDiagnosisError(data.message || 'Vision diagnosis could not be completed.');
        return;
      }
      setDiagnosisResult(data.result);
      await fetchDetails();
    } catch (err: any) {
      setDiagnosisError(err?.message || 'Network error during crop diagnosis.');
    } finally {
      setDiagnosing(false);
    }
  };

  const handleIssueShareQr = async () => {
    if (!greenhouseId) return;
    setIssuingQr(true);
    try {
      const res = await apiFetch(`/api/greenhouses/${greenhouseId}/qr-token`, {
        method: 'POST',
        body: JSON.stringify({ purpose: 'member_share_qr', roleGranted: 'operator', ttlMinutes: 30 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShareQr({
          tokenId: data.tokenId,
          qrDataUrl: data.qrDataUrl,
          enrollmentCode: data.enrollmentCode,
          expiresAt: data.expiresAt
        });
        await fetchDetails();
      }
    } finally {
      setIssuingQr(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!greenhouseId) return;
    await apiFetch(`/api/greenhouses/${greenhouseId}/devices/${deviceId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    await fetchDetails();
    await refreshSession();
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!greenhouseId) return;
    await apiFetch(`/api/greenhouses/${greenhouseId}/qr-tokens/${tokenId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (shareQr?.tokenId === tokenId) setShareQr(null);
    await fetchDetails();
  };

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 opacity-75">
        <Loader2 size={28} className="animate-spin text-[#10B981]" />
        <span className="text-sm">Loading greenhouse state...</span>
      </div>
    );
  }

  if (errorMsg || !detail?.greenhouse) {
    return (
      <div className="max-w-xl mx-auto rounded-3xl border border-red-500/40 bg-red-500/10 p-8 text-center space-y-4">
        <AlertTriangle size={28} className="mx-auto text-red-400" />
        <p className="text-sm text-red-300">{errorMsg || 'Greenhouse not found.'}</p>
        <Button type="button" variant="outline" onClick={() => navigate('/greenhouses')}>
          Return to My Greenhouses
        </Button>
      </div>
    );
  }

  const gh = detail.greenhouse;
  const cam = detail.latestCamera;
  const tel = detail.latestTelemetry;
  const canManage = gh.role === 'owner' || gh.role === 'operator';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            to="/greenhouses"
            className="text-xs opacity-70 hover:opacity-100 inline-flex items-center gap-1"
          >
            <ArrowLeft size={14} /> All Greenhouses
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{gh.name}</h1>
            <span className="text-[10px] font-mono uppercase px-2.5 py-1 rounded-md border border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]">
              {gh.overallStatus}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs opacity-75">
            <span className="flex items-center gap-1">
              <MapPin size={13} /> {gh.locationLabel}
            </span>
            <span>Crop: {gh.cropType}</span>
            <span className="font-mono">ID: {gh.id}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testingConn}
            onClick={handleRetryConnectionTest}
          >
            <RefreshCw size={14} className={`mr-1.5 ${testingConn ? 'animate-spin' : ''}`} />
            Retry Connection
          </Button>
          {canManage && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={issuingQr}
                onClick={handleIssueShareQr}
                className="border-[#10B981]/40 text-[#059669] dark:text-[#10B981]"
              >
                <QrCode size={14} className="mr-1.5" />
                Share Invite QR
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => navigate(`/greenhouses/${gh.id}/setup`)}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
              >
                <Wrench size={14} className="mr-1.5" />
                Setup Help & Keys
              </Button>
            </>
          )}
        </div>
      </div>

      {connBanner && (
        <div className="rounded-2xl border border-[#10B981]/40 bg-[#10B981]/10 px-4 py-3 text-xs text-[#10B981] flex items-center justify-between">
          <span>{connBanner}</span>
          <button type="button" onClick={() => setConnBanner(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {shareQr && (
        <div className="max-w-sm">
          <QrCodeCard
            qrDataUrl={shareQr.qrDataUrl}
            enrollmentCode={shareQr.enrollmentCode}
            expiresAt={shareQr.expiresAt}
            title={`Member Invite QR (${gh.name})`}
            subtitle="Valid for 30 minutes, single use. Grants operator access."
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ESP32-CAM Crop Snapshot & Manual AI Diagnosis */}
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Camera size={17} className="text-[#14B8A6]" /> ESP32-CAM Crop Snapshot
              </CardTitle>
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10">
                  SNAPSHOT (NOT LIVE VIDEO)
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    cam?.isFresh
                      ? 'bg-[#10B981]/20 text-[#10B981]'
                      : cam?.exists
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {cam?.exists ? cam.freshness : 'DISCONNECTED'}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {cam?.exists ? (
              <div className="space-y-2">
                <div className="rounded-2xl overflow-hidden bg-black aspect-video border border-[#1A2A1A]">
                  <img
                    src={cam.base64 || cam.url}
                    alt="Verified ESP32-CAM Greenhouse Snapshot"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between text-xs opacity-75 font-mono">
                  <span>Captured: {new Date(cam.timestamp).toLocaleTimeString()}</span>
                  <span>Age: {cam.ageSeconds}s • {(cam.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#D1E8D1] dark:border-[#1A2A1A] p-8 text-center space-y-2">
                <Camera size={28} className="mx-auto opacity-40" />
                <div className="text-sm font-medium">No ESP32-CAM Snapshot Uploaded Yet</div>
                <p className="text-xs opacity-70">
                  Issue a camera credential in Setup Help and flash `camera_secrets.h` so your ESP32-CAM posts verified
                  JPEGs to `/api/camera/upload`.
                </p>
              </div>
            )}

            <div className="border-t border-[#D1E8D1] dark:border-[#1A2A1A] pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  value={diagLang}
                  onChange={(e) => setDiagLang(e.target.value)}
                  className="rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-transparent px-3 py-1.5 text-xs"
                >
                  <option value="en">English (Nigeria)</option>
                  <option value="pcm">Nigerian Pidgin</option>
                  <option value="ha">Hausa</option>
                  <option value="yo">Yoruba</option>
                  <option value="ig">Igbo</option>
                </select>

                <Button
                  type="button"
                  size="sm"
                  disabled={!cam?.isFresh || diagnosing}
                  onClick={handleRunVisionDiagnosis}
                  className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold"
                >
                  {diagnosing ? (
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                  ) : (
                    <Sparkles size={14} className="mr-1.5" />
                  )}
                  Analyze Fresh Crop Snapshot
                </Button>
              </div>

              {!cam?.isFresh && cam?.exists && (
                <p className="text-[11px] text-amber-400">
                  Snapshot is {cam.freshness} ({cam.ageSeconds}s old). Live AI diagnosis requires a FRESH camera upload
                  (&le;90s old).
                </p>
              )}

              {diagnosisError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
                  {diagnosisError}
                </div>
              )}

              {diagnosisResult && (
                <div className="rounded-2xl border border-[#10B981]/30 bg-[#10B981]/5 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-sm">
                    <span>{diagnosisResult.species}</span>
                    <span className="text-[#10B981]">{diagnosisResult.healthStatus}</span>
                  </div>
                  <p>
                    <strong>Symptoms:</strong> {diagnosisResult.symptoms}
                  </p>
                  <p>
                    <strong>Likely Cause:</strong> {diagnosisResult.cause}
                  </p>
                  <p>
                    <strong>Recommendation:</strong> {diagnosisResult.recommendation}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main ESP32 Controller Telemetry & Hardware Interlocks */}
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A]">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Activity size={17} className="text-[#10B981]" /> Main ESP32 Sensor Telemetry
              </CardTitle>
              <span
                className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded ${
                  tel?.dataSource === 'REAL_HARDWARE'
                    ? 'bg-[#10B981]/20 text-[#10B981]'
                    : tel?.dataSource === 'CACHED' || tel?.dataSource === 'STALE'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
              >
                {tel?.dataSource || 'DISCONNECTED'}
              </span>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {tel?.exists && tel.readings ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3">
                    <div className="text-[11px] opacity-70 flex items-center gap-1">
                      <Thermometer size={12} className="text-[#10B981]" /> Air Temp
                    </div>
                    <div className="text-xl font-mono font-bold mt-1">
                      {tel.readings.temperature.toFixed(1)}°C
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3">
                    <div className="text-[11px] opacity-70 flex items-center gap-1">
                      <Droplets size={12} className="text-sky-400" /> Humidity
                    </div>
                    <div className="text-xl font-mono font-bold mt-1">
                      {tel.readings.humidity.toFixed(0)}%
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3">
                    <div className="text-[11px] opacity-70">Soil Moisture</div>
                    <div className="text-xl font-mono font-bold mt-1">
                      {tel.readings.soilMoisture.toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2.5">
                    <span className="opacity-65 block">Reservoir</span>
                    <span className="font-mono font-semibold">
                      {tel.readings.waterLevel !== null ? `${tel.readings.waterLevel}%` : 'Unreported'}
                    </span>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2.5">
                    <span className="opacity-65 flex items-center gap-1">
                      <Sun size={11} /> Sunlight
                    </span>
                    <span className="font-mono font-semibold">
                      {tel.readings.sunlight !== null ? `${tel.readings.sunlight} lx` : 'Unreported'}
                    </span>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2.5">
                    <span className="opacity-65 block">Battery</span>
                    <span className="font-mono font-semibold">
                      {tel.readings.batteryVoltage !== null ? `${tel.readings.batteryVoltage}V` : 'Unreported'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-[#10B981]" /> Local ESP32 Safety Interlocks (Autonomous)
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                    {Object.entries(tel.interlocks || {}).map(([key, locked]) => (
                      <div
                        key={key}
                        className={`rounded-xl px-3 py-2 border flex items-center justify-between ${
                          locked
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-[#D1E8D1] dark:border-[#1A2A1A] opacity-80'
                        }`}
                      >
                        <span>{key}</span>
                        <span>{locked ? 'LOCKED' : 'CLEAR'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#D1E8D1] dark:border-[#1A2A1A] p-8 text-center space-y-2">
                <Cpu size={28} className="mx-auto opacity-40" />
                <div className="text-sm font-medium">No Controller Telemetry Uploaded Yet</div>
                <p className="text-xs opacity-70">
                  Zero synthetic values are displayed here. Configure `controller_secrets.h` on the Main ESP32 to push
                  verified sensor JSON to `POST /api/telemetry/upload`.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Enrolled Hardware Devices & Audit Trail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <CardTitle className="text-base font-bold">Enrolled Hardware Identities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(detail.devices || []).map((dev: any) => (
              <div
                key={dev.id}
                className="rounded-2xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-3.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-sm">{dev.label}</div>
                  <div className="font-mono opacity-65">
                    {dev.id} {dev.credentialPrefix ? `• Key ${dev.credentialPrefix}...` : '• No key issued'}
                  </div>
                  <div className="opacity-70">
                    Status: <span className="font-mono uppercase">{dev.provisioningStatus}</span>
                    {dev.lastSeenAt ? ` • Last seen ${new Date(dev.lastSeenAt).toLocaleTimeString()}` : ''}
                  </div>
                </div>
                {canManage && dev.provisioningStatus !== 'revoked' && dev.hasCredentialIssued && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevokeDevice(dev.id)}
                    className="border-red-500/40 text-red-400 hover:bg-red-500/10 shrink-0"
                  >
                    <ShieldAlert size={13} className="mr-1" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-[#D1E8D1] dark:border-[#1A2A1A] bg-white/90 dark:bg-[#080808]/90">
          <CardHeader>
            <CardTitle className="text-base font-bold">Security & Onboarding Audit Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-72 overflow-y-auto text-xs">
            {(detail.enrollmentTokens || [])
              .filter((t: any) => !t.usedAt && !t.revokedAt)
              .map((tok: any) => (
                <div
                  key={tok.id}
                  className="rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-2.5 flex items-center justify-between"
                >
                  <div>
                    <span className="font-mono font-semibold">{tok.tokenPrefix}...</span> • Active {tok.purpose}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeToken(tok.id)}
                    className="text-red-400 hover:underline font-medium"
                  >
                    Revoke QR
                  </button>
                </div>
              ))}

            {(detail.auditEvents || []).map((ev: any) => (
              <div
                key={ev.id}
                className="rounded-xl border border-[#D1E8D1] dark:border-[#1A2A1A] p-2.5 flex items-start gap-2"
              >
                <CheckCircle2 size={14} className="text-[#10B981] shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">{ev.summary}</div>
                  <div className="font-mono text-[10px] opacity-60">
                    {ev.eventType} • {new Date(ev.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
