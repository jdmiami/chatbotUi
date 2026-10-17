import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShell } from '../state/shell';
import { useMediaQuery } from '../hooks/useApplySettings';
import { cachedProbe, measureFrames, rememberProbe, resolveLevel, type MotionLevel } from './level';
import { transitionFor, type SpringName } from './springs';
import { startTilt } from './tilt';

const Ctx = createContext<MotionLevel>('full');

/**
 * Resolves the motion level (Settings, the device's Reduce Motion, and a quick speed check) and
 * publishes it as <html data-motion> for CSS and through useMotionLevel() for code.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const pref = useShell((s) => s.settings.motion);
  const osReduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [probe, setProbe] = useState<'full' | 'lite'>(() => cachedProbe() ?? 'full');

  useEffect(() => {
    if (pref !== 'system') return;
    let live = true;
    measureFrames().then((level) => {
      if (!live) return;
      rememberProbe(level);
      setProbe(level);
    });
    return () => {
      live = false;
    };
  }, [pref]);

  const level = resolveLevel(pref, osReduce, probe);

  useEffect(() => {
    document.documentElement.dataset.motion = level;
  }, [level]);

  // Tilt moves the light and the depth layers: Full only.
  const tilt = useShell((s) => s.settings.tilt);
  const tiltGranted = useShell((s) => s.settings.tiltGranted);
  useEffect(() => {
    if (level !== 'full' || !tilt) return;
    return startTilt({ askOnTap: Boolean(tiltGranted) });
  }, [level, tilt, tiltGranted]);

  return (
    <Ctx.Provider value={level}>
      {children}
    </Ctx.Provider>
  );
}

export const useMotionLevel = () => useContext(Ctx);

/** A spring transition that already respects the level. */
export function useSpringTransition(name: SpringName = 'bouncy') {
  const level = useMotionLevel();
  return useMemo(() => transitionFor(level, name), [level, name]);
}
