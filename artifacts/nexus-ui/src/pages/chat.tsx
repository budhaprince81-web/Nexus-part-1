import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CyberPanel, CyberInput, CyberButton } from '@/components/ui/cyber';
import { Send, Plus, Trash2, Cpu, Mic, MicOff, Volume2, VolumeX, Square, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  useListAnthropicConversations, getListAnthropicConversationsQueryKey,
  useCreateAnthropicConversation,
  useListAnthropicMessages, getListAnthropicMessagesQueryKey,
  useDeleteAnthropicConversation
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLangContext } from '@/hooks/use-language';
import { useVoice } from '@/hooks/use-voice';
import { VoiceWaveform } from '@/components/hud/voice-indicator';
import { cn } from '@/lib/utils';

export default function Chat() {
  const queryClient = useQueryClient();
  const { t, lang } = useLangContext();
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [providerMeta, setProviderMeta] = useState<{
    providerLabel: string;
    model: string;
    fallbackUsed: boolean;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListAnthropicConversations({ query: { queryKey: getListAnthropicConversationsQueryKey() } });
  const createConv = useCreateAnthropicConversation();
  const deleteConv = useDeleteAnthropicConversation();

  const { data: messages } = useListAnthropicMessages(
    activeConvId!,
    { query: { enabled: !!activeConvId, queryKey: getListAnthropicMessagesQueryKey(activeConvId!) } }
  );

  // Voice is a single shared engine owned by <VoiceProvider>. Speech output is
  // deliberately NOT gated on the microphone being on — that coupling is what
  // silently disabled every spoken reply.
  const voice = useVoice();
  const {
    speak, stopSpeaking, subscribeTranscript, conversationMode, ttsEnabled,
    setTtsEnabled, isSpeaking, pauseListening, resumeListening,
  } = voice;

  useEffect(() => {
    if (conversations && conversations.length > 0 && !activeConvId) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  const handleCreate = () => {
    createConv.mutate({ data: { title: `LINK_${Date.now().toString(36).toUpperCase()}` } }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
        setActiveConvId(data.id);
      }
    });
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConv.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
        if (activeConvId === id) setActiveConvId(null);
      }
    });
  };

  const sendMessage = useCallback(async (messageContent: string) => {
    const content = messageContent.trim();
    if (!content || !activeConvId || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setStreamingMessage('');
    setStreamError(null);
    setProviderMeta(null);
    // Stop the recogniser while the model works, so NEXUS cannot transcribe its
    // own spoken reply and loop forever. It is resumed once the turn is done.
    pauseListening();

    let fullResponse = '';

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${BASE}/api/anthropic/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        // Surface the server's error (e.g. AI provider not configured) instead
        // of silently showing an empty response.
        let detail = `Request failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) detail = String(body.error);
        } catch {
          // keep the generic message
        }
        throw new Error(detail);
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Server-Sent Events are delimited by a blank line. A network chunk can
      // split an event mid-JSON, so we buffer until a full event is available
      // instead of parsing each chunk independently (which dropped tokens).
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLine = event
            .split('\n')
            .find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const dataStr = dataLine.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr) as {
              content?: string;
              error?: string;
              meta?: {
                provider?: string;
                providerLabel?: string;
                model?: string;
                fallbackUsed?: boolean;
              };
            };
            if (data.error) throw new Error(data.error);
            // The server announces which provider actually answered (and
            // whether a fallback was used) before the first token.
            if (data.meta) {
              setProviderMeta({
                providerLabel: data.meta.providerLabel ?? data.meta.provider ?? 'unknown',
                model: data.meta.model ?? 'unknown',
                fallbackUsed: data.meta.fallbackUsed === true,
              });
            }
            if (data.content) {
              fullResponse += data.content;
              setStreamingMessage(fullResponse);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }

        if (done) break;
      }

      if (!fullResponse.trim()) {
        setStreamError('The provider returned an empty response. Nothing to speak.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Streaming failed';
      console.error(err);
      setStreamError(message);
    } finally {
      setIsStreaming(false);
      setStreamingMessage('');
      queryClient.invalidateQueries({ queryKey: getListAnthropicMessagesQueryKey(activeConvId) });

      if (fullResponse.trim()) {
        // Resume listening first: when speech output is on, the synthesiser
        // takes over the mic again and hands it back when it finishes. That is
        // what makes the hands-free loop work without the mic hearing NEXUS.
        resumeListening();
        // The complete answer is spoken — cleanForSpeech() strips Markdown and
        // splitForSpeech() queues every sentence, so nothing is truncated.
        speak(fullResponse, lang === 'ne' ? 'ne-NP' : 'en-US');
      } else {
        resumeListening();
      }
    }
  }, [activeConvId, isStreaming, lang, pauseListening, queryClient, resumeListening, speak]);

  // Keep the latest sender reachable from the stable transcript listener.
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;

  useEffect(() => {
    return subscribeTranscript((text) => {
      if (conversationMode) {
        // Hands-free: a finalised utterance goes straight to the model.
        void sendRef.current(text);
      } else {
        // Manual mode: fill the composer so the user can review and edit.
        setInput((previous) => (previous.trim() ? `${previous.trim()} ${text}` : text));
      }
    });
  }, [subscribeTranscript, conversationMode]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-4">
      {/* Sidebar Threads */}
      <CyberPanel className="w-full md:w-56 shrink-0 flex flex-col h-48 md:h-full">
        <div className="flex items-center justify-between mb-3 border-b border-primary/20 pb-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">{t.comms}</h2>
          <CyberButton variant="ghost" onClick={handleCreate} className="px-2 py-1 text-xs" disabled={createConv.isPending}>
            <Plus className="w-4 h-4" />
          </CyberButton>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
          {conversations?.map(c => (
            <div
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={cn(
                "p-2.5 border cursor-pointer group flex justify-between items-center transition-all",
                activeConvId === c.id
                  ? 'border-primary bg-primary/10 text-primary shadow-[0_0_10px_rgba(0,212,255,0.1)]'
                  : 'border-primary/15 bg-primary/5 hover:border-primary/40 text-primary/60'
              )}
            >
              <span className="font-mono text-xs truncate uppercase tracking-wider">{c.title}</span>
              <Trash2
                className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity shrink-0 ml-2"
                onClick={(e) => handleDelete(c.id, e)}
              />
            </div>
          ))}
          {conversations?.length === 0 && (
            <div className="text-center font-mono text-[10px] text-primary/30 mt-4 uppercase">
              No active links.
            </div>
          )}
        </div>
      </CyberPanel>

      {/* Main Chat */}
      <CyberPanel className="flex-1 flex flex-col relative overflow-hidden h-full">
        {activeConvId && (
          <div className="flex items-center justify-between border-b border-primary/15 pb-2 mb-2 shrink-0 gap-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-primary/40 truncate">
              {providerMeta
                ? `Answered by ${providerMeta.providerLabel}`
                : isStreaming
                  ? 'Awaiting provider…'
                  : 'Provider auto-selected per request'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {providerMeta?.fallbackUsed && (
                <span className="font-mono text-[9px] uppercase text-amber-400 border border-amber-500/40 px-1.5 py-0.5">
                  fallback
                </span>
              )}
              {providerMeta && (
                <span className="font-mono text-[9px] text-primary/50 truncate max-w-[160px]">
                  {providerMeta.model}
                </span>
              )}
              {/* Voice output state — always visible, so "why is it silent?"
                  never needs guessing. */}
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                aria-pressed={ttsEnabled}
                title={
                  ttsEnabled
                    ? 'Voice output is ON — NEXUS speaks every reply'
                    : 'Voice output is OFF — click to make NEXUS speak replies'
                }
                className={cn(
                  'flex items-center gap-1 px-2 py-1 border font-mono text-[9px] uppercase tracking-wider transition-all',
                  ttsEnabled
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-primary/20 text-primary/40 hover:border-primary/50',
                )}
              >
                {ttsEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                <span className="hidden sm:inline">{ttsEnabled ? 'voice on' : 'voice off'}</span>
              </button>
              {isSpeaking && (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  className="flex items-center gap-1 px-2 py-1 border border-amber-400/50 bg-amber-400/10 font-mono text-[9px] uppercase tracking-wider text-amber-400"
                >
                  <Square className="w-3 h-3" /> stop
                </button>
              )}
            </div>
          </div>
        )}
        {!activeConvId ? (
          <div className="flex-1 flex flex-col items-center justify-center font-mono text-primary/30 uppercase gap-4">
            <Cpu className="w-12 h-12 opacity-20" />
            <div className="text-sm">Select or initialize a comm link.</div>
            <CyberButton onClick={handleCreate} className="text-xs">
              <Plus className="w-4 h-4 mr-2" /> New Channel
            </CyberButton>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-5 relative z-10">
              {messages?.map((msg) => (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 border border-primary/40 flex items-center justify-center mr-2 shrink-0 mt-1 bg-primary/5">
                      <Cpu className="w-3 h-3 text-primary" />
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[82%] p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap",
                    msg.role === 'user'
                      ? 'bg-primary/15 border border-primary/40 text-cyan-50 rounded-tl-lg rounded-bl-lg rounded-tr-lg shadow-[0_0_15px_rgba(0,212,255,0.1)]'
                      : 'bg-background/90 border border-primary/25 text-primary/90 rounded-tr-lg rounded-br-lg rounded-tl-lg'
                  )}>
                    {msg.content}
                  </div>
                </motion.div>
              ))}

              {streamError && (
                <div className="flex justify-start">
                  <div className="max-w-[82%] p-3 font-mono text-xs border border-destructive/50 bg-destructive/10 text-destructive rounded">
                    {streamError}
                  </div>
                </div>
              )}

              {/* Streaming */}
              {isStreaming && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <div className="w-6 h-6 border border-primary/40 flex items-center justify-center mr-2 shrink-0 mt-1 bg-primary/5">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
                      <Cpu className="w-3 h-3 text-primary" />
                    </motion.div>
                  </div>
                  <div className="max-w-[82%] p-4 font-mono text-sm leading-relaxed bg-background/90 border border-primary/40 text-primary/90 rounded-tr-lg rounded-br-lg rounded-tl-lg whitespace-pre-wrap">
                    {streamingMessage || <span className="opacity-50">Processing...</span>}
                    <span className="animate-pulse inline-block ml-1 w-2 h-4 bg-primary align-middle"></span>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Voice waveform when listening or speaking */}
            {(voice.state === 'listening' || isSpeaking) && (
              <div className="px-4 py-2 border-t border-primary/10 bg-primary/5">
                <VoiceWaveform active bars={32} />
                <div className={cn(
                  'text-center font-mono text-xs mt-1 uppercase tracking-widest',
                  isSpeaking ? 'text-emerald-400' : 'text-primary animate-pulse',
                )}>
                  {isSpeaking
                    ? (lang === 'ne' ? 'बोल्दैछु...' : 'Speaking — press the mic to interrupt')
                    : (voice.listeningPaused ? 'Mic paused' : t.listening)}
                </div>
              </div>
            )}

            {/* Honest voice diagnostics: a missing Nepali voice, a synthesis
                failure or a denied microphone is stated, never swallowed. */}
            {(voice.ttsNotice || voice.ttsError || voice.errorKind) && (
              <div className="mx-3 mt-1 flex items-start gap-2 border border-amber-500/40 bg-amber-500/5 px-3 py-2 shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="font-mono text-[10px] text-amber-200/90 leading-snug">
                  {voice.ttsError
                    || (voice.errorKind === 'permission-denied'
                      ? 'Microphone permission was denied. Allow microphone access in your browser to use voice input — text chat still works.'
                      : voice.errorKind === 'unsupported'
                        ? 'This browser does not support speech recognition. Use Chrome or Edge for voice input.'
                        : voice.errorKind === 'no-microphone'
                          ? 'No microphone was detected.'
                          : voice.errorKind === 'network'
                            ? 'The speech recognition service is unreachable. Text chat still works.'
                            : voice.ttsNotice)}
                </span>
              </div>
            )}

            <form onSubmit={handleSend} className="p-3 border-t border-primary/20 shrink-0 flex gap-2 bg-background/60 backdrop-blur z-20">
              <CyberInput
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={conversationMode ? 'Voice conversation mode — speak, or type…' : t.transmit}
                disabled={isStreaming}
                className="h-11 flex-1 text-sm"
                autoFocus
              />
              {/* Push-to-talk: press and speak. It also interrupts playback. */}
              <button
                type="button"
                onMouseDown={voice.pushToTalk}
                aria-label="Push to talk"
                className={cn(
                  "h-11 w-11 border flex items-center justify-center shrink-0 transition-all",
                  voice.state === 'listening'
                    ? 'border-primary bg-primary/20 text-primary shadow-[0_0_15px_rgba(0,212,255,0.4)]'
                    : 'border-primary/30 text-primary/50 hover:border-primary hover:text-primary'
                )}
                title="Push to talk (hold and speak)"
              >
                {voice.state === 'listening' ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
              <CyberButton type="submit" disabled={isStreaming || !input.trim()} className="h-11 px-4 shrink-0">
                <Send className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t.send}</span>
              </CyberButton>
            </form>
          </>
        )}
      </CyberPanel>
    </div>
  );
}
