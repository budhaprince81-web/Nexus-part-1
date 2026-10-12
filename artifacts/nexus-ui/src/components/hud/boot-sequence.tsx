import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '@/lib/api';
import { prefersReducedMotion } from '@/hooks/use-ui-prefs';

const SESSION_KEY = 'nexus-boot-shown';

interface BootCheck {
  label: string;
  detail: string;
  ok: boolean | null;
}

/**
 * Cinematic boot sequence.
 *
 * It performs *real* checks (API health, provider configuration) and shows the
 * real result — no invented percentages or fake progress. It is skipped
 * entirely for returning visits in the same session, for reduced-motion users
 * and for low-resource mode, and can always be dismissed with a key or a click.
 */
export function BootSequence({ skip = false }: { skip?: boolean }) {
  const reduced = useMemo(() => prefersReducedMotion() || skip, [skip]);
  const [shouldRun] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (reduced) return false;
    try {
      return window.sessionStorage.getItem(SESSION_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [visible, setVisible] = useState(shouldRun);
  const [checks, setChecks] = useState<BootCheck[]>([
    { label: 'CORE', detail: 'Initialising interface', ok: true },
    { label: 'LINK', detail: 'Contacting API', ok: null },
    { label: 'AI', detail: 'Scanning provider mesh', ok: null },
  ]);

  const dismiss = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // Session storage unavailable: the sequence simply shows again.
    }
  };

  useEffect(() => {
    if (!shouldRun) return;
    let cancelled = false;

    const runChecks = async () => {
      let apiOk = false;
      let aiOk = false;
      let aiDetail = 'No provider configured';

      try {
        const health = await fetch(`${API_BASE}/api/healthz`);
        apiOk = health.ok;
      } catch {
        apiOk = false;
      }

      try {
        const response = await fetch(`${API_BASE}/api/providers`);
        if (response.ok) {
          const payload = (await response.json()) as {
            configuredProviders?: string[];
            defaultProvider?: string | null;
          };
          const configured = payload.configuredProviders ?? [];
          aiOk = configured.length > 0;
          aiDetail = aiOk
            ? `${configured.join(', ')} → ${payload.defaultProvider ?? configured[0]}`
            : 'No provider configured — add a key in Replit Secrets';
        }
      } catch {
        aiDetail = 'Provider status unavailable';
      }

      if (cancelled) return;
      setChecks([
        { label: 'CORE', detail: 'Interface online', ok: true },
        { label: 'LINK', detail: apiOk ? 'API responding' : 'API unreachable', ok: apiOk },
        { label: 'AI', detail: aiDetail, ok: aiOk },
      ]);
      setTimeout(() => {
        if (!cancelled) dismiss();
      }, 900);
    };

    void runChecks();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun]);

  useEffect(() => {
    if (!visible) return;
    const onKey = () => dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.5 }}
          className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 cursor-pointer"
          onClick={dismiss}
          role="presentation"
        >
          <div className="grid-lattice absolute inset-0 opacity-20 pointer-events-none" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.8 }}
            className="relative flex flex-col items-center gap-3"
          >
            <div className="relative w-24 h-24">
              <span className="absolute inset-0 rounded-full border border-primary/30 animate-[core-spin_6s_linear_infinite]" />
              <span className="absolute inset-3 rounded-full border border-primary/40 animate-[core-spin_4s_linear_infinite_reverse]" />
              <span className="absolute inset-6 rounded-full bg-primary/20 blur-md animate-pulse" />
              <span className="absolute inset-8 rounded-full bg-primary/70" />
            </div>
            <h1 className="font-mono text-2xl tracking-[0.4em] text-primary cyber-glow-text uppercase">
              Nexus
            </h1>
            <div className="font-mono text-[9px] tracking-[0.3em] text-primary/40 uppercase">
              AI Operating System
            </div>
          </motion.div>

          <div className="flex flex-col gap-1 font-mono text-[10px] w-72">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2">
                <span className="text-primary/40 w-10">{check.label}</span>
                <span
                  className={
                    check.ok === null
                      ? 'text-primary/40 animate-pulse'
                      : check.ok
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                  }
                >
                  {check.ok === null ? '······' : check.ok ? '✓' : '!'}
                </span>
                <span className="text-primary/60 truncate">{check.detail}</span>
              </div>
            ))}
          </div>

          <div className="font-mono text-[9px] text-primary/25 uppercase tracking-widest">
            Press any key to skip
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
