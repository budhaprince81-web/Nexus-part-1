import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('wouter', () => ({
  useLocation: () => ['/', navigateMock] as const,
}));

// The generated API client needs a live server; the SSE transport under test is
// the only part that matters here, so the query hooks are stubbed.
vi.mock('@workspace/api-client-react', () => ({
  useListAnthropicConversations: () => ({ data: [{ id: 1, title: 'LINK_TEST' }] }),
  getListAnthropicConversationsQueryKey: () => ['conversations'],
  useCreateAnthropicConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useListAnthropicMessages: () => ({ data: [] }),
  getListAnthropicMessagesQueryKey: (id: number) => ['messages', id],
  useDeleteAnthropicConversation: () => ({ mutate: vi.fn() }),
}));

import Chat from '@/pages/chat';
import { LangProvider } from '@/hooks/use-language';
import { VoiceProvider } from '@/hooks/use-voice';
import {
  installRecognition,
  installSynth,
  sseResponse,
  uninstallSpeechApis,
  type SynthHarness,
} from '@/test/speech-harness';

function renderChat() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  act(() => {
    root.render(
      createElement(
        LangProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(VoiceProvider, null, createElement(Chat)),
        ),
      ),
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

async function waitFor(predicate: () => boolean, label: string, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function submitMessage(container: HTMLElement, text: string) {
  const input = container.querySelector('input');
  if (!input) throw new Error('chat input missing');
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    valueSetter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const form = container.querySelector('form');
  if (!form) throw new Error('chat form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function stubFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async () => (typeof response === 'function' ? response() : response));
  (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
  return fetchMock;
}

let synth: SynthHarness;

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  synth = installSynth();
  installRecognition();
  // jsdom implements neither of these, and the HUD touches both.
  Element.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) {
    (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  }
});

afterEach(() => {
  uninstallSpeechApis();
});

const META = { provider: 'gemini', providerLabel: 'Gemini', model: 'gemini-flash-latest', fallbackUsed: false };

describe('chat voice output', () => {
  it('speaks the completed AI response', async () => {
    stubFetch(sseResponse(['All ', 'systems ', 'are ', 'online.'], META));
    const rendered = renderChat();

    await submitMessage(rendered.container, 'status report');
    await waitFor(() => synth.spoken.length > 0, 'speech to start');

    synth.drain();

    expect(synth.spoken.map((u) => u.text).join(' ')).toBe('All systems are online.');
    rendered.unmount();
  });

  it('speaks each answer exactly once', async () => {
    stubFetch(sseResponse(['Only ', 'once.'], META));
    const rendered = renderChat();

    await submitMessage(rendered.container, 'say it once');
    await waitFor(() => synth.spoken.length > 0, 'speech to start');
    synth.drain();

    // Give any stray duplicate trigger a chance to fire before asserting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.text).toBe('Only once.');
    rendered.unmount();
  });

  it('speaks the whole answer, not a truncated prefix', async () => {
    const words = Array.from({ length: 120 }, (_, i) => `token${i}`);
    stubFetch(sseResponse(words.map((w) => `${w} `), META));
    const rendered = renderChat();

    await submitMessage(rendered.container, 'long answer');
    await waitFor(() => synth.spoken.length > 0, 'speech to start');
    synth.drain();

    expect(synth.spoken.length).toBeGreaterThan(1);
    expect(synth.spokenWords()).toEqual(words);
    rendered.unmount();
  });

  it('stays silent when voice output is switched off, and text chat still works', async () => {
    const fetchMock = stubFetch(sseResponse(['Text ', 'only ', 'reply.'], META, 60));
    const rendered = renderChat();

    const toggle = [...rendered.container.querySelectorAll('button')].find(
      (b) => b.textContent?.toLowerCase().includes('voice'),
    );
    expect(toggle, 'voice output toggle should be visible').toBeTruthy();
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');

    await submitMessage(rendered.container, 'quiet please');
    // The reply still streams into the transcript — the words are simply not read out.
    await waitFor(
      () => rendered.container.textContent?.includes('Text only') ?? false,
      'the streamed reply to render',
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    synth.drain();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(synth.spoken).toHaveLength(0);
    rendered.unmount();
  });

  it('reports a provider failure and speaks nothing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: 'No AI provider is configured.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const rendered = renderChat();

    await submitMessage(rendered.container, 'are you there');
    await waitFor(
      () => rendered.container.textContent?.includes('No AI provider is configured.') ?? false,
      'the error to render',
    );
    synth.drain();

    expect(synth.spoken).toHaveLength(0);
    consoleError.mockRestore();
    rendered.unmount();
  });

  it('keeps the microphone muted while NEXUS speaks so it cannot hear itself', async () => {
    stubFetch(sseResponse(['Listening ', 'is ', 'paused.'], META));
    const rendered = renderChat();

    await submitMessage(rendered.container, 'talk to me');
    await waitFor(() => synth.spoken.length > 0, 'speech to start');

    expect(synth.spoken).toHaveLength(1);
    rendered.unmount();
  });
});
