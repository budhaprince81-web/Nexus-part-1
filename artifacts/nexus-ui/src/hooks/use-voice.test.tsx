import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('wouter', () => ({
  useLocation: () => ['/', navigateMock] as const,
}));

import { LangProvider } from '@/hooks/use-language';
import { VoiceProvider, useVoice, type VoiceContextValue } from '@/hooks/use-voice';
import {
  ENGLISH_VOICES,
  FakeRecognition,
  installRecognition,
  installSynth,
  uninstallSpeechApis,
} from '@/test/speech-harness';

/* ── render harness ────────────────────────────────────────────────────── */

interface Rendered {
  api: VoiceContextValue;
  unmount: () => void;
}

function renderProvider(): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let captured: VoiceContextValue | null = null;

  function Probe() {
    captured = useVoice();
    return null;
  }

  act(() => {
    root.render(
      createElement(
        LangProvider,
        null,
        createElement(VoiceProvider, null, createElement(Probe)),
      ),
    );
  });

  if (!captured) throw new Error('VoiceProvider did not render');

  return {
    get api() {
      if (!captured) throw new Error('lost context');
      return captured;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  navigateMock.mockClear();
  installSynth();
  installRecognition();
});

afterEach(() => {
  uninstallSpeechApis();
});

/* ── tests ─────────────────────────────────────────────────────────────── */

describe('voice output (text-to-speech)', () => {
  it('speaks a completed response', () => {
    const synth = installSynth();
    const rendered = renderProvider();
    act(() => rendered.api.speak('All systems are online.'));

    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.text).toBe('All systems are online.');
    rendered.unmount();
  });

  it('does not need the microphone to be on — the core regression', () => {
    const synth = installSynth();
    const rendered = renderProvider();

    // Microphone is off by default; speech output must still work.
    expect(rendered.api.sttEnabled).toBe(false);
    expect(rendered.api.ttsEnabled).toBe(true);

    act(() => rendered.api.speak('Speaking without the microphone.'));

    expect(synth.spoken).toHaveLength(1);
    rendered.unmount();
  });

  it('speaks a long answer in full instead of truncating it', () => {
    const synth = installSynth();
    const rendered = renderProvider();
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
    const answer = `${words.join(' ')} final.`;

    act(() => rendered.api.speak(answer));
    synth.drain();

    expect(synth.spoken.length).toBeGreaterThan(1);
    expect(synth.spokenWords()).toEqual([...words, 'final.']);
    rendered.unmount();
  });

  it('strips markdown before speaking but keeps the prose', () => {
    const synth = installSynth();
    const rendered = renderProvider();
    act(() => rendered.api.speak('**Done.** `npm test` passes.\n```js\nconst x = 1;\n```'));

    expect(synth.spoken[0]?.text).toBe('Done. npm test passes. (code block)');
    rendered.unmount();
  });

  it('stays silent when voice output is switched off', () => {
    const synth = installSynth();
    const rendered = renderProvider();

    act(() => rendered.api.setTtsEnabled(false));
    act(() => rendered.api.speak('This must not be spoken.'));

    expect(synth.spoken).toHaveLength(0);
    expect(rendered.api.ttsEnabled).toBe(false);
    rendered.unmount();
  });

  it('cancels speech immediately when output is switched off mid-sentence', () => {
    const synth = installSynth();
    const rendered = renderProvider();

    act(() => rendered.api.speak('A long sentence that is still being read.'));
    expect(synth.spoken).toHaveLength(1);

    act(() => rendered.api.setTtsEnabled(false));

    expect(synth.cancelCount()).toBeGreaterThan(0);
    expect(rendered.api.isSpeaking).toBe(false);
    rendered.unmount();
  });

  it('lets the Test Voice button speak even while output is disabled', () => {
    const synth = installSynth();
    const rendered = renderProvider();

    act(() => rendered.api.setTtsEnabled(false));
    act(() => rendered.api.testVoice());

    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.text.length).toBeGreaterThan(10);
    // The temporary override must not leak into the user's preference.
    expect(rendered.api.ttsEnabled).toBe(false);
    rendered.unmount();
  });

  it('replaces in-flight speech instead of layering a second answer on top', async () => {
    const synth = installSynth();
    const rendered = renderProvider();
    const firstAnswer = Array.from({ length: 40 }, (_, i) => `alpha${i}`).join(' ');

    act(() => rendered.api.speak(firstAnswer));
    const mark = synth.spoken.length;
    act(() => rendered.api.speak('Second answer.'));

    expect(synth.cancelCount()).toBeGreaterThan(0);

    // The replacement is handed to the synthesiser on the next frame.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // A late `onend` from the replaced session must not resume its queue.
    const stale = synth.spoken[0]!;
    stale.ended = true;
    act(() => stale.onend?.());
    synth.drain();

    expect(synth.spoken.slice(mark).map((u) => u.text)).toEqual(['Second answer.']);
    rendered.unmount();
  });

  it('stops speaking on request and does not restart the cancelled queue', () => {
    const synth = installSynth();
    const rendered = renderProvider();

    act(() => rendered.api.speak('Something long enough to be interrupted.'));
    act(() => rendered.api.stopSpeaking());

    const spokenBefore = synth.spoken.length;
    synth.drain();

    expect(synth.spoken).toHaveLength(spokenBefore);
    expect(rendered.api.isSpeaking).toBe(false);
    rendered.unmount();
  });

  it('reports unsupported synthesis instead of failing silently', () => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    const rendered = renderProvider();

    expect(rendered.api.ttsSupported).toBe(false);

    act(() => rendered.api.speak('Nobody can hear this.'));

    expect(rendered.api.errorKind).toBe('tts-unsupported');
    expect(rendered.api.ttsError).toMatch(/speech synthesis/i);
    rendered.unmount();
  });

  it('explains that this device has no Nepali voice', () => {
    window.localStorage.setItem('nexus-lang', 'ne');
    installSynth(ENGLISH_VOICES); // English-only device
    const rendered = renderProvider();

    act(() => rendered.api.speak('नमस्ते।'));

    expect(rendered.api.ttsNotice).toMatch(/Nepali/i);
    rendered.unmount();
  });

  it('says nothing about missing voices when the language is installed', () => {
    const rendered = renderProvider();
    act(() => rendered.api.speak('Everything is fine.'));
    expect(rendered.api.ttsNotice).toBeNull();
    rendered.unmount();
  });
});

