import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Check, Copy, ImageUp, KeyRound, Loader2, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface QrCodeCardProps {
  qrDataUrl: string;
  enrollmentCode: string;
  expiresAt: string;
  title?: string;
  subtitle?: string;
}

export function QrCodeCard({
  qrDataUrl,
  enrollmentCode,
  expiresAt,
  title = 'EDENS AI Enrollment QR',
  subtitle = 'Short-lived, one-time-use token — contains zero device or API secrets.'
}: QrCodeCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(enrollmentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 text-card-foreground space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <QrCode size={16} className="text-muted-foreground" aria-hidden="true" />
            {title}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          One-time token
        </span>
      </div>

      <div className="flex justify-center bg-white p-3 rounded-lg border border-border w-fit mx-auto">
        <img src={qrDataUrl} alt="EDENS Enrollment QR Code" className="w-52 h-52 object-contain" />
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <span className="font-mono text-sm text-foreground truncate">{enrollmentCode}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="shrink-0 text-brand"
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ShieldCheck size={13} className="text-success" aria-hidden="true" /> Revocable, not a secret
          </span>
          <span>Expires: <span className="font-mono tabular">{new Date(expiresAt).toLocaleTimeString()}</span></span>
        </div>
      </div>
    </div>
  );
}

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (rawCodeOrUri: string) => Promise<void> | void;
  title?: string;
}

export function QrScannerModal({
  open,
  onClose,
  onDetected,
  title = 'Scan EDENS Greenhouse Kit QR'
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'denied' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [manualCode, setManualCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanError, setScanError] = useState('');

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleDecodedValue = useCallback(
    async (value: string) => {
      if (!value.trim() || submitting) return;
      setSubmitting(true);
      setScanError('');
      stopCamera();
      try {
        await onDetected(value.trim());
      } catch (err: any) {
        setScanError(err?.message || 'Failed to verify QR code.');
      } finally {
        setSubmitting(false);
      }
    },
    [onDetected, stopCamera, submitting]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setScanError('');
    setCameraError('');
    setCameraState('starting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unavailable');
      setCameraError('Browser camera access is unavailable in this context. Upload a QR photo or enter the enrollment code below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('active');

      const nativeDetector =
        typeof (window as any).BarcodeDetector === 'function'
          ? new (window as any).BarcodeDetector({ formats: ['qr_code'] })
          : null;

      timerRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return;

        try {
          if (nativeDetector) {
            const barcodes = await nativeDetector.detect(video);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              handleDecodedValue(String(barcodes[0].rawValue));
              return;
            }
          }

          const width = video.videoWidth || 480;
          const height = video.videoHeight || 480;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const decoded = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
          if (decoded && decoded.data) {
            handleDecodedValue(decoded.data);
          }
        } catch {}
      }, 220);
    } catch (err: any) {
      const isDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setCameraState(isDenied ? 'denied' : 'unavailable');
      setCameraError(
        isDenied
          ? 'Camera permission was denied. Allow camera access and retry, or upload a photo of the QR code below.'
          : 'Could not open rear camera on this device. Upload a photo of the QR sticker or paste the enrollment code.'
      );
    }
  }, [handleDecodedValue, stopCamera]);

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError('');

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const decoded = jsQR(imageData.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (decoded && decoded.data) {
        handleDecodedValue(decoded.data);
      } else {
        setScanError('No valid QR code found in the selected photo. Ensure the QR square is sharp and well-lit.');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setScanError('Could not read the selected image file.');
    };
    img.src = objectUrl;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3.5 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-border">
          <div className="flex min-w-0 items-center gap-2.5">
            <Camera size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold">{title}</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close QR scanner"
            title="Close QR scanner"
            className="shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        <div className="p-5 space-y-5">
          <div className="relative rounded-lg overflow-hidden bg-muted aspect-square max-h-56 sm:max-h-72 mx-auto border border-border flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraState === 'active' ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraState === 'active' && (
              <div className="absolute inset-8 border-2 border-brand/70 rounded-lg pointer-events-none" />
            )}

            {cameraState === 'starting' && (
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground p-6 text-center">
                <Loader2 size={24} className="animate-spin" aria-hidden="true" />
                <span>Opening camera…</span>
              </div>
            )}

            {(cameraState === 'denied' || cameraState === 'unavailable') && (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-xs text-warning leading-relaxed">{cameraError}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={startCamera}
                >
                  <RefreshCw size={14} aria-hidden="true" /> Retry camera
                </Button>
              </div>
            )}
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Point the camera at the QR code on your greenhouse kit, or use one of the options below.
          </p>

          {scanError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
              {scanError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex-1 cursor-pointer">
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              <span className="w-full inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                <ImageUp size={15} className="text-muted-foreground" aria-hidden="true" />
                Scan QR photo or screenshot
              </span>
            </label>
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <label htmlFor="manual-enrollment-code" className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <KeyRound size={13} className="text-muted-foreground" aria-hidden="true" />
              Or paste one-time enrollment code (e.g. enr_...)
            </label>
            <div className="flex gap-2">
              <Input
                id="manual-enrollment-code"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="enr_..."
                className="h-10 bg-background border-input font-mono text-base sm:text-xs"
              />
              <Button
                type="button"
                disabled={!manualCode.trim() || submitting}
                onClick={() => handleDecodedValue(manualCode)}
                className="shrink-0"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : 'Verify'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
