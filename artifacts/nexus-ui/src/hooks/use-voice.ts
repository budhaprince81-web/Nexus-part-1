import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'wouter';
import { useLangContext } from '@/hooks/use-language';
import {
  cleanForSpeech,
  hasVoiceForLanguage,
  languageLabel,
  selectVoice,
  splitForSpeech,
  type VoiceSelection,
} from '@/lib/speech';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export type VoiceErrorKind =
  | 'permission-denied'
  | 'no-microphone'
  | 'unsupported'
  | 'network'
  | 'tts-unsupported'
  | 'tts-failed'
  | null;

/* ── minimal Web Speech typings ─────────────────────────────────────────── */

interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
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

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (
    (w.SpeechRecognition as SpeechRecognitionCtor | undefined) ??
    (w.webkitSpeechRecognition as SpeechRecognitionCtor | undefined) ??
    null
  );
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/* ── persisted preferences ─────────────────────────────────────────────── */

const KEY_TTS = 'nexus-tts-enabled';
const KEY_VOICE = 'nexus-tts-voice';
const KEY_CONVERSATION = 'nexus-conversation-mode';
const KEY_COMMANDS = 'nexus-voice-commands';
const KEY_RATE = 'nexus-voice-rate';
const KEY_PITCH = 'nexus-voice-pitch';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* private browsing — preference is simply not persisted */
  }
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

interface PublicVoice {
  name: string;
  lang: string;
  voiceURI: string;
}

export interface VoiceContextValue {
  /** Shared state machine across every consumer. */
  state: VoiceState;

  /* speech recognition */
  sttEnabled: boolean;
  sttSupported: boolean;
  listeningPaused: boolean;
  transcript: string;
  wakeWordDetected: boolean;
  /** Transient, non-error microphone status (e.g. silence detected). */
  micNotice: string | null;
  errorKind: VoiceErrorKind;
  clearError: () => void;
  toggleMic: () => void;
  pushToTalk: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  /** Fires once per finalised utterance — never for interim results. */
  subscribeTranscript: (listener: (text: string) => void) => () => void;

  /* speech synthesis */
  ttsEnabled: boolean;
  setTtsEnabled: (value: boolean) => void;
  ttsSupported: boolean;
  speak: (text: string, langOverride?: string) => void;
  testVoice: () => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  ttsError: string | null;
  /** Honest explanation when the requested language has no installed voice. */
  ttsNotice: string | null;
  /** Voices installed for the currently selected language. */
  availableVoices: PublicVoice[];
  /** Every voice the device exposes, regardless of language. */
  allVoices: PublicVoice[];
  selectedVoiceURI: string;
  setSelectedVoiceURI: (uri: string) => void;
  voiceRate: number;
  setVoiceRate: (value: number) => void;
  voicePitch: number;
  setVoicePitch: (value: number) => void;

  /* modes */
  conversationMode: boolean;
  setConversationMode: (value: boolean) => void;
  commandMode: boolean;
  setCommandMode: (value: boolean) => void;

  /* legacy aliases kept so existing HUD components keep compiling */
  enabled: boolean;
  supported: boolean;
  toggle: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice() must be used inside <VoiceProvider>.');
  }
  return context;
}

const WAKE_WORD = 'nexus';
const MAX_RECOGNITION_RETRIES = 4;
/** A recogniser that dies faster than this is considered broken, not idle. */
const HEALTHY_SESSION_MS = 1500;

