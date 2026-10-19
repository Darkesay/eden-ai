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

/**
 * Starts recording audio from user microphone with optimal browser mimeType detection
 */
export async function startAudioRecording(): Promise<VoiceRecorderController> {
  const getMedia = navigator.mediaDevices?.getUserMedia 
    ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
    : (constraints: MediaStreamConstraints) => new Promise<MediaStream>((resolve, reject) => {
        const legacyGetUserMedia = (navigator as any).getUserMedia || 
                                   (navigator as any).webkitGetUserMedia || 
                                   (navigator as any).mozGetUserMedia;
        if (!legacyGetUserMedia) {
          reject(new Error("getUserMedia is not supported by your browser environment."));
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
    console.warn("First getUserMedia attempt failed, retrying with basic { audio: true }:", err);
    try {
      stream = await getMedia({ audio: true });
    } catch (secondErr: any) {
      throw secondErr;
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
  for (const t of preferredTypes) {
    if (MediaRecorder.isTypeSupported(t)) {
      mimeType = t;
      break;
    }
  }

  const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
        mediaRecorder.stop();
      } catch (_) {}
      stream.getTracks().forEach(track => track.stop());
    },
    stop: () => {
      return new Promise((resolve, reject) => {
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          const finalType = mediaRecorder.mimeType || mimeType || 'audio/webm';
          const audioBlob = new Blob(chunks, { type: finalType });

          try {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Data = (reader.result as string).split(',')[1] || '';
              resolve({
                blob: audioBlob,
                base64: base64Data,
                mimeType: finalType.split(';')[0] // remove codecs part for Gemini inlineData
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
          } catch (err) {
            reject(err);
          }
        };

        try {
          mediaRecorder.stop();
        } catch (err) {
          reject(err);
        }
      });
    }
  };
}
