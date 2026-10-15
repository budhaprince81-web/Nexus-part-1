import { act } from 'react';

/**
 * Fake Web Speech API implementations.
 *
 * jsdom ships neither `speechSynthesis` nor `SpeechRecognition`, so these stand
 * in for the browser. They are deliberately stateful: the queue advances only
 * when an utterance's `onend` fires, which is what makes chunked speech and
 * cancellation testable.
 */

export class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  started = false;
  ended = false;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

export interface FakeVoice {
  name: string;
  lang: string;
  voiceURI: string;
  default?: boolean;
}

export const ENGLISH_VOICES: FakeVoice[] = [
  { name: 'Microsoft David', lang: 'en-US', voiceURI: 'david', default: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha' },
];

export interface SynthHarness {
  spoken: FakeUtterance[];
  cancelCount: () => number;
  /** Completes the utterance currently being spoken, advancing the queue. */
  finishCurrent: () => void;
  /** Runs the whole queue to completion. */
  drain: () => void;
  spokenWords: () => string[];
}

export function installSynth(voices: FakeVoice[] = ENGLISH_VOICES): SynthHarness {
  const spoken: FakeUtterance[] = [];
  let cancelled = 0;

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    speak(utterance: FakeUtterance) {
      spoken.push(utterance);
      utterance.started = true;
      synth.speaking = true;
      utterance.onstart?.();
    },
    cancel() {
      cancelled += 1;
      synth.speaking = false;
      synth.pending = false;
    },
    pause() {},
    resume() {},
    getVoices: () => voices as unknown as SpeechSynthesisVoice[],
    addEventListener() {},
    removeEventListener() {},
  };

  const target = window as unknown as Record<string, unknown>;
  target.speechSynthesis = synth;
  target.SpeechSynthesisUtterance = FakeUtterance;

  const finishCurrent = () => {
    const current = spoken.find((u) => u.started && !u.ended);
    if (!current) return;
    current.ended = true;
    act(() => {
      current.onend?.();
    });
  };

  const drain = () => {
    for (let guard = 0; guard < 500; guard += 1) {
      const current = spoken.find((u) => u.started && !u.ended);
      if (!current) return;
      finishCurrent();
    }
    throw new Error('speech queue never drained');
  };

  return {
    spoken,
    cancelCount: () => cancelled,
    finishCurrent,
    drain,
    spokenWords: () =>
      spoken
        .map((u) => u.text)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean),
  };
}

export class FakeRecognition {
  static latest: FakeRecognition | null = null;

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onstart: ((ev: Event) => void) | null = null;
  onresult: ((ev: unknown) => void) | null = null;
  onerror: ((ev: { error?: string }) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;

  start() {
    FakeRecognition.latest = this;
    this.onstart?.(new Event('start'));
  }

  stop() {
    this.onend?.(new Event('end'));
  }

  /** Feeds a recognition event with the given results. */
  emit(results: Array<{ text: string; final: boolean }>, resultIndex = 0) {
    const list = results.map((r) => ({
      isFinal: r.final,
      length: 1,
      0: { transcript: r.text, confidence: 1 },
    }));
    this.onresult?.({ results: list, resultIndex });
  }

  fail(error: string) {
    this.onerror?.({ error });
  }
}

export function installRecognition() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  FakeRecognition.latest = null;
}

export function uninstallSpeechApis() {
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
}

/**
 * Builds a Server-Sent Events body that the chat page streams from.
 *
 * `delayMs` spaces the chunks out so the streaming phase is observable; with
 * the default of 0 every chunk arrives at once, which is the realistic
 * "provider replied instantly" case.
 */
export function sseResponse(
  chunks: string[],
  meta?: Record<string, unknown>,
  delayMs = 0,
): Response {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  if (meta) parts.push(`data: ${JSON.stringify({ meta })}\n\n`);
  for (const chunk of chunks) {
    parts.push(`data: ${JSON.stringify({ content: chunk })}\n\n`);
  }
  parts.push('data: [DONE]\n\n');

  let index = 0;
  return new Response(
    new ReadableStream({
      async pull(controller) {
        if (index >= parts.length) {
          controller.close();
          return;
        }
        if (index > 0 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        controller.enqueue(encoder.encode(parts[index] ?? ''));
        index += 1;
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}
