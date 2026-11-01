import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ImageUp, Loader2, RefreshCw, X } from 'lucide-react';
import { prepareImageForDiagnosis } from '../lib/imageUtils';
import { Button } from './ui/button';

interface LeafCameraModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string, fileName: string) => void;
}

export function LeafCameraModal({ open, onClose, onCapture }: LeafCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCameraStream = useCallback(
    async (mode: 'environment' | 'user') => {
      stopCameraStream();
      setCameraError(null);
      setStartingCamera(true);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStartingCamera(false);
        setCameraError(
          'Direct browser camera streaming is not supported here. Tap "Open Phone Camera / Gallery" below to snap or pick a leaf photo.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        const msg =
          err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
            ? 'Camera permission was blocked by your browser. Allow camera access in your address bar, or tap "Open Phone Camera / Gallery" below.'
            : err?.name === 'NotFoundError'
              ? 'No camera was detected on this device. Tap "Open Phone Camera / Gallery" to choose a leaf photo.'
              : `Could not open live camera (${err?.message || 'camera busy'}). You can still snap or pick a photo below.`;
        setCameraError(msg);
      } finally {
        setStartingCamera(false);
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    if (!open) {
      stopCameraStream();
      setCapturedDataUrl(null);
      setCameraError(null);
      return;
    }
    if (!capturedDataUrl) {
      void startCameraStream(facingMode);
    }
    return () => {
      stopCameraStream();
    };
  }, [open, facingMode, capturedDataUrl, startCameraStream, stopCameraStream]);

  if (!open) return null;

  const handleSnapFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera video is still warming up. Wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    const maxDim = 1024;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopCameraStream();
    setCapturedDataUrl(jpegDataUrl);
  };

  const handleConfirmPhoto = () => {
    if (!capturedDataUrl) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    onCapture(capturedDataUrl, `leaf-capture-${stamp}.jpg`);
    onClose();
  };

  const handleFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fallbackInputRef.current) fallbackInputRef.current.value = '';
    if (!file) return;
    try {
      const normalized = await prepareImageForDiagnosis(file);
      onCapture(normalized, file.name || 'phone-leaf-photo.jpg');
      onClose();
    } catch (err: any) {
      setCameraError(
        err?.message || 'Could not load that photo. Please pick a clear JPG, PNG, or WebP leaf image.'
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leaf-camera-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card text-foreground shadow-xl">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent text-primary flex items-center justify-center shrink-0">
              <Camera size={18} />
            </div>
            <div className="min-w-0">
              <h2 id="leaf-camera-title" className="text-base font-semibold text-foreground">
                Snap Plant Leaf Photo
              </h2>
              <p className="text-xs text-muted-foreground">
                Hold a leaf steady in clear light so spots, pests, or yellowing are visible.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="w-full aspect-video rounded-xl overflow-hidden border border-border bg-stone-950 flex items-center justify-center relative">
            {capturedDataUrl ? (
              <img
                src={capturedDataUrl}
                alt="Captured plant leaf preview"
                className="w-full h-full object-contain"
              />
            ) : cameraError ? (
              <div className="p-6 text-center space-y-3 max-w-sm">
                <AlertTriangle size={24} className="text-amber-400 mx-auto" />
                <p className="text-xs text-stone-200 leading-relaxed">{cameraError}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {startingCamera && (
                  <div className="absolute inset-0 bg-stone-950/75 flex flex-col items-center justify-center gap-2 text-stone-200 text-xs">
                    <Loader2 size={22} className="animate-spin text-emerald-400" />
                    <span>Starting camera...</span>
                  </div>
                )}
              </>
            )}
          </div>

          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture="environment"
            onChange={handleFallbackFile}
            className="hidden"
          />

          {capturedDataUrl ? (
            <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center justify-between gap-2.5">
              <Button
                type="button"
                onClick={handleConfirmPhoto}
                className="h-11 sm:h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold sm:order-2 cursor-pointer"
              >
                <Check size={15} className="mr-1.5" />
                Use This Leaf Photo
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCapturedDataUrl(null)}
                className="h-11 sm:h-10 px-4 rounded-xl text-xs font-semibold sm:order-1 cursor-pointer"
              >
                <RefreshCw size={14} className="mr-1.5" />
                Retake Photo
              </Button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2.5">
              {!cameraError && (
                <Button
                  type="button"
                  disabled={startingCamera}
                  onClick={handleSnapFrame}
                  className="h-11 sm:h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold sm:order-2 cursor-pointer"
                >
                  <Camera size={15} className="mr-1.5" />
                  Capture Leaf
                </Button>
              )}

              <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:order-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                  }
                  disabled={startingCamera}
                  className="h-10 px-3 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw size={14} className="mr-1.5 shrink-0" />
                  <span className="truncate">Switch Cam</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="h-10 px-3 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <ImageUp size={14} className="mr-1.5 text-primary shrink-0" />
                  <span className="truncate">Phone Gallery</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