describe('voice input (speech recognition)', () => {
  it('exposes microphone support and starts listening on toggle', () => {
    const rendered = renderProvider();
    expect(rendered.api.sttSupported).toBe(true);

    act(() => rendered.api.toggleMic());

    expect(rendered.api.sttEnabled).toBe(true);
    expect(rendered.api.state).toBe('listening');
    rendered.unmount();
  });

  it('delivers a finalised transcript exactly once', () => {
    const rendered = renderProvider();
    const received: string[] = [];
    act(() => rendered.api.subscribeTranscript((text) => received.push(text)));
    act(() => rendered.api.toggleMic());

    act(() => FakeRecognition.latest?.emit([{ text: 'open the memory module', final: true }]));

    expect(received).toEqual(['open the memory module']);
    rendered.unmount();
  });

  it('never re-submits earlier sentences from the same session', () => {
    const rendered = renderProvider();
    const received: string[] = [];
    act(() => rendered.api.subscribeTranscript((text) => received.push(text)));
    act(() => rendered.api.toggleMic());

    const first = { text: 'first sentence', final: true };
    const second = { text: 'second sentence', final: true };
    act(() => FakeRecognition.latest?.emit([first], 0));
    // The browser accumulates results; only the new one may be emitted.
    act(() => FakeRecognition.latest?.emit([first, second], 1));

    expect(received).toEqual(['first sentence', 'second sentence']);
    rendered.unmount();
  });

  it('shows interim text without submitting it', () => {
    const rendered = renderProvider();
    const received: string[] = [];
    act(() => rendered.api.subscribeTranscript((text) => received.push(text)));
    act(() => rendered.api.toggleMic());

    act(() => FakeRecognition.latest?.emit([{ text: 'still talk', final: false }]));

    expect(received).toEqual([]);
    expect(rendered.api.transcript).toBe('still talk');
    rendered.unmount();
  });

  it('reports a denied microphone and switches voice input off', () => {
    const rendered = renderProvider();
    act(() => rendered.api.toggleMic());
    act(() => FakeRecognition.latest?.fail('not-allowed'));

    expect(rendered.api.errorKind).toBe('permission-denied');
    expect(rendered.api.sttEnabled).toBe(false);
    rendered.unmount();
  });

  it('reports a missing microphone', () => {
    const rendered = renderProvider();
    act(() => rendered.api.toggleMic());
    act(() => FakeRecognition.latest?.fail('audio-capture'));

    expect(rendered.api.errorKind).toBe('no-microphone');
    rendered.unmount();
  });

  it('treats silence as a hint, not a failure, and keeps listening', () => {
    const rendered = renderProvider();
    act(() => rendered.api.toggleMic());
    act(() => FakeRecognition.latest?.fail('no-speech'));

    expect(rendered.api.errorKind).toBeNull();
    expect(rendered.api.micNotice).toMatch(/no speech/i);
    // Silence must not switch voice input off — the user simply did not talk.
    expect(rendered.api.sttEnabled).toBe(true);
    rendered.unmount();
  });

  it('clears the silence hint as soon as speech is recognised', () => {
    const rendered = renderProvider();
    const received: string[] = [];
    act(() => rendered.api.subscribeTranscript((text) => received.push(text)));
    act(() => rendered.api.toggleMic());
    act(() => FakeRecognition.latest?.fail('no-speech'));
    expect(rendered.api.micNotice).toBeTruthy();

    act(() => FakeRecognition.latest?.emit([{ text: 'hello nexus', final: true }]));

    expect(rendered.api.micNotice).toBeNull();
    expect(received).toEqual(['hello nexus']);
    rendered.unmount();
  });

  it('reports silence from push-to-talk without turning voice input off', () => {
    const rendered = renderProvider();
    act(() => rendered.api.pushToTalk());
    act(() => FakeRecognition.latest?.fail('no-speech'));

    expect(rendered.api.micNotice).toMatch(/no speech/i);
    expect(rendered.api.errorKind).toBeNull();
    rendered.unmount();
  });

  it('reports an unsupported browser instead of pretending to listen', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    const rendered = renderProvider();

    expect(rendered.api.sttSupported).toBe(false);
    act(() => rendered.api.toggleMic());

    expect(rendered.api.errorKind).toBe('unsupported');
    rendered.unmount();
  });

  it('routes spoken navigation only when command mode is enabled', () => {
    const rendered = renderProvider();
    act(() => rendered.api.toggleMic());

    act(() => FakeRecognition.latest?.emit([{ text: 'open chat', final: true }]));
    expect(navigateMock).not.toHaveBeenCalled();

    act(() => rendered.api.setCommandMode(true));
    act(() => FakeRecognition.latest?.emit([{ text: 'open the settings', final: true }]));

    expect(navigateMock).toHaveBeenCalledWith('/settings');
    rendered.unmount();
  });

  it('turns the microphone on when conversation mode is enabled', () => {
    const rendered = renderProvider();
    expect(rendered.api.sttEnabled).toBe(false);

    act(() => rendered.api.setConversationMode(true));

    expect(rendered.api.conversationMode).toBe(true);
    expect(rendered.api.sttEnabled).toBe(true);
    rendered.unmount();
  });

  it('can pause and resume the microphone so NEXUS cannot hear itself', () => {
    const rendered = renderProvider();
    act(() => rendered.api.toggleMic());

    act(() => rendered.api.pauseListening());
    expect(rendered.api.listeningPaused).toBe(true);

    act(() => rendered.api.resumeListening());
    expect(rendered.api.listeningPaused).toBe(false);
    rendered.unmount();
  });
});

describe('voice preferences', () => {
  it('persists the voice-output switch across mounts', () => {
    const first = renderProvider();
    act(() => first.api.setTtsEnabled(false));
    first.unmount();

    const second = renderProvider();
    expect(second.api.ttsEnabled).toBe(false);
    second.unmount();
  });

  it('persists the selected voice and speaks with it', () => {
    const synth = installSynth();
    const first = renderProvider();

    act(() => first.api.setSelectedVoiceURI('samantha'));
    act(() => first.api.speak('Using the pinned voice.'));
    expect(synth.spoken[0]?.voice).toMatchObject({ voiceURI: 'samantha' });
    first.unmount();

    const second = renderProvider();
    expect(second.api.selectedVoiceURI).toBe('samantha');
    second.unmount();
  });

  it('lists only voices for the active language', () => {
    installSynth([
      ...ENGLISH_VOICES,
      { name: 'Amelie', lang: 'fr-FR', voiceURI: 'amelie' },
    ]);
    const rendered = renderProvider();

    expect(rendered.api.availableVoices.map((v) => v.voiceURI)).toEqual(['david', 'samantha']);
    expect(rendered.api.allVoices).toHaveLength(3);
    rendered.unmount();
  });
});
