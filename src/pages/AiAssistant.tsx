import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FileAudio,
  Globe,
  ImagePlus,
  Info,
  Loader2,
  MessageSquareText,
  Mic,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import {
  analyzePlantImage,
  type ChatMessage,
  consultAgronomist,
  generateSpeechAudio,
  NIGERIAN_LANGUAGES,
  transcribeSpeechAudio
} from '../lib/gemini';
import {
  base64PcmToWavUrl,
  checkMicrophoneSupport,
  playAudioUrl,
  speakWithBrowserTts,
  startAudioRecording,
  stopAllAudio,
  validateAudioFile,
  type VoiceRecorderController
} from '../lib/audio';
import { formatRelativeAge, useFarmerGreenhouseState } from '../lib/greenhouseState';
import { store, useStoreValue } from '../lib/store';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

function formatMessageText(raw: string): React.ReactNode {
  // Clean markdown bold/headings lightly so farmers read plain, clear paragraphs & bullet points
  const lines = raw.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} className="h-2" />;
    const cleaned = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,3}\s+/, '');
    const isBullet = /^[-•*]\s+/.test(cleaned) || /^\d+[.)]\s+/.test(cleaned);
    return (
      <p
        key={i}
        className={cn(
          'leading-relaxed',
          isBullet && 'pl-3 py-0.5 my-0.5'
        )}
      >
        {cleaned}
      </p>
    );
  });
}

