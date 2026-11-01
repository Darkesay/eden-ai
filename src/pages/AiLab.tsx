import React, { useRef, useState, useEffect } from 'react';
import { useStoreValue, store, useStoreTable } from '../lib/store';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { 
  Camera, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  Clock, 
  Leaf, 
  Bot, 
  Volume2, 
  VolumeX, 
  Languages, 
  MessageSquare, 
  Send, 
  Sparkles, 
  RotateCcw,
  Mic,
  MicOff,
  Radio,
  Play,
  Pause,
  Square,
  Loader2,
  Upload,
  Volume1,
  AudioLines,
  Check,
  X,
  Headphones,
  ExternalLink,
  RefreshCw,
  Wifi,
  WifiOff
} from 'lucide-react';
import { 
  analyzePlantImage, 
  diagnoseLatestCameraFrame,
  CameraDiagnosisError,
  consultAgronomist, 
  transcribeSpeechAudio,
  generateSpeechAudio,
  PlantAnalysisResult, 
  NIGERIAN_LANGUAGES, 
  NigerianLanguage, 
  ChatMessage 
} from '../lib/gemini';
import { 
  startAudioRecording, 
  VoiceRecorderController, 
  base64PcmToWavUrl, 
  playAudioUrl, 
  stopAllAudio, 
  speakWithBrowserTts,
  MicrophoneAccessError,
  validateAudioFile
} from '../lib/audio';
import {
  useCameraConnection,
  formatFrameAge
} from '../lib/cameraConnectionManager';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { HardwareSetupGuide } from '../components/HardwareSetupGuide';

// Voice interaction pipeline state & error categorization
export type VoiceErrorType = 
  | 'permission'
  | 'not-found'
  | 'busy'
  | 'insecure-context'
  | 'unsupported'
  | 'empty-audio'
  | 'file-invalid'
  | 'transcription'
  | 'ai-service';

export interface VoiceErrorInfo {
  type: VoiceErrorType;
  title: string;
  message: string;
  actionHint?: string;
  canRetryMic?: boolean;
  canUploadFile?: boolean;
}

