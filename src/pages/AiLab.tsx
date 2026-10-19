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
  SlidersHorizontal,
  Headphones,
  ExternalLink,
  RefreshCw,
  Lock
} from 'lucide-react';
import { 
  analyzePlantImage, 
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
  speakWithBrowserTts 
} from '../lib/audio';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { HardwareSetupGuide } from '../components/HardwareSetupGuide';

export default function AiLab() {
  const camUrl = useStoreValue('cameraUrl', import.meta.env.VITE_ESP32_CAM_STREAM_URL || '');
  const isVisionAgentEnabled = useStoreValue('agent_VisionAgent_enabled', false);
  const tempVal = useStoreValue('temperature', 24.5);
  const humVal = useStoreValue('humidity', 65.0);
  const soilVal = useStoreValue('soilMoisture', 52.0);
  const cropType = useStoreValue('cropType', 'Tomato (Tumatir / Tòmátì)');

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<PlantAnalysisResult | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const historyTable = useStoreTable('ai_history');

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

  // Capture and analyze plant image with active Nigerian language
  const handleCapture = async () => {
    if (!imgRef.current) return;
    setAnalyzing(true);
    setResult(null);
    stopAllAudio();
    setCurrentPlayingId(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgRef.current.width || 640;
      canvas.height = imgRef.current.height || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
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

        // Auto announce summary in Nigerian language if auto-speak is enabled
        if (autoSpeak && (res.audioSummary || res.recommendation)) {
          setTimeout(() => {
            const speechText = `${res.speciesLocal || res.species}. ${res.healthStatusLocal || res.healthStatus}. ${res.audioSummary || res.recommendation}`;
            playSpeech(speechText, 'diag-auto');
          }, 600);
        }
      }
    } catch (e) {
      console.error(e);
      alert('EDENS AI diagnostic service is currently unavailable. ' + (e as Error).message);
    } finally {
      setAnalyzing(false);
    }
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

  // Microphone recording & speech-to-text
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorderController | null>(null);
  const timerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      stopAllAudio();
      if (recorderRef.current) {
        recorderRef.current.cancel();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    setAudioError(null);
    stopAllAudio();
    setCurrentPlayingId(null);

    try {
      const controller = await startAudioRecording();
      recorderRef.current = controller;
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setAudioError('Microphone permission denied. Please allow microphone access or upload an audio voice note.');
      } else {
        setAudioError(`Microphone unavailable (${err.message || 'permission error'}). You can also upload a voice note below.`);
      }
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
  };

  const stopAndTranscribe = async (autoSend: boolean = false) => {
    if (!recorderRef.current || !isRecording) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setIsTranscribing(true);

    try {
      const { base64, mimeType } = await recorderRef.current.stop();
      recorderRef.current = null;

      const transcribedText = await transcribeSpeechAudio(base64, mimeType, selectedLangId);
      setIsTranscribing(false);

      if (transcribedText) {
        if (autoSend) {
          handleSendChat(transcribedText, true);
        } else {
          setChatInput(transcribedText);
        }
      } else {
        setAudioError(`Could not detect clear speech in ${activeLanguage.name}. Please try speaking a bit louder or closer to the mic.`);
      }
    } catch (err: any) {
      console.error("Speech transcription error:", err);
      setIsTranscribing(false);
      setAudioError("Speech transcription error: " + (err.message || 'Failed to process voice'));
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsTranscribing(true);
    setAudioError(null);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1] || '';
        const mimeType = file.type || 'audio/webm';
        const transcribedText = await transcribeSpeechAudio(base64Data, mimeType, selectedLangId);
        setIsTranscribing(false);

        if (transcribedText) {
          setChatInput(transcribedText);
        } else {
          setAudioError(`Could not recognize speech from uploaded audio.`);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error("Audio upload error:", err);
      setIsTranscribing(false);
      setAudioError("Error processing uploaded audio: " + err.message);
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

    try {
      const reply = await consultAgronomist(
        promptToSend.trim(),
        selectedLangId,
        chatMessages,
        {
          cropType: String(cropType),
          temperature: Number(tempVal),
          humidity: Number(humVal),
          soilMoisture: Number(soilVal)
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

      // If auto-speak is enabled, speak out the response in authentic native voice!
      if (autoSpeak) {
        setTimeout(() => {
          playSpeech(reply, msgId);
        }, 300);
      }
    } catch (error) {
      console.error("Agronomist chat error", error);
      setChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: selectedLangId === 'ha' 
            ? 'Akwai ɗan matsala wajen sadarwa da EDENS AI. Da fatan za a sake gwadawa.'
            : selectedLangId === 'yo'
            ? 'Àṣìṣe díẹ̀ wáyé nígbà tí a ń gbìyànjú láti sọ̀rọ̀ pẹ̀lú EDENS AI. Jọ̀wọ́ tún gbìyànjú lẹ́ẹ̀kan sí i.'
            : selectedLangId === 'ig'
            ? 'Enwere obere nsogbu na nkwukọrịta na EDENS AI. Biko nwaa ọzọ.'
            : selectedLangId === 'pcm'
            ? 'Small network glitch happen with EDENS AI. Abeg try send your message again!'
            : 'EDENS AI encountered an error processing your inquiry. Please try again.',
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
        <Card id="tour-ai-camera" className="border border-[#14B8A6]/20 dark:border-white/5 bg-[#FFFFFF]/80 dark:bg-[#080808]/80 backdrop-blur-xl rounded-3xl shadow-[0_4px_24px_-4px_rgba(20,184,166,0.05)] flex flex-col hover:scale-[1.01] transition-transform duration-300 relative group overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#14B8A6]" />
          <CardHeader className="pb-4 border-b border-[#D1E8D1] dark:border-[#1A2A1A] flex flex-row items-center justify-between">
            <div className="text-[10px] w-max font-bold font-sans uppercase tracking-[0.05em] flex items-center gap-2 text-[#808080]">
              <Camera size={14} className="text-[#14B8A6]" /> LIVE CAMERA STREAM & VISUAL CAPTURE
            </div>
            <div className="text-[10px] font-mono text-[#14B8A6] font-bold">
              {activeLanguage.name} Mode
            </div>
          </CardHeader>
          <CardContent className="flex-1 space-y-6 p-6">
             <div className="w-full aspect-video bg-[#050505] rounded-2xl overflow-hidden relative border border-[#222] shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
               {camUrl ? (
                 <img ref={imgRef} src={camUrl} crossOrigin="anonymous" alt="ESP32-CAM Stream" className="w-full h-full object-cover mix-blend-luminosity hover:mix-blend-normal transition-all duration-700" />
               ) : (
                 <HardwareSetupGuide variant="custom">
                   <button className="w-full h-full flex items-center justify-center text-gray-500 font-sans flex-col gap-3 p-6 text-center absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0A0A0A] to-[#000000] hover:bg-[#111] transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-[#14B8A6] focus:ring-inset group border-0">
                      <div className="w-16 h-16 rounded-3xl bg-[#14B8A6]/5 flex items-center justify-center mb-2 border border-[#14B8A6]/30 relative overflow-hidden shadow-[0_0_30px_rgba(20,184,166,0.15)] group-hover:scale-110 transition-transform duration-500">
                         <div className="absolute inset-0 bg-[#14B8A6]/20 animate-pulse opacity-50" />
                         <Camera size={32} className="text-[#14B8A6] relative z-10 opacity-80 drop-shadow-[0_0_5px_rgba(20,184,166,0.5)]" />
                      </div>
                      <span className="tracking-widest opacity-100 font-bold text-white uppercase text-sm drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">Visual Stream Offline</span>
                      <span className="opacity-60 max-w-sm mb-2 text-xs leading-relaxed">Connect an ESP32-CAM to enable live plant monitoring and EDENS AI analysis in your native tongue.</span>
                      <span className="text-[#14B8A6] text-[10px] font-bold uppercase tracking-widest mt-2 border border-[#14B8A6]/30 bg-[#14B8A6]/10 px-3 py-1.5 rounded-full drop-shadow-[0_0_5px_rgba(20,184,166,0.3)]">Click to View Setup Guide</span>
                   </button>
                 </HardwareSetupGuide>
               )}
               <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+Cjwvc3ZnPg==')] opacity-40 mix-blend-overlay" />
             </div>

             <Button 
               onClick={handleCapture}
               disabled={!camUrl || analyzing}
               className="w-full bg-[#14B8A6] hover:bg-[#0D9488] text-white font-bold tracking-wide h-14 rounded-2xl shadow-[0_4px_20px_rgba(20,184,166,0.3)] border-0 cursor-pointer transition-all"
             >
               <Camera className="mr-2" size={20} /> 
               {analyzing ? `EDENS AI ń ṣe àyẹ̀wò...` : `Capture Frame & Diagnose in ${activeLanguage.name}`}
             </Button>
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

            <div className="hidden xl:flex items-center gap-1.5 text-xs font-mono opacity-70 bg-black/5 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-black/5 dark:border-white/5">
              <Sparkles size={13} className="text-[#10B981]" />
              <span>{Number(tempVal).toFixed(1)}°C · {Number(humVal).toFixed(0)}% Hum</span>
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

          {/* Audio Transcription Loading State */}
          {isTranscribing && (
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

          {/* Audio Error Alert & Permission Resolution Banner */}
          {audioError && (
            <motion.div 
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 space-y-2.5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold leading-tight">
                      Microphone Access Blocked or Restricted
                    </p>
                    <p className="text-[11px] opacity-90 leading-relaxed text-foreground">
                      Your browser denied microphone access for this page. To talk in Hausa, Yoruba, Igbo, or Pidgin:
                    </p>
                    <ol className="text-[11px] list-decimal list-inside opacity-85 space-y-0.5 text-foreground">
                      <li>Click the <strong className="text-amber-500 inline-flex items-center gap-0.5"><Lock size={10} /> lock icon</strong> or camera/mic icon beside the address bar.</li>
                      <li>Switch <strong>Microphone</strong> from <em>Block</em> to <strong>Allow</strong>.</li>
                      <li>Click <strong>Retry Microphone</strong> below, or tap <strong>Upload Voice Note</strong>.</li>
                    </ol>
                  </div>
                </div>

                <button 
                  type="button" 
                  onClick={() => setAudioError(null)}
                  className="p-1 hover:bg-amber-500/20 text-amber-500 rounded-lg cursor-pointer shrink-0"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-500/20">
                <Button
                  type="button"
                  size="sm"
                  onClick={startRecording}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-bold h-7 px-3 rounded-xl text-xs cursor-pointer shadow-sm"
                >
                  <RefreshCw size={12} className="mr-1" /> Retry Microphone
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-amber-500/40 hover:bg-amber-500/10 text-amber-500 h-7 px-3 rounded-xl text-xs cursor-pointer"
                >
                  <Upload size={12} className="mr-1" /> Upload Voice Note
                </Button>

                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 underline px-2 py-1 ml-auto"
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
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" 
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
              onClick={() => {
                if (isRecording) {
                  stopAndTranscribe(false);
                } else {
                  startRecording();
                }
              }}
              title={isRecording ? "Stop Recording & Understand" : `Click to talk in ${activeLanguage.name} or Nigerian languages`}
              className={cn(
                "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-center shrink-0 relative group",
                isRecording 
                  ? "bg-red-500 text-white border-red-600 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)]" 
                  : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-[#10B981] hover:text-[#10B981] text-foreground"
              )}
            >
              {isRecording ? <Square size={18} /> : <Mic size={18} />}
              <span className="sr-only">Microphone</span>
            </button>

            {/* Upload Audio File / Voice Note Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={`Upload audio recording or WhatsApp voice note in ${activeLanguage.name}`}
              className="p-3 rounded-2xl border bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-[#10B981] hover:text-[#10B981] text-foreground transition-all cursor-pointer flex items-center justify-center shrink-0"
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
