import type { MemeRecord, StudioItem } from './LocalAi';
import type { StoredGallery, StoredItem } from './StoredGallery';

/**
 * The Gallery's last list, kept on this device so it shows the moment the Gallery opens; the fresh list
 * replaces it a moment later (and renews every link). Only what is needed to draw the grid: ids, words,
 * sizes, the NSFW marks and links. Never a picture or video itself. Each device keeps its own.
 *
 * Links in it stop working after a while (the site's after 90 minutes at least, the machine's after 12
 * hours): an older list still shows its tiles, as blank squares, until the fresh one fills them in.
 */
export const LAST_KEY = 'orbit:gallery:last:v1';
/** How long the links in the last list are trusted. */
export const LINKS_GOOD_MS = 80 * 60_000;
/** At most this many of the newest (localStorage is small on iPhone). */
export const LAST_MAX = 400;

export interface LastGallery {
  at: number;
  stored: StoredGallery | null;
  machine: { items: StudioItem[]; lab: MemeRecord[] } | null;
}

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> => {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

const STORED_KEYS: (keyof StoredItem)[] = ['id', 'kind', 'source', 'maker', 'prompt', 'title', 'caption', 'hashtags', 'score', 'width', 'height', 'seconds', 'movie', 'nsfw', 'nsfwUser', 'lab', 'createdAt', 'url', 'thumbUrl'];
const ITEM_KEYS: (keyof StudioItem)[] = ['id', 'kind', 'prompt', 'width', 'height', 'seconds', 'maker', 'movie', 'nsfw', 'nsfwUser', 'createdAt', 'url', 'thumbUrl'];
const LAB_KEYS: (keyof MemeRecord)[] = ['id', 'kind', 'nsfw', 'nsfwUser', 'url', 'thumbUrl', 'title', 'prompt', 'caption', 'hashtags', 'seconds', 'createdAt', 'score', 'movieId', 'remixOf', 'style', 'status'];
const newest = <T extends { createdAt?: string }>(list: T[]) => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, LAST_MAX);

/** What is kept of a list: the newest LAST_MAX of each, only the fields the grid and the viewer's words need. */
export function slim(last: LastGallery): LastGallery {
  return {
    at: last.at,
    // No save links (they come with the fresh list) and no sizes.
    stored: last.stored ? { configured: last.stored.configured, items: newest(last.stored.items).map((it) => ({ ...pick(it, STORED_KEYS), downloadUrl: '', bytes: 0 }) as StoredItem) } : null,
    machine: last.machine
      ? { items: newest(last.machine.items).map((it) => pick(it, ITEM_KEYS) as StudioItem), lab: newest(last.machine.lab).map((r) => pick(r, LAB_KEYS) as MemeRecord) }
      : null,
  };
}

/** Links that are too old to work are left out (the tile waits for the fresh list). */
function withoutLinks<T extends { url?: string; thumbUrl?: string }>(it: T): T {
  return { ...it, url: '', thumbUrl: undefined };
}

/** The last list, or null (none, unreadable, private window). */
export function readLast(now = Date.now()): LastGallery | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') as LastGallery | null;
    if (!v || typeof v.at !== 'number' || (v.stored !== null && !Array.isArray(v.stored?.items)) || (v.machine !== null && (!Array.isArray(v.machine?.items) || !Array.isArray(v.machine?.lab)))) return null;
    if (now - v.at < LINKS_GOOD_MS) return v;
    return {
      at: v.at,
      stored: v.stored ? { ...v.stored, items: v.stored.items.map(withoutLinks) } : null,
      machine: v.machine ? { items: v.machine.items.map(withoutLinks), lab: v.machine.lab.map(withoutLinks) } : null,
    };
  } catch {
    return null;
  }
}

export function saveLast(last: LastGallery) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(slim(last)));
  } catch {
    /* private window, or full: the Gallery just opens without it */
  }
}
