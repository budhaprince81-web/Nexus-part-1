import { useState, useEffect, useRef, useCallback } from 'react';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export type VoiceErrorKind =
  | 'permission-denied'
  | 'no-microphone'
  | 'unsupported'
  | 'network'
  | null;
type VoiceMode = 'none' | 'continuous' | 'push-to-talk';

interface UseVoiceOptions {
  onTranscript?: (text: string) => void;
  wakeWord?: string;
  lang?: string;
  ttsEnabled?: boolean;
  speechRate?: number;
  speechPitch?: number;
  feminineVoice?: boolean;
}

interface SpeechRecognitionResultItem { transcript: string; confidence: number; }
interface SpeechRecognitionResult extends Iterable<SpeechRecognitionResultItem> {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionResultList extends Iterable<SpeechRecognitionResult> {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error?: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
}

function getSRClass(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as (new () => SpeechRecognitionInstance) | undefined)
    || (w.webkitSpeechRecognition as (new () => SpeechRecognitionInstance) | undefined)
    || null;
}

function storedNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

const feminineVoiceNames = /\b(female|woman|samantha|zira|aria|jenny|ava|sara|susan|karen|moira|tessa)\b/i;

export function useVoice({
  onTranscript,
  wakeWord = 'nexus',
  lang = 'en-US',
  ttsEnabled = true,
  speechRate,
  speechPitch,
  feminineVoice = true,
}: UseVoiceOptions = {}) {
  const [state, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [errorKind, setErrorKind] = useState<VoiceErrorKind>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionModeRef = useRef<VoiceMode>('none');
  const retryCountRef = useRef(0);
  const enabledRef = useRef(enabled);
  const startListeningRef = useRef<() => void>(() => {});
  const speechTokenRef = useRef(0);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  enabledRef.current = enabled;

  const supported = typeof window !== 'undefined'
    && !!getSRClass()
    && 'speechSynthesis' in window;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const scheduleRestart = useCallback((delay: number) => {
    if (!enabledRef.current || restartTimerRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (enabledRef.current) {
        recognitionModeRef.current = 'continuous';
        startListeningRef.current();
      }
    }, delay);
  }, []);

  const stopListening = useCallback(() => {
    clearRestartTimer();
    retryCountRef.current = 0;
    recognitionModeRef.current = 'none';
    speechTokenRef.current += 1;
    if (recognitionRef.current) {
      const current = recognitionRef.current;
      recognitionRef.current = null;
      current.onend = null;
      current.onerror = null;
      try { current.stop(); } catch { /* Already stopped by the browser. */ }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceState('idle');
    setTranscript('');
  }, [clearRestartTimer]);

  const startListening = useCallback(() => {
    const SRClass = getSRClass();
    if (!SRClass || !enabledRef.current) {
      setVoiceState('idle');
      return;
    }
    clearRestartTimer();
    if (recognitionRef.current) {
      const previous = recognitionRef.current;
      recognitionRef.current = null;
      previous.onend = null;
      previous.onerror = null;
      try { previous.stop(); } catch { /* The browser may have ended it already. */ }
    }

    const sr = new SRClass();
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = lang;
    sr.maxAlternatives = 1;
    recognitionModeRef.current = 'continuous';

    sr.onstart = () => {
      retryCountRef.current = 0;
      setVoiceState('listening');
    };
    sr.onresult = (event: SpeechRecognitionEvent) => {
      const results = Array.from(event.results);
      const fullTranscript = results.map(result => result[0].transcript).join(' ').trim();
      setTranscript(fullTranscript);
      const latest = results[results.length - 1]?.[0]?.transcript?.toLowerCase() || '';
      if (latest.includes(wakeWord.toLowerCase())) {
        setWakeWordDetected(true);
        if (wakeWordTimerRef.current) clearTimeout(wakeWordTimerRef.current);
        wakeWordTimerRef.current = setTimeout(() => setWakeWordDetected(false), 3000);
      }
      if (event.results[event.results.length - 1]?.isFinal && fullTranscript.length > 2) {
        setTranscript('');
        setVoiceState('processing');
        onTranscript?.(fullTranscript);
      }
    };
    sr.onerror = (event: SpeechRecognitionErrorEvent) => {
      setVoiceState('idle');
      const code = event.error || '';
      const fatal = ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code);
      if (fatal) {
        // Be explicit about *why* the microphone stopped, instead of silently
        // turning voice off. The user can then grant permission and retry.
        setErrorKind(code === 'audio-capture' ? 'no-microphone' : 'permission-denied');
        recognitionModeRef.current = 'none';
        enabledRef.current = false;
        setEnabled(false);
        return;
      }
      if (code === 'network') setErrorKind('network');
      else setErrorKind(null);
      if (enabledRef.current && retryCountRef.current < 4) {
        retryCountRef.current += 1;
        scheduleRestart(Math.min(1000 * retryCountRef.current, 4000));
      }
    };
    sr.onend = () => {
      if (recognitionRef.current === sr) recognitionRef.current = null;
      if (recognitionModeRef.current === 'continuous' && enabledRef.current) {
        if (retryCountRef.current < 4) scheduleRestart(600);
        else setVoiceState('idle');
      } else if (recognitionModeRef.current !== 'push-to-talk') {
        setVoiceState('idle');
      }
    };

    recognitionRef.current = sr;
    try {
      sr.start();
    } catch {
      recognitionRef.current = null;
      setVoiceState('idle');
      if (retryCountRef.current < 4) {
        retryCountRef.current += 1;
        scheduleRestart(Math.min(1000 * retryCountRef.current, 4000));
      }
    }
  }, [clearRestartTimer, lang, onTranscript, scheduleRestart, wakeWord]);
  startListeningRef.current = startListening;

  const speak = useCallback((text: string, langCode?: string) => {
    if (!ttsEnabled || !text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const speechLang = langCode || lang;
    const normalizedLang = speechLang.toLowerCase();
    const language = normalizedLang.split('-')[0];
    const voices = window.speechSynthesis.getVoices();
    voicesRef.current = voices;

    if (recognitionRef.current && recognitionModeRef.current === 'continuous') {
      const current = recognitionRef.current;
      recognitionRef.current = null;
      recognitionModeRef.current = 'none';
      current.onend = null;
      current.onerror = null;
      try { current.stop(); } catch { /* Speech recognition already stopped. */ }
    }

    speechTokenRef.current += 1;
    const speechToken = speechTokenRef.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.rate = speechRate ?? storedNumber('nexus-voice-rate', 0.98, 0.8, 1.2);
    utterance.pitch = speechPitch ?? storedNumber('nexus-voice-pitch', 1.05, 0.8, 1.3);
    utterance.volume = 1;

    const matchingVoices = voices.filter(voice => voice.lang.toLowerCase() === normalizedLang);
    const sameLanguageVoices = matchingVoices.length > 0
      ? matchingVoices
      : voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === language);
    const preferredVoice = feminineVoice
      ? sameLanguageVoices.find(voice => feminineVoiceNames.test(voice.name))
      : undefined;
    const languageVoice = preferredVoice
      || sameLanguageVoices.find(voice => voice.default)
      || sameLanguageVoices[0];
    if (languageVoice) utterance.voice = languageVoice;

    utterance.onstart = () => {
      if (speechToken === speechTokenRef.current) setVoiceState('speaking');
    };
    utterance.onend = () => {
      if (speechToken !== speechTokenRef.current) return;
      if (enabledRef.current) {
        setVoiceState('listening');
        scheduleRestart(350);
      } else {
        setVoiceState('idle');
      }
    };
    utterance.onerror = () => {
      if (speechToken === speechTokenRef.current) {
        setVoiceState(enabledRef.current ? 'idle' : 'idle');
        if (enabledRef.current) scheduleRestart(500);
      }
    };
    window.speechSynthesis.speak(utterance);
  }, [feminineVoice, lang, scheduleRestart, speechPitch, speechRate, ttsEnabled]);

  /** Stops speech immediately so the user can interrupt NEXUS mid-sentence. */
  const stopSpeaking = useCallback(() => {
    speechTokenRef.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (enabledRef.current) {
      setVoiceState('listening');
      scheduleRestart(200);
    } else {
      setVoiceState('idle');
    }
  }, [scheduleRestart]);

  const clearError = useCallback(() => setErrorKind(null), []);

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      stopListening();
      return;
    }
    if (!getSRClass()) {
      setErrorKind('unsupported');
      return;
    }
    retryCountRef.current = 0;
    setErrorKind(null);
    enabledRef.current = true;
    recognitionModeRef.current = 'continuous';
    setEnabled(true);
  }, [stopListening]);

  const pushToTalk = useCallback(() => {
    const SRClass = getSRClass();
    if (!SRClass) {
      setVoiceState('idle');
      return;
    }
    clearRestartTimer();
    if (recognitionRef.current) {
      const previous = recognitionRef.current;
      recognitionRef.current = null;
      previous.onend = null;
      previous.onerror = null;
      try { previous.stop(); } catch { /* The browser may have ended it already. */ }
    }

    const sr = new SRClass();
    sr.continuous = false;
    sr.interimResults = true;
    sr.lang = lang;
    sr.maxAlternatives = 1;
    recognitionModeRef.current = 'push-to-talk';
    sr.onstart = () => setVoiceState('listening');
    sr.onresult = (event: SpeechRecognitionEvent) => {
      const text = Array.from(event.results).map(result => result[0].transcript).join(' ').trim();
      setTranscript(text);
      if (event.results[event.results.length - 1]?.isFinal && text.length > 1) {
        setTranscript('');
        setVoiceState('processing');
        onTranscript?.(text);
      }
    };
    sr.onerror = () => {
      if (recognitionModeRef.current === 'push-to-talk') {
        recognitionModeRef.current = 'none';
        setVoiceState('idle');
        if (enabledRef.current) scheduleRestart(500);
      }
    };
    sr.onend = () => {
      if (recognitionRef.current === sr) recognitionRef.current = null;
      if (recognitionModeRef.current === 'push-to-talk') recognitionModeRef.current = 'none';
      if (enabledRef.current) scheduleRestart(500);
      else setVoiceState('idle');
    };
    recognitionRef.current = sr;
    try {
      sr.start();
    } catch {
      recognitionRef.current = null;
      recognitionModeRef.current = 'none';
      setVoiceState('idle');
    }
  }, [clearRestartTimer, lang, onTranscript, scheduleRestart]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refreshVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  useEffect(() => {
    if (enabled) {
      enabledRef.current = true;
      recognitionModeRef.current = 'continuous';
      startListening();
    } else {
      enabledRef.current = false;
      stopListening();
    }
    return () => stopListening();
  // Keep the recognizer stable while inline transcript callbacks change identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    state,
    transcript,
    enabled,
    wakeWordDetected,
    supported,
    errorKind,
    clearError,
    toggle,
    pushToTalk,
    speak,
    stopSpeaking,
    setVoiceState,
  };
}
