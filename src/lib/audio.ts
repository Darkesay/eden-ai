/**
 * Audio helpers for EDENS AI:
 * - MediaRecorder capture for voice input in Nigerian languages (Hausa, Igbo, Yoruba, Pidgin, etc.)
 * - PCM to WAV conversion for Gemini 3.8 Flash Lite TTS (24kHz 16-bit mono)
 * - Audio playback management with pause, resume, and fallback to Web Speech API
 */

let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioContext: AudioContext | null = null;

/**
 * Converts 16-bit linear PCM byte buffer to a valid RIFF WAV Blob
 * Sample rate is typically 24000 Hz for Gemini TTS output
 */
export function pcmToWavBlob(
  pcmBytes: Uint8Array,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Blob {
  // Gemini 3.8 TTS unary generateContent returns a complete RIFF WAV file directly;
  // avoid prepending a duplicate 44-byte WAV header if RIFF...WAVE is already present.
  if (
    pcmBytes.length > 44 &&
    pcmBytes[0] === 0x52 && pcmBytes[1] === 0x49 && pcmBytes[2] === 0x46 && pcmBytes[3] === 0x46 &&
    pcmBytes[8] === 0x57 && pcmBytes[9] === 0x41 && pcmBytes[10] === 0x56 && pcmBytes[11] === 0x45
  ) {
    return new Blob([pcmBytes], { type: 'audio/wav' });
  }

  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmBytes.length, true);

  // Write the PCM audio samples
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmBytes, 44);

  return new Blob([wavBytes], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Converts base64 PCM data into an object URL for playback
 */
export function base64PcmToWavUrl(base64Pcm: string, sampleRate = 24000): string {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = pcmToWavBlob(bytes, sampleRate);
  return URL.createObjectURL(blob);
}

/**
 * Plays a WAV or audio URL with event hooks and cleanup
 */
export function playAudioUrl(
  url: string, 
  onEnded?: () => void,
  onError?: (err: any) => void
): HTMLAudioElement {
  stopAllAudio();

  const audio = new Audio(url);
  activeAudioElement = audio;

  audio.onended = () => {
    if (activeAudioElement === audio) {
      activeAudioElement = null;
    }
    onEnded?.();
  };

  audio.onerror = (e) => {
    if (activeAudioElement === audio) {
      activeAudioElement = null;
    }
    onError?.(e);
  };

  audio.play().catch(err => {
    console.warn("Audio play blocked or failed:", err);
    onError?.(err);
  });

  return audio;
}

/**
 * Stops any currently active speech, audio elements, or contexts
 */
export function stopAllAudio() {
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
    } catch (_) {}
    activeAudioElement = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }

  if (activeAudioContext) {
    try {
      activeAudioContext.close();
    } catch (_) {}
    activeAudioContext = null;
  }
}

/**
 * Fallback to browser SpeechSynthesis when offline or model TTS is unavailable
 */
