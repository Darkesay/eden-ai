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
            ? `⚠️ [AI Service Unconfigured — Not a Live Gemini Answer]: ${errDetail}`
            : `⚠️ [AI Service Error — Not a Live Gemini Answer]: ${errDetail}`,
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
            <DialogTrigger render={<button type="button" className="relative shrink-0 cursor-pointer block p-0 bg-transparent border-0 outline-none hover:scale-105 transition-transform" />}>
              <img 
                src="https://i.imgur.com/WOeaqFK.png" 
                alt="EDENS AI Logo" 
                className={cn(
                  "w-10 h-10 md:w-14 md:h-14 rounded-2xl shadow-[0_0_25px_rgba(16,185,129,0.4)] object-cover",
                  analyzing && "animate-pulse shadow-[0_0_35px_rgba(16,185,129,0.7)]"
                )}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  e.currentTarget.nextElementSibling?.classList.add('flex');
                }}
              />
              <div className="hidden w-10 h-10 md:w-14 md:h-14 rounded-2xl bg-[#10B981]/10 text-[#10B981] flex-col items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                <Leaf size={26} className={cn(analyzing && "animate-pulse")} />
              </div>
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] md:max-w-2xl bg-[#111] border-[#333] p-1 overflow-hidden shadow-2xl rounded-2xl flex items-center justify-center">
              <DialogHeader className="sr-only">
                <DialogTitle>EDENS AI Logo</DialogTitle>
              </DialogHeader>
              <img src="https://i.imgur.com/WOeaqFK.png" alt="EDENS AI Logo" className="w-full h-auto max-h-[85vh] object-contain rounded-xl" />
            </DialogContent>
          </Dialog>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">EDENS AI Lab</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30 uppercase">
                🇳🇬 Multilingual
              </span>
            </div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] font-bold text-[#10B981] mt-0.5">
              Powered by RA · Native Nigerian Botanical Intelligence
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HardwareSetupGuide variant="icon" />
          <div className="flex items-center gap-3 bg-[#FFFFFF]/60 dark:bg-[#040404]/60 border border-[#D1E8D1] dark:border-[#1A2A1A] px-4 py-2 rounded-xl backdrop-blur-md">
             <Bot size={18} className={isVisionAgentEnabled ? "text-[#10B981]" : "text-gray-400"} />
             <span className="text-xs font-bold uppercase tracking-wider">Autonomous Vision</span>
             <button 
               onClick={() => store.setValue('agent_VisionAgent_enabled', !isVisionAgentEnabled)}
               className={cn("w-10 h-5 rounded-full relative transition-colors duration-300", isVisionAgentEnabled ? "bg-[#10B981]" : "bg-gray-300 dark:bg-gray-700")}
               aria-label="Toggle autonomous vision agent"
             >
               <div className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-300", isVisionAgentEnabled ? "translate-x-5" : "translate-x-0")} />
             </button>
          </div>
        </div>
      </div>

      {/* Nigerian Language Selector Bar */}
      <div className="bg-gradient-to-r from-[#10B981]/10 via-[#059669]/5 to-transparent border border-[#10B981]/30 rounded-2xl p-4 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#10B981]/20 flex items-center justify-center text-[#10B981]">
              <Languages size={18} />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#10B981]">
                Communication Language / Harshe / Asụsụ / Èdè
              </span>
              <p className="text-[11px] opacity-70">
                Choose your native Nigerian tongue for live diagnosis, voice readouts, and agronomist chat
              </p>
            </div>
          </div>
          
          <div className="text-[11px] font-mono px-3 py-1 rounded-lg bg-[#10B981]/15 text-[#10B981] font-semibold flex items-center gap-1.5 self-start sm:self-auto">
            <Radio size={12} className="animate-pulse" /> Active: {activeLanguage.nativeName} ({activeLanguage.name})
          </div>
        </div>

        {/* Language Tabs / Buttons */}
        <div className="flex flex-wrap gap-2">
          {NIGERIAN_LANGUAGES.map((lang) => {
            const isSelected = lang.id === selectedLangId;
            return (
              <button
                key={lang.id}
                onClick={() => handleSelectLanguage(lang.id)}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer",
                  isSelected
                    ? "bg-[#10B981] text-black border-[#10B981] shadow-[0_0_15px_rgba(16,185,129,0.35)] scale-105"
                    : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-[#10B981]/50 text-foreground opacity-80 hover:opacity-100"
                )}
              >
                <span>{lang.flag}</span>
                <span className="font-semibold">{lang.name}</span>
                <span className={cn("text-[10px] opacity-75 font-normal", isSelected ? "text-black/80" : "text-muted-foreground")}>
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
        <Card id="tour-ai-camera" className="border border-[#14B8A6]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-[0_4px_24px_-4px_rgba(20,184,166,0.05)] flex flex-col relative group overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#14B8A6]" />
          <CardHeader className="pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A] flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[10px] font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
                <Camera size={14} className="text-[#14B8A6]" /> GREENHOUSE CLOUD CAMERA
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums font-bold border",
                  camera.connectionBadge === 'CONNECTED'
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                    : camera.connectionBadge === 'RECONNECTING'
                    ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                    : camera.status === 'ERROR'
                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                )}
              >
                {camera.connectionBadge === 'CONNECTED' ? (
                  <Wifi size={11} />
                ) : camera.connectionBadge === 'RECONNECTING' ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <WifiOff size={11} />
                )}
                {camera.connectionBadge}
              </span>

              {camera.freshnessBadge && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono tabular-nums font-bold border",
                    camera.freshnessBadge === 'FRESH'
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                  )}
                >
                  {camera.freshnessBadge}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                Snapshot Preview
              </span>
              <div className="text-[10px] font-mono text-[#14B8A6] font-bold">
                {activeLanguage.name}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-4 p-4 sm:p-6">
            {/* Connection & Last-Image Timestamp Telemetry Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 text-[11px] font-mono">
              <div className="flex items-center gap-2 min-w-0" title={camera.statusDetail}>
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    camera.connectionBadge === 'CONNECTED'
                      ? "bg-emerald-500 animate-pulse"
                      : camera.freshnessBadge === 'STALE'
                      ? "bg-amber-500"
                      : camera.connectionBadge === 'RECONNECTING'
                      ? "bg-sky-400 animate-ping"
                      : camera.status === 'ERROR'
                      ? "bg-red-500"
                      : "bg-zinc-500"
                  )}
                />
                <span className="truncate font-semibold">{camera.statusHeadline}</span>
              </div>

              <div className="flex items-center sm:justify-end gap-1.5 text-muted-foreground tabular-nums">
                <Clock size={12} className="text-[#14B8A6] shrink-0" />
                <span className="truncate">
                  Last Capture:{' '}
                  {camera.lastImageTimestamp
                    ? `${format(new Date(camera.lastImageTimestamp), 'yyyy-MM-dd HH:mm:ss')} (${formatFrameAge(camera.displayAgeSeconds)})`
                    : 'None received'}
                </span>
              </div>
            </div>

            {/* Viewport */}
            <div className="w-full aspect-video bg-[#050505] rounded-2xl overflow-hidden relative border border-[#222] shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
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
                  <img src={customImagePreview} alt="Uploaded Leaf Photo" className="w-full h-full object-contain" />
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-blue-500/50 text-[10px] font-mono text-blue-400 font-bold">
                    <Leaf size={12} /> MANUAL LEAF PHOTO UPLOAD
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomImagePreview(null)}
                    className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/80 hover:bg-black px-2.5 py-1.5 rounded-lg border border-white/20 text-[10px] font-mono text-white cursor-pointer"
                  >
                    <RotateCcw size={11} /> Return to Camera Feed
                  </button>
                </div>
              ) : camera.isLiveStreamVerified && camera.liveStreamCandidateUrl ? (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-emerald-500/50 text-[10px] font-mono font-bold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    CONNECTED · LIVE MJPEG STREAM
                  </div>
                </div>
              ) : camera.latestFrame ? (
                <div className="relative w-full h-full">
                  <img
                    key={camera.latestFrame.id}
                    src={camera.latestFrame.url}
                    alt="ESP32-CAM Greenhouse Snapshot"
                    className={cn(
                      "w-full h-full object-cover transition-opacity duration-300",
                      !camera.latestFrame.isFresh && "opacity-80"
                    )}
                  />
                  <div
                    className={cn(
                      "absolute top-2.5 left-2.5 right-2.5 sm:right-auto flex items-center gap-2 bg-black/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border text-[10px] font-mono tabular-nums font-bold",
                      camera.latestFrame.isFresh
                        ? "border-emerald-500/50 text-emerald-400"
                        : "border-amber-500/50 text-amber-400"
                    )}
                  >
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        camera.latestFrame.isFresh
                          ? "bg-emerald-500 animate-pulse"
                          : "bg-amber-500"
                      )}
                    />
                    <span className="truncate">
                      {camera.latestFrame.isFresh
                        ? `FRESH · AUTO-REFRESHING JPEG SNAPSHOT (NOT LIVE VIDEO) · ${Math.max(1, Math.round(camera.latestFrame.sizeBytes / 1024))} KB`
                        : `STALE · HISTORICAL SNAPSHOT (NOT LIVE) · ${Math.max(1, Math.round(camera.latestFrame.sizeBytes / 1024))} KB`}
                    </span>
                  </div>

                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] font-mono text-gray-200 tabular-nums">
                    <span>
                      Captured: {format(new Date(camera.latestFrame.timestamp), 'yyyy-MM-dd HH:mm:ss')} (
                      {formatFrameAge(camera.displayAgeSeconds)})
                    </span>
                    <span className="text-[#14B8A6]">
                      ESP32-CAM Cloud Snapshot
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 font-sans flex-col gap-2.5 p-5 sm:p-6 text-center absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0D1312] to-[#040606]">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#14B8A6]/10 flex items-center justify-center border border-[#14B8A6]/30">
                    {camera.connectionBadge === 'RECONNECTING' ? (
                      <RefreshCw size={24} className="text-[#14B8A6] animate-spin" />
                    ) : (
                      <Camera size={24} className="text-[#14B8A6]" />
                    )}
                  </div>
                  <span className="tracking-wider font-bold text-white uppercase text-xs">
                    {camera.status === 'ERROR'
                      ? 'Camera Feed Configuration Pending'
                      : camera.connectionBadge === 'RECONNECTING'
                      ? `Reconnecting to Cloud Feed${camera.nextRetryInSeconds !== null ? ` (${camera.nextRetryInSeconds}s)` : ''}`
                      : 'Disconnected · No Camera Image Available'}
                  </span>
                  <span className="text-gray-400 max-w-md text-[11px] leading-relaxed">
                    {camera.statusDetail}
                  </span>
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => void camera.reconnectNow()}
                      disabled={camera.isRefreshing}
                      className="text-[#14B8A6] text-[10px] font-mono font-bold uppercase tracking-wider border border-[#14B8A6]/35 bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 px-3 py-1.5 rounded-lg cursor-pointer"
                    >
                      {camera.isRefreshing ? 'Checking...' : 'Check Camera Feed'}
                    </button>
                  </div>
                </div>
              )}

              <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+Cjwvc3ZnPg==')] opacity-40 mix-blend-overlay" />
            </div>

            {/* Stale / Reconnect Banner when stored image is old or connection is retrying */}
            {!customImagePreview && (camera.freshnessBadge === 'STALE' || camera.connectionBadge === 'RECONNECTING' || camera.errorMessage) && (
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs">
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span className="text-[11px] leading-relaxed">
                    {camera.errorMessage || camera.statusDetail}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void camera.reconnectNow()}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-300 text-[10px] font-mono font-bold uppercase cursor-pointer"
                >
                  Refresh
                </button>
              </div>
            )}

            {/* Action bar: User-Triggered AI Diagnosis, Upload Leaf Photo, Refresh */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
              <Button
                onClick={handleCapture}
                disabled={analyzing}
                className="flex-1 bg-[#14B8A6] hover:bg-[#0D9488] text-white font-bold tracking-wide min-h-12 h-auto py-2.5 px-4 rounded-2xl shadow-[0_4px_20px_rgba(20,184,166,0.3)] border-0 cursor-pointer transition-all text-xs sm:text-sm"
              >
                <Camera className="mr-2 shrink-0" size={18} />
                <span className="truncate">
                  {analyzing
                    ? 'Analyzing plant frame...'
                    : customImagePreview
                    ? `Diagnose Uploaded Photo (${activeLanguage.name})`
                    : camera.latestFrame?.isFresh || camera.status === 'LIVE_STREAM'
                    ? `Diagnose Fresh Camera Image (${activeLanguage.name})`
                    : `Diagnose Greenhouse Camera (${activeLanguage.name})`}
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
                  className="flex-1 sm:flex-initial h-12 rounded-2xl border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 font-semibold text-xs px-4 cursor-pointer"
                >
                  <Upload className="mr-1.5 shrink-0" size={16} /> Upload Leaf Photo
                </Button>

                <Button
                  type="button"
                  onClick={() => void camera.refreshNow(false)}
                  disabled={camera.isRefreshing}
                  title="Check for newer greenhouse camera snapshot"
                  variant="outline"
                  className="h-12 w-12 p-0 rounded-2xl border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <RefreshCw size={16} className={cn(camera.isRefreshing && "animate-spin text-[#14B8A6]")} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Diagnostics Report Panel */}
        <Card className={cn(
          "border bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl overflow-hidden hover:scale-[1.01] transition-transform duration-300 relative group flex flex-col",
          analyzing || result ? "border-[#10B981]/50 shadow-[0_0_30px_rgba(16,185,129,0.1)]" : "border-[#E8F0E8] dark:border-white/10"
        )}>
          <CardHeader className="pb-4 border-b border-black/5 dark:border-white/5 flex flex-row items-center justify-between">
            <div className="text-[10px] w-max font-bold uppercase tracking-[0.2em] flex items-center gap-2 opacity-70">
              <Info size={14} className="text-[#10B981]" /> 
              {activeLanguage.id === 'ha' ? 'RAHOTON BINCIKEN SHUKA' :
               activeLanguage.id === 'yo' ? 'ÌRÒYÌN ÀYẸ̀WÒ OHUN Ọ̀GBÌN' :
               activeLanguage.id === 'ig' ? 'AKWỤKWỌ NKỌWA AHỤIKE OSISI' :
               activeLanguage.id === 'pcm' ? 'PLANT HEALTH DIAGNOSTICS REPORT' :
               'BOTANICAL DIAGNOSTICS REPORT'}
            </div>

            {result && (
              <button
                type="button"
                onClick={() => playSpeech(`${result.speciesLocal || result.species}. ${result.healthStatusLocal || result.healthStatus}. ${result.symptoms}. ${result.cause}. ${result.recommendation}`, 'diag-header')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                  currentPlayingId === 'diag-header'
                    ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse" 
                    : "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30 hover:bg-[#10B981]/20"
                )}
              >
                {isGeneratingSpeech === 'diag-header' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : currentPlayingId === 'diag-header' ? (
                  <Square size={14} />
                ) : (
                  <Volume2 size={14} />
                )}
                <span>
                  {currentPlayingId === 'diag-header'
                    ? (activeLanguage.id === 'ha' ? 'Dakata' : activeLanguage.id === 'yo' ? 'Dúró' : activeLanguage.id === 'ig' ? 'Kwụsị' : 'Stop')
                    : (activeLanguage.id === 'ha' ? 'Saurari Rahoto' : activeLanguage.id === 'yo' ? 'Gbọ́ Ìròyìn' : activeLanguage.id === 'ig' ? 'Gee Ntị' : 'Listen Aloud')}
                </span>
              </button>
            )}
          </CardHeader>
          <CardContent className="p-6 flex-1">
            <div className="relative h-full min-h-[400px]">
              {analyzing ? (
                 <div className="absolute inset-0 flex flex-col justify-center items-center">
                    <div className="w-[140px] h-[5px] bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-[#10B981]"
                        animate={{ x: ["-100%", "100%", "-100%"] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-[#10B981] font-bold">
                      EDENS AI IS COMMUNICATING IN {activeLanguage.name.toUpperCase()}...
                    </div>
                    <div className="text-[11px] opacity-60 mt-2 font-mono">
                      {activeLanguage.welcomeGreeting.slice(0, 45)}...
                    </div>
                 </div>
              ) : diagnosisError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  <div className="p-5 rounded-2xl bg-red-500/10 border border-red-500/30 max-w-md space-y-2">
                    <div className="flex items-center justify-center gap-2 text-red-500 font-bold text-xs uppercase tracking-wider">
                      <AlertTriangle size={16} />
                      <span>Image Diagnosis Error</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/90">{diagnosisError}</p>
                    <button
                      type="button"
                      onClick={() => setDiagnosisError(null)}
                      className="mt-2 px-3 py-1 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[11px] font-bold cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : !result ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                    <Leaf size={48} className="opacity-15 mb-4 text-[#10B981]" />
                    <div className="font-mono text-xs uppercase tracking-[0.2em] opacity-60 font-bold leading-relaxed">
                      No active report.<br/>
                      Capture a frame to receive instant analysis in {activeLanguage.name}.
                    </div>
                    <div className="mt-4 text-xs max-w-sm opacity-50 italic">
                      "EDENS AI can communicate fluently in Hausa, Igbo, Yoruba, Naija Pidgin, and other Nigerian native tongues."
                    </div>
                 </div>
              ) : (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="space-y-6"
                 >
                   <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 text-[10px] font-mono tabular-nums">
                     <span className="font-bold text-[#10B981]">
                       {result.imageSource === 'ESP32_CAM_FRESH'
                         ? `PROVENANCE: FRESH ESP32-CAM CLOUD SNAPSHOT (${result.frameId || 'VERIFIED'})`
                         : 'PROVENANCE: MANUAL LEAF PHOTOGRAPH UPLOAD'}
                     </span>
                     {result.frameTimestamp && (
                       <span className="opacity-75">
                         Captured {format(new Date(result.frameTimestamp), 'yyyy-MM-dd HH:mm:ss')}
                       </span>
                     )}
                   </div>

                   <div className="flex items-start justify-between">
                     <div>
                        <div className="text-[10px] uppercase opacity-50 font-bold tracking-[0.2em] mb-1">
                          {activeLanguage.id === 'ha' ? 'Nau\'in Shuka' : activeLanguage.id === 'yo' ? 'Orúkọ Ohun Ọ̀gbìn' : activeLanguage.id === 'ig' ? 'Aha Osisi' : 'Identified Species'}
                        </div>
                        <div className="text-2xl md:text-3xl font-serif text-[#10B981]">
                          {result.speciesLocal || result.species}
                        </div>
                        {result.speciesLocal && result.species !== result.speciesLocal && (
                          <div className="text-xs opacity-60 mt-0.5 font-mono">
                            Scientific/Common: {result.species}
                          </div>
                        )}
                     </div>

                     <div className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl font-bold border-2 text-xs uppercase tracking-wider shadow-sm",
                        result.healthStatus === 'Healthy' ? "bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]" :
                        result.healthStatus === 'Stressed' ? "bg-amber-500/10 border-amber-500/30 text-amber-500" :
                        "bg-red-500/10 border-red-500/30 text-red-500"
                      )}>
                         {result.healthStatus === 'Healthy' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                         <span>{result.healthStatusLocal || result.healthStatus}</span>
                      </div>
                   </div>

                   <div className="space-y-4 pt-4 border-t border-black/5 dark:border-white/5">
                     <div>
                        <div className="text-[10px] uppercase opacity-60 font-bold tracking-[0.15em] mb-1.5 flex items-center gap-1.5 text-[#10B981]">
                          <Info size={12} />
                          {activeLanguage.id === 'ha' ? 'Alamomin Cutar da Aka Gani' : activeLanguage.id === 'yo' ? 'Àwọn Àmì Tó Hàn' : activeLanguage.id === 'ig' ? 'Ihe Ịrịba Ama A Hụrụ' : 'Visible Symptoms'}
                        </div>
                        <div className="text-[13px] font-medium leading-relaxed opacity-95 p-3.5 bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5">
                          {result.symptoms || "Babu wata matsala / None detected."}
                        </div>
                     </div>

                     <div>
                        <div className="text-[10px] uppercase opacity-60 font-bold tracking-[0.15em] mb-1.5 flex items-center gap-1.5 text-amber-500">
                          <AlertTriangle size={12} />
                          {activeLanguage.id === 'ha' ? 'Abin da Ya Haifar da Matsalar' : activeLanguage.id === 'yo' ? 'Ohun Tó Fa Ìṣòro Yìí' : activeLanguage.id === 'ig' ? 'Ihe Kpatara Nsogbu a' : 'Likely Cause'}
                        </div>
                        <div className="text-[13px] font-medium leading-relaxed opacity-95 p-3.5 bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5">
                          {result.cause || "N/A"}
                        </div>
                     </div>

                     <div className="bg-[#10B981]/10 p-4 rounded-2xl border border-[#10B981]/20 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#10B981]" />
                        <div className="text-[10px] text-[#10B981] font-bold tracking-[0.15em] mb-2 uppercase flex items-center gap-1.5">
                          <Leaf size={14} />
                          {activeLanguage.id === 'ha' ? 'Shawarar Masana & Hanyar Magani (Tattaunawa)' : 
                           activeLanguage.id === 'yo' ? 'Ìtọ́jú & Ìmọ̀ràn Olùtọ́jú (Àbájáde)' : 
                           activeLanguage.id === 'ig' ? 'Usoro Ọgwụgwọ & Ndụmọdụ' : 
                           activeLanguage.id === 'pcm' ? 'Action & Treatment Recommendation' : 
                           'Recommended Agronomic Action'}
                        </div>
                        <div className="text-[13px] font-medium leading-relaxed dark:text-[#E2E8F0]">
                          {result.recommendation}
                        </div>

                        {/* Direct Audio playback trigger inside recommendation card */}
                        <div className="pt-3 mt-3 border-t border-[#10B981]/20 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => playSpeech(`${result.speciesLocal || result.species}. ${result.symptoms}. ${result.cause}. ${result.recommendation}`, 'diag-card')}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm",
                              currentPlayingId === 'diag-card'
                                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                                : "bg-[#10B981]/20 hover:bg-[#10B981]/30 text-[#10B981] border border-[#10B981]/40"
                            )}
                          >
                            {isGeneratingSpeech === 'diag-card' ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                <span>Generating Speech...</span>
                              </>
                            ) : currentPlayingId === 'diag-card' ? (
                              <>
                                <Square size={13} />
                                <span>Stop Audio</span>
                                <div className="flex items-center gap-0.5 ml-1">
                                  <span className="w-1 h-3 bg-red-400 rounded animate-bounce" />
                                  <span className="w-1 h-2 bg-red-400 rounded animate-bounce [animation-delay:0.15s]" />
                                  <span className="w-1 h-3 bg-red-400 rounded animate-bounce [animation-delay:0.3s]" />
                                </div>
                              </>
                            ) : (
                              <>
                                <Volume2 size={13} />
                                <span>Listen in {activeLanguage.name} ({activeLanguage.nativeName})</span>
                              </>
                            )}
                          </button>

                          <span className="text-[10px] font-mono opacity-60 text-foreground">
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
      <Card className="border border-[#10B981]/30 bg-[#FFFFFF]/90 dark:bg-[#070707]/90 backdrop-blur-xl rounded-3xl overflow-hidden shadow-xl">
        <CardHeader className="p-5 pb-3 border-b border-[#D1E8D1] dark:border-[#1A2A1A] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#10B981]/15 text-[#10B981] flex items-center justify-center border border-[#10B981]/30 shrink-0">
              <MessageSquare size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">
                  {activeLanguage.id === 'ha' ? 'Tattaunawa da Masanin Noma na EDENS AI' :
                   activeLanguage.id === 'yo' ? 'Ibaraẹnisọrọ pẹ̀lú Onímọ̀ Ọ̀gbìn EDENS AI' :
                   activeLanguage.id === 'ig' ? 'Mkparịta ụka Agronomist EDENS AI' :
                   activeLanguage.id === 'pcm' ? 'Talk to EDENS AI Plant Doctor' :
                   'EDENS AI Multilingual Agronomist Consultation'}
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#10B981]/20 text-[#10B981] font-mono font-bold">
                  {activeLanguage.name}
                </span>
              </div>
              <p className="text-xs opacity-70">
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
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer",
                autoSpeak
                  ? "bg-[#10B981]/20 border-[#10B981]/40 text-[#10B981] shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                  : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 opacity-60 hover:opacity-100"
              )}
            >
              {autoSpeak ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span className="font-bold">Speech</span>: {autoSpeak ? "AUTO ON" : "OFF"}
            </button>

            {/* Voice Persona Selector */}
            <div className="flex items-center gap-1.5 text-xs bg-black/5 dark:bg-white/5 px-2.5 py-1.5 rounded-xl border border-black/10 dark:border-white/10">
              <Headphones size={13} className="text-[#10B981] shrink-0" />
              <select 
                value={voicePersona}
                onChange={(e) => handleSelectVoicePersona(e.target.value)}
                className="bg-transparent text-xs font-medium text-foreground outline-none cursor-pointer"
                title="Select Gemini Voice Persona"
              >
                <option value="Kore" className="bg-[#111] text-white">Kore (Warm Botanist)</option>
                <option value="Zephyr" className="bg-[#111] text-white">Zephyr (Smooth Expert)</option>
                <option value="Puck" className="bg-[#111] text-white">Puck (Energetic Voice)</option>
                <option value="Fenrir" className="bg-[#111] text-white">Fenrir (Deep Voice)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono bg-black/5 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/10">
              <span className={cn(
                "w-2 h-2 rounded-full shrink-0",
                hardwareDataSource === 'REAL_HARDWARE' ? "bg-emerald-500" :
                hardwareDataSource === 'CACHED' ? "bg-amber-500 animate-pulse" :
                hardwareDataSource === 'STALE' ? "bg-orange-500" :
                hardwareDataSource === 'SIMULATED' ? "bg-purple-400" : "bg-red-500"
              )} />
              <span className="font-bold text-[10px] uppercase tracking-wider text-foreground">
                {hardwareDataSource}
                {isTelemetryStale && hardwareDataSource === 'REAL_HARDWARE' ? ' (STALE)' : ''}
              </span>
              {hardwareDataSource === 'DISCONNECTED' ? (
                <span className="opacity-70 text-[10px] hidden sm:inline text-red-400">
                  No live sensor signal
                </span>
              ) : (
                <span className="opacity-70 text-[10px] hidden sm:inline">
                  {Number(tempVal).toFixed(1)}°C · {Number(humVal).toFixed(0)}% Hum · {Number(soilVal).toFixed(0)}% Soil
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {/* Quick sample question chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 shrink-0">
              {activeLanguage.id === 'ha' ? 'Misalan Tambayoyi:' : activeLanguage.id === 'yo' ? 'Àpẹẹrẹ Ìbéèrè:' : activeLanguage.id === 'ig' ? 'Ụfọdụ Ajụjụ:' : 'Quick Prompts:'}
            </span>
            {activeLanguage.sampleQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendChat(q)}
                disabled={isSending || isRecording}
                className="shrink-0 text-xs px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[#10B981]/15 hover:border-[#10B981]/40 border border-black/10 dark:border-white/10 text-foreground transition-all cursor-pointer font-medium"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Conversation history area */}
          <div 
            ref={chatScrollRef}
            className="h-[340px] overflow-y-auto space-y-3.5 p-4 rounded-2xl bg-black/5 dark:bg-black/40 border border-black/5 dark:border-white/5 font-sans"
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
                    "flex flex-col max-w-[88%] md:max-w-[80%] rounded-2xl p-4 text-xs md:text-sm leading-relaxed",
                    isAssistant
                      ? "mr-auto bg-white dark:bg-[#121212] border border-[#D1E8D1] dark:border-white/10 text-foreground shadow-sm"
                      : "ml-auto bg-[#10B981] text-black font-medium shadow-[0_2px_12px_rgba(16,185,129,0.25)]"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        isAssistant ? "text-[#10B981]" : "text-black/75"
                      )}>
                        {isAssistant ? `EDENS AI (${activeLanguage.name})` : 'You (Farmer)'}
                      </span>
                      {msg.isVoiceInput && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-black/15 text-black">
                          <Mic size={9} /> Voice Note
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={cn("text-[9px] opacity-60", isAssistant ? "" : "text-black/60")}>
                        {format(new Date(msg.timestamp), 'HH:mm')}
                      </span>

                      {/* Assistant Audio Speech Button */}
                      {isAssistant && (
                        <button 
                          type="button"
                          onClick={() => playSpeech(msg.content, msgId)}
                          title={isPlaying ? "Stop listening" : `Listen in ${activeLanguage.name}`}
                          className={cn(
                            "flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border",
                            isPlaying
                              ? "bg-red-500/20 text-red-400 border-red-500/40"
                              : isGenerating
                              ? "bg-[#10B981]/20 text-[#10B981] border-[#10B981]/40"
                              : "hover:bg-[#10B981]/15 text-[#10B981] border-[#10B981]/20 bg-[#10B981]/5"
                          )}
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 size={11} className="animate-spin text-[#10B981]" />
                              <span className="text-[9px]">Voice...</span>
                            </>
                          ) : isPlaying ? (
                            <>
                              <Square size={10} />
                              <span className="text-[9px] font-bold">Stop</span>
                              <div className="flex items-center gap-0.5">
                                <span className="w-0.5 h-2 bg-red-400 rounded animate-bounce" />
                                <span className="w-0.5 h-1.5 bg-red-400 rounded animate-bounce [animation-delay:0.15s]" />
                                <span className="w-0.5 h-2.5 bg-red-400 rounded animate-bounce [animation-delay:0.3s]" />
                              </div>
                            </>
                          ) : (
                            <>
                              <Volume2 size={12} />
                              <span className="text-[9px] font-bold">Speech</span>
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
                className="flex items-center gap-2 p-3 rounded-2xl bg-white dark:bg-[#121212] border border-[#10B981]/30 max-w-[65%] text-xs font-mono text-[#10B981]"
              >
                <Sparkles size={14} className="animate-spin text-[#10B981]" />
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
                className="p-3.5 rounded-2xl bg-gradient-to-r from-red-500/15 via-red-500/10 to-transparent border border-red-500/30 flex flex-wrap items-center justify-between gap-3 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-red-500 uppercase tracking-widest">
                      REC {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      Listening in <strong className="text-[#10B981]">{activeLanguage.name} ({activeLanguage.nativeName})</strong>...
                    </span>
                  </div>

                  {/* Pulsing Audio visualizer bars */}
                  <div className="flex items-center gap-1 pl-2">
                    {[...Array(6)].map((_, idx) => (
                      <motion.span
                        key={idx}
                        className="w-1 bg-red-500 rounded-full"
                        animate={{ height: ['4px', `${12 + (idx % 3) * 8}px`, '4px'] }}
                        transition={{ repeat: Infinity, duration: 0.6 + (idx * 0.1), ease: 'easeInOut' }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelRecording}
                    className="text-xs hover:bg-red-500/20 text-red-400 hover:text-red-300 h-8 px-3 rounded-xl cursor-pointer"
                  >
                    <X size={14} className="mr-1" /> Discard
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => stopAndTranscribe(false)}
                    className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-8 px-3.5 rounded-xl cursor-pointer text-xs shadow-md"
                  >
                    <Check size={14} className="mr-1" /> Transcribe
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => stopAndTranscribe(true)}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold h-8 px-3.5 rounded-xl cursor-pointer text-xs shadow-md"
                  >
                    <Send size={12} className="mr-1" /> Send Voice
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
              className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between text-xs text-blue-500 dark:text-blue-400"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-blue-500" />
                <span className="font-semibold">
                  Uploading and validating voice note for speech transcription...
                </span>
              </div>
              <span className="text-[10px] font-mono opacity-70">EDENS AI Pipeline</span>
            </motion.div>
          )}

          {/* Audio Transcription Loading State */}
          {isTranscribing && voiceState !== 'uploading' && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-between text-xs text-[#10B981]"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-[#10B981]" />
                <span className="font-semibold">
                  EDENS AI ń gbọ́ / Transcribing & understanding speech in {activeLanguage.name} ({activeLanguage.nativeName})...
                </span>
              </div>
              <span className="text-[10px] font-mono opacity-70">Powered by Gemini AI</span>
            </motion.div>
          )}

          {/* Structured Voice Error / Diagnostic Resolution Banner */}
          {voiceError && (
            <motion.div 
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "p-4 rounded-2xl border space-y-2.5 shadow-sm",
                voiceError.type === 'permission' || voiceError.type === 'insecure-context'
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                  : voiceError.type === 'ai-service'
                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-500 dark:text-blue-400"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold leading-tight">
                      {voiceError.title}
                    </p>
                    <p className="text-[11px] opacity-90 leading-relaxed text-foreground">
                      {voiceError.message}
                    </p>
                    {voiceError.actionHint && (
                      <p className="text-[11px] opacity-80 leading-relaxed text-foreground font-medium">
                        💡 {voiceError.actionHint}
                      </p>
                    )}
                  </div>
                </div>

                <button 
                  type="button" 
                  onClick={() => setVoiceError(null)}
                  className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg cursor-pointer shrink-0 text-foreground opacity-60 hover:opacity-100"
                  aria-label="Dismiss message"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-black/10 dark:border-white/10">
                {voiceError.canRetryMic && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={startRecording}
                    disabled={isRecording || isTranscribing}
                    className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-7 px-3 rounded-xl text-xs cursor-pointer shadow-sm"
                  >
                    <RefreshCw size={12} className="mr-1" /> Retry Microphone
                  </Button>
                )}

                {voiceError.canUploadFile && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || isTranscribing}
                    className="border-current hover:bg-black/5 dark:hover:bg-white/5 h-7 px-3 rounded-xl text-xs cursor-pointer"
                  >
                    <Upload size={12} className="mr-1" /> Upload Voice Note
                  </Button>
                )}

                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold underline px-2 py-1 ml-auto opacity-80 hover:opacity-100"
                >
                  <span>Open in Full Tab</span>
                  <ExternalLink size={12} />
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
            <button
              type="button"
              disabled={isSending || isTranscribing}
              onClick={() => {
                if (isRecording) {
                  stopAndTranscribe(false);
                } else {
                  startRecording();
                }
              }}
              title={
                voiceState === 'requesting_mic' ? "Requesting microphone..." :
                isRecording ? "Stop Recording & Transcribe" : 
                `Click to speak in ${activeLanguage.name} or Nigerian languages`
              }
              className={cn(
                "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-center shrink-0 relative group",
                isRecording 
                  ? "bg-red-500 text-white border-red-600 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)]" 
                  : voiceState === 'requesting_mic'
                  ? "bg-amber-500/20 text-amber-500 border-amber-500/40"
                  : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-[#10B981] hover:text-[#10B981] text-foreground",
                (isSending || isTranscribing) && "opacity-50 cursor-not-allowed"
              )}
            >
              {voiceState === 'requesting_mic' ? (
                <Loader2 size={18} className="animate-spin text-amber-500" />
              ) : isRecording ? (
                <Square size={18} />
              ) : (
                <Mic size={18} />
              )}
              <span className="sr-only">Microphone</span>
            </button>

            {/* Upload Audio File / Voice Note Button */}
            <button
              type="button"
              disabled={isSending || isRecording || isTranscribing}
              onClick={() => fileInputRef.current?.click()}
              title={`Upload audio recording or WhatsApp voice note in ${activeLanguage.name}`}
              className={cn(
                "p-3 rounded-2xl border bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-[#10B981] hover:text-[#10B981] text-foreground transition-all cursor-pointer flex items-center justify-center shrink-0",
                (isSending || isRecording || isTranscribing) && "opacity-50 cursor-not-allowed"
              )}
            >
              <Upload size={18} />
              <span className="sr-only">Upload Voice Note</span>
            </button>

            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                activeLanguage.id === 'ha' ? `Yi magana da mic ko rubuta tambaya a Harshen Hausa...` :
                activeLanguage.id === 'yo' ? `Sọ̀rọ̀ sínú mic tàbí kọ ìbéèrè ní Èdè Yorùbá...` :
                activeLanguage.id === 'ig' ? `Gwa m okwu site na mic ma ọ bụ dee n'Asụsụ Igbo...` :
                activeLanguage.id === 'pcm' ? `Talk into mic or type your question in Naija Pidgin...` :
                `Speak or type any question in ${activeLanguage.name}...`
              }
              className="flex-1 bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl px-4 py-3 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-[#10B981] transition-all"
            />

            <Button
              type="submit"
              disabled={!chatInput.trim() || isSending || isRecording}
              className="bg-[#10B981] hover:bg-[#059669] text-black font-bold h-11 px-5 rounded-2xl cursor-pointer shadow-[0_2px_10px_rgba(16,185,129,0.3)] shrink-0"
            >
              <Send size={16} className="mr-1" /> Send
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Historical Diagnostic Analysis Records */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3 opacity-80">
            <Clock size={16} className="text-[#10B981]" />
            <h2 className="text-[11px] uppercase tracking-[0.2em] font-bold">
              {activeLanguage.id === 'ha' ? 'Tarihin Binciken Cututtukan Shuka' :
               activeLanguage.id === 'yo' ? 'Àkójọ Àyẹ̀wò Àtijọ́' :
               activeLanguage.id === 'ig' ? 'Akụkọ Nnyocha nke Oge Gara Aga' :
               'Botanical Analysis History'}
            </h2>
          </div>
          <span className="text-xs font-mono opacity-50">
            {historyEntries.length} Records
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {historyEntries.map(([id, entry]: any) => (
             <Card key={id} className="border border-[#E8F0E8] dark:border-white/10 bg-[#FFFFFF]/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl rounded-2xl shadow-sm transform transition-all hover:-translate-y-1 hover:shadow-md group">
               <CardContent className="p-5 flex gap-4 items-center">
                 {entry.image && (
                   <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-black/10 dark:border-white/10 relative">
                     <img src={entry.image} className="w-full h-full object-cover mix-blend-luminosity group-hover:mix-blend-normal transition-all duration-500" alt="History" />
                   </div>
                 )}
                 <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] uppercase opacity-50 font-bold tracking-widest">{format(new Date(entry.timestamp), 'MMM dd · HH:mm')}</div>
                      {entry.language && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#10B981]/15 text-[#10B981] font-mono font-bold">
                          {entry.language}
                        </span>
                      )}
                    </div>
                    <div className="font-bold truncate text-[13px] mb-1.5">{entry.speciesLocal || entry.species}</div>
                     <div className={cn(
                        "text-[10px] font-bold w-max px-2 py-0.5 rounded-md uppercase tracking-wider",
                        entry.healthStatus === 'Healthy' ? "bg-[#10B981]/10 text-[#10B981]" :
                        entry.healthStatus === 'Stressed' ? "bg-amber-500/10 text-amber-500" :
                        "bg-red-500/10 text-red-500"
                      )}>
                        {entry.healthStatusLocal || entry.healthStatus}
                      </div>
                 </div>
               </CardContent>
             </Card>
          ))}
          {historyEntries.length === 0 && (
            <div className="col-span-3 text-center py-16 opacity-40 font-mono text-[10px] border border-dashed border-[#1A1A1A] rounded-3xl uppercase tracking-[0.2em] font-bold">
              No historical data available. Capture an image above to start.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
