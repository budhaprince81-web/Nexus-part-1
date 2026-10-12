import React, { useState, useEffect, useRef } from 'react';
import { CyberPanel, CyberInput, CyberButton } from '@/components/ui/cyber';
import { Send, Plus, Trash2, Cpu, Mic, MicOff } from 'lucide-react';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListAnthropicConversations({ query: { queryKey: getListAnthropicConversationsQueryKey() } });
  const createConv = useCreateAnthropicConversation();
  const deleteConv = useDeleteAnthropicConversation();

  const { data: messages } = useListAnthropicMessages(
    activeConvId!,
    { query: { enabled: !!activeConvId, queryKey: getListAnthropicMessagesQueryKey(activeConvId!) } }
  );

  // Voice — fills input from mic
  const voice = useVoice({
    wakeWord: 'nexus',
    lang: lang === 'ne' ? 'ne-NP' : 'en-US',
    ttsEnabled: true,
    onTranscript: (text) => {
      setInput(text);
    }
  });

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

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !activeConvId || isStreaming) return;

    const messageContent = input;
    setInput('');
    setIsStreaming(true);
    setStreamingMessage('');
    setStreamError(null);

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${BASE}/api/anthropic/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageContent }),
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
      let fullResponse = '';
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
            };
            if (data.error) throw new Error(data.error);
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

      // Speak the response with TTS
      if (fullResponse && voice.enabled) {
        // Truncate for TTS to avoid very long reads
        const ttsText = fullResponse.slice(0, 200);
        voice.speak(ttsText, lang === 'ne' ? 'ne-NP' : 'en-US');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Streaming failed';
      console.error(err);
      setStreamError(message);
    } finally {
      setIsStreaming(false);
      setStreamingMessage('');
      queryClient.invalidateQueries({ queryKey: getListAnthropicMessagesQueryKey(activeConvId) });
    }
  };

  // Auto-send when voice transcript comes in and PTT is done
  useEffect(() => {
    if (input && voice.state === 'idle' && !isStreaming) {
      // small delay so user can edit
    }
  }, [input, voice.state, isStreaming]);

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
                  : 'border-primary/15 bg-primary/3 hover:border-primary/40 text-primary/60'
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

            {/* Voice waveform when listening */}
            {(voice.state === 'listening') && (
              <div className="px-4 py-2 border-t border-primary/10 bg-primary/5">
                <VoiceWaveform active bars={32} />
                <div className="text-center font-mono text-xs text-primary animate-pulse mt-1 uppercase tracking-widest">
                  {t.listening}
                </div>
              </div>
            )}

            <form onSubmit={handleSend} className="p-3 border-t border-primary/20 shrink-0 flex gap-2 bg-background/60 backdrop-blur z-20">
              <CyberInput
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={t.transmit}
                disabled={isStreaming}
                className="h-11 flex-1 text-sm"
                autoFocus
              />
              {/* Push-to-talk */}
              <button
                type="button"
                onMouseDown={voice.pushToTalk}
                className={cn(
                  "h-11 w-11 border flex items-center justify-center shrink-0 transition-all",
                  voice.state === 'listening'
                    ? 'border-primary bg-primary/20 text-primary shadow-[0_0_15px_rgba(0,212,255,0.4)]'
                    : 'border-primary/30 text-primary/50 hover:border-primary hover:text-primary'
                )}
                title="Push to Talk"
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
