import { useEffect, useState } from 'react';
import { useShell } from '../state/shell';

/** Reflects Settings onto <html> data attributes / CSS variables that tokens.css reads. */
export function useApplySettings() {
  const settings = useShell((s) => s.settings);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
    root.dataset.theme = theme;
    root.dataset.accent = settings.accent;
    root.dataset.wallpaper = settings.wallpaper;
    // Off (or Auto with the device's Reduce Motion on) also zeroes CSS timings; Full and Lite keep them.
    root.dataset.reduceMotion = settings.motion === 'system' ? '' : settings.motion === 'reduce' ? 'true' : 'false';
    if (settings.motion === 'system') delete root.dataset.reduceMotion;
    root.style.setProperty('--text-scale', String(settings.textScale));
    // Orbit 0.5 (MagStyle) is the only look; its styles key off data-skin="o5".
    root.dataset.skin = 'o5';
    loadEditorialFonts();
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#eef1f7');
  }, [settings, systemDark]);
}

let fontsLoading: Promise<unknown> | null = null;
/** Orbit 0.5's typefaces (a serif with optical sizes for display, Inter for text). */
function loadEditorialFonts() {
  fontsLoading ??= Promise.all([
    import('@fontsource-variable/fraunces/opsz.css'),
    import('@fontsource-variable/fraunces/opsz-italic.css'),
    import('@fontsource-variable/inter/index.css'),
  ]).catch(() => {
    fontsLoading = null; // offline: system fonts stand in; try again next time
  });
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** True when animations should be skipped (OS setting or Orbit's own toggle). */
export function useReducedMotion(): boolean {
  const motion = useShell((s) => s.settings.motion);
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  return motion === 'reduce' || (motion === 'system' && system);
}
