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
      <div
        className={cn(
          'w-full bg-muted rounded-lg overflow-hidden relative border border-border',
          liveStreamCandidateUrl || latestFrame ? 'aspect-video' : ''
        )}
      >
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
          <div className="flex min-h-[300px] w-full flex-col items-center justify-center p-6 pt-24 text-center bg-muted">
            <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background mb-3">
              {status === 'RECONNECTING' || status === 'CONNECTING' ? (
                <Loader2 size={22} className="text-warning animate-spin" aria-hidden="true" />
              ) : (
                <WifiOff size={22} className="text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {camera.statusHeadline}
            </p>
            <p className="text-muted-foreground max-w-md text-xs leading-relaxed mb-4">
              {camera.statusDetail}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void camera.reconnectNow()}
              disabled={camera.isRefreshing}
            >
              <RefreshCw size={13} className={cn(camera.isRefreshing && 'animate-spin')} aria-hidden="true" />
              {camera.isRefreshing ? 'Checking…' : 'Check camera feed'}
            </Button>
          </div>
        )}

        {/* Top Status & Provenance Bar */}
        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-lg border bg-background/80 px-2 py-1 text-xs font-medium',
                connectionBadge === 'CONNECTED'
                  ? 'border-success/30 bg-success/10 text-success'
                  : connectionBadge === 'RECONNECTING'
                  ? 'border-warning/30 bg-warning/10 text-warning'
                  : 'border-border bg-background/80 text-muted-foreground'
              )}
            >
              {status === 'LIVE_STREAM' ? (
                <>
                  <Radio size={12} className="animate-pulse" aria-hidden="true" />
                  Connected · live MJPEG
                </>
              ) : connectionBadge === 'CONNECTED' ? (
                <>
                  <Wifi size={12} aria-hidden="true" />
                  Connected
                </>
              ) : connectionBadge === 'RECONNECTING' ? (
                <>
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                  Reconnecting{camera.nextRetryInSeconds !== null ? ` (${camera.nextRetryInSeconds}s)` : ''}
                </>
              ) : (
                <>
                  <WifiOff size={12} aria-hidden="true" />
                  Disconnected
                </>
              )}
            </span>

            {freshnessBadge && status !== 'LIVE_STREAM' && (
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border bg-background/80 px-2 py-1 text-xs font-medium',
                  freshnessBadge === 'FRESH'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-warning/30 bg-warning/10 text-warning'
                )}
              >
                {freshnessBadge === 'FRESH' ? (
                  <>
                    <FileCheck size={12} aria-hidden="true" />
                    Fresh · snapshot preview
                  </>
                ) : (
                  <>
                    <AlertTriangle size={12} aria-hidden="true" />
                    Stale · not live
                  </>
                )}
              </span>
            )}
          </div>

          <span className="flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2 py-1 text-xs text-foreground">
            <Clock size={12} className={cn(latestFrame?.isFresh ? 'text-success' : 'text-muted-foreground')} aria-hidden="true" />
            <span className="font-mono tabular">
              {lastImageTimestamp
                ? `${format(new Date(lastImageTimestamp), 'HH:mm:ss')} (${formatFrameAge(displayAgeSeconds)})`
                : 'Last capture: none'}
            </span>
          </span>
        </div>

        {/* Stale Frame Honesty Warning */}
        {latestFrame && !latestFrame.isFresh && !camera.isLiveStreamVerified && (
          <div className="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            <span>
              Historical snapshot from{' '}
              <span className="font-mono tabular">{format(new Date(latestFrame.timestamp), 'yyyy-MM-dd HH:mm:ss')}</span>{' '}
              (<span className="font-mono tabular">{formatFrameAge(displayAgeSeconds)}</span>). Camera is not currently uploading live frames.
            </span>
          </div>
        )}

        {uploadSuccessMessage && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs flex items-center gap-1.5">
            <Check size={14} aria-hidden="true" /> {uploadSuccessMessage}
          </div>
        )}

        {uploadError && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden="true" /> {uploadError}
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
            >
              <RefreshCw size={15} className={cn(camera.isRefreshing && 'animate-spin')} aria-hidden="true" />
              {camera.isRefreshing ? 'Refreshing…' : 'Refresh snapshot'}
            </Button>

            {allowAdminTestUpload && (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  value={testCameraKey}
                  onChange={(e) => setTestCameraKey(e.target.value)}
                  placeholder="X-Camera-Key"
                  aria-label="X-Camera-Key for test upload"
                  className="h-9 w-36 rounded-lg border border-input bg-background px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                  disabled={isUploadingTest}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={15} aria-hidden="true" />
                  {isUploadingTest ? 'Uploading…' : 'Upload test JPEG'}
                </Button>
              </>
            )}
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Camera size={13} aria-hidden="true" />
            <span>Auto-refreshing JPEG snapshot — not a continuous video stream</span>
          </div>
        </div>
      )}
    </div>
  );
}
