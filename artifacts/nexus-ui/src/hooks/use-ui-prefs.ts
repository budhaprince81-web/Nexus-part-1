import { useCallback, useEffect, useState } from 'react';

export type MotionPref = 'system' | 'full' | 'reduced';

export interface UiPrefs {
  lowResource: boolean;
  motion: MotionPref;
}

const STORAGE_KEY = 'nexus-ui-prefs';

function read(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lowResource: false, motion: 'system' };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      lowResource: parsed.lowResource === true,
      motion: parsed.motion === 'full' || parsed.motion === 'reduced' ? parsed.motion : 'system',
    };
  } catch {
    return { lowResource: false, motion: 'system' };
  }
}

/**
 * Visual intensity preferences.
 *
 * `lowResource` turns off the particle field, scanlines and backdrop blur so the
 * HUD stays usable on weak devices, and `motion` allows forcing reduced motion
 * regardless of the OS setting. Both are applied as attributes on <html> so the
 * CSS can react without any component re-render.
 */
export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(() =>
    typeof window === 'undefined' ? { lowResource: false, motion: 'system' } : read(),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.lowResource = prefs.lowResource ? 'true' : 'false';
    root.dataset.motion = prefs.motion;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Private browsing: preferences simply are not persisted.
    }
  }, [prefs]);

  const update = useCallback((patch: Partial<UiPrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  const toggleLowResource = useCallback(() => {
    setPrefs((current) => ({ ...current, lowResource: !current.lowResource }));
  }, []);

  return { prefs, update, toggleLowResource };
}

/** True when the user (or the OS) asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
