import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMediaQuery } from './useMediaQuery';
import { cachedProbe, measureFrames, rememberProbe, resolveLevel, type MotionLevel, type MotionPref } from './level';
import { transitionFor, type SpringName } from './springs';
import { startTilt } from './tilt';

const Ctx = createContext<MotionLevel>('full');

export interface MotionProviderProps {
  /** The person's setting. 'system' (the default) lets Reduce Motion and the frame probe decide. */
  pref?: MotionPref;
  /** Follow the motion sensor / mouse and write --tx / --ty on <html>. Full level only. */
  tilt?: boolean;
  /**
   * On iPhone, the sensor needs a permission that can only be asked from a tap. Pass true once the
   * person has granted it before, so the first tap of this visit asks again silently.
   */
  tiltGranted?: boolean;
  children: ReactNode;
}

/**
 * Resolves the motion level (the pref, the device's Reduce Motion, and a quick speed check) and
 * publishes it as <html data-motion> for CSS and through useMotionLevel() for code.
 *
 * In Orbit the three inputs came from the shell settings store (settings.motion, settings.tilt,
 * settings.tiltGranted); here they are props, with the same resolution logic.
 */
export function MotionProvider({ pref = 'system', tilt = false, tiltGranted = false, children }: MotionProviderProps) {
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
  useEffect(() => {
    if (level !== 'full' || !tilt) return;
    return startTilt({ askOnTap: Boolean(tiltGranted) });
  }, [level, tilt, tiltGranted]);

  return <Ctx.Provider value={level}>{children}</Ctx.Provider>;
}

export const useMotionLevel = () => useContext(Ctx);

/** A spring transition that already respects the level. */
export function useSpringTransition(name: SpringName = 'bouncy') {
  const level = useMotionLevel();
  return useMemo(() => transitionFor(level, name), [level, name]);
}
