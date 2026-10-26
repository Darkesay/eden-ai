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
    <div className="rounded-2xl border border-[#10B981]/30 bg-[#070B08] p-5 text-[#F0F0F0] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-base text-white flex items-center gap-2">
            <QrCode size={18} className="text-[#10B981]" />
            {title}
          </h4>
          <p className="text-xs text-[#9CA3AF] mt-1">{subtitle}</p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30">
          One-Time Token
        </span>
      </div>

      <div className="flex justify-center bg-white p-3 rounded-xl w-fit mx-auto shadow-md">
        <img src={qrDataUrl} alt="EDENS Enrollment QR Code" className="w-52 h-52 object-contain" />
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between bg-[#0D1410] border border-[#1A2A1A] rounded-xl px-3 py-2">
          <span className="font-mono text-[#D1FAE5] truncate mr-2">{enrollmentCode}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[#10B981] hover:text-[#34D399] font-medium shrink-0"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy Code'}
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <span className="flex items-center gap-1 text-[#10B981]/90">
            <ShieldCheck size={13} /> Revocable & non-secret
          </span>
          <span>Expires: {new Date(expiresAt).toLocaleTimeString()}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl border border-[#1A2A1A] bg-[#080C09] text-[#F0F0F0] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1A2A1A]">
          <div className="flex items-center gap-2.5">
            <Camera size={20} className="text-[#10B981]" />
            <h3 className="font-bold text-lg">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square max-h-72 mx-auto border border-[#10B981]/30 flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraState === 'active' ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraState === 'active' && (
              <div className="absolute inset-8 border-2 border-[#10B981]/80 rounded-2xl pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            )}

            {cameraState === 'starting' && (
              <div className="flex flex-col items-center gap-2 text-sm text-[#9CA3AF] p-6 text-center">
                <Loader2 size={28} className="animate-spin text-[#10B981]" />
                <span>Opening mobile camera scanner...</span>
              </div>
            )}

            {(cameraState === 'denied' || cameraState === 'unavailable') && (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-xs text-amber-300 leading-relaxed">{cameraError}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={startCamera}
                  className="border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981]/10"
                >
                  <RefreshCw size={14} className="mr-1.5" /> Retry Camera
                </Button>
              </div>
            )}
          </div>

          {scanError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
              {scanError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex-1 cursor-pointer">
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              <span className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#1A2A1A] bg-[#0D1410] hover:border-[#10B981]/50 px-3 py-2.5 text-xs font-medium text-[#D1FAE5] transition-colors">
                <ImageUp size={15} className="text-[#10B981]" />
                Scan QR Photo / Screenshot
              </span>
            </label>
          </div>

          <div className="border-t border-[#1A2A1A] pt-4 space-y-2">
            <label className="text-xs font-medium text-[#9CA3AF] flex items-center gap-1.5">
              <KeyRound size={13} className="text-[#10B981]" />
              Or paste one-time enrollment code (e.g. enr_...)
            </label>
            <div className="flex gap-2">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="enr_..."
                className="bg-[#040605] border-[#1A2A1A] text-white font-mono text-xs"
              />
              <Button
                type="button"
                disabled={!manualCode.trim() || submitting}
                onClick={() => handleDecodedValue(manualCode)}
                className="bg-[#10B981] hover:bg-[#059669] text-black font-semibold shrink-0"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : 'Verify'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
