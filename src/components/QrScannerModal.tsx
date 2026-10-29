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
  subtitle = 'Short-lived, single-use enrollment code — contains zero hardware secrets.'
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
    <div className="rounded-xl border border-border bg-card p-5 text-foreground space-y-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
            <QrCode size={18} className="text-primary" />
            {title}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-accent text-accent-foreground border border-primary/20 whitespace-nowrap shrink-0">
          One-Time Code
        </span>
      </div>

      <div className="flex justify-center bg-white p-3 rounded-xl w-fit mx-auto border border-border">
        <img src={qrDataUrl} alt="EDENS Enrollment QR Code" className="w-48 h-48 object-contain" />
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between bg-muted border border-border rounded-lg px-3 py-2">
          <span className="font-mono tabular-nums text-foreground truncate mr-2">{enrollmentCode}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-primary hover:underline font-semibold shrink-0 cursor-pointer"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy Code'}
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 text-primary font-medium">
            <ShieldCheck size={13} /> Safe &amp; revocable
          </span>
          <span className="font-mono tabular-nums">Expires: {new Date(expiresAt).toLocaleTimeString()}</span>
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
  title = 'Scan Greenhouse Kit QR Code'
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
      setCameraError('Phone camera is unavailable in this browser. Upload a photo of your QR sticker or type the code below.');
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
          ? 'Camera access was blocked. Allow camera permission in your browser, or upload a photo of the QR sticker below.'
          : 'Could not open your camera. Upload a photo of the QR sticker or paste the code below.'
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
        setScanError('No QR code was detected in that photo. Make sure the QR sticker is clear and well-lit.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card text-foreground shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Camera size={20} className="text-primary" />
            <h3 className="font-semibold text-base">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close scanner"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative rounded-xl overflow-hidden bg-stone-900 aspect-square max-h-68 mx-auto border border-border flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraState === 'active' ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraState === 'active' && (
              <div className="absolute inset-8 border-2 border-white/80 rounded-xl pointer-events-none" />
            )}

            {cameraState === 'starting' && (
              <div className="flex flex-col items-center gap-2 text-sm text-stone-300 p-6 text-center">
                <Loader2 size={26} className="animate-spin text-emerald-400" />
                <span>Starting camera...</span>
              </div>
            )}

            {(cameraState === 'denied' || cameraState === 'unavailable') && (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-xs text-stone-200 leading-relaxed">{cameraError}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={startCamera}
                  className="bg-white text-stone-900 hover:bg-stone-100 h-9 px-3.5 text-xs font-semibold"
                >
                  <RefreshCw size={14} className="mr-1.5" /> Try Camera Again
                </Button>
              </div>
            )}
          </div>

          {scanError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              {scanError}
            </div>
          )}

          <label className="block cursor-pointer">
            <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            <span className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted hover:bg-secondary px-3 text-xs font-semibold text-foreground transition-colors">
              <ImageUp size={15} className="text-primary" />
              Upload Photo of QR Sticker
            </span>
          </label>

          <div className="border-t border-border pt-4 space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <KeyRound size={13} className="text-primary" />
              Or enter the code printed below the QR sticker
            </label>
            <div className="flex gap-2">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="enr_..."
                className="h-10 bg-background border-input font-mono text-xs"
              />
              <Button
                type="button"
                disabled={!manualCode.trim() || submitting}
                onClick={() => handleDecodedValue(manualCode)}
                className="h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shrink-0 cursor-pointer"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
