import { useSyncExternalStore } from 'react';
import type { LocalAi, StudioItem } from '../services/ai/LocalAi';

/**
 * Which gallery items the AI machine's NSFW check flagged (it looks at the pictures themselves, not
 * the words). Every screen that loads the gallery feeds this, so a chat picture or a movie shot can be
 * blurred by id even where the item itself isn't at hand.
 */
const flagged = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function rememberItems(items: Pick<StudioItem, 'id' | 'nsfw'>[]) {
  let changed = false;
  for (const it of items) {
    if (it.nsfw === true && !flagged.has(it.id)) {
      flagged.add(it.id);
      changed = true;
    } else if (it.nsfw === false && flagged.delete(it.id)) {
      changed = true;
    }
  }
  if (changed) {
    version++;
    for (const l of listeners) l();
  }
}

export function isFlagged(id: string | null | undefined): boolean {
  return Boolean(id && flagged.has(id));
}

/** Re-renders when the flags change. */
export function useNsfwFlags(): (id: string | null | undefined) => boolean {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
  return isFlagged;
}

/** Load the gallery's flags (quietly: the machine may be off). */
export async function refreshFlags(ai: LocalAi) {
  try {
    rememberItems(await ai.studioItems());
  } catch {
    /* machine off, or an older machine */
  }
}
