import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck,
  Globe,
  ImageUp,
  Info,
  Leaf,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  Volume2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { apiFetch, resolveApiUrl, useAuth } from '../lib/auth';
import { parseApiJsonResponse } from '../lib/api';
import { formatFrameAge, useCameraConnection } from '../lib/cameraConnectionManager';
import {
  analyzePlantImage,
  CameraDiagnosisError,
  diagnoseLatestCameraFrame,
  generateSpeechAudio,
  NIGERIAN_LANGUAGES,
  type PlantAnalysisResult
} from '../lib/gemini';
import { base64PcmToWavUrl, playAudioUrl, speakWithBrowserTts, stopAllAudio } from '../lib/audio';
import { formatRelativeAge } from '../lib/greenhouseState';
import { store, useStoreTable, useStoreValue } from '../lib/store';
import { LeafCameraModal } from '../components/LeafCameraModal';
import { MonitoringModeBanner } from '../components/MonitoringModeBanner';
import { prepareImageForDiagnosis } from '../lib/imageUtils';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

export default function PlantVision() {
  const { activeGreenhouse } = useAuth();
  const camera = useCameraConnection();

  const savedLangId = String(useStoreValue('aiLanguage', 'en') || 'en');
  const [selectedLangId, setSelectedLangId] = useState<string>(() =>
    NIGERIAN_LANGUAGES.some((l) => l.id === savedLangId) ? savedLangId : 'en'
  );

  // Also fetch enrolled greenhouse's specific latestCamera when activeGreenhouse exists
  const [ghCamera, setGhCamera] = useState<any | null>(null);
  const [ghObservations, setGhObservations] = useState<any[]>([]);
  const [loadingGhCam, setLoadingGhCam] = useState(false);

  // Manual phone/computer photo upload & live camera snap state
  const [manualPhotoDataUrl, setManualPhotoDataUrl] = useState<string | null>(null);
  const [manualPhotoName, setManualPhotoName] = useState<string>('');
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI inspection state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PlantAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [speakingReport, setSpeakingReport] = useState(false);
  const [loadingSpeech, setLoadingSpeech] = useState(false);

  // Saved Existing HTTP Camera quick-capture state
  const [savedHttpPhotoUrl, setSavedHttpPhotoUrl] = useState<string>('');
  const [httpDirectSupported, setHttpDirectSupported] = useState<boolean>(false);
  const [capturingHttpFrame, setCapturingHttpFrame] = useState<boolean>(false);

  const aiHistoryTable = useStoreTable('ai_history') || {};

  const fetchSavedHttpCameraState = useCallback(async () => {
    try {
      const qs = activeGreenhouse?.id
        ? `?greenhouseId=${encodeURIComponent(activeGreenhouse.id)}`
        : '';
      const res = await apiFetch(`/api/hardware-http/state${qs}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) return;
      setSavedHttpPhotoUrl(parsed.data.savedCamera?.photoUrl || '');
      setHttpDirectSupported(Boolean(parsed.data.environment?.localDirectHttpSupported));
    } catch {
      // Ignore transient state errors
    }
  }, [activeGreenhouse?.id]);

  const fetchGreenhouseCamera = useCallback(async () => {
    if (!activeGreenhouse?.id) {
      setGhCamera(null);
      setGhObservations([]);
      return;
    }
    setLoadingGhCam(true);
    try {
      const res = await apiFetch(`/api/greenhouses/${activeGreenhouse.id}`);
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok) return;
      setGhCamera(parsed.data.latestCamera || null);
      setGhObservations(Array.isArray(parsed.data.observations) ? parsed.data.observations : []);
    } catch {
      // Ignore transient poll errors
    } finally {
      setLoadingGhCam(false);
    }
  }, [activeGreenhouse?.id]);

  useEffect(() => {
    void fetchGreenhouseCamera();
    void fetchSavedHttpCameraState();
    const timer = window.setInterval(() => {
      void fetchGreenhouseCamera();
    }, 10000);
    return () => {
      window.clearInterval(timer);
      stopAllAudio();
    };
  }, [fetchGreenhouseCamera, fetchSavedHttpCameraState]);

  const handleRefreshSnapshot = async () => {
    setAnalysisError(null);
    await Promise.all([
      camera.refreshNow(false),
      fetchGreenhouseCamera(),
      fetchSavedHttpCameraState()
    ]);
  };

  const handleCaptureHttpCamera = async () => {
    if (!savedHttpPhotoUrl || !httpDirectSupported) return;
    setCapturingHttpFrame(true);
    setAnalysisError(null);
    setManualPhotoDataUrl(null);
    setManualPhotoName('');
    try {
      const res = await apiFetch('/api/hardware-http/camera/capture', {
        method: 'POST',
        body: JSON.stringify({
          greenhouseId: activeGreenhouse?.id || undefined,
          photoUrl: savedHttpPhotoUrl
        })
      });
      const parsed = await parseApiJsonResponse<any>(res);
      if (!parsed.ok || !parsed.data?.success) {
        setAnalysisError(
          !parsed.ok
            ? parsed.message
            : parsed.data?.message || 'Could not capture a live JPEG from the HTTP camera.'
        );
        return;
      }
      await Promise.all([camera.refreshNow(false), fetchGreenhouseCamera()]);
    } catch (err: any) {
      setAnalysisError(err?.message || 'HTTP camera capture failed.');
    } finally {
      setCapturingHttpFrame(false);
    }
  };

  // Resolve active greenhouse camera frame vs global cameraConnectionManager frame
  const hasEnrolledGh = Boolean(activeGreenhouse?.id);
  const snapshotExists = hasEnrolledGh
    ? Boolean(ghCamera?.exists && ghCamera?.url)
    : Boolean(camera.latestFrame);
  const snapshotUrl = hasEnrolledGh
    ? ghCamera?.url
      ? resolveApiUrl(ghCamera.url)
      : undefined
    : camera.latestFrame?.url;
  const snapshotTimestamp = hasEnrolledGh
    ? ghCamera?.capturedAt || ghCamera?.timestamp || null
    : camera.lastImageTimestamp;
  const snapshotAgeSec = hasEnrolledGh ? ghCamera?.ageSeconds ?? null : camera.displayAgeSeconds;
  const snapshotIsFresh = hasEnrolledGh
    ? Boolean(ghCamera?.isFresh)
    : Boolean(camera.latestFrame?.isFresh);

  const cameraConnected = snapshotExists && snapshotIsFresh;

  const handleManualPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setAnalysisError(null);
    setAnalysisResult(null);
    setPreparingPhoto(true);
    try {
      const normalizedDataUrl = await prepareImageForDiagnosis(file);
      setManualPhotoName(file.name);
      setManualPhotoDataUrl(normalizedDataUrl);
    } catch (err: any) {
      setAnalysisError(
        err?.message || 'Could not load that photo. Please choose a clear JPG, PNG, or WebP leaf image.'
      );
    } finally {
      setPreparingPhoto(false);
    }
  };

  const handleAnalyzePlant = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    stopAllAudio();
    setSpeakingReport(false);

    try {
      let result: PlantAnalysisResult;
      if (manualPhotoDataUrl) {
        result = await analyzePlantImage(manualPhotoDataUrl, selectedLangId);
      } else {
        result = await diagnoseLatestCameraFrame(selectedLangId);
      }
      setAnalysisResult(result);

      const langName =
        NIGERIAN_LANGUAGES.find((l) => l.id === selectedLangId)?.name || 'English';
      const resolvedOriginLabel =
        result.imageOriginLabel === 'UPLOADED_TEST_IMAGE' || Boolean(manualPhotoDataUrl)
          ? 'UPLOADED TEST IMAGE'
          : 'REAL CAMERA IMAGE';
      store.setRow('ai_history', `${Date.now()}`, {
        timestamp: result.capturedAt || new Date().toISOString(),
        species: result.species,
        healthStatus: result.healthStatus,
        recommendation: result.recommendation,
        language: langName,
        source: resolvedOriginLabel
      });

      if (hasEnrolledGh) {
        await fetchGreenhouseCamera();
      }
    } catch (err: any) {
      if (err instanceof CameraDiagnosisError) {
        if (err.status === 409) {
          setAnalysisError(
            'The latest greenhouse camera photo is older than 90 seconds, so EDENS AI will not treat it as a live capture. Refresh once your ESP32-CAM uploads a new snapshot, or upload a leaf photo from your phone.'
          );
        } else if (err.status === 404) {
          setAnalysisError(
            'No greenhouse camera photo has arrived yet. Make sure your ESP32-CAM is powered on 2.4 GHz Wi-Fi, or upload a leaf photo from your phone to inspect right away.'
          );
        } else {
          setAnalysisError(err.message);
        }
      } else {
        setAnalysisError(
          err?.message || 'Plant analysis could not be completed. Please try again.'
        );
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const reportSpeechCacheRef = useRef<Map<string, string>>(new Map());

  const handleSpeakReport = async () => {
    if (!analysisResult) return;
    if (speakingReport) {
      stopAllAudio();
      setSpeakingReport(false);
      return;
    }

    const summaryText =
      analysisResult.audioSummary ||
      `${analysisResult.species}. Condition: ${analysisResult.healthStatus}. ${analysisResult.symptoms}. Recommended action: ${analysisResult.recommendation}`;

    const langObj = NIGERIAN_LANGUAGES.find((l) => l.id === selectedLangId);
    const fallbackToDeviceVoice = () => {
      setLoadingSpeech(false);
      const ok = speakWithBrowserTts(
        summaryText,
        langObj?.speechCode || 'en-NG',
        () => setSpeakingReport(true),
        () => setSpeakingReport(false)
      );
      if (!ok) setSpeakingReport(false);
    };

    setLoadingSpeech(true);
    try {
      const cachedPcm = reportSpeechCacheRef.current.get(summaryText);
      const pcmBase64 = cachedPcm ?? (await generateSpeechAudio(summaryText, 'Kore'));
      if (!pcmBase64) {
        fallbackToDeviceVoice();
        return;
      }
      if (!cachedPcm) {
        reportSpeechCacheRef.current.set(summaryText, pcmBase64);
      }
      const wavUrl = base64PcmToWavUrl(pcmBase64, 24000);
      setLoadingSpeech(false);
      setSpeakingReport(true);
      playAudioUrl(
        wavUrl,
        () => {
          URL.revokeObjectURL(wavUrl);
          setSpeakingReport(false);
        },
        () => {
          URL.revokeObjectURL(wavUrl);
          fallbackToDeviceVoice();
        }
      );
    } catch {
      fallbackToDeviceVoice();
    }
  };

  // Combine past inspections from cloud greenhouse vision observations + local ai_history
  const localHistory = Object.entries(aiHistoryTable).map(([id, item]: [string, any]) => ({
    id,
    title: `${item.species || 'Crop'} — ${item.healthStatus || 'Inspected'}`,
    summary: item.recommendation || '',
    timestamp: item.timestamp || null,
    source: item.source || 'Leaf Photo'
  }));

  const cloudHistory = ghObservations
    .filter((obs: any) => !obs.category || obs.category === 'vision_diagnosis')
    .map((obs: any) => {
      const payload = obs.payload || {};
      return {
        id: obs.id,
        title: `${payload.species || activeGreenhouse?.cropType || 'Crop'} — ${payload.healthStatus || obs.healthStatus || 'Inspected'}`,
        summary: payload.recommendation || obs.recommendation || obs.summary || '',
        timestamp: obs.createdAt || null,
        source:
          obs.dataSource === 'MANUAL_UPLOAD' ? 'Phone / Leaf Photo' : 'ESP32-CAM Snapshot'
      };
    });

  // Deduplicate if the same inspection was saved both to cloud and local history within 5s
  const combinedHistory = [...cloudHistory, ...localHistory]
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .filter((item, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr[idx - 1];
      const dt = Math.abs(
        new Date(item.timestamp || 0).getTime() - new Date(prev.timestamp || 0).getTime()
      );
      return !(dt < 5000 && item.title === prev.title);
    })
    .slice(0, 8);

  const canAnalyze = Boolean(manualPhotoDataUrl) || (snapshotExists && snapshotIsFresh);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5">
            <Camera size={24} className="text-primary" />
            Plant Vision
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            View your latest greenhouse camera snapshot or upload a leaf photo to check for pests, nutrient hunger, or disease.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Language Selector for Diagnosis Output */}
          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 h-10 flex-1 sm:flex-initial min-w-0">
            <Globe size={15} className="text-primary shrink-0" />
            <label htmlFor="vision-lang-select" className="sr-only">
              Report Language
            </label>
            <select
              id="vision-lang-select"
              value={selectedLangId}
              onChange={(e) => {
                setSelectedLangId(e.target.value);
                store.setValue('aiLanguage', e.target.value);
              }}
              className="bg-transparent text-xs font-semibold text-foreground focus:outline-none w-full min-w-0 truncate cursor-pointer"
            >
              {NIGERIAN_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  Report in {lang.name}
                </option>
              ))}
            </select>
          </div>

          {savedHttpPhotoUrl && httpDirectSupported && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCaptureHttpCamera}
              disabled={capturingHttpFrame || analyzing}
              className="h-10 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {capturingHttpFrame ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Camera size={14} className="mr-1.5 text-primary" />
              )}
              Capture HTTP Camera
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={handleRefreshSnapshot}
            disabled={camera.isRefreshing || loadingGhCam}
            className="h-10 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              size={14}
              className={cn('mr-1.5', (camera.isRefreshing || loadingGhCam) && 'animate-spin')}
            />
            Refresh Camera
          </Button>
        </div>
      </div>

      <MonitoringModeBanner />

      {/* Main Two-Column Inspection Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Left: Snapshot Preview & Action Controls */}
        <section className="lg:col-span-7 rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
          {/* Explicit Camera Connection, Freshness & Image Provenance Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b border-border">
            <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
              {manualPhotoDataUrl ? (
                <>
                  <span className="font-semibold text-warning">
                    UPLOADED TEST IMAGE
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Manual Device File</span>
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 font-semibold',
                      cameraConnected
                        ? 'bg-success/10 border-success/30 text-success'
                        : 'bg-muted border-border text-muted-foreground'
                    )}
                  >
                    {cameraConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {cameraConnected ? 'CONNECTED' : 'OFFLINE'}
                  </span>
                  {snapshotExists && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-semibold',
                        snapshotIsFresh
                          ? 'bg-success/10 border-success/30 text-success'
                          : 'bg-warning/10 border-warning/30 text-warning'
                      )}
                    >
                      {snapshotIsFresh ? <FileCheck size={13} /> : <AlertTriangle size={13} />}
                      {snapshotIsFresh ? 'Fresh Snapshot (≤90s)' : 'Outdated Snapshot (>90s)'}
                    </span>
                  )}
                </>
              )}
            </div>

            <Link
              to="/settings?tab=hardware"
              className="text-xs font-semibold text-primary hover:underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              CONNECT EXISTING HARDWARE
            </Link>
          </div>

          {/* Image Viewport */}
          <div className="w-full aspect-video rounded-xl overflow-hidden border border-border bg-muted/60 flex items-center justify-center relative">
            {manualPhotoDataUrl ? (
              <img
                src={manualPhotoDataUrl}
                alt="Selected leaf photo for inspection"
                className="w-full h-full object-contain"
              />
            ) : snapshotExists && snapshotUrl ? (
              <img
                src={snapshotUrl}
                alt="Latest ESP32-CAM greenhouse snapshot"
                className={cn(
                  'w-full h-full object-contain',
                  !snapshotIsFresh && 'opacity-85'
                )}
              />
            ) : (
              <div className="p-8 text-center max-w-md space-y-2.5">
                <div className="w-12 h-12 rounded-2xl bg-card border border-border flex items-center justify-center mx-auto text-muted-foreground">
                  <Camera size={22} />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  No Greenhouse Camera Snapshot Yet
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {activeGreenhouse
                    ? `Waiting for ${activeGreenhouse.name}'s ESP32-CAM to upload a JPEG photo. You can also upload a leaf photo from your phone below.`
                    : 'Connect your ESP32-CAM in Settings, or upload a clear photo of a plant leaf from your phone to inspect right now.'}
                </p>
              </div>
            )}
          </div>

          {/* Capture Timestamp & Clear Manual Photo */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            {manualPhotoDataUrl ? (
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="truncate max-w-[220px] sm:max-w-xs">
                  Selected file: {manualPhotoName || 'Leaf photograph'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setManualPhotoDataUrl(null);
                    setManualPhotoName('');
                  }}
                  className="inline-flex items-center gap-1 text-primary font-semibold hover:underline shrink-0 cursor-pointer"
                >
                  <X size={13} /> Switch back to Greenhouse Camera
                </button>
              </div>
            ) : (
              <span className="font-mono tabular-nums flex items-center gap-1.5 min-w-0 break-words">
                <Clock size={13} className="shrink-0" />
                <span className="min-w-0">
                  {snapshotTimestamp
                    ? `Captured ${new Date(snapshotTimestamp).toLocaleString()} (${formatFrameAge(snapshotAgeSec)})`
                    : 'Capture timestamp: None recorded yet'}
                </span>
              </span>
            )}

            <Link
              to="/settings?tab=hardware"
              className="text-xs font-medium text-primary hover:underline underline-offset-4 shrink-0"
            >
              Camera Settings
            </Link>
          </div>

          {/* Stale Snapshot Honesty Notice */}
          {!manualPhotoDataUrl && snapshotExists && !snapshotIsFresh && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 text-warning px-4 py-3 text-xs flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">Snapshot is outdated</p>
                <p className="leading-relaxed">
                  This camera photo is older than 90 seconds, so EDENS AI disables live-camera diagnosis until a fresh photo arrives. You can still upload a leaf photo from your phone right now.
                </p>
              </div>
            </div>
          )}

          {/* Primary Action Bar: Analyze Plant + Snap Leaf Photo + Upload Leaf Photo */}
          <div className="pt-2 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
            <Button
              type="button"
              disabled={!canAnalyze || analyzing || preparingPhoto}
              onClick={handleAnalyzePlant}
              className="h-11 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold sm:flex-1 sm:min-w-[200px] cursor-pointer"
            >
              {analyzing ? (
                <>
                  <Loader2 size={17} className="animate-spin mr-2" />
                  <span>Inspecting Plant Leaves...</span>
                </>
              ) : preparingPhoto ? (
                <>
                  <Loader2 size={17} className="animate-spin mr-2" />
                  <span>Preparing Photo...</span>
                </>
              ) : (
                <>
                  <Sparkles size={17} className="mr-2" />
                  <span>
                    {manualPhotoDataUrl ? 'Analyze Leaf Photo' : 'Analyze Plant Snapshot'}
                  </span>
                </>
              )}
            </Button>

            <div className="grid grid-cols-2 sm:flex items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={analyzing || preparingPhoto}
                onClick={() => setCameraModalOpen(true)}
                className="h-11 px-3 sm:px-4 rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
              >
                <Camera size={16} className="mr-1.5 sm:mr-2 text-primary shrink-0" />
                <span className="truncate">Snap Leaf Photo</span>
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleManualPhotoUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                disabled={analyzing || preparingPhoto}
                onClick={() => fileInputRef.current?.click()}
                className="h-11 px-3 sm:px-4 rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
              >
                <ImageUp size={16} className="mr-1.5 sm:mr-2 text-primary shrink-0" />
                <span className="truncate">{preparingPhoto ? 'Loading...' : 'Upload Photo'}</span>
              </Button>
            </div>
          </div>

          {analysisError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-xs flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span className="leading-relaxed">{analysisError}</span>
            </div>
          )}
        </section>

        {/* Right: Structured AI Plant Inspection Result */}
        <section className="lg:col-span-5 rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-accent text-primary flex items-center justify-center shrink-0">
                <Leaf size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Plant Health Report</h2>
                <p className="text-xs text-muted-foreground">Clear observations &amp; next steps</p>
              </div>
            </div>

            {analysisResult && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingSpeech}
                onClick={handleSpeakReport}
                className="h-9 px-3 rounded-lg text-xs font-semibold cursor-pointer"
              >
                {loadingSpeech ? (
                  <Loader2 size={13} className="animate-spin mr-1.5" />
                ) : speakingReport ? (
                  <Square size={12} className="mr-1.5 text-primary" />
                ) : (
                  <Volume2 size={14} className="mr-1.5 text-primary" />
                )}
                {speakingReport ? 'Stop' : 'Listen'}
              </Button>
            )}
          </div>

          {analysisResult ? (
            <div className="space-y-4 text-sm">
              {/* Explicit Image Provenance & Capture Timestamp Metadata */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-muted-foreground pb-2 border-b border-border">
                <span
                  className={cn(
                    'font-semibold',
                    analysisResult.imageOriginLabel === 'UPLOADED_TEST_IMAGE' || Boolean(manualPhotoDataUrl)
                      ? 'text-warning'
                      : 'text-success'
                  )}
                >
                  {analysisResult.imageOriginLabel === 'UPLOADED_TEST_IMAGE' || Boolean(manualPhotoDataUrl)
                    ? 'UPLOADED TEST IMAGE'
                    : 'REAL CAMERA IMAGE'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {analysisResult.capturedAt
                    ? `Captured ${new Date(analysisResult.capturedAt).toLocaleString()}`
                    : !manualPhotoDataUrl && snapshotTimestamp
                      ? `Captured ${new Date(snapshotTimestamp).toLocaleString()}`
                      : 'Manual file inspection'}
                </span>
              </div>

              <div className="rounded-xl bg-muted/50 p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Plant Identified</span>
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded border',
                    /unhealth|diseas|pest|critical|poor|infected/i.test(analysisResult.healthStatus)
                      ? 'bg-destructive/10 text-destructive border-destructive/30'
                      : /stress|warn|moderat|fair|caution/i.test(analysisResult.healthStatus)
                        ? 'bg-warning/10 text-warning border-warning/30'
                        : 'bg-success/10 text-success border-success/30'
                  )}>
                    {analysisResult.healthStatus}
                  </span>
                </div>
                <p className="text-base font-bold text-foreground">
                  {analysisResult.species}
                  {analysisResult.speciesLocal ? ` (${analysisResult.speciesLocal})` : ''}
                </p>
                {analysisResult.healthStatusLocal && (
                  <p className="text-xs text-muted-foreground">{analysisResult.healthStatusLocal}</p>
                )}
              </div>

              <div className="space-y-3 text-xs leading-relaxed">
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Diagnosis &amp; Observed Symptoms</h3>
                  <p className="text-muted-foreground">{analysisResult.symptoms}</p>
                </div>

                <div className="pt-2 border-t border-border">
                  <h3 className="font-semibold text-foreground mb-1">Possible Causes</h3>
                  {Array.isArray(analysisResult.possibleCauses) &&
                  analysisResult.possibleCauses.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                      {analysisResult.possibleCauses.map((causeItem, idx) => (
                        <li key={idx}>{causeItem}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">{analysisResult.cause}</p>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <h3 className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-primary" />
                    Recommended Actions
                  </h3>
                  {Array.isArray(analysisResult.recommendedActions) &&
                  analysisResult.recommendedActions.length > 0 ? (
                    <ol className="list-decimal pl-4 space-y-1 text-foreground font-medium">
                      {analysisResult.recommendedActions.map((actItem, idx) => (
                        <li key={idx}>{actItem}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-foreground font-medium whitespace-pre-line">
                      {analysisResult.recommendation}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 border border-border p-3 text-[11px] text-muted-foreground space-y-1.5">
                <div className="flex items-start gap-2">
                  <Info size={14} className="shrink-0 mt-0.5 text-primary" />
                  <span>
                    {analysisResult.confidenceNote ||
                      'Confidence percentage omitted: visual LLM plant inspection is not calibrated as a statistical probability.'}
                  </span>
                </div>
                <p className="pl-5">
                  Camera photos show surface symptoms only. Check the underside of leaves, stems, and root moisture in person before applying sprays or fertilizers.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-muted/50 p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">Ready to Inspect Your Crop</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tap <strong className="text-foreground">Analyze Plant Snapshot</strong> when a fresh greenhouse photo is shown, or tap <strong className="text-foreground">Snap Leaf Photo</strong> / <strong className="text-foreground">Upload Photo</strong> to inspect a leaf from your phone or camera.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Past Plant Inspections */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Past Plant Inspections</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recent leaf assessments saved from your greenhouse camera and uploaded photos.
          </p>
        </div>

        {combinedHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No plant inspections recorded yet. Your completed checks will appear here.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {combinedHistory.map((item) => (
              <div
                key={item.id}
                className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
                  {item.source} · {formatRelativeAge(null, item.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <LeafCameraModal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCapture={(dataUrl, fileName) => {
          setAnalysisError(null);
          setAnalysisResult(null);
          setManualPhotoDataUrl(dataUrl);
          setManualPhotoName(fileName);
        }}
      />
    </div>
  );
}