export function speakWithBrowserTts(
  text: string, 
  speechCode: string = 'en-NG',
  onStart?: () => void,
  onEnd?: () => void
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  stopAllAudio();

  const cleanText = text
    .replace(/[*#_`>]/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  if (!cleanText) return false;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const prefix = speechCode.slice(0, 2).toLowerCase();
  const matchedVoice = 
    voices.find(v => v.lang.toLowerCase().startsWith(prefix)) ||
    voices.find(v => v.lang.includes('NG') || v.lang.includes('GB') || v.lang.includes('US')) ||
    voices[0];

  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
  return true;
}

export interface VoiceRecorderController {
  stop: () => Promise<{ blob: Blob; base64: string; mimeType: string }>;
  cancel: () => void;
  stream: MediaStream;
}

export type MicrophoneErrorCode = 
  | 'PERMISSION_DENIED' 
  | 'DEVICE_NOT_FOUND' 
  | 'DEVICE_BUSY' 
  | 'INSECURE_CONTEXT' 
  | 'UNSUPPORTED_BROWSER' 
  | 'EMPTY_AUDIO' 
  | 'GENERIC_ERROR';

export class MicrophoneAccessError extends Error {
  code: MicrophoneErrorCode;
  originalError?: any;

  constructor(code: MicrophoneErrorCode, message: string, originalError?: any) {
    super(message);
    this.name = 'MicrophoneAccessError';
    this.code = code;
    this.originalError = originalError;
  }
}

export interface MicrophoneSupportCheck {
  supported: boolean;
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  permissionState?: 'granted' | 'denied' | 'prompt' | 'unknown';
  errorReason?: 'INSECURE_CONTEXT' | 'UNSUPPORTED_BROWSER' | 'PERMISSION_DENIED';
  message?: string;
}

/**
 * Checks whether the browser and environment support microphone recording
 * without prompting the user prematurely.
 */
export async function checkMicrophoneSupport(): Promise<MicrophoneSupportCheck> {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      isSecureContext: false,
      hasGetUserMedia: false,
      hasMediaRecorder: false,
      errorReason: 'UNSUPPORTED_BROWSER',
      message: 'Running in non-browser environment.'
    };
  }

  const isSecure = window.isSecureContext !== false;
  const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia || (navigator as any).getUserMedia);
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  let permissionState: 'granted' | 'denied' | 'prompt' | 'unknown' = 'unknown';
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const res = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      permissionState = res.state as any;
    } catch (_) {
      // Permission query for microphone is not supported in all browsers
    }
  }

  if (!isSecure) {
    return {
      supported: false,
      isSecureContext: false,
      hasGetUserMedia,
      hasMediaRecorder,
      permissionState,
      errorReason: 'INSECURE_CONTEXT',
      message: 'Microphone access requires a secure connection (HTTPS or localhost). Unencrypted HTTP blocks audio recording.'
    };
  }

  if (!hasGetUserMedia || !hasMediaRecorder) {
    return {
      supported: false,
      isSecureContext: true,
      hasGetUserMedia,
      hasMediaRecorder,
      permissionState,
      errorReason: 'UNSUPPORTED_BROWSER',
      message: 'Your browser does not support audio recording (navigator.mediaDevices.getUserMedia / MediaRecorder).'
    };
  }

  return {
    supported: true,
    isSecureContext: true,
    hasGetUserMedia: true,
    hasMediaRecorder: true,
    permissionState
  };
}

/**
 * Validates audio file size and MIME type for voice note uploads.
 */
