import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Camera,
  Check,
  Clock,
  FileCheck,
  Loader2,
  RefreshCw,
  Upload,
  Wifi,
  WifiOff
} from 'lucide-react';
import { hardwareService } from '../lib/hardwareService';
import { formatFrameAge, useCameraConnection } from '../lib/cameraConnectionManager';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

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
      setUploadError('No greenhouse camera photograph is stored on the server yet.');
    } else if (!frame.isFresh) {
      setUploadError(
        `Latest stored photograph is outdated (${formatFrameAge(camera.displayAgeSeconds)}) — not a live capture.`
      );
    }
  };

  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = testCameraKey.trim();
    if (!token) {
      setUploadError('Enter your X-Camera-Key before sending a test JPEG.');
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
    <div className={cn('space-y-3', className)}>
      {/* Metadata Strip Above Viewport */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium',
              connectionBadge === 'CONNECTED'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/45 dark:border-emerald-800/60 dark:text-emerald-300'
                : connectionBadge === 'RECONNECTING'
                  ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/45 dark:border-amber-800/60 dark:text-amber-300'
                  : 'bg-muted border-border text-muted-foreground'
            )}
          >
            {connectionBadge === 'CONNECTED' ? (
              <Wifi size={13} />
            ) : connectionBadge === 'RECONNECTING' ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <WifiOff size={13} />
            )}
            {connectionBadge === 'CONNECTED'
              ? 'Camera Connected'
              : connectionBadge === 'RECONNECTING'
                ? 'Checking Camera...'
                : 'Camera Offline'}
          </span>

          {freshnessBadge && status !== 'LIVE_STREAM' && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium',
                freshnessBadge === 'FRESH'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/45 dark:border-emerald-800/60 dark:text-emerald-300'
                  : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/45 dark:border-amber-800/60 dark:text-amber-300'
              )}
            >
              {freshnessBadge === 'FRESH' ? <FileCheck size={13} /> : <AlertTriangle size={13} />}
              {freshnessBadge === 'FRESH' ? 'Fresh Photo' : 'Outdated Photo'}
            </span>
          )}

          <span className="text-muted-foreground">
            {status === 'LIVE_STREAM' ? 'Local LAN Stream' : 'Uploaded Photograph (Not Live Video)'}
          </span>
        </div>

        <span className="font-mono tabular-nums text-muted-foreground flex items-center gap-1.5">
          <Clock size={13} />
          {lastImageTimestamp
            ? `${format(new Date(lastImageTimestamp), 'HH:mm:ss')} (${formatFrameAge(displayAgeSeconds)})`
            : 'No photo uploaded yet'}
        </span>
      </div>

      {/* Camera Frame */}
      <div className="w-full aspect-video rounded-xl overflow-hidden relative border border-border bg-stone-100 dark:bg-stone-950">
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
            className={cn('w-full h-full object-contain bg-stone-950', !latestFrame.isFresh && 'opacity-85')}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-muted/60">
            <div className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center mb-3 text-muted-foreground">
              {status === 'RECONNECTING' || status === 'CONNECTING' ? (
                <Loader2 size={22} className="text-primary animate-spin" />
              ) : (
                <Camera size={22} />
              )}
            </div>
            <p className="font-semibold text-foreground text-sm mb-1">{camera.statusHeadline}</p>
            <p className="text-muted-foreground max-w-md text-xs leading-relaxed mb-4">
              {camera.statusDetail}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void camera.reconnectNow()}
              disabled={camera.isRefreshing}
              className="h-9 px-3.5 text-xs font-semibold cursor-pointer"
            >
              <RefreshCw size={13} className={cn('mr-1.5', camera.isRefreshing && 'animate-spin')} />
              {camera.isRefreshing ? 'Checking...' : 'Check Camera Now'}
            </Button>
          </div>
        )}
      </div>

      {latestFrame && !latestFrame.isFresh && !camera.isLiveStreamVerified && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-200 px-3.5 py-2.5 text-xs flex items-start gap-2">
          <AlertTriangle size={15} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>
            This photograph was captured on{' '}
            <strong className="font-mono tabular-nums">
              {format(new Date(latestFrame.timestamp), 'yyyy-MM-dd HH:mm:ss')}
            </strong>{' '}
            ({formatFrameAge(displayAgeSeconds)}). Your camera is not currently sending new photos.
          </span>
        </div>
      )}

      {uploadSuccessMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-3.5 py-2 text-xs font-medium flex items-center gap-2">
          <Check size={14} className="text-emerald-700 dark:text-emerald-400" /> {uploadSuccessMessage}
        </div>
      )}

      {uploadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200 px-3.5 py-2 text-xs font-medium flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-700 dark:text-red-400" /> {uploadError}
        </div>
      )}

      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSyncFreshFrame}
              disabled={camera.isRefreshing}
              className="h-10 px-4 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <RefreshCw size={14} className={cn('mr-1.5', camera.isRefreshing && 'animate-spin')} />
              {camera.isRefreshing ? 'Refreshing...' : 'Refresh Snapshot'}
            </Button>

            {allowAdminTestUpload && (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  value={testCameraKey}
                  onChange={(e) => setTestCameraKey(e.target.value)}
                  placeholder="Enter X-Camera-Key"
                  className="h-10 w-44 px-3 rounded-lg bg-background border border-input text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  title="One-time X-Camera-Key header for testing POST /api/camera/upload (never saved)"
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
                  disabled={isUploadingTest}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  <Upload size={14} className="mr-1.5 text-primary" />
                  {isUploadingTest ? 'Uploading...' : 'Send Test JPEG'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
