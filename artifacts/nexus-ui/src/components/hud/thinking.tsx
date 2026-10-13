import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ThinkingIndicatorProps {
  active: boolean;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ThinkingIndicator({ active, label = 'Processing...', size = 'md' }: ThinkingIndicatorProps) {
  const sizes = {
    sm: { ring: 24, stroke: 2, text: 'text-[9px]' },
    md: { ring: 48, stroke: 2.5, text: 'text-xs' },
    lg: { ring: 80, stroke: 3, text: 'text-sm' },
  };
  const { ring, stroke, text } = sizes[size];
  const cx = ring / 2;
  const r = ring / 2 - stroke * 2;
  const circ = 2 * Math.PI * r;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="flex flex-col items-center gap-2"
        >
          <div className="relative" style={{ width: ring, height: ring }}>
            {/* Outer scanning ring */}
            <svg width={ring} height={ring} viewBox={`0 0 ${ring} ${ring}`} className="absolute inset-0">
              <motion.circle
                cx={cx} cy={cx} r={r}
                fill="none"
                stroke="rgba(0,212,255,0.15)"
                strokeWidth={stroke}
              />
              <motion.circle
                cx={cx} cy={cx} r={r}
                fill="none"
                stroke="rgba(0,212,255,0.9)"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${circ * 0.3} ${circ * 0.7}`}
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                style={{ transformOrigin: `${cx}px ${cx}px`, filter: 'drop-shadow(0 0 4px rgba(0,212,255,0.8))' }}
              />
              {/* Inner counter-rotating */}
              <motion.circle
                cx={cx} cy={cx} r={r * 0.6}
                fill="none"
                stroke="rgba(147,51,234,0.6)"
                strokeWidth={stroke * 0.6}
                strokeLinecap="round"
                strokeDasharray={`${circ * 0.6 * 0.15} ${circ * 0.6 * 0.85}`}
                animate={{ rotate: -360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                style={{ transformOrigin: `${cx}px ${cx}px` }}
              />
            </svg>
            {/* Center pulse */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                className="rounded-full bg-primary"
                style={{ width: ring * 0.12, height: ring * 0.12 }}
                animate={{ scale: [1, 1.5, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
            </div>
          </div>
          <motion.span
            className={`font-mono uppercase tracking-widest text-primary/80 ${text}`}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            {label}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Inline dots for chat
export function ThinkingDots({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5"
        >
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary"
              animate={{ y: [0, -4, 0], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Full-page thinking overlay
export function ThinkingOverlay({ active, steps }: { active: boolean; steps?: string[] }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/80 backdrop-blur-md"
        >
          <ThinkingIndicator active size="lg" label="NEXUS thinking..." />
          {steps && steps.length > 0 && (
            <div className="flex flex-col gap-2 font-mono text-xs max-w-sm w-full">
              {steps.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.3 }}
                  className="flex items-center gap-2 text-primary/70"
                >
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                  {step}
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
