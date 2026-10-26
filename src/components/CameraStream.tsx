import React, { useState, useRef } from 'react';
import { hardwareService } from '../lib/hardwareService';
import { useCameraConnection, formatFrameAge } from '../lib/cameraConnectionManager';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import {
  Camera,
  RefreshCw,
  Check,
  Upload,
  Clock,
  FileCheck,
  AlertTriangle,
  Wifi,
  WifiOff,
  Loader2,
  Radio
} from 'lucide-react';
import { format } from 'date-fns';

interface CameraStreamProps {
  onCapture?: (base64Image: string) => void;
  className?: string;
  showControls?: boolean;
  allowAdminTestUpload?: boolean;
}

export function CameraStream({
  onCapture,
  className,
  showControls = true,
  allowAdminTestUpload = false
}: CameraStreamProps) {
  const camera = useCameraConnection();
  const [isUploadingTest, setIsUploadingTest] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [testCameraKey, setTestCameraKey] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSyncFreshFrame = async () => {
    setUploadError(null);
    const frame = await camera.refreshNow(false);
    if (frame?.isFresh && frame.base64 && onCapture) {
      onCapture(frame.base64);
    } else if (!frame) {
      setUploadError('No greenhouse camera photograph is currently available on the cloud server.');
    } else if (!frame.isFresh) {
      setUploadError(
        `Latest stored photograph is STALE (${formatFrameAge(camera.displayAgeSeconds)}) — not a fresh live capture.`
      );
    }
  };

  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = testCameraKey.trim();
    if (!token) {
      setUploadError('Enter X-Camera-Key before sending an authenticated test JPEG.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploadingTest(true);
    setUploadError(null);
    setUploadSuccessMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await hardwareService.uploadCameraImage(arrayBuffer, token);
      setUploadSuccessMessage(
        `Uploaded frame ${res.imageId} (${Math.max(1, Math.round(res.sizeBytes / 1024))} KB)`
      );
      await camera.refreshNow(false);
      setTimeout(() => setUploadSuccessMessage(null), 5000);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setIsUploadingTest(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const {
    latestFrame,
    status,
    connectionBadge,
    freshnessBadge,
    liveStreamCandidateUrl,
    displayAgeSeconds,
    lastImageTimestamp
  } = camera;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="w-full aspect-video bg-[#050505] rounded-2xl overflow-hidden relative border border-[#222] shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
        {liveStreamCandidateUrl ? (
          <img
            src={liveStreamCandidateUrl}
            alt="Greenhouse Camera Live Stream"
            onLoad={camera.notifyStreamLoaded}
            onError={camera.notifyStreamError}
            className="w-full h-full object-cover"
          />
        ) : latestFrame ? (
          <img
            key={latestFrame.id}
            src={latestFrame.url}
            alt="ESP32-CAM Greenhouse Snapshot"
            className={cn(
              'w-full h-full object-cover transition-opacity duration-300',
              !latestFrame.isFresh && 'opacity-80'
            )}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#070908]">
            <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center mb-3">
              {status === 'RECONNECTING' || status === 'CONNECTING' ? (
                <Loader2 size={26} className="text-amber-400 animate-spin" />
              ) : (
                <WifiOff size={26} className="text-gray-400" />
              )}
            </div>
            <p className="font-bold text-white uppercase text-xs tracking-wider mb-1">
              {camera.statusHeadline}
            </p>
            <p className="text-gray-400 max-w-md text-xs leading-relaxed mb-4">
              {camera.statusDetail}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void camera.reconnectNow()}
              disabled={camera.isRefreshing}
              className="border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981]/10 text-xs font-bold cursor-pointer"
            >
              <RefreshCw size={13} className={cn('mr-1.5', camera.isRefreshing && 'animate-spin')} />
              {camera.isRefreshing ? 'Checking...' : 'Check Camera Feed'}
            </Button>
          </div>
        )}

        {/* Top Status & Provenance Bar */}
        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums px-2.5 py-1 rounded-md backdrop-blur-md border font-bold flex items-center gap-1.5',
                connectionBadge === 'CONNECTED'
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                  : connectionBadge === 'RECONNECTING'
                  ? 'bg-amber-950/90 border-amber-500/40 text-amber-300'
                  : 'bg-neutral-900/90 border-white/15 text-gray-300'
              )}
            >
              {status === 'LIVE_STREAM' ? (
                <>
                  <Radio size={11} className="text-emerald-400 animate-pulse" />
                  CONNECTED · LIVE MJPEG
                </>
              ) : connectionBadge === 'CONNECTED' ? (
                <>
                  <Wifi size={11} className="text-emerald-400" />
                  CONNECTED
                </>
              ) : connectionBadge === 'RECONNECTING' ? (
                <>
                  <RefreshCw size={11} className="animate-spin text-amber-400" />
                  RECONNECTING{camera.nextRetryInSeconds !== null ? ` (${camera.nextRetryInSeconds}s)` : ''}
                </>
              ) : (
                <>
                  <WifiOff size={11} className="text-gray-400" />
                  DISCONNECTED
                </>
              )}
            </span>

            {freshnessBadge && status !== 'LIVE_STREAM' && (
              <span
                className={cn(
                  'text-[10px] font-mono tabular-nums px-2.5 py-1 rounded-md backdrop-blur-md border font-bold flex items-center gap-1.5',
                  freshnessBadge === 'FRESH'
                    ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
                    : 'bg-orange-950/90 border-orange-500/50 text-orange-300'
                )}
              >
                {freshnessBadge === 'FRESH' ? (
                  <>
                    <FileCheck size={11} className="text-emerald-400" />
                    FRESH · SNAPSHOT PREVIEW
                  </>
                ) : (
                  <>
                    <AlertTriangle size={11} className="text-orange-400" />
                    STALE · NOT LIVE
                  </>
                )}
              </span>
            )}
          </div>

          <span className="text-[10px] font-mono tabular-nums px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md border border-white/10 text-white/90 flex items-center gap-1.5">
            <Clock size={11} className={latestFrame?.isFresh ? 'text-emerald-400' : 'text-gray-400'} />
            {lastImageTimestamp
              ? `${format(new Date(lastImageTimestamp), 'HH:mm:ss')} (${formatFrameAge(displayAgeSeconds)})`
              : 'Last capture: None'}
          </span>
        </div>

        {/* Stale Frame Honesty Warning */}
        {latestFrame && !latestFrame.isFresh && !camera.isLiveStreamVerified && (
          <div className="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-lg bg-orange-950/90 border border-orange-500/40 text-orange-200 text-[11px] font-mono tabular-nums flex items-center gap-2">
            <AlertTriangle size={14} className="text-orange-400 shrink-0" />
            <span>
              Historical snapshot from {format(new Date(latestFrame.timestamp), 'yyyy-MM-dd HH:mm:ss')} ({formatFrameAge(displayAgeSeconds)}). Camera is not currently uploading live frames.
            </span>
          </div>
        )}

        {uploadSuccessMessage && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-emerald-500 text-black font-bold text-xs flex items-center gap-1.5">
            <Check size={14} /> {uploadSuccessMessage}
          </div>
        )}

        {uploadError && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-red-600/95 text-white font-bold text-xs flex items-center gap-1.5">
            <AlertTriangle size={14} /> {uploadError}
          </div>
        )}
      </div>

      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handleSyncFreshFrame}
              disabled={camera.isRefreshing}
              className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-10 px-4 rounded-xl cursor-pointer text-xs"
            >
              <RefreshCw size={14} className={cn('mr-2', camera.isRefreshing && 'animate-spin')} />
              {camera.isRefreshing ? 'Refreshing...' : 'Refresh Snapshot'}
            </Button>

            {allowAdminTestUpload && (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  value={testCameraKey}
                  onChange={(e) => setTestCameraKey(e.target.value)}
                  placeholder="X-Camera-Key"
                  className="h-10 w-36 px-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-emerald-500/30 text-xs font-mono focus:outline-none focus:border-emerald-500"
                  title="Ephemeral X-Camera-Key header for testing POST /api/camera/upload (never stored)"
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleTestUpload}
                  accept="image/jpeg,image/jpg"
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploadingTest}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/10 text-xs h-10 px-3 rounded-xl cursor-pointer"
                >
                  <Upload size={14} className="mr-1.5 text-emerald-500" />
                  {isUploadingTest ? 'Uploading...' : 'Test Upload JPEG'}
                </Button>
              </>
            )}
          </div>

          <div className="text-[11px] font-mono tabular-nums opacity-75 flex items-center gap-1.5">
            <Camera size={12} className="text-emerald-400" />
            <span>Auto-refreshing JPEG snapshot · Not a continuous video stream</span>
          </div>
        </div>
      )}
    </div>
  );
}