export default function AiAssistant() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ghState = useFarmerGreenhouseState();

  const savedLangId = String(useStoreValue('aiLanguage', 'en') || 'en');
  const [selectedLangId, setSelectedLangId] = useState<string>(() =>
    NIGERIAN_LANGUAGES.some((l) => l.id === savedLangId) ? savedLangId : 'en'
  );
  const [autoSpeak, setAutoSpeak] = useState<boolean>(false);

  const selectedLang =
    NIGERIAN_LANGUAGES.find((l) => l.id === selectedLangId) ||
    NIGERIAN_LANGUAGES.find((l) => l.id === 'en')!;

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      role: 'assistant',
      content: selectedLang.welcomeGreeting,
      timestamp: new Date().toISOString(),
      languageId: selectedLang.id
    }
  ]);

  const [input, setInput] = useState('');
  const [attachedLeafImage, setAttachedLeafImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Voice recording & playback states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [loadingSpeechIndex, setLoadingSpeechIndex] = useState<number | null>(null);
  const [micHintBanner, setMicHintBanner] = useState<string | null>(null);

  const recorderRef = useRef<VoiceRecorderController | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const voiceFileInputRef = useRef<HTMLInputElement | null>(null);
  const leafFileInputRef = useRef<HTMLInputElement | null>(null);
  const handledInitialQueryRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    return () => {
      stopAllAudio();
      recorderRef.current?.cancel();
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    };
  }, []);

  const handleLanguageChange = (newLangId: string) => {
    setSelectedLangId(newLangId);
    store.setValue('aiLanguage', newLangId);
    const langObj = NIGERIAN_LANGUAGES.find((l) => l.id === newLangId);
    if (langObj && messages.length === 1 && messages[0].role === 'assistant') {
      setMessages([
        {
          role: 'assistant',
          content: langObj.welcomeGreeting,
          timestamp: new Date().toISOString(),
          languageId: langObj.id
        }
      ]);
    }
  };

  const speakReply = useCallback(
    async (text: string, msgIndex: number) => {
      if (speakingIndex === msgIndex) {
        stopAllAudio();
        setSpeakingIndex(null);
        return;
      }
      stopAllAudio();
      setLoadingSpeechIndex(msgIndex);
      try {
        const pcmBase64 = await generateSpeechAudio(text, 'Kore');
        const wavUrl = base64PcmToWavUrl(pcmBase64, 24000);
        setLoadingSpeechIndex(null);
        setSpeakingIndex(msgIndex);
        playAudioUrl(
          wavUrl,
          () => {
            URL.revokeObjectURL(wavUrl);
            setSpeakingIndex(null);
          },
          () => {
            URL.revokeObjectURL(wavUrl);
            setSpeakingIndex(null);
          }
        );
      } catch {
        setLoadingSpeechIndex(null);
        const started = speakWithBrowserTts(
          text,
          selectedLang.speechCode || 'en-NG',
          () => setSpeakingIndex(msgIndex),
          () => setSpeakingIndex(null)
        );
        if (!started) {
          setSpeakingIndex(null);
        }
      }
    },
    [selectedLang.speechCode, speakingIndex]
  );

  const sendQuestion = useCallback(
    async (questionText: string, options?: { isVoice?: boolean; leafDataUrl?: string | null }) => {
      const trimmed = questionText.trim();
      const imageToInspect = options?.leafDataUrl ?? attachedLeafImage;
      if ((!trimmed && !imageToInspect) || sending) return;

      setErrorBanner(null);
      setSending(true);

      const userLabel =
        trimmed || 'Please inspect this attached leaf photo and tell me if my plant is healthy.';
      const userMsg: ChatMessage = {
        role: 'user',
        content: userLabel,
        timestamp: new Date().toISOString(),
        languageId: selectedLangId,
        isVoiceInput: options?.isVoice
      };

      const nextHistory = [...messages, userMsg];
      setMessages(nextHistory);
      setInput('');
      setAttachedLeafImage(null);

      try {
        let replyText = '';

        if (imageToInspect) {
          const diagnosis = await analyzePlantImage(imageToInspect, selectedLangId);
          replyText = [
            `Plant Identified: ${diagnosis.species}${diagnosis.speciesLocal ? ` (${diagnosis.speciesLocal})` : ''}`,
            `Health Status: ${diagnosis.healthStatus}${diagnosis.healthStatusLocal ? ` — ${diagnosis.healthStatusLocal}` : ''}`,
            `What I See: ${diagnosis.symptoms}`,
            `Likely Cause: ${diagnosis.cause}`,
            `Recommended Next Steps: ${diagnosis.recommendation}`,
            `Note: Visual diagnosis is advisory. Check leaf undersides and soil moisture in person before applying treatments.`
          ].join('\n\n');

          store.setRow('ai_history', `${Date.now()}`, {
            timestamp: new Date().toISOString(),
            species: diagnosis.species,
            healthStatus: diagnosis.healthStatus,
            recommendation: diagnosis.recommendation,
            language: selectedLang.name
          });
        } else {
          // Build strictly honest telemetry context
          const hasValidNumbers = ghState.provenance !== 'UNAVAILABLE';
          const contextData = {
            cropType: ghState.cropName,
            temperature:
              hasValidNumbers && ghState.metrics.temperature.value !== null
                ? ghState.metrics.temperature.value
                : undefined,
            humidity:
              hasValidNumbers && ghState.metrics.humidity.value !== null
                ? ghState.metrics.humidity.value
                : undefined,
            soilMoisture:
              hasValidNumbers && ghState.metrics.soilMoisture.value !== null
                ? ghState.metrics.soilMoisture.value
                : undefined,
            dataSource:
              ghState.provenance === 'UNAVAILABLE' ? 'DISCONNECTED' : ghState.provenance,
            isStale: ghState.provenance === 'STALE' || ghState.provenance === 'CACHED',
            lastSeen: ghState.lastUpdatedAt || undefined
          };

          replyText = await consultAgronomist(
            userLabel,
            selectedLangId,
            nextHistory.slice(-10),
            contextData
          );
        }

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: replyText,
          timestamp: new Date().toISOString(),
          languageId: selectedLangId
        };

        setMessages((prev) => {
          const updated = [...prev, assistantMsg];
          if (autoSpeak) {
            setTimeout(() => {
              void speakReply(replyText, updated.length - 1);
            }, 100);
          }
          return updated;
        });
      } catch (err: any) {
        setErrorBanner(
          err?.message ||
            'EDENS AI could not complete your request right now. Check your internet connection and try again.'
        );
      } finally {
        setSending(false);
      }
    },
    [
      attachedLeafImage,
      autoSpeak,
      ghState.cropName,
      ghState.lastUpdatedAt,
      ghState.metrics.humidity.value,
      ghState.metrics.soilMoisture.value,
      ghState.metrics.temperature.value,
      ghState.provenance,
      messages,
      selectedLang.name,
      selectedLangId,
      sending,
      speakReply
    ]
  );

  // Handle ?q=... or ?voice=1 query parameters from Home Dashboard
  useEffect(() => {
    if (handledInitialQueryRef.current) return;
    const qParam = searchParams.get('q');
    const voiceParam = searchParams.get('voice');

    if (qParam) {
      handledInitialQueryRef.current = true;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('q');
      setSearchParams(nextParams, { replace: true });
      void sendQuestion(qParam);
    } else if (voiceParam === '1') {
      handledInitialQueryRef.current = true;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('voice');
      setSearchParams(nextParams, { replace: true });
      setMicHintBanner(
        `Tap "Speak Question" below and talk naturally in ${selectedLang.name}.`
      );
    }
  }, [searchParams, selectedLang.name, sendQuestion, setSearchParams]);

  const handleStartRecording = async () => {
    setErrorBanner(null);
    setMicHintBanner(null);
    const support = await checkMicrophoneSupport();
    if (!support.supported) {
      setErrorBanner(
        support.message ||
          'Microphone is unavailable in this browser. You can upload a recorded voice note instead.'
      );
      return;
    }

    try {
      const controller = await startAudioRecording();
      recorderRef.current = controller;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      setErrorBanner(
        err?.message ||
          'Could not access your microphone. Allow microphone permission or upload a voice note.'
      );
    }
  };

  const handleStopRecording = async () => {
    if (!recorderRef.current) return;
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    setIsTranscribing(true);
    setErrorBanner(null);

    try {
      const { base64, mimeType } = await recorderRef.current.stop();
      recorderRef.current = null;
      const transcript = await transcribeSpeechAudio(base64, mimeType, selectedLangId);
      if (!transcript.trim()) {
        setErrorBanner(
          'No clear speech was heard. Please speak a little closer to your microphone and try again.'
        );
        return;
      }
      await sendQuestion(transcript.trim(), { isVoice: true });
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not transcribe voice recording.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCancelRecording = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const handleVoiceFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);

    const check = validateAudioFile(file, 15);
    if (!check.valid) {
      setErrorBanner(check.error || 'Unsupported audio file.');
      if (voiceFileInputRef.current) voiceFileInputRef.current.value = '';
      return;
    }

    setIsTranscribing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const raw = String(reader.result || '');
          resolve(raw.split(',')[1] || '');
        };
        reader.onerror = () => reject(new Error('Failed to read audio file.'));
        reader.readAsDataURL(file);
      });
      const transcript = await transcribeSpeechAudio(
        base64,
        file.type || 'audio/webm',
        selectedLangId
      );
      if (!transcript.trim()) {
        setErrorBanner('No speech was detected in that audio note.');
        return;
      }
      await sendQuestion(transcript.trim(), { isVoice: true });
    } catch (err: any) {
      setErrorBanner(err?.message || 'Voice note transcription failed.');
    } finally {
      setIsTranscribing(false);
      if (voiceFileInputRef.current) voiceFileInputRef.current.value = '';
    }
  };

  const handleLeafPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setAttachedLeafImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    if (leafFileInputRef.current) leafFileInputRef.current.value = '';
  };

  const handleClearConversation = () => {
    stopAllAudio();
    setSpeakingIndex(null);
    setMessages([
      {
        role: 'assistant',
        content: selectedLang.welcomeGreeting,
        timestamp: new Date().toISOString(),
        languageId: selectedLang.id
      }
    ]);
  };

  const contextExplanation =
    ghState.provenance === 'REAL_HARDWARE'
      ? `Using live sensor readings from ${ghState.greenhouseName} (${ghState.metrics.temperature.formattedValue}, ${ghState.metrics.humidity.formattedValue} humidity, ${ghState.metrics.soilMoisture.formattedValue} soil — updated ${formatRelativeAge(ghState.lastUpdatedAgeSeconds, ghState.lastUpdatedAt)}).`
      : ghState.provenance === 'CACHED' || ghState.provenance === 'STALE'
        ? `Sensor readings from ${ghState.greenhouseName} are delayed (${formatRelativeAge(ghState.lastUpdatedAgeSeconds, ghState.lastUpdatedAt)}). Advice will note that current greenhouse conditions may have changed.`
        : ghState.provenance === 'SIMULATED'
          ? 'Practice Mode is active. EDENS AI knows these sensor numbers are simulated and will label advice accordingly.'
          : 'No live greenhouse sensors are connected right now. EDENS AI will answer using general farming knowledge without guessing your greenhouse temperature or moisture.';

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header & Language Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <MessageSquareText size={24} className="text-primary" />
            AI Farming Assistant
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ask crop, watering, pest, or greenhouse questions by typing or speaking in your language.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Language Selector */}
          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 h-10">
            <Globe size={15} className="text-primary shrink-0" />
            <label htmlFor="ai-lang-select" className="sr-only">
              Select Language
            </label>
            <select
              id="ai-lang-select"
              value={selectedLangId}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-transparent text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
            >
              {NIGERIAN_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
          </div>

          {/* Auto-Read Replies Toggle */}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (autoSpeak) stopAllAudio();
              setAutoSpeak((v) => !v);
            }}
            className={cn(
              'h-10 px-3.5 rounded-xl text-xs font-semibold cursor-pointer',
              autoSpeak && 'border-primary bg-accent text-accent-foreground'
            )}
          >
            {autoSpeak ? (
              <Volume2 size={15} className="mr-1.5 text-primary" />
            ) : (
              <VolumeX size={15} className="mr-1.5 text-muted-foreground" />
            )}
            {autoSpeak ? 'Voice Replies On' : 'Voice Replies Off'}
          </Button>

          {messages.length > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleClearConversation}
              className="h-10 px-3 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
              title="Start new conversation"
            >
              <Trash2 size={14} className="mr-1.5" />
              New Chat
            </Button>
          )}
        </div>
      </div>

      {/* Honest Greenhouse Context Banner */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-2.5 max-w-2xl">
          {ghState.provenance === 'REAL_HARDWARE' ? (
            <CheckCircle2 size={16} className="text-primary shrink-0 mt-0.5" />
          ) : (
            <Info size={16} className="text-muted-foreground shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{contextExplanation}</span>
        </div>
        <Link
          to="/vision"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline underline-offset-4 whitespace-nowrap shrink-0"
        >
          <Camera size={14} />
          <span>Check Greenhouse Camera</span>
        </Link>
      </div>

      {micHintBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-200 px-4 py-3 text-xs flex items-center justify-between gap-2">
          <span className="font-medium">{micHintBanner}</span>
          <button
            type="button"
            onClick={() => setMicHintBanner(null)}
            className="text-emerald-800 dark:text-emerald-300 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200 px-4 py-3 text-xs flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-800 dark:text-red-300 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Main Chat Card */}
      <section className="rounded-2xl border border-border bg-card shadow-xs flex flex-col overflow-hidden">
        {/* Conversation History */}
        <div className="p-5 md:p-6 space-y-4 min-h-[360px] max-h-[540px] overflow-y-auto">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const isSpeakingThis = speakingIndex === idx;
            const isLoadingThisSpeech = loadingSpeechIndex === idx;

            return (
              <div
                key={`${msg.timestamp}-${idx}`}
                className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}
              >
                <div
                  className={cn(
                    'max-w-[88%] sm:max-w-[78%] rounded-2xl px-4 py-3.5 text-sm space-y-1',
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/60 text-foreground border border-border'
                  )}
                >
                  {isUser ? (
                    <p className="leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-1">{formatMessageText(msg.content)}</div>
                  )}
                </div>

                <div className="flex items-center gap-3 px-1 text-[11px] text-muted-foreground">
                  <span className="font-mono tabular-nums flex items-center gap-1">
                    <Clock size={11} />
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  {msg.isVoiceInput && <span>Spoken question</span>}

                  {!isUser && (
                    <button
                      type="button"
                      onClick={() => void speakReply(msg.content, idx)}
                      disabled={isLoadingThisSpeech}
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer"
                    >
                      {isLoadingThisSpeech ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : isSpeakingThis ? (
                        <Square size={11} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                      <span>
                        {isLoadingThisSpeech
                          ? 'Preparing voice...'
                          : isSpeakingThis
                            ? 'Stop Reading'
                            : 'Listen'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {(sending || isTranscribing) && (
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground px-2 py-2">
              <Loader2 size={16} className="animate-spin text-primary" />
              <span>
                {isTranscribing
                  ? `Listening and transcribing your ${selectedLang.name} voice note...`
                  : 'EDENS AI is preparing clear farming guidance...'}
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Farmer Questions */}
        {messages.length <= 2 && !sending && (
          <div className="px-5 md:px-6 pb-4 pt-2 border-t border-border bg-muted/20 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Suggested questions in {selectedLang.name}:
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedLang.sampleQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendQuestion(q)}
                  className="text-left text-xs font-medium rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 px-3 py-2 text-foreground transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Composer Area */}
        <div className="p-4 md:p-5 border-t border-border bg-card space-y-3">
          {/* Attached Leaf Photo Preview */}
          {attachedLeafImage && (
            <div className="inline-flex items-center gap-3 rounded-xl border border-border bg-muted/50 p-2 pr-3">
              <img
                src={attachedLeafImage}
                alt="Attached crop leaf"
                className="w-12 h-12 rounded-lg object-cover border border-border"
              />
              <div className="text-xs">
                <p className="font-semibold text-foreground">Leaf photo attached</p>
                <p className="text-muted-foreground">Tap Send to inspect plant health</p>
              </div>
              <button
                type="button"
                onClick={() => setAttachedLeafImage(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Remove attached photo"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Active Voice Recording Bar */}
          {isRecording ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/45 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-red-900 dark:text-red-200">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 dark:bg-red-400 animate-pulse" />
                <span>Speaking in {selectedLang.name}...</span>
                <span className="font-mono tabular-nums text-xs bg-card text-foreground px-2 py-0.5 rounded border border-red-200 dark:border-red-800/60">
                  {Math.floor(recordingSeconds / 60)}:
                  {String(recordingSeconds % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancelRecording}
                  className="h-10 px-3.5 text-xs font-semibold bg-card cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleStopRecording}
                  className="h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                >
                  Done Speaking — Send
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuestion(input);
              }}
              className="space-y-3"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Type your farming question in ${selectedLang.name}...`}
                  disabled={sending || isTranscribing}
                  className="flex-1 h-11 rounded-xl border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  type="submit"
                  disabled={sending || isTranscribing || (!input.trim() && !attachedLeafImage)}
                  className="h-11 px-5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shrink-0 cursor-pointer"
                >
                  {sending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Send size={15} className="mr-1.5" />
                      <span>Ask</span>
                    </>
                  )}
                </Button>
              </div>

              {/* Voice & Photo Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sending || isTranscribing}
                    onClick={handleStartRecording}
                    className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <Mic size={15} className="mr-1.5 text-primary" />
                    Speak Question
                  </Button>

                  <input
                    ref={voiceFileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleVoiceFileSelected}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sending || isTranscribing}
                    onClick={() => voiceFileInputRef.current?.click()}
                    className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <FileAudio size={15} className="mr-1.5 text-primary" />
                    Upload Voice Note
                  </Button>

                  <input
                    ref={leafFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLeafPhotoSelected}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sending || isTranscribing}
                    onClick={() => leafFileInputRef.current?.click()}
                    className="h-10 px-3.5 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <ImagePlus size={15} className="mr-1.5 text-primary" />
                    Attach Leaf Photo
                  </Button>
                </div>

                <span className="text-[11px] text-muted-foreground">
                  Advisory guidance only — never changes physical equipment automatically.
                </span>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