const TEST_PHRASE: Record<string, string> = {
  en: 'Hello. I am NEXUS, your AI operating system. All systems are online.',
  ne: 'नमस्ते। म NEXUS हुँ, तपाईंको AI सहायक। सबै प्रणाली सक्रिय छन्।',
};

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLangContext();
  const [, setLocation] = useLocation();

  const speechLang = lang === 'ne' ? 'ne-NP' : 'en-US';

  const [state, setState] = useState<VoiceState>('idle');
  const [sttEnabled, setSttEnabled] = useState(false);
  const [listeningPaused, setListeningPaused] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<VoiceErrorKind>(null);

  const [ttsEnabled, setTtsEnabledState] = useState(() =>
    typeof window === 'undefined' ? true : readBool(KEY_TTS, true),
  );
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(() =>
    typeof window === 'undefined' ? '' : window.localStorage.getItem(KEY_VOICE) ?? '',
  );
  const [voiceRate, setVoiceRateState] = useState(() =>
    typeof window === 'undefined' ? 0.98 : readNumber(KEY_RATE, 0.98, 0.5, 2),
  );
  const [voicePitch, setVoicePitchState] = useState(() =>
    typeof window === 'undefined' ? 1.05 : readNumber(KEY_PITCH, 1.05, 0.5, 2),
  );
  const [voices, setVoices] = useState<PublicVoice[]>([]);

  const [conversationMode, setConversationModeState] = useState(() =>
    typeof window === 'undefined' ? false : readBool(KEY_CONVERSATION, false),
  );
  const [commandMode, setCommandModeState] = useState(() =>
    typeof window === 'undefined' ? false : readBool(KEY_COMMANDS, false),
  );

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const listeningRef = useRef(false);
  const pausedRef = useRef(false);
  const speechSessionRef = useRef(0);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef = useRef(new Set<(text: string) => void>());
  // Assigned after their callbacks are created; reading them lazily through a
  // ref keeps the recogniser/utterance closures stable across renders.
  const startListeningRef = useRef<() => void>(() => {});
  const runCommandRef = useRef<(text: string) => void>(() => {});

  // Refs mirror state so the recogniser/utterance callbacks (created once per
  // session) always read current values without being recreated.
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsSupported = getSynth() !== null;
  const sttSupported = typeof window !== 'undefined' && getRecognitionCtor() !== null;
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const selectedVoiceURIRef = useRef(selectedVoiceURI);
  const rateRef = useRef(voiceRate);
  const pitchRef = useRef(voicePitch);
  const langRef = useRef(speechLang);
  const commandModeRef = useRef(commandMode);
  const conversationRef = useRef(conversationMode);
  const setLocationRef = useRef(setLocation);

  ttsEnabledRef.current = ttsEnabled;
  selectedVoiceURIRef.current = selectedVoiceURI;
  rateRef.current = voiceRate;
  pitchRef.current = voicePitch;
  langRef.current = speechLang;
  commandModeRef.current = commandMode;
  conversationRef.current = conversationMode;
  setLocationRef.current = setLocation;

  /* ── voice catalogue ─────────────────────────────────────────────────── */

  useEffect(() => {
    const synth = getSynth();
    if (!synth) return;
    const refresh = () => {
      const list = synth.getVoices();
      voicesRef.current = list;
      setVoices(list.map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI })));
    };
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
    // Chrome populates voices asynchronously; a couple of retries covers the
    // window where `voiceschanged` has already fired before we subscribed.
    const retries = [100, 500, 1500].map((ms) => setTimeout(refresh, ms));
    return () => {
      synth.removeEventListener?.('voiceschanged', refresh);
      retries.forEach(clearTimeout);
    };
  }, []);

  const availableVoices = useMemo(
    () =>
      voices
        .filter((v) => hasVoiceForLanguage([v], langRef.current))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voices, speechLang],
  );

  /* ── speech synthesis ────────────────────────────────────────────────── */

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const resolveSelection = useCallback((targetLang: string): VoiceSelection => {
    const catalogue = voicesRef.current;
    if (selectedVoiceURIRef.current) {
      const pinned = catalogue.find((v) => v.voiceURI === selectedVoiceURIRef.current);
      if (pinned) {
        return {
          voice: pinned,
          exactMatch: pinned.lang.toLowerCase() === targetLang.toLowerCase(),
          languageAvailable: true,
        };
      }
    }
    return selectVoice(catalogue, targetLang);
  }, []);

  const explainMissingLanguage = useCallback((selection: VoiceSelection, targetLang: string) => {
    if (selection.languageAvailable) {
      setTtsNotice(null);
      return;
    }
    const label = languageLabel(targetLang);
    const installed = voicesRef.current.length;
    setTtsNotice(
      installed === 0
        ? 'No system voices are available yet. Your browser is still loading them — try again in a moment.'
        : `This device has no ${label} voice installed, so NEXUS will read ${label} text with its closest available voice. Install a ${label} voice in your operating system's speech settings for accurate pronunciation.`,
    );
  }, []);

  const finishSpeech = useCallback(() => {
    if (listeningRef.current && !pausedRef.current) {
      setState('listening');
      if (!restartTimerRef.current) {
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (listeningRef.current && !pausedRef.current) startListeningRef.current();
        }, 350);
      }
    } else {
      setState('idle');
    }
  }, []);

  const speakChunks = useCallback(
    (chunks: string[], selection: VoiceSelection, session: number, targetLang: string) => {
      const synth = getSynth();
      if (!synth) return;

      const speakAt = (index: number) => {
        if (session !== speechSessionRef.current) return;
        if (index >= chunks.length) {
          finishSpeech();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = targetLang;
        utterance.rate = rateRef.current;
        utterance.pitch = pitchRef.current;
        utterance.volume = 1;
        if (selection.voice) utterance.voice = selection.voice;

        utterance.onstart = () => {
          if (session === speechSessionRef.current) setState('speaking');
        };
        utterance.onend = () => {
          if (session !== speechSessionRef.current) return;
          speakAt(index + 1);
        };
        utterance.onerror = (event) => {
          if (session !== speechSessionRef.current) return;
          const code = (event as SpeechSynthesisErrorEvent).error;
          // `interrupted`/`canceled` are emitted by our own cancel() calls.
          if (code === 'interrupted' || code === 'canceled') return;
          setTtsError(`Speech synthesis failed (${code ?? 'unknown error'}).`);
          finishSpeech();
        };
        synth.speak(utterance);
      };

      setState('speaking');
      speakAt(0);
    },
    [finishSpeech],
  );

  const startSpeaking = useCallback(
    (rawText: string, session: number, targetLang: string) => {
      const text = cleanForSpeech(rawText);
      const chunks = splitForSpeech(text);
      const synth = getSynth();
      if (!synth) {
        setErrorKind('tts-unsupported');
        setTtsError('This browser does not support speech synthesis.');
        finishSpeech();
        return;
      }
      // Cleaning strips Markdown, but if that left nothing (for example a
      // response that was only a code block) fall back to the raw text so the
      // listener still hears something rather than silence.
      const speakable = chunks.length > 0 ? chunks : splitForSpeech(rawText);
      if (speakable.length === 0) {
        setTtsError('There was nothing to speak in that response.');
        finishSpeech();
        return;
      }
      const selection = resolveSelection(targetLang);
      explainMissingLanguage(selection, targetLang);
      setTtsError(null);
      speakChunks(speakable, selection, session, targetLang);
    },
    [explainMissingLanguage, finishSpeech, resolveSelection, speakChunks],
  );

  const stopSpeaking = useCallback(() => {
    speechSessionRef.current += 1;
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
    getSynth()?.cancel();
    // Only touch the shared state machine when speech actually owned it —
    // otherwise stopping a no-op would clobber a `listening` indicator.
    setState((current) =>
      current === 'speaking'
        ? listeningRef.current && !pausedRef.current
          ? 'listening'
          : 'idle'
        : current,
    );
  }, []);

  const speak = useCallback(
    (rawText: string, langOverride?: string) => {
      if (!ttsEnabledRef.current) return;
      if (!rawText || !rawText.trim()) return;
      if (!getSynth()) {
        setErrorKind('tts-unsupported');
        setTtsError('This browser does not support speech synthesis.');
        return;
      }
      // Threaded through explicitly rather than stored on a ref, which the next
      // render would overwrite mid-sentence.
      const targetLang = langOverride ?? langRef.current;

      const synth = getSynth()!;
      // Invalidate any in-flight session before cancelling, so the cancelled
      // utterance's `onend` cannot restart or double-fire the queue.
      const hadActiveSpeech = synth.speaking || synth.pending;
      const session = ++speechSessionRef.current;
      synth.cancel();

      // Pause the recogniser while NEXUS talks so it cannot transcribe its own
      // voice and re-trigger the conversation loop.
      const recognition = recognitionRef.current;
      if (recognition) {
        recognitionRef.current = null;
        recognition.onend = null;
        recognition.onerror = null;
        try {
          recognition.stop();
        } catch {
          /* already stopped */
        }
      }
      // Drop any pending restart, otherwise the mic would come back on and
      // transcribe NEXUS while it is still talking.
      clearRestartTimer();

      if (hadActiveSpeech) {
        // Chrome occasionally swallows a speak() issued in the same tick as a
        // cancel(). Yielding a frame makes the hand-off reliable.
        if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
        speakTimerRef.current = setTimeout(() => {
          speakTimerRef.current = null;
          if (session === speechSessionRef.current) startSpeaking(rawText, session, targetLang);
        }, 80);
      } else {
        startSpeaking(rawText, session, targetLang);
      }
    },
    [clearRestartTimer, startSpeaking],
  );

  const testVoice = useCallback(() => {
    const phrase = TEST_PHRASE[langRef.current.split('-')[0] ?? 'en'] ?? TEST_PHRASE.en;
    // The explicit test must work even while TTS is switched off, otherwise the
    // user has no way to check their speakers before enabling it.
    const previous = ttsEnabledRef.current;
    ttsEnabledRef.current = true;
    speak(phrase);
    ttsEnabledRef.current = previous;
  }, [speak]);

  const setTtsEnabled = useCallback(
    (value: boolean) => {
      setTtsEnabledState(value);
      writeBool(KEY_TTS, value);
      if (!value) {
        stopSpeaking();
        setTtsNotice(null);
        setTtsError(null);
      }
    },
    [stopSpeaking],
  );

  const setSelectedVoiceURI = useCallback(
    (uri: string) => {
      setSelectedVoiceURIState(uri);
      try {
        if (uri) window.localStorage.setItem(KEY_VOICE, uri);
        else window.localStorage.removeItem(KEY_VOICE);
      } catch {
        /* not persisted */
      }
    },
    [],
  );

  const setVoiceRate = useCallback((value: number) => {
    setVoiceRateState(value);
    try {
      window.localStorage.setItem(KEY_RATE, String(value));
    } catch {
      /* not persisted */
    }
  }, []);

  const setVoicePitch = useCallback((value: number) => {
    setVoicePitchState(value);
    try {
      window.localStorage.setItem(KEY_PITCH, String(value));
    } catch {
      /* not persisted */
    }
  }, []);

  // Chrome stops reading after roughly 15 seconds unless resume() is called.
  useEffect(() => {
    if (state !== 'speaking') return;
    const synth = getSynth();
    if (!synth) return;
    const id = setInterval(() => {
      try {
        synth.resume();
      } catch {
        /* unsupported in this browser */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state]);

  /* ── speech recognition ──────────────────────────────────────────────── */

  const emitTranscript = useCallback((text: string) => {
    listenersRef.current.forEach((listener) => {
      try {
        listener(text);
      } catch (err) {
        console.error('[voice] transcript listener failed', err);
      }
    });
    if (commandModeRef.current) runCommandRef.current(text);
  }, []);

  const scheduleRestart = useCallback(
    (delay: number) => {
      if (!listeningRef.current || pausedRef.current || restartTimerRef.current) return;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (listeningRef.current && !pausedRef.current) startListeningRef.current();
      }, delay);
    },
    [],
  );

  const stopListening = useCallback(() => {
    clearRestartTimer();
    retryCountRef.current = 0;
    const current = recognitionRef.current;
    recognitionRef.current = null;
    if (current) {
      current.onend = null;
      current.onerror = null;
      current.onresult = null;
      try {
        current.stop();
      } catch {
        /* the browser may have ended it already */
      }
    }
    setTranscript('');
    setMicNotice(null);
    setState((previous) => (previous === 'speaking' ? previous : 'idle'));
  }, [clearRestartTimer]);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || !listeningRef.current || pausedRef.current) return;
    clearRestartTimer();
    if (recognitionRef.current) {
      const previous = recognitionRef.current;
      recognitionRef.current = null;
      previous.onend = null;
      previous.onerror = null;
      try {
        previous.stop();
      } catch {
        /* already stopped */
      }
    }

    const recognition = new Ctor();
    recognition.continuous = conversationRef.current;
    recognition.interimResults = true;
    recognition.lang = langRef.current;
    recognition.maxAlternatives = 1;
    sessionStartedAtRef.current = Date.now();

    recognition.onstart = () => {
      sessionStartedAtRef.current = Date.now();
      setState('listening');
      setErrorKind(null);
      setMicNotice(null);
    };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      // Only walk the results this event actually delivered. Reading the whole
      // accumulated list re-sent every earlier sentence (duplicate prompts).
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        const value = alternative?.transcript ?? '';
        if (result.isFinal) finalText += value;
        else interimText += value;
      }

      // A healthy result proves the recogniser works — clear the retry budget
      // and any "silence" hint from an earlier empty session.
      retryCountRef.current = 0;
      setMicNotice(null);

      const latest = (interimText || finalText).trim();
      if (latest.toLowerCase().includes(WAKE_WORD)) {
        setWakeWordDetected(true);
        if (wakeWordTimerRef.current) clearTimeout(wakeWordTimerRef.current);
        wakeWordTimerRef.current = setTimeout(() => setWakeWordDetected(false), 3000);
      }

      if (interimText.trim()) setTranscript(interimText.trim());

      const finished = finalText.trim();
      if (finished.length > 0) {
        setTranscript('');
        setState('processing');
        emitTranscript(finished);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error ?? '';
      const fatal = ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code);
      if (fatal) {
        setErrorKind(code === 'audio-capture' ? 'no-microphone' : 'permission-denied');
        listeningRef.current = false;
        setSttEnabled(false);
        setState('idle');
        return;
      }
      if (code === 'no-speech') {
        // Normal silence, not a failure: tell the user we are still listening
        // instead of leaving them wondering whether the mic is live.
        setMicNotice('No speech detected — still listening.');
        setErrorKind(null);
      } else {
        setErrorKind(code === 'network' ? 'network' : null);
      }
      setState('idle');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      const ranFor = Date.now() - sessionStartedAtRef.current;
      if (ranFor >= HEALTHY_SESSION_MS) retryCountRef.current = 0;
      if (listeningRef.current && !pausedRef.current && retryCountRef.current < MAX_RECOGNITION_RETRIES) {
        retryCountRef.current += 1;
        scheduleRestart(Math.min(600 * retryCountRef.current, 4000));
      } else if (!listeningRef.current) {
        setState((previous) => (previous === 'speaking' ? previous : 'idle'));
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      if (retryCountRef.current < MAX_RECOGNITION_RETRIES) {
        retryCountRef.current += 1;
        scheduleRestart(Math.min(600 * retryCountRef.current, 4000));
      }
    }
  }, [clearRestartTimer, emitTranscript, scheduleRestart]);

  startListeningRef.current = startListening;
  runCommandRef.current = useCallback(
    (text: string) => {
      const lower = text
        .toLowerCase()
        .replace(/[.,!?;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hasWakeWord = lower.includes(WAKE_WORD);
      const navigational =
        hasWakeWord || /^(open|go to|goto|show|navigate to|switch to|take me to)\b/.test(lower);
      if (!navigational) return;

      const routes: Array<[RegExp, string]> = [
        [/\b(chat|comms|conversation)\b/, '/chat'],
        [/\b(memory|recall)\b|\u0938\u094d\u092e\u0943\u0924\u093f/, '/memory'],
        [/\b(agents?|jarvis)\b/, '/agents'],
        [/\b(sandbox|terminal|shell)\b/, '/sandbox'],
        [/\b(vision|camera|image)\b/, '/vision'],
        [/\b(coding|code editor|build)\b/, '/coding'],
        [/\b(tasks?|todo)\b/, '/tasks'],
        [/\b(research|news|search)\b/, '/research'],
        [/\btrading|market|stocks?\b/, '/trading'],
        [/\bsettings?|preferences\b/, '/settings'],
        [/\b(home|dashboard|hud)\b/, '/'],
      ];
      const match = routes.find(([pattern]) => pattern.test(lower));
      if (!match) return;
      setLocationRef.current(match[1]);
    },
    [],
  );

  const toggleMic = useCallback(() => {
    if (listeningRef.current) {
      listeningRef.current = false;
      setSttEnabled(false);
      stopListening();
      return;
    }
    if (!getRecognitionCtor()) {
      setErrorKind('unsupported');
      return;
    }
    setErrorKind(null);
    retryCountRef.current = 0;
    listeningRef.current = true;
    pausedRef.current = false;
    setListeningPaused(false);
    setSttEnabled(true);
    startListeningRef.current();
  }, [stopListening]);

  const pauseListening = useCallback(() => {
    pausedRef.current = true;
    setListeningPaused(true);
    if (recognitionRef.current) {
      const current = recognitionRef.current;
      recognitionRef.current = null;
      current.onend = null;
      current.onerror = null;
      try {
        current.stop();
      } catch {
        /* already stopped */
      }
    }
    clearRestartTimer();
    setState((previous) => (previous === 'speaking' ? previous : 'idle'));
  }, [clearRestartTimer]);

  const resumeListening = useCallback(() => {
    pausedRef.current = false;
    setListeningPaused(false);
    if (listeningRef.current) scheduleRestart(250);
  }, [scheduleRestart]);

  const pushToTalk = useCallback(() => {
    // Pressing the mic is also the barge-in gesture: stop NEXUS mid-sentence.
    stopSpeaking();
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setErrorKind('unsupported');
      return;
    }
    clearRestartTimer();
    if (recognitionRef.current) {
      const previous = recognitionRef.current;
      recognitionRef.current = null;
      previous.onend = null;
      previous.onerror = null;
      try {
        previous.stop();
      } catch {
        /* already stopped */
      }
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = langRef.current;
    recognition.maxAlternatives = 1;
    sessionStartedAtRef.current = Date.now();

    recognition.onstart = () => {
      sessionStartedAtRef.current = Date.now();
      setState('listening');
      setErrorKind(null);
      setMicNotice(null);
    };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const value = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += value;
        else interimText += value;
      }
      setMicNotice(null);
      if (interimText.trim()) setTranscript(interimText.trim());
      const finished = finalText.trim();
      if (finished.length > 0) {
        setTranscript('');
        setState('processing');
        emitTranscript(finished);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error ?? '';
      if (['not-allowed', 'service-not-allowed'].includes(code)) {
        setErrorKind('permission-denied');
      } else if (code === 'audio-capture') {
        setErrorKind('no-microphone');
      } else if (code === 'network') {
        setErrorKind('network');
      } else if (code === 'no-speech') {
        setMicNotice('No speech detected — hold the button and try again.');
      }
      setState('idle');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setState((previous) => (previous === 'speaking' ? previous : 'idle'));
      if (listeningRef.current && !pausedRef.current) scheduleRestart(500);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setState('idle');
    }
  }, [clearRestartTimer, emitTranscript, scheduleRestart, stopSpeaking]);

  const subscribeTranscript = useCallback((listener: (text: string) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const clearError = useCallback(() => setErrorKind(null), []);

  const setConversationMode = useCallback((value: boolean) => {
    setConversationModeState(value);
    writeBool(KEY_CONVERSATION, value);
    if (value && !listeningRef.current) {
      listeningRef.current = true;
      setSttEnabled(true);
      startListeningRef.current();
    }
  }, []);

  const setCommandMode = useCallback((value: boolean) => {
    setCommandModeState(value);
    writeBool(KEY_COMMANDS, value);
  }, []);

  // Leaving the page used to cancel speech, because every page owned its own
  // hook instance. The provider now owns the lifecycle, so it only tears the
  // recogniser down when the whole shell unmounts.
  useEffect(() => {
    return () => {
      listeningRef.current = false;
      pausedRef.current = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (wakeWordTimerRef.current) clearTimeout(wakeWordTimerRef.current);
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      const current = recognitionRef.current;
      recognitionRef.current = null;
      if (current) {
        current.onend = null;
        current.onerror = null;
        current.onresult = null;
        try {
          current.stop();
        } catch {
          /* already stopped */
        }
      }
      getSynth()?.cancel();
    };
  }, []);

  const value = useMemo<VoiceContextValue>(
    () => ({
      state,
      sttEnabled,
      sttSupported,
      listeningPaused,
      transcript,
      wakeWordDetected,
      micNotice,
      errorKind,
      clearError,
      toggleMic,
      pushToTalk,
      pauseListening,
      resumeListening,
      subscribeTranscript,
      ttsEnabled,
      setTtsEnabled,
      ttsSupported,
      speak,
      testVoice,
      stopSpeaking,
      isSpeaking: state === 'speaking',
      ttsError,
      ttsNotice,
      availableVoices,
      allVoices: voices,
      selectedVoiceURI,
      setSelectedVoiceURI,
      voiceRate,
      setVoiceRate,
      voicePitch,
      setVoicePitch,
      conversationMode,
      setConversationMode,
      commandMode,
      setCommandMode,
      enabled: sttEnabled,
      supported: sttSupported,
      toggle: toggleMic,
    }),
    [
      availableVoices,
      voices,
      clearError,
      commandMode,
      conversationMode,
      errorKind,
      micNotice,
      listeningPaused,
      pauseListening,
      pushToTalk,
      resumeListening,
      selectedVoiceURI,
      setCommandMode,
      setConversationMode,
      setSelectedVoiceURI,
      setTtsEnabled,
      setVoicePitch,
      setVoiceRate,
      speak,
      state,
      sttEnabled,
      sttSupported,
      stopSpeaking,
      subscribeTranscript,
      testVoice,
      toggleMic,
      transcript,
      ttsEnabled,
      ttsError,
      ttsNotice,
      ttsSupported,
      voicePitch,
      voiceRate,
      wakeWordDetected,
    ],
  );

  return createElement(VoiceContext.Provider, { value }, children);
}