export function validateAudioFile(file: File, maxMb = 15): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No audio file selected.' };
  }

  const maxBytes = maxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Audio file (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of ${maxMb}MB.`
    };
  }

  if (file.size === 0) {
    return { valid: false, error: 'The selected audio file is empty (0 bytes).' };
  }

  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const allowedExts = ['.webm', '.wav', '.mp3', '.m4a', '.mp4', '.ogg', '.aac', '.flac'];
  const hasValidExt = allowedExts.some(ext => name.endsWith(ext));
  const hasValidType = type.startsWith('audio/') || type.includes('octet-stream') || type.startsWith('video/mp4') || type.startsWith('video/webm');

  if (!hasValidType && !hasValidExt) {
    return {
      valid: false,
      error: `Unsupported audio format "${file.type || name.split('.').pop()}". Supported formats: WebM, WAV, MP3, M4A, MP4, AAC, or OGG.`
    };
  }

  return { valid: true };
}

/**
 * Starts recording audio from user microphone with optimal browser mimeType detection
 * and detailed error categorization.
 */
export async function startAudioRecording(): Promise<VoiceRecorderController> {
  const support = await checkMicrophoneSupport();
  if (!support.supported) {
    if (support.errorReason === 'INSECURE_CONTEXT') {
      throw new MicrophoneAccessError('INSECURE_CONTEXT', support.message || 'Microphone requires HTTPS or localhost.');
    }
    throw new MicrophoneAccessError('UNSUPPORTED_BROWSER', support.message || 'Browser does not support microphone input.');
  }

  const getMedia = navigator.mediaDevices?.getUserMedia 
    ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
    : (constraints: MediaStreamConstraints) => new Promise<MediaStream>((resolve, reject) => {
        const legacyGetUserMedia = (navigator as any).getUserMedia || 
                                   (navigator as any).webkitGetUserMedia || 
                                   (navigator as any).mozGetUserMedia;
        if (!legacyGetUserMedia) {
          reject(new MicrophoneAccessError('UNSUPPORTED_BROWSER', 'getUserMedia is not supported by your browser environment.'));
        } else {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        }
      });

  let stream: MediaStream;
  try {
    stream = await getMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
  } catch (err: any) {
    try {
      stream = await getMedia({ audio: true });
    } catch (secondErr: any) {
      const eName = secondErr?.name || err?.name || '';
      const eMsg = secondErr?.message || err?.message || '';

      const lowerMsg = eMsg.toLowerCase();
      if (eName === 'NotAllowedError' || eName === 'PermissionDeniedError' || lowerMsg.includes('permission') || lowerMsg.includes('not allowed')) {
        throw new MicrophoneAccessError('PERMISSION_DENIED', 'Microphone permission was denied. Please allow microphone access in your browser or device settings.', secondErr);
      }
      if (eName === 'NotReadableError' || eName === 'TrackStartError' || lowerMsg.includes('in use') || lowerMsg.includes('busy')) {
        throw new MicrophoneAccessError('DEVICE_BUSY', 'Your microphone is currently in use by another app or tab. Please close other audio apps and retry.', secondErr);
      }
      if (eName === 'NotFoundError' || eName === 'DevicesNotFoundError' || lowerMsg.includes('not found') || lowerMsg.includes('no device') || lowerMsg.includes('missing')) {
        throw new MicrophoneAccessError('DEVICE_NOT_FOUND', 'No microphone device was detected. Please connect a microphone and retry.', secondErr);
      }
      if (eName === 'SecurityError' || lowerMsg.includes('insecure') || lowerMsg.includes('policy')) {
        throw new MicrophoneAccessError('INSECURE_CONTEXT', 'Microphone access is restricted by security policy or insecure context.', secondErr);
      }
      throw new MicrophoneAccessError('GENERIC_ERROR', `Could not access microphone: ${eMsg || 'Unknown error.'}`, secondErr);
    }
  }

  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav'
  ];

  let mimeType = '';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
    for (const t of preferredTypes) {
      if (MediaRecorder.isTypeSupported(t)) {
        mimeType = t;
        break;
      }
    }
  }

  let mediaRecorder: MediaRecorder;
  try {
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (_) {
    mediaRecorder = new MediaRecorder(stream);
  }

  const chunks: BlobPart[] = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.start(100);

  return {
    stream,
    cancel: () => {
      try {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      } catch (_) {}
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    },
    stop: () => {
      return new Promise((resolve, reject) => {
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => {
            try { track.stop(); } catch (_) {}
          });
          const finalType = mediaRecorder.mimeType || mimeType || 'audio/webm';
          const audioBlob = new Blob(chunks, { type: finalType });

          if (audioBlob.size === 0) {
            return reject(new MicrophoneAccessError('EMPTY_AUDIO', 'Audio recording captured 0 bytes. Please speak into your microphone and retry.'));
          }

          try {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Data = (reader.result as string).split(',')[1] || '';
              resolve({
                blob: audioBlob,
                base64: base64Data,
                mimeType: finalType.split(';')[0]
              });
            };
            reader.onerror = () => reject(new MicrophoneAccessError('GENERIC_ERROR', 'Failed to read recorded audio data.'));
            reader.readAsDataURL(audioBlob);
          } catch (err) {
            reject(err);
          }
        };

        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (err) {
          stream.getTracks().forEach(track => {
            try { track.stop(); } catch (_) {}
          });
          reject(err);
        }
      });
    }
  };
}
