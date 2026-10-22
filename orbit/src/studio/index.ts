import type { StudioDef } from './defs';
import { AFTER_DARK } from './studios/afterdark';

export const STUDIOS: Record<string, StudioDef> = { [AFTER_DARK.id]: AFTER_DARK };

/**
 * Which studio this page is, if any. Each studio is its own site: its address picks it
 * (VITE_STUDIO_HOSTS="afterdark.example.com=afterdark,…" at build time), or a build for one studio
 * (VITE_STUDIO), or ?studio=afterdark for previews. Remembered for the tab, so links inside keep it.
 */
export function studioFromLocation(loc: Location = window.location): StudioDef | null {
  const hosts = String(import.meta.env.VITE_STUDIO_HOSTS ?? '')
    .split(',')
    .map((p) => p.trim().split('='))
    .filter((p) => p.length === 2);
  const byHost = hosts.find(([h]) => h === loc.hostname)?.[1];
  const byQuery = new URLSearchParams(loc.search).get('studio');
  let id = byHost || (import.meta.env.VITE_STUDIO as string | undefined) || byQuery || null;
  try {
    if (byQuery === 'off') {
      sessionStorage.removeItem('orbit:studio');
      return null;
    }
    if (id) sessionStorage.setItem('orbit:studio', id);
    else id = sessionStorage.getItem('orbit:studio');
  } catch {
    /* storage blocked: the address alone decides */
  }
  return (id && STUDIOS[id]) || null;
}
