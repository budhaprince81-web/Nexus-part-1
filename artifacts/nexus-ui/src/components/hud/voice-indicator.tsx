import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, Square, AlertTriangle } from 'lucide-react';
import type { VoiceErrorKind, VoiceState } from '@/hooks/use-voice';
import { cn } from '@/lib/utils';

interface VoiceIndicatorProps {
  state: VoiceState;
  wakeWordDetected?: boolean;
  transcript?: string;
  enabled?: boolean;
  onToggle?: () => void;
  compact?: boolean;
  /** False when the browser has no speech recognition support at all. */
  supported?: boolean;
  /** Why voice stopped, when it stopped for a reason the user can fix. */
  errorKind?: VoiceErrorKind;
  /** Interrupt speech playback. */
  onStopSpeaking?: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  'permission-denied': 'Microphone permission denied — allow access and try again.',
  'no-microphone': 'No microphone detected.',
  unsupported: 'This browser does not support speech recognition.',
  network: 'Speech service unreachable. Text input still works.',
};

export function VoiceIndicator({
  state,
  wakeWordDetected,
  transcript,
  enabled,
  onToggle,
  compact = false,
  supported = true,
  errorKind = null,
  onStopSpeaking,
}: VoiceIndicatorProps) {
  const colors = {
    idle: 'text-primary/40 border-primary/20',
    listening: 'text-primary border-primary shadow-[0_0_15px_rgba(0,212,255,0.4)]',
    processing: 'text-amber-400 border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.4)]',
    speaking: 'text-emerald-400 border-emerald-400/50 shadow-[0_0_15px_rgba(16,185,129,0.4)]',
  };

  const Icon = state === 'speaking' ? Volume2 : enabled ? Mic : MicOff;

  if (compact) {
    return (
      <button
        onClick={state === 'speaking' && onStopSpeaking ? onStopSpeaking : onToggle}
        aria-pressed={enabled}
        aria-label={
          state === 'speaking'
            ? 'Stop NEXUS speaking'
            : enabled
              ? 'Disable voice input'
              : 'Enable voice input'
        }
        className={cn(
          "relative flex items-center justify-center w-8 h-8 border transition-all duration-300",
          enabled ? colors[state] : 'text-primary/30 border-primary/10',
        )}
        title={
          !supported
            ? 'Speech recognition is not supported in this browser'
            : state === 'speaking'
              ? 'Stop speaking'
              : enabled
                ? 'Disable voice'
                : 'Enable voice'
        }
      >
        {(state === 'listening' || state === 'speaking') && (
          <motion.span
            className="absolute inset-0 border border-current opacity-50"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        {state === 'speaking' ? <Square className="w-3.5 h-3.5" /> : <Icon className="w-4 h-4" />}
        {errorKind && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-destructive rounded-full" />
        )}
        {wakeWordDetected && (
          <motion.span
            className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full"
            animate={{ scale: [1, 1.5, 1] }}
            transition={{ duration: 0.5, repeat: 3 }}
          />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onToggle}
        className={cn(
          "relative flex items-center justify-center w-16 h-16 border-2 transition-all duration-300",
          enabled ? colors[state] : 'text-primary/30 border-primary/10 hover:border-primary/30 hover:text-primary/50',
        )}
      >
        {/* Pulse rings when active */}
        {state === 'listening' && (
          <>
            <motion.span className="absolute inset-0 border border-primary opacity-50"
              animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0 }} />
            <motion.span className="absolute inset-0 border border-primary opacity-30"
              animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }} />
          </>
        )}
        {state === 'speaking' && (
          <motion.span className="absolute inset-0 border border-emerald-400 opacity-50"
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 0.8, repeat: Infinity }} />
        )}
        {state === 'speaking' ? <Square className="w-6 h-6 relative z-10" /> : <Icon className="w-7 h-7 relative z-10" />}
      </button>

      {(state === 'speaking' || state === 'processing') && onStopSpeaking && (
        <button
          onClick={onStopSpeaking}
          className="flex items-center gap-2 px-3 py-1 border border-emerald-400/50 bg-emerald-400/10 font-mono text-[10px] uppercase tracking-widest text-emerald-400 hover:bg-emerald-400/20 transition-colors"
        >
          <Square className="w-3 h-3" /> Stop speaking
        </button>
      )}

      {/* State label */}
      <div className="font-mono text-xs uppercase tracking-widest" role="status" aria-live="polite">
        {!supported && <span className="text-destructive/80">VOICE UNSUPPORTED</span>}
        {supported && state === 'idle' && !enabled && <span className="text-primary/30">VOICE OFF</span>}
        {state === 'idle' && enabled && <span className="text-primary/60">STANDBY</span>}
        {state === 'listening' && <span className="text-primary animate-pulse">LISTENING</span>}
        {state === 'processing' && <span className="text-amber-400 animate-pulse">PROCESSING</span>}
        {supported && state === 'speaking' && <span className="text-emerald-400">SPEAKING</span>}
      </div>

      {supported && errorKind && (
        <div className="flex items-start gap-2 max-w-[220px] border border-destructive/40 bg-destructive/5 px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
          <span className="font-mono text-[10px] text-destructive/90 leading-snug">
            {ERROR_TEXT[errorKind] ?? 'Voice input stopped.'}
          </span>
        </div>
      )}

      {/* Live transcript */}
      <AnimatePresence>
        {transcript && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="font-mono text-xs text-primary/70 text-center max-w-[180px] italic"
          >
            "{transcript}"
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wake word flash */}
      <AnimatePresence>
        {wakeWordDetected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="font-mono text-xs text-primary font-bold tracking-widest uppercase bg-primary/10 border border-primary/30 px-3 py-1"
          >
            ⚡ NEXUS ACTIVATED
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Waveform animation for voice
export function VoiceWaveform({ active, bars = 28 }: { active: boolean; bars?: number }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-12 w-full">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full origin-bottom"
          style={{ backgroundColor: 'hsl(var(--primary))', height: 40 }}
          animate={active ? {
            scaleY: [0.1, 0.4 + (i % 5) * 0.16, 0.1],
            opacity: [0.4, 1, 0.4],
          } : { scaleY: 0.08, opacity: 0.2 }}
          transition={{
            duration: active ? 0.4 + (i % 5) * 0.08 : 0.5,
            repeat: Infinity,
            delay: (i * 0.035) % 0.5,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
