import React, { useState, useEffect, useRef } from 'react';
import { hardwareService } from '../lib/hardwareService';
import { CameraStatusResponse, LatestUploadedImage } from '../lib/hardwareTypes';
import { DataSourceBadge } from './DataSourceBadge';
import { HardwareSetupGuide } from './HardwareSetupGuide';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { Camera, RefreshCw, Sparkles, Check, Upload, Clock, FileCheck, AlertTriangle } from 'lucide-react';

interface CameraStreamProps {
  onCapture?: (base64Image: string) => void;
  className?: string;
  showControls?: boolean;
}

export function CameraStream({ onCapture, className, showControls = true }: CameraStreamProps) {
  const [cameraStatus, setCameraStatus] = useState<CameraStatusResponse | null>(null);
  const [latestUploaded, setLatestUploaded] = useState<LatestUploadedImage | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isUploadingTest, setIsUploadingTest] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [snapshotSuccess, setSnapshotSuccess] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const config = hardwareService.getConfig();
  const streamUrl = hardwareService.getCameraStreamUrl();

  const refreshStatus = async () => {
    try {
      const [status, uploaded] = await Promise.all([
        hardwareService.getCameraStatus(),
        hardwareService.getLatestUploadedCameraImage()
      ]);
      setCameraStatus(status);
      setLatestUploaded(uploaded);
      setStreamError(!status.connected && config.mode !== 'simulation');
      if (uploaded && uploaded.exists && uploaded.base64 && !lastSnapshot) {
        setLastSnapshot(uploaded.base64);
      }
    } catch (_) {
      setStreamError(true);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 6000);
    return () => clearInterval(interval);
  }, [config.cameraHost, config.mode]);

  const handleCaptureSnapshot = async () => {
    setIsCapturing(true);
    setSnapshotSuccess(false);
    setUploadError(null);
    try {
      const result = await hardwareService.getCameraSnapshot();
      setLastSnapshot(result.base64Image);
      setSnapshotSuccess(true);
      setTimeout(() => setSnapshotSuccess(false), 3500);
      if (onCapture) {
        onCapture(result.base64Image);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Snapshot capture failed');
    } finally {
      setIsCapturing(false);
    }
  };

  // Simulates or tests uploading a real botanical JPEG frame to POST /api/camera/upload
  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingTest(true);
    setUploadError(null);
    setUploadSuccessMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await hardwareService.uploadCameraImage(arrayBuffer, 'edens_camera_secret_2026');
      setUploadSuccessMessage(`Uploaded frame ${res.imageId} (${Math.round(res.sizeBytes / 1024)} KB) successfully!`);
      await refreshStatus();
      setTimeout(() => setUploadSuccessMessage(null), 5000);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setIsUploadingTest(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="w-full aspect-video bg-[#050505] rounded-3xl overflow-hidden relative border border-[#222] shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] group">
        {/* Stream, Uploaded Frame, or Standby Canvas */}
        {latestUploaded && latestUploaded.exists && latestUploaded.base64 ? (
          <img
            src={latestUploaded.base64}
            alt="Latest ESP32-CAM Upload"
            className="w-full h-full object-cover transition-all duration-500"
          />
        ) : streamUrl && !streamError ? (
          <img
            ref={imgRef}
            src={streamUrl}
            alt="ESP32-CAM MJPEG Stream"
            onError={() => setStreamError(true)}
            crossOrigin="anonymous"
            className="w-full h-full object-cover transition-all duration-500"
          />
        ) : lastSnapshot ? (
          <img
            src={lastSnapshot}
            alt="Last Camera Snapshot"
            className="w-full h-full object-cover transition-all duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0A0A0A] to-[#000000]">
            <div className="w-16 h-16 rounded-3xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center mb-3 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
              <Camera size={32} className="text-[#10B981] opacity-80" />
            </div>
            <p className="font-bold text-white uppercase text-sm tracking-widest mb-1">
              {config.mode === 'simulation' ? 'Simulated Camera Feed Active' : 'ESP32-CAM Push Intake Standby'}
            </p>
            <p className="opacity-60 max-w-sm text-xs leading-relaxed mb-4">
              {config.mode === 'simulation' 
                ? 'Simulation mode generates botanical plant models for vision agent testing.'
                : 'Awaiting image upload at POST /api/camera/upload from greenhouse ESP32-CAM.'}
            </p>
            <div className="flex items-center gap-3">
              <HardwareSetupGuide variant="button" />
              <Button
                size="sm"
                variant="outline"
                onClick={handleCaptureSnapshot}
                disabled={isCapturing}
                className="border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981]/10 text-xs font-bold"
              >
                <Sparkles size={14} className="mr-1.5" />
                {isCapturing ? 'Inspecting...' : 'Test Snapshot'}
              </Button>
            </div>
          </div>
        )}

        {/* Scanline CRT overlay */}
        <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+Cjwvc3ZnPg==')] opacity-40 mix-blend-overlay" />

        {/* Top Overlay Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2">
            <DataSourceBadge variant="badge" />
            {latestUploaded && latestUploaded.exists && (
              <span className="text-[10px] font-mono px-2.5 py-1 rounded-xl bg-emerald-950/80 backdrop-blur-md border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-1 shadow-sm">
                <FileCheck size={11} className="text-emerald-400" />
                ESP32-CAM Upload · {Math.round((latestUploaded.sizeBytes || 0) / 1024)} KB
              </span>
            )}
          </div>

          {latestUploaded && latestUploaded.timestamp ? (
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-white/90 flex items-center gap-1 font-semibold">
              <Clock size={11} className="text-emerald-400" />
              {latestUploaded.ageSeconds !== undefined 
                ? `${latestUploaded.ageSeconds}s ago` 
                : new Date(latestUploaded.timestamp).toLocaleTimeString()}
            </span>
          ) : cameraStatus && cameraStatus.connected ? (
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-white font-bold">
              {cameraStatus.sensorModel} · {cameraStatus.resolution}
            </span>
          ) : null}
        </div>

        {/* Snapshot Notification toast */}
        {snapshotSuccess && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-[#10B981] text-black font-bold text-xs flex items-center gap-1.5 shadow-lg animate-bounce">
            <Check size={14} /> Snapshot Captured & Ready for VisionAgent!
          </div>
        )}

        {/* Upload Success Toast */}
        {uploadSuccessMessage && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-emerald-500 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg">
            <Check size={14} /> {uploadSuccessMessage}
          </div>
        )}

        {/* Error Toast */}
        {uploadError && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-red-500/90 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg">
            <AlertTriangle size={14} /> {uploadError}
          </div>
        )}
      </div>

      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={isCapturing}
              className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-10 px-4 rounded-xl cursor-pointer text-xs shadow-md transition-all"
            >
              <Camera size={15} className="mr-2" />
              {isCapturing ? 'Analyzing Foliage...' : 'Capture Snapshot & Analyze'}
            </Button>

            {/* Test Upload Button */}
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
              title="Test uploading a JPEG frame to POST /api/camera/upload"
            >
              <Upload size={14} className="mr-1.5 text-emerald-500" />
              {isUploadingTest ? 'Uploading...' : 'Test Upload JPEG'}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshStatus}
              className="border-black/10 dark:border-white/10 hover:border-[#10B981] text-xs h-10 px-3 rounded-xl cursor-pointer"
              title="Refresh Camera Status & Uploads"
            >
              <RefreshCw size={14} />
            </Button>
          </div>

          <div className="text-[11px] font-mono opacity-70 flex items-center gap-2">
            <span>Intake:</span>
            <code className="bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded text-emerald-400 font-bold">
              POST /api/camera/upload
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