export default function AiLab() {
  const camera = useCameraConnection();
  const isVisionAgentEnabled = useStoreValue('agent_VisionAgent_enabled', false);
  const tempVal = useStoreValue('temperature', 24.5);
  const humVal = useStoreValue('humidity', 65.0);
  const soilVal = useStoreValue('soilMoisture', 52.0);
  const cropType = useStoreValue('cropType', 'Tomato (Tumatir / Tòmátì)');
  const hardwareDataSource = useStoreValue<string>('hardware_dataSource', 'SIMULATED');
  const hardwareLastSeen = useStoreValue('hardware_lastSeen', '');
  const isTelemetryStale =
    hardwareDataSource !== 'REAL_HARDWARE' ||
    (hardwareLastSeen ? (Date.now() - new Date(hardwareLastSeen).getTime()) > 15000 : true);

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<PlantAnalysisResult | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const historyTable = useStoreTable('ai_history');

  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const plantImageInputRef = useRef<HTMLInputElement>(null);

  // Language selection: Default to Nigerian Pidgin or Hausa / Yoruba / Igbo
  const [selectedLangId, setSelectedLangId] = useState<string>(() => {
    return localStorage.getItem('edens_ai_lang') || 'ha';
  });

  const activeLanguage = NIGERIAN_LANGUAGES.find(l => l.id === selectedLangId) || NIGERIAN_LANGUAGES[0];

  const handleSelectLanguage = (langId: string) => {
    setSelectedLangId(langId);
    localStorage.setItem('edens_ai_lang', langId);
  };

  // Audio state
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState<string | null>(null);
  const [audioCache, setAudioCache] = useState<Record<string, string>>({});
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => {
    return localStorage.getItem('edens_ai_autospeak') !== 'false';
  });
  const [voicePersona, setVoicePersona] = useState<string>(() => {
    return localStorage.getItem('edens_ai_voice') || 'Kore';
  });

  const handleToggleAutoSpeak = () => {
    const nextVal = !autoSpeak;
    setAutoSpeak(nextVal);
    localStorage.setItem('edens_ai_autospeak', String(nextVal));
  };

  const handleSelectVoicePersona = (voice: string) => {
    setVoicePersona(voice);
    localStorage.setItem('edens_ai_voice', voice);
  };

  // Play audio speech for given text
  const playSpeech = async (text: string, messageId: string, customStyle?: string) => {
    if (currentPlayingId === messageId) {
      stopAllAudio();
      setCurrentPlayingId(null);
      return;
    }

    stopAllAudio();
    setCurrentPlayingId(messageId);

    // If cached, play immediately
    if (audioCache[messageId]) {
      playAudioUrl(
        audioCache[messageId],
        () => setCurrentPlayingId(null),
        () => {
          setCurrentPlayingId(null);
          speakWithBrowserTts(text, activeLanguage.speechCode, undefined, () => setCurrentPlayingId(null));
        }
      );
      return;
    }

    setIsGeneratingSpeech(messageId);
    try {
      const pcmBase64 = await generateSpeechAudio(
        text,
        voicePersona,
        customStyle || `Warm, clear, articulate Nigerian agricultural expert speaking fluently in ${activeLanguage.name}`
      );
      const wavUrl = base64PcmToWavUrl(pcmBase64, 24000);
      setAudioCache(prev => ({ ...prev, [messageId]: wavUrl }));
      setIsGeneratingSpeech(null);

      playAudioUrl(
        wavUrl,
        () => setCurrentPlayingId(null),
        (err) => {
          console.warn("WAV playback error, falling back to speech synthesis:", err);
          setCurrentPlayingId(null);
          speakWithBrowserTts(text, activeLanguage.speechCode, undefined, () => setCurrentPlayingId(null));
        }
      );
    } catch (err) {
      console.warn("Gemini TTS error, falling back to browser speech synthesis:", err);
      setIsGeneratingSpeech(null);
      const spoken = speakWithBrowserTts(
        text,
        activeLanguage.speechCode,
        () => setCurrentPlayingId(messageId),
        () => setCurrentPlayingId(null)
      );
      if (!spoken) {
        setCurrentPlayingId(null);
      }
    }
  };

  // Capture and analyze plant image with active Nigerian language.
  // Strictly uses either an explicit user-uploaded leaf photo OR a verified fresh ESP32-CAM frame.
  // Never scrapes blank canvases or passes cached/stale snapshots as fresh physical camera captures.
  const handleCapture = async () => {
    setAnalyzing(true);
    setResult(null);
    setDiagnosisError(null);
    stopAllAudio();
    setCurrentPlayingId(null);

    try {
      let res: PlantAnalysisResult;
      let historyImageRef: string;

      if (customImagePreview) {
        res = await analyzePlantImage(customImagePreview, selectedLangId);
        historyImageRef = customImagePreview;
      } else {
        const syncedFrame = await camera.refreshNow(false);
        const activeFrame = syncedFrame || camera.latestFrame;

        if (!activeFrame) {
          setDiagnosisError(
            activeLanguage.id === 'ha'
              ? 'Babu hoton kyamara na greenhouse a halin yanzu. Jira ESP32-CAM ta turo sabon hoto ko ka loda hoton ganye da hannu.'
              : activeLanguage.id === 'pcm'
              ? 'No greenhouse camera picture dey available right now. Wait make ESP32-CAM upload fresh snapshot or upload leaf photo.'
              : 'No real greenhouse camera photograph is currently available. Wait for the ESP32-CAM to upload a fresh snapshot, or upload a leaf photo.'
          );
          setAnalyzing(false);
          return;
        }

        res = await diagnoseLatestCameraFrame(selectedLangId);
        historyImageRef = activeFrame.base64 || activeFrame.url;
        void camera.refreshNow(false);
      }

      setResult(res);

      store.addRow('ai_history', {
        timestamp: new Date().toISOString(),
        species: res.species || 'Unknown',
        speciesLocal: res.speciesLocal || res.species || 'Unknown',
        healthStatus: res.healthStatus || 'N/A',
        healthStatusLocal: res.healthStatusLocal || res.healthStatus || 'N/A',
        symptoms: res.symptoms || 'N/A',
        cause: res.cause || 'N/A',
        recommendation: res.recommendation || 'N/A',
        language: activeLanguage.name,
        image: historyImageRef
      });

      // Auto announce summary in Nigerian language if auto-speak is enabled
      if (autoSpeak && (res.audioSummary || res.recommendation)) {
        setTimeout(() => {
          const speechText = `${res.speciesLocal || res.species}. ${res.healthStatusLocal || res.healthStatus}. ${res.audioSummary || res.recommendation}`;
          playSpeech(speechText, 'diag-auto');
        }, 600);
      }
    } catch (e: any) {
      console.error(e);
      if (e instanceof CameraDiagnosisError) {
        if (e.code === 'STALE_CAMERA_FRAME') {
          setDiagnosisError(
            `Stale snapshot rejected (${formatFrameAge(e.ageSeconds ?? camera.displayAgeSeconds)}): EDENS AI will not diagnose an older stored photograph as a live physical capture. Wait for a fresh ESP32-CAM upload or upload a leaf photo.`
          );
        } else if (e.code === 'NO_CAMERA_FRAME') {
          setDiagnosisError(
            'No real greenhouse camera photograph is currently stored on the cloud server. Wait for the ESP32-CAM to upload a fresh snapshot, or upload a leaf photo.'
          );
        } else {
          setDiagnosisError(e.message);
        }
      } else {
        setDiagnosisError('EDENS AI plant diagnosis failed: ' + (e as Error).message);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePlantPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setDiagnosisError('Invalid image format. Please select a JPEG, PNG, or WebP photograph.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setDiagnosisError('Plant photo exceeds 10MB limit. Please upload an image under 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setCustomImagePreview(dataUrl);

      setAnalyzing(true);
      setResult(null);
      setDiagnosisError(null);
      stopAllAudio();
      setCurrentPlayingId(null);

      try {
        const res = await analyzePlantImage(dataUrl, selectedLangId);
        setResult(res);

        store.addRow('ai_history', {
          timestamp: new Date().toISOString(),
          species: res.species || 'Unknown',
          speciesLocal: res.speciesLocal || res.species || 'Unknown',
          healthStatus: res.healthStatus || 'N/A',
          healthStatusLocal: res.healthStatusLocal || res.healthStatus || 'N/A',
          symptoms: res.symptoms || 'N/A',
          cause: res.cause || 'N/A',
          recommendation: res.recommendation || 'N/A',
          language: activeLanguage.name,
          image: dataUrl
        });

        if (autoSpeak && (res.audioSummary || res.recommendation)) {
          setTimeout(() => {
            const speechText = `${res.speciesLocal || res.species}. ${res.healthStatusLocal || res.healthStatus}. ${res.audioSummary || res.recommendation}`;
            playSpeech(speechText, 'diag-auto');
          }, 600);
        }
      } catch (err: any) {
        console.error("Leaf photo diagnosis error:", err);
        setDiagnosisError(`Plant diagnosis failed: ${err.message}`);
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Interactive Agronomist Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [
    {
      role: 'assistant',
      content: activeLanguage.welcomeGreeting,
      timestamp: new Date().toISOString(),
      languageId: activeLanguage.id
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceState, setVoiceState] = useState<'ready' | 'requesting_mic' | 'recording' | 'uploading' | 'transcribing' | 'waiting_ai' | 'speaking' | 'completed' | 'error'>('ready');
  const [voiceError, setVoiceError] = useState<VoiceErrorInfo | null>(null);
  const recorderRef = useRef<VoiceRecorderController | null>(null);
  const timerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      stopAllAudio();
      if (recorderRef.current) {
        recorderRef.current.cancel();
        recorderRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const startRecording = async () => {
    setVoiceError(null);
    stopAllAudio();
    setCurrentPlayingId(null);
    setVoiceState('requesting_mic');

    try {
      const controller = await startAudioRecording();
      recorderRef.current = controller;
      setIsRecording(true);
      setVoiceState('recording');
      setRecordingSeconds(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setIsRecording(false);
      setVoiceState('error');

      if (err instanceof MicrophoneAccessError) {
        if (err.code === 'PERMISSION_DENIED') {
          setVoiceError({
            type: 'permission',
            title: 'Microphone Permission Blocked',
            message: 'Your browser or device has blocked microphone access for this page.',
            actionHint: 'Click the lock or camera/mic icon beside your address bar, switch Microphone to "Allow", then click Retry Microphone.',
            canRetryMic: true,
            canUploadFile: true
          });
          return;
        }
        if (err.code === 'DEVICE_NOT_FOUND') {
          setVoiceError({
            type: 'not-found',
            title: 'No Microphone Detected',
            message: 'No active microphone was detected on your computer or device.',
            actionHint: 'Please connect a microphone or headset, or upload a voice note below.',
            canRetryMic: true,
            canUploadFile: true
          });
          return;
        }
        if (err.code === 'DEVICE_BUSY') {
          setVoiceError({
            type: 'busy',
            title: 'Microphone In Use or Unavailable',
            message: 'Your microphone is currently in use by another application or browser tab.',
            actionHint: 'Close other applications using your microphone (e.g. Zoom, Teams) and click Retry Microphone.',
            canRetryMic: true,
            canUploadFile: true
          });
          return;
        }
        if (err.code === 'INSECURE_CONTEXT') {
          setVoiceError({
            type: 'insecure-context',
            title: 'Microphone Restricted (Insecure Connection)',
            message: 'Modern web browsers strictly require HTTPS or localhost to record live microphone audio.',
            actionHint: 'Access EDENS AI over HTTPS or localhost, or upload a recorded voice note below.',
            canRetryMic: false,
            canUploadFile: true
          });
          return;
        }
        if (err.code === 'UNSUPPORTED_BROWSER') {
          setVoiceError({
            type: 'unsupported',
            title: 'Microphone Recording Unsupported',
            message: 'Your browser does not support standard audio recording APIs.',
            actionHint: 'Try using Chrome, Safari, Edge, or Firefox, or use the Upload Voice Note button.',
            canRetryMic: false,
            canUploadFile: true
          });
          return;
        }
      }

      // Generic error fallback
      const isPermission = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      setVoiceError({
        type: isPermission ? 'permission' : 'not-found',
        title: isPermission ? 'Microphone Permission Blocked' : 'Microphone Unavailable',
        message: err.message || 'Could not initialize microphone.',
        actionHint: isPermission 
          ? 'Allow microphone access in your browser site settings and click Retry Microphone.'
          : 'Check your microphone device connection or upload an audio voice note.',
        canRetryMic: true,
        canUploadFile: true
      });
    }
  };

  const cancelRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setVoiceState('ready');
  };

  const stopAndTranscribe = async (autoSend: boolean = false) => {
    if (!recorderRef.current || !isRecording) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setIsTranscribing(true);
    setVoiceState('transcribing');
    setVoiceError(null);

    try {
      const { base64, mimeType } = await recorderRef.current.stop();
      recorderRef.current = null;

      const transcribedText = await transcribeSpeechAudio(base64, mimeType, selectedLangId);
      setIsTranscribing(false);
      setVoiceState('completed');

      if (transcribedText && transcribedText.trim()) {
        if (autoSend) {
          handleSendChat(transcribedText.trim(), true);
        } else {
          setChatInput(transcribedText.trim());
        }
      } else {
        setVoiceError({
          type: 'empty-audio',
          title: 'No Speech Detected',
          message: `Could not detect clear spoken words in ${activeLanguage.name}.`,
          actionHint: 'Please speak closer to your microphone or speak louder and try again.',
          canRetryMic: true,
          canUploadFile: true
        });
      }
    } catch (err: any) {
      console.error("Speech transcription error:", err);
      setIsTranscribing(false);
      recorderRef.current = null;
      setVoiceState('error');

      if (err.code === 'EMPTY_AUDIO') {
        setVoiceError({
          type: 'empty-audio',
          title: 'Empty Audio Recording',
          message: err.message || 'Audio recording captured 0 bytes.',
          actionHint: 'Please speak louder or closer to the microphone and retry.',
          canRetryMic: true,
          canUploadFile: true
        });
        return;
      }

      const isConfig = err.message && (err.message.includes('GEMINI_API_KEY') || err.message.includes('Render'));
      setVoiceError({
        type: isConfig ? 'ai-service' : 'transcription',
        title: isConfig ? 'AI Service Configuration' : 'Speech Transcription Error',
        message: err.message || 'Failed to process voice recording.',
        actionHint: isConfig 
          ? 'Please set GEMINI_API_KEY in your Render dashboard under Environment Variables.'
          : 'Microphone recording completed, but transcription encountered an issue. You can type your question directly.',
        canRetryMic: true,
        canUploadFile: true
      });
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Client-side validation: file size & MIME type
    const validation = validateAudioFile(file, 15);
    if (!validation.valid) {
      setVoiceError({
        type: 'file-invalid',
        title: 'Invalid Audio File',
        message: validation.error || 'The selected file is not a supported audio format.',
        actionHint: 'Please select an audio file under 15MB (WebM, WAV, MP3, M4A, AAC, or OGG).',
        canRetryMic: false,
        canUploadFile: true
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setVoiceError(null);
    setIsTranscribing(true);
    setVoiceState('uploading');

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1] || '';
        const mimeType = file.type || 'audio/webm';
        setVoiceState('transcribing');

        try {
          const transcribedText = await transcribeSpeechAudio(base64Data, mimeType, selectedLangId);
          setIsTranscribing(false);
          setVoiceState('completed');

          if (transcribedText && transcribedText.trim()) {
            setChatInput(transcribedText.trim());
          } else {
            setVoiceError({
              type: 'empty-audio',
              title: 'No Speech Recognized',
              message: `Could not recognize speech from "${file.name}".`,
              actionHint: 'Ensure the audio contains audible speech and has clear volume.',
              canRetryMic: true,
              canUploadFile: true
            });
          }
        } catch (transcribeErr: any) {
          setIsTranscribing(false);
          setVoiceState('error');
          const isConfig = transcribeErr.message && (transcribeErr.message.includes('GEMINI_API_KEY') || transcribeErr.message.includes('Render'));
          setVoiceError({
            type: isConfig ? 'ai-service' : 'transcription',
            title: isConfig ? 'AI Service Configuration' : 'Voice Note Transcription Failed',
            message: transcribeErr.message || 'Error processing uploaded voice note.',
            actionHint: isConfig 
              ? 'Set GEMINI_API_KEY in your Render dashboard Environment Variables.' 
              : 'Check that the audio file is not corrupt and contains audible speech.',
            canRetryMic: true,
            canUploadFile: true
          });
        }
      };

      reader.onerror = () => {
        setIsTranscribing(false);
        setVoiceState('error');
        setVoiceError({
          type: 'file-invalid',
          title: 'File Read Error',
          message: 'Could not read audio file from disk.',
          canUploadFile: true
        });
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error("Audio upload error:", err);
      setIsTranscribing(false);
      setVoiceState('error');
      setVoiceError({
        type: 'file-invalid',
        title: 'Audio Upload Error',
        message: err.message || 'Unexpected error processing file.',
        canUploadFile: true
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Update welcome greeting when language changes if only 1 message exists
  useEffect(() => {
    setChatMessages(prev => {
      if (prev.length <= 1) {
        return [
          {
            role: 'assistant',
            content: activeLanguage.welcomeGreeting,
            timestamp: new Date().toISOString(),
            languageId: activeLanguage.id
          }
        ];
      }
      return prev;
    });
  }, [activeLanguage]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isSending]);

  const handleSendChat = async (userPrompt?: string, isVoice: boolean = false) => {
    const promptToSend = userPrompt || chatInput;
    if (!promptToSend.trim() || isSending) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: promptToSend.trim(),
      timestamp: new Date().toISOString(),
      languageId: selectedLangId,
      isVoiceInput: isVoice
    };

    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsSending(true);
    setVoiceState('waiting_ai');

    try {
      const currentHistory = [...chatMessages, userMsg];
      const reply = await consultAgronomist(
        promptToSend.trim(),
        selectedLangId,
        currentHistory,
        {
          cropType: String(cropType),
          temperature: Number(tempVal),
          humidity: Number(humVal),
          soilMoisture: Number(soilVal),
          dataSource: hardwareDataSource,
          isStale: isTelemetryStale,
          lastSeen: hardwareLastSeen
        }
      );

      const msgId = `asst-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        languageId: selectedLangId,
        voiceName: voicePersona
      };

      setChatMessages(prev => [...prev, assistantMsg]);
      setVoiceState('completed');

      // If auto-speak is enabled, speak out the response in authentic native voice!
      if (autoSpeak) {
        setTimeout(() => {
          playSpeech(reply, msgId);
        }, 300);
      }
    } catch (error: any) {
      console.error("Agronomist chat error", error);
      setVoiceState('error');
      const errDetail = error?.message || 'Unable to reach Gemini AI service.';
      const isKeyError =
        errDetail.toLowerCase().includes('api key') ||
        errDetail.toLowerCase().includes('api_key') ||
        errDetail.toLowerCase().includes('unconfigured');
      setChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: isKeyError
            ? `AI service unconfigured — not a live Gemini answer: ${errDetail}`
            : `AI service error — not a live Gemini answer: ${errDetail}`,
          timestamp: new Date().toISOString(),
          languageId: selectedLangId
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const historyEntries = Object.entries(historyTable || {})
    .sort(([, a]: any, [, b]: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-6 pb-12">
      {/* Header with EDENS AI & Powered by RA branding */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Dialog>
            <DialogTrigger render={<button type="button" aria-label="View EDENS AI logo" className="relative block shrink-0 cursor-pointer border-0 bg-transparent p-0 outline-none" />}>
              <img 
                src="https://i.imgur.com/WOeaqFK.png" 
                alt="EDENS AI Logo" 
                className="size-11 rounded-xl border border-border object-cover md:size-14"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  e.currentTarget.nextElementSibling?.classList.add('flex');
                }}
              />
              <div className="hidden size-11 flex-col items-center justify-center rounded-xl bg-accent text-accent-foreground md:size-14">
                <Leaf size={26} aria-hidden="true" />
              </div>
            </DialogTrigger>
            <DialogContent className="flex max-w-[95vw] items-center justify-center overflow-hidden p-2 md:max-w-2xl">
              <DialogHeader className="sr-only">
                <DialogTitle>EDENS AI Logo</DialogTitle>
              </DialogHeader>
              <img src="https://i.imgur.com/WOeaqFK.png" alt="EDENS AI Logo" className="h-auto max-h-[85vh] w-full rounded-lg object-contain" />
            </DialogContent>
          </Dialog>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">EDENS AI Lab</h1>
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Multilingual
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Powered by RA · Native Nigerian botanical intelligence
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HardwareSetupGuide variant="icon" />
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2">
             <Bot size={18} className={isVisionAgentEnabled ? "text-brand" : "text-muted-foreground"} aria-hidden="true" />
             <span className="text-xs font-medium text-foreground">Autonomous vision</span>
             <button 
               type="button"
               onClick={() => store.setValue('agent_VisionAgent_enabled', !isVisionAgentEnabled)}
               className={cn("relative h-5 w-10 shrink-0 rounded-full transition-colors duration-300", isVisionAgentEnabled ? "bg-primary" : "bg-input")}
               role="switch"
               aria-checked={isVisionAgentEnabled}
               aria-label="Toggle autonomous vision agent"
             >
               <div className={cn("absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-300", isVisionAgentEnabled ? "translate-x-5" : "translate-x-0")} />
             </button>
          </div>
        </div>
      </div>

      {/* Nigerian Language Selector Bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Languages size={16} aria-hidden="true" />
            </div>
            <div>
              <span className="text-[13px] font-semibold text-foreground">
                Communication language / Harshe / Asụsụ / Èdè
              </span>
              <p className="text-xs text-muted-foreground">
                Choose your native Nigerian tongue for live diagnosis, voice readouts, and agronomist chat
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 self-start rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground sm:self-auto">
            <span className="size-1.5 shrink-0 rounded-full bg-success animate-pulse" aria-hidden="true" /> Active: {activeLanguage.nativeName} ({activeLanguage.name})
          </div>
        </div>

        {/* Language Tabs / Buttons */}
        <div className="flex flex-wrap gap-2">
          {NIGERIAN_LANGUAGES.map((lang) => {
            const isSelected = lang.id === selectedLangId;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => handleSelectLanguage(lang.id)}
                aria-pressed={isSelected}
                aria-label={`${lang.name} (${lang.nativeName})`}
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors",
                  isSelected
                    ? "border-brand/40 bg-accent text-accent-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted"
                )}
              >
                <span className="text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
                  {lang.id === 'pcm' ? 'PD' : lang.id === 'tiv' ? 'TI' : lang.id === 'efi' ? 'EF' : lang.id.toUpperCase().slice(0, 2)}
                </span>
                <span className="font-medium">{lang.name}</span>
                <span className={cn("text-[11px] font-normal", isSelected ? "text-accent-foreground/70" : "text-muted-foreground")}>
                  ({lang.nativeName})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Visual Camera Diagnostics & Live Report */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 items-start">
        
        {/* Camera Stream & Capture Card */}
        <Card id="tour-ai-camera" className="flex flex-col">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <Camera size={16} className="text-muted-foreground" aria-hidden="true" /> Greenhouse cloud camera
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  camera.connectionBadge === 'CONNECTED'
                    ? "bg-success/10 text-success"
                    : camera.connectionBadge === 'RECONNECTING'
                    ? "bg-warning/10 text-warning"
                    : camera.status === 'ERROR'
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {camera.connectionBadge === 'CONNECTED' ? (
                  <Wifi size={12} aria-hidden="true" />
                ) : camera.connectionBadge === 'RECONNECTING' ? (
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <WifiOff size={12} aria-hidden="true" />
                )}
                {camera.connectionBadge === 'CONNECTED' ? 'Connected' : camera.connectionBadge === 'RECONNECTING' ? 'Reconnecting' : 'Offline'}
              </span>

              {camera.freshnessBadge && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                    camera.freshnessBadge === 'FRESH'
                      ? "bg-success/10 text-success"
                      : "bg-warning/10 text-warning"
                  )}
                >
                  {camera.freshnessBadge === 'FRESH' ? 'Fresh' : 'Stale'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Snapshot preview
              </span>
              <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {activeLanguage.name}
              </span>
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-4 p-4 sm:p-6">
            {/* Connection & Last-Image Timestamp Telemetry Strip */}
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2" title={camera.statusDetail}>
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    camera.connectionBadge === 'CONNECTED'
                      ? "bg-success animate-pulse"
                      : camera.freshnessBadge === 'STALE'
                      ? "bg-warning"
                      : camera.connectionBadge === 'RECONNECTING'
                      ? "bg-info animate-pulse"
                      : camera.status === 'ERROR'
                      ? "bg-destructive"
                      : "bg-border"
                  )}
                  aria-hidden="true"
                />
                <span className="truncate font-medium text-foreground">{camera.statusHeadline}</span>
              </div>

              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground sm:justify-end">
                <Clock size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Last capture:{' '}
                  {camera.lastImageTimestamp
                    ? <span className="font-mono tabular">{`${format(new Date(camera.lastImageTimestamp), 'yyyy-MM-dd HH:mm:ss')} (${formatFrameAge(camera.displayAgeSeconds)})`}</span>
                    : 'None received'}
                </span>
              </div>
            </div>

            {/* Viewport */}
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted">
              {/* Optional local MJPEG stream when verified on local gateway */}
              {!customImagePreview && camera.liveStreamCandidateUrl && (
                <img
                  src={camera.liveStreamCandidateUrl}
                  alt="Greenhouse Camera Live Stream"
                  onLoad={camera.notifyStreamLoaded}
                  onError={camera.notifyStreamError}
                  className={cn(
                    "w-full h-full object-cover transition-opacity duration-300",
                    camera.isLiveStreamVerified ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0"
                  )}
                />
              )}

              {customImagePreview ? (
                <div className="relative w-full h-full">
                  <img src={customImagePreview} alt="Uploaded Leaf Photo" className="h-full w-full object-contain" />
                  <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md border border-border bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground">
                    <Leaf size={13} className="text-brand" aria-hidden="true" /> Uploaded leaf photo
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomImagePreview(null)}
                    aria-label="Return to camera feed"
                    title="Return to camera feed"
                    className="absolute top-3 right-3 flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <RotateCcw size={12} aria-hidden="true" /> Return to camera feed
                  </button>
                </div>
              ) : camera.isLiveStreamVerified && camera.liveStreamCandidateUrl ? (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md border border-border bg-background/95 px-2.5 py-1 text-[11px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success animate-pulse" aria-hidden="true" />
                    Connected · live MJPEG stream
                  </div>
                </div>
              ) : camera.latestFrame ? (
                <div className="relative h-full w-full">
                  <img
                    key={camera.latestFrame.id}
                    src={camera.latestFrame.url}
                    alt="ESP32-CAM Greenhouse Snapshot"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      !camera.latestFrame.isFresh && "opacity-80"
                    )}
                  />
                  <div
                    className={cn(
                      "absolute top-2.5 left-2.5 right-2.5 flex items-center gap-2 rounded-md border bg-background/95 px-2.5 py-1 text-[11px] font-medium sm:right-auto",
                      camera.latestFrame.isFresh
                        ? "border-border text-success"
                        : "border-border text-warning"
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        camera.latestFrame.isFresh
                          ? "bg-success animate-pulse"
                          : "bg-warning"
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {camera.latestFrame.isFresh
                        ? `Fresh · auto-refreshing JPEG snapshot (not live video) · ${Math.max(1, Math.round(camera.latestFrame.sizeBytes / 1024))} KB`
                        : `Stale · historical snapshot (not live) · ${Math.max(1, Math.round(camera.latestFrame.sizeBytes / 1024))} KB`}
                    </span>
                  </div>

                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/95 px-3 py-1 text-[11px] text-foreground">
                    <span className="font-mono tabular">
                      Captured: {format(new Date(camera.latestFrame.timestamp), 'yyyy-MM-dd HH:mm:ss')} (
                      {formatFrameAge(camera.displayAgeSeconds)})
                    </span>
                    <span className="text-muted-foreground">
                      ESP32-CAM cloud snapshot
                    </span>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 z-10 flex h-full w-full flex-col items-center justify-center gap-2.5 bg-muted p-5 text-center sm:p-6">
                  <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-background sm:size-14">
                    {camera.connectionBadge === 'RECONNECTING' ? (
                      <RefreshCw size={22} className="text-muted-foreground animate-spin" aria-hidden="true" />
                    ) : (
                      <Camera size={22} className="text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {camera.status === 'ERROR'
                      ? 'Camera feed configuration pending'
                      : camera.connectionBadge === 'RECONNECTING'
                      ? `Reconnecting to cloud feed${camera.nextRetryInSeconds !== null ? ` (${camera.nextRetryInSeconds}s)` : ''}`
                      : 'Disconnected · no camera image available'}
                  </span>
                  <span className="max-w-md text-xs leading-relaxed text-muted-foreground">
                    {camera.statusDetail}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void camera.reconnectNow()}
                      disabled={camera.isRefreshing}
                    >
                      {camera.isRefreshing ? 'Checking…' : 'Check camera feed'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Stale / Reconnect Banner when stored image is old or connection is retrying */}
            {!customImagePreview && (camera.freshnessBadge === 'STALE' || camera.connectionBadge === 'RECONNECTING' || camera.errorMessage) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs">
                <div className="flex min-w-0 items-start gap-2 text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="text-[11px] leading-relaxed">
                    {camera.errorMessage || camera.statusDetail}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void camera.reconnectNow()}
                  className="shrink-0"
                >
                  Refresh
                </Button>
              </div>
            )}

            {/* Action bar: User-Triggered AI Diagnosis, Upload Leaf Photo, Refresh */}
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Button
                onClick={handleCapture}
                disabled={analyzing}
                size="lg"
                className="flex-1"
              >
                <Camera aria-hidden="true" size={16} />
                <span className="truncate">
                  {analyzing
                    ? 'Analyzing plant frame…'
                    : customImagePreview
                    ? `Diagnose uploaded photo (${activeLanguage.name})`
                    : camera.latestFrame?.isFresh || camera.status === 'LIVE_STREAM'
                    ? `Diagnose fresh camera image (${activeLanguage.name})`
                    : `Diagnose greenhouse camera (${activeLanguage.name})`}
                </span>
              </Button>

              <div className="flex gap-2.5">
                <input
                  type="file"
                  ref={plantImageInputRef}
                  onChange={handlePlantPhotoUpload}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                />

                <Button
                  type="button"
                  onClick={() => plantImageInputRef.current?.click()}
                  disabled={analyzing}
                  variant="outline"
                  className="flex-1 sm:flex-initial"
                >
                  <Upload size={15} aria-hidden="true" /> Upload leaf photo
                </Button>

                <Button
                  type="button"
                  onClick={() => void camera.refreshNow(false)}
                  disabled={camera.isRefreshing}
                  title="Check for newer greenhouse camera snapshot"
                  aria-label="Check for newer greenhouse camera snapshot"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                >
                  <RefreshCw size={16} className={cn(camera.isRefreshing && "animate-spin")} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Diagnostics Report Panel */}
        <Card className={cn(
          "flex flex-col",
          analyzing || result ? "border-brand/40" : ""
        )}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Info size={16} className="text-muted-foreground" aria-hidden="true" />
              {activeLanguage.id === 'ha' ? 'Rahoton binciken shuka' :
               activeLanguage.id === 'yo' ? 'Ìròyìn àyẹ̀wò ohun ọ̀gbìn' :
               activeLanguage.id === 'ig' ? 'Akwụkwọ nkọwa ahụike osisi' :
               activeLanguage.id === 'pcm' ? 'Plant health diagnostics report' :
               'Botanical diagnostics report'}
            </span>

            {result && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => playSpeech(`${result.speciesLocal || result.species}. ${result.healthStatusLocal || result.healthStatus}. ${result.symptoms}. ${result.cause}. ${result.recommendation}`, 'diag-header')}
                className={cn(
                  currentPlayingId === 'diag-header' && "border-destructive/40 bg-destructive/10 text-destructive"
                )}
              >
                {isGeneratingSpeech === 'diag-header' ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : currentPlayingId === 'diag-header' ? (
                  <Square size={14} aria-hidden="true" />
                ) : (
                  <Volume2 size={14} aria-hidden="true" />
                )}
                <span>
                  {currentPlayingId === 'diag-header'
                    ? (activeLanguage.id === 'ha' ? 'Dakata' : activeLanguage.id === 'yo' ? 'Dúró' : activeLanguage.id === 'ig' ? 'Kwụsị' : 'Stop')
                    : (activeLanguage.id === 'ha' ? 'Saurari rahoto' : activeLanguage.id === 'yo' ? 'Gbọ́ ìròyìn' : activeLanguage.id === 'ig' ? 'Gee ntị' : 'Listen aloud')}
                </span>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-4 sm:p-6">
            <div className="relative h-full min-h-[400px]">
              {analyzing ? (
                 <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                    <Loader2 size={22} className="animate-spin text-muted-foreground" aria-hidden="true" />
                    <div className="text-sm font-medium text-foreground">
                      EDENS AI is analyzing in {activeLanguage.name}…
                    </div>
                    <div className="max-w-xs text-xs text-muted-foreground">
                      {activeLanguage.welcomeGreeting.slice(0, 45)}…
                    </div>
                 </div>
              ) : diagnosisError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <div className="max-w-md space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-5">
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold text-destructive">
                      <AlertTriangle size={16} aria-hidden="true" />
                      <span>Diagnosis error</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground">{diagnosisError}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDiagnosisError(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : !result ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                    <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-muted">
                      <Leaf size={24} className="text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="text-sm font-medium leading-relaxed text-foreground">
                      No active report.<br/>
                      Capture a frame to receive instant analysis in {activeLanguage.name}.
                    </div>
                    <div className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
                      EDENS AI communicates in Hausa, Igbo, Yoruba, Naija Pidgin, and other Nigerian languages.
                    </div>
                 </div>
              ) : (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="space-y-6"
                 >
                   <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                     <span className="font-medium text-foreground">
                       {result.imageSource === 'ESP32_CAM_FRESH'
                         ? `Source: fresh ESP32-CAM cloud snapshot (${result.frameId || 'verified'})`
                         : 'Source: manual leaf photo upload'}
                     </span>
                     {result.frameTimestamp && (
                       <span className="font-mono tabular text-muted-foreground">
                         Captured {format(new Date(result.frameTimestamp), 'yyyy-MM-dd HH:mm:ss')}
                       </span>
                     )}
                   </div>

                   <div className="flex flex-wrap items-start justify-between gap-3">
                     <div className="min-w-0">
                        <div className="mb-1 text-xs text-muted-foreground">
                           {activeLanguage.id === 'ha' ? "Nau'in shuka" : activeLanguage.id === 'yo' ? 'Orúkọ ohun ọ̀gbìn' : activeLanguage.id === 'ig' ? 'Aha osisi' : 'Identified species'}
                        </div>
                        <div className="text-2xl font-semibold tracking-tight text-foreground">
                          {result.speciesLocal || result.species}
                        </div>
                        {result.speciesLocal && result.species !== result.speciesLocal && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Scientific/common: {result.species}
                          </div>
                        )}
                     </div>

                     <div className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                        result.healthStatus === 'Healthy' ? "bg-success/10 text-success" :
                        result.healthStatus === 'Stressed' ? "bg-warning/10 text-warning" :
                        "bg-destructive/10 text-destructive"
                      )}>
                         {result.healthStatus === 'Healthy' ? <CheckCircle size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                         <span>{result.healthStatusLocal || result.healthStatus}</span>
                      </div>
                   </div>

                   <div className="space-y-4 border-t border-border pt-4">
                     <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <Info size={13} aria-hidden="true" />
                          {activeLanguage.id === 'ha' ? 'Alamomin cutar da aka gani' : activeLanguage.id === 'yo' ? 'Àwọn àmì tó hàn' : activeLanguage.id === 'ig' ? 'Ihe ịrịba ama a hụrụ' : 'Visible symptoms'}
                        </div>
                        <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-[13px] leading-relaxed text-foreground">
                          {result.symptoms || "Babu wata matsala / None detected."}
                        </div>
                     </div>

                     <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <AlertTriangle size={13} aria-hidden="true" />
                          {activeLanguage.id === 'ha' ? 'Abin da ya haifar da matsalar' : activeLanguage.id === 'yo' ? 'Ohun tó fa ìṣòro yìí' : activeLanguage.id === 'ig' ? 'Ihe kpatara nsogbu a' : 'Likely cause'}
                        </div>
                        <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-[13px] leading-relaxed text-foreground">
                          {result.cause || "N/A"}
                        </div>
                     </div>

                     <div className="rounded-lg border border-brand/30 bg-accent p-4">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                          <Leaf size={14} aria-hidden="true" />
                          {activeLanguage.id === 'ha' ? 'Shawarar masana & hanyar magani' : 
                           activeLanguage.id === 'yo' ? 'Ìtọ́jú & ìmọ̀ràn olùtọ́jú' : 
                           activeLanguage.id === 'ig' ? 'Usoro ọgwụgwọ & ndụmọdụ' : 
                           activeLanguage.id === 'pcm' ? 'Action & treatment recommendation' : 
                           'Recommended agronomic action'}
                        </div>
                        <div className="text-[13px] leading-relaxed text-foreground">
                          {result.recommendation}
                        </div>

                        {/* Direct Audio playback trigger inside recommendation card */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => playSpeech(`${result.speciesLocal || result.species}. ${result.symptoms}. ${result.cause}. ${result.recommendation}`, 'diag-card')}
                            className={cn(
                              currentPlayingId === 'diag-card' && "border-destructive/40 bg-destructive/10 text-destructive"
                            )}
                          >
                            {isGeneratingSpeech === 'diag-card' ? (
                              <>
                                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                                <span>Generating speech…</span>
                              </>
                            ) : currentPlayingId === 'diag-card' ? (
                              <>
                                <Square size={13} aria-hidden="true" />
                                <span>Stop audio</span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={13} aria-hidden="true" />
                                <span>Listen in {activeLanguage.name} ({activeLanguage.nativeName})</span>
                              </>
                            )}
                          </Button>

                          <span className="text-xs text-muted-foreground">
                            Voice: {voicePersona} · {activeLanguage.name}
                          </span>
                        </div>
                     </div>
                   </div>
                 </motion.div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interactive AI Agronomist Communication Hub */}
      <Card>
        <CardHeader className="flex flex-col border-b border-border pb-3 md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <MessageSquare size={20} aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {activeLanguage.id === 'ha' ? 'Tattaunawa da Masanin Noma na EDENS AI' :
                   activeLanguage.id === 'yo' ? 'Ibaraẹnisọrọ pẹ̀lú Onímọ̀ Ọ̀gbìn EDENS AI' :
                   activeLanguage.id === 'ig' ? 'Mkparịta ụka Agronomist EDENS AI' :
                   activeLanguage.id === 'pcm' ? 'Talk to EDENS AI Plant Doctor' :
                   'EDENS AI multilingual agronomist consultation'}
                </h2>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {activeLanguage.name}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Speak or type in Hausa, Yoruba, Igbo, Pidgin, or English with live voice responses
              </p>
            </div>
          </div>

          {/* Voice Controls: Auto-Speech & Persona Selector */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            {/* Auto-Speech Toggle */}
            <button
              type="button"
              onClick={handleToggleAutoSpeak}
              title="Toggle automatic voice speech for assistant responses"
              aria-pressed={autoSpeak}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                autoSpeak
                  ? "border-brand/40 bg-accent text-accent-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              )}
            >
              {autoSpeak ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
              <span className="font-medium">Speech:</span> {autoSpeak ? "Auto on" : "Off"}
            </button>

            {/* Voice Persona Selector */}
            <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5">
              <Headphones size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="ai-voice-persona" className="sr-only">Voice persona</label>
              <select 
                id="ai-voice-persona"
                value={voicePersona}
                onChange={(e) => handleSelectVoicePersona(e.target.value)}
                className="cursor-pointer bg-transparent text-xs font-medium text-foreground outline-none"
                title="Select Gemini voice persona"
              >
                <option value="Kore">Kore (Warm botanist)</option>
                <option value="Zephyr">Zephyr (Smooth expert)</option>
                <option value="Puck">Puck (Energetic voice)</option>
                <option value="Fenrir">Fenrir (Deep voice)</option>
              </select>
            </div>

            <div className="flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs">
              <span className={cn(
                "size-1.5 shrink-0 rounded-full",
                hardwareDataSource === 'REAL_HARDWARE' ? "bg-success" :
                hardwareDataSource === 'CACHED' ? "bg-warning animate-pulse" :
                hardwareDataSource === 'STALE' ? "bg-warning" :
                hardwareDataSource === 'SIMULATED' ? "bg-info" : "bg-destructive"
              )} aria-hidden="true" />
              <span className="font-medium text-foreground">
                {hardwareDataSource}
                {isTelemetryStale && hardwareDataSource === 'REAL_HARDWARE' ? ' (stale)' : ''}
              </span>
              {hardwareDataSource === 'DISCONNECTED' ? (
                <span className="hidden text-[11px] text-destructive sm:inline">
                  No live sensor signal
                </span>
              ) : (
                <span className="hidden font-mono tabular text-[11px] text-muted-foreground sm:inline">
                  {Number(tempVal).toFixed(1)}°C · {Number(humVal).toFixed(0)}% Hum · {Number(soilVal).toFixed(0)}% Soil
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Quick sample question chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {activeLanguage.id === 'ha' ? 'Misalan Tambayoyi:' : activeLanguage.id === 'yo' ? 'Àpẹẹrẹ Ìbéèrè:' : activeLanguage.id === 'ig' ? 'Ụfọdụ Ajụjụ:' : 'Quick prompts:'}
            </span>
            {activeLanguage.sampleQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendChat(q)}
                disabled={isSending || isRecording}
                className="h-8 shrink-0 cursor-pointer rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Conversation history area */}
          <div 
            ref={chatScrollRef}
            className="custom-scrollbar h-[340px] overflow-y-auto space-y-3.5 rounded-lg border border-border bg-muted/40 p-4"
          >
            {chatMessages.map((msg, i) => {
              const isAssistant = msg.role === 'assistant';
              const msgId = `msg-${i}`;
              const isPlaying = currentPlayingId === msgId;
              const isGenerating = isGeneratingSpeech === msgId;

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex max-w-[88%] flex-col rounded-lg p-4 text-sm leading-relaxed md:max-w-[80%]",
                    isAssistant
                      ? "mr-auto border border-border bg-card text-foreground"
                      : "ml-auto bg-primary font-medium text-primary-foreground"
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[11px] font-semibold",
                        isAssistant ? "text-muted-foreground" : "text-primary-foreground"
                      )}>
                        {isAssistant ? `EDENS AI (${activeLanguage.name})` : 'You (farmer)'}
                      </span>
                      {msg.isVoiceInput && (
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          isAssistant ? "bg-muted text-muted-foreground" : "bg-primary-foreground/15 text-primary-foreground"
                        )}>
                          <Mic size={11} aria-hidden="true" /> Voice note
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={cn("text-[11px]", isAssistant ? "text-muted-foreground" : "text-primary-foreground/80")}>
                        {format(new Date(msg.timestamp), 'HH:mm')}
                      </span>

                      {/* Assistant Audio Speech Button */}
                      {isAssistant && (
                        <button 
                          type="button"
                          onClick={() => playSpeech(msg.content, msgId)}
                          title={isPlaying ? "Stop listening" : `Listen in ${activeLanguage.name}`}
                          className={cn(
                            "flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
                            isPlaying
                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                              : isGenerating
                              ? "border-border bg-muted text-muted-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                              <span>Voice…</span>
                            </>
                          ) : isPlaying ? (
                            <>
                              <Square size={12} aria-hidden="true" />
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <Volume2 size={12} aria-hidden="true" />
                              <span>Speech</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </motion.div>
              );
            })}

            {isSending && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex max-w-[65%] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
              >
                <Sparkles size={14} className="text-brand" aria-hidden="true" />
                <span>EDENS AI ń ronu / analyzing in {activeLanguage.name}...</span>
              </motion.div>
            )}
          </div>

          {/* Live Audio Recording HUD */}
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5"
              >
                <div className="flex items-center gap-3">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular text-xs font-semibold text-destructive">
                      Recording {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-foreground">
                      Listening in <span className="font-medium text-destructive">{activeLanguage.name} ({activeLanguage.nativeName})</span>…
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelRecording}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X size={14} aria-hidden="true" /> Discard
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => stopAndTranscribe(false)}
                  >
                    <Check size={14} aria-hidden="true" /> Transcribe
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => stopAndTranscribe(true)}
                  >
                    <Send size={14} aria-hidden="true" /> Send voice
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Voice Note Uploading Status Indicator */}
          {voiceState === 'uploading' && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-3.5 py-2.5 text-xs text-info"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                <span className="font-medium">
                  Uploading and validating voice note for speech transcription...
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">EDENS AI pipeline</span>
            </motion.div>
          )}

          {/* Audio Transcription Loading State */}
          {isTranscribing && voiceState !== 'uploading' && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-3.5 py-2.5 text-xs text-info"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                <span className="font-medium">
                  EDENS AI ń gbọ́ / Transcribing &amp; understanding speech in {activeLanguage.name} ({activeLanguage.nativeName})...
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">Powered by Gemini AI</span>
            </motion.div>
          )}

          {/* Structured Voice Error / Diagnostic Resolution Banner */}
          {voiceError && (
            <motion.div 
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "space-y-2.5 rounded-lg border p-4",
                voiceError.type === 'permission' || voiceError.type === 'insecure-context'
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : voiceError.type === 'ai-service'
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-info/30 bg-info/10 text-info"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold leading-tight">
                      {voiceError.title}
                    </p>
                    <p className="text-xs leading-relaxed text-foreground">
                      {voiceError.message}
                    </p>
                    {voiceError.actionHint && (
                      <p className="text-xs leading-relaxed text-foreground">
                        <span className="font-medium">Tip:</span> {voiceError.actionHint}
                      </p>
                    )}
                  </div>
                </div>

                <button 
                  type="button" 
                  onClick={() => setVoiceError(null)}
                  className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Dismiss message"
                  title="Dismiss message"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                {voiceError.canRetryMic && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={startRecording}
                    disabled={isRecording || isTranscribing}
                  >
                    <RefreshCw size={12} aria-hidden="true" /> Retry microphone
                  </Button>
                )}

                {voiceError.canUploadFile && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || isTranscribing}
                  >
                    <Upload size={12} aria-hidden="true" /> Upload voice note
                  </Button>
                )}

                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground underline hover:text-foreground"
                >
                  <span>Open in full tab</span>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            </motion.div>
          )}

          {/* Hidden file input for uploading audio voice note */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAudioFileUpload} 
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac" 
            className="hidden" 
          />

          {/* Chat input box with real microphone and audio upload */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSendChat();
            }}
            className="flex items-center gap-2"
          >
            {/* Microphone Toggle Button */}
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={isSending || isTranscribing}
              onClick={() => {
                if (isRecording) {
                  stopAndTranscribe(false);
                } else {
                  startRecording();
                }
              }}
              aria-label={isRecording ? "Stop recording and transcribe" : "Record a voice question"}
              title={
                voiceState === 'requesting_mic' ? "Requesting microphone..." :
                isRecording ? "Stop recording & transcribe" : 
                `Click to speak in ${activeLanguage.name} or Nigerian languages`
              }
              className={cn(
                "shrink-0",
                isRecording 
                  ? "border-destructive/40 bg-destructive/10 text-destructive" 
                  : voiceState === 'requesting_mic'
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : ""
              )}
            >
              {voiceState === 'requesting_mic' ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : isRecording ? (
                <Square size={18} aria-hidden="true" />
              ) : (
                <Mic size={18} aria-hidden="true" />
              )}
            </Button>

            {/* Upload Audio File / Voice Note Button */}
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={isSending || isRecording || isTranscribing}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload an audio voice note"
              title={`Upload audio recording or WhatsApp voice note in ${activeLanguage.name}`}
              className="shrink-0"
            >
              <Upload size={18} aria-hidden="true" />
            </Button>

            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              aria-label="Your question for the AI agronomist"
              placeholder={
                activeLanguage.id === 'ha' ? `Yi magana da mic ko rubuta tambaya a Harshen Hausa...` :
                activeLanguage.id === 'yo' ? `Sọ̀rọ̀ sínú mic tàbí kọ ìbéèrè ní Èdè Yorùbá...` :
                activeLanguage.id === 'ig' ? `Gwa m okwu site na mic ma ọ bụ dee n'Asụsụ Igbo...` :
                activeLanguage.id === 'pcm' ? `Talk into mic or type your question in Naija Pidgin...` :
                `Speak or type any question in ${activeLanguage.name}...`
              }
              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            <Button
              type="submit"
              size="lg"
              disabled={!chatInput.trim() || isSending || isRecording}
              className="shrink-0"
            >
              <Send size={16} aria-hidden="true" /> Send
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Historical Diagnostic Analysis Records */}
      <div className="pt-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Clock size={16} className="text-muted-foreground" aria-hidden="true" />
            {activeLanguage.id === 'ha' ? 'Tarihin binciken cututtukan shuka' :
             activeLanguage.id === 'yo' ? 'Àkójọ àyẹ̀wò àtijọ́' :
             activeLanguage.id === 'ig' ? 'Akụkọ nnyocha nke oge gara aga' :
             'Botanical analysis history'}
          </span>
          <span className="text-xs text-muted-foreground">
            {historyEntries.length} record{historyEntries.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {historyEntries.map(([id, entry]: any) => (
             <Card key={id}>
               <CardContent className="flex items-center gap-4 p-4">
                 {entry.image && (
                   <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border">
                     <img src={entry.image} className="h-full w-full object-cover" alt="" />
                   </div>
                 )}
                 <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono tabular text-[11px] text-muted-foreground">{format(new Date(entry.timestamp), 'MMM dd · HH:mm')}</span>
                      {entry.language && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {entry.language}
                        </span>
                      )}
                    </div>
                    <div className="mb-1.5 truncate text-[13px] font-semibold text-foreground">{entry.speciesLocal || entry.species}</div>
                     <div className={cn(
                        "inline-flex w-max rounded-md px-2 py-0.5 text-[11px] font-medium",
                        entry.healthStatus === 'Healthy' ? "bg-success/10 text-success" :
                        entry.healthStatus === 'Stressed' ? "bg-warning/10 text-warning" :
                        "bg-destructive/10 text-destructive"
                      )}>
                        {entry.healthStatusLocal || entry.healthStatus}
                      </div>
                 </div>
               </CardContent>
             </Card>
          ))}
          {historyEntries.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-border px-6 py-14 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-lg bg-muted">
                <Clock size={20} className="text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">No history yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Capture or upload a plant image above to start building your diagnosis history.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
