import { useSyncExternalStore } from 'react';
import type { LocalAi, StudioItem } from '../services/ai/LocalAi';

/**
 * Which gallery items are NSFW, by id. Two sources:
 *  - the AI machine's check, which looks at the pictures themselves (every screen that loads the
 *    gallery feeds it, so a chat picture or a movie shot can be blurred by id where the item isn't at hand);
 *  - your own say: hold a picture to blur it, or turn the switch off in the viewer to unblur it. Yours
 *    always wins over the check and the words. It is kept on the AI machine (so every device follows it)
 *    and on this device, so it holds while the machine is off and is sent up when it is back.
 */
const flagged = new Set<string>();
/** Your say, as the AI machine has it. */
const marks = new Map<string, boolean>();
/** Your say on this device, not yet on the AI machine. */
const KEY = 'orbit:nsfw-marks';
const pending = new Map<string, boolean | null>(load());
/** Just saved: a gallery list fetched before the save landed must not undo it. */
const justSaved = new Map<string, { nsfw: boolean | null; at: number }>();
const listeners = new Set<() => void>();
let version = 0;
let sink: ((id: string, nsfw: boolean | null) => Promise<void>) | null = null;
/** Where a mark goes when the AI machine can't take it (off): the gallery kept in cloud storage. */
let fallback: ((id: string, nsfw: boolean | null) => Promise<void>) | null = null;
let flushing = false;

function load(): [string, boolean | null][] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return Object.entries(raw).filter((e): e is [string, boolean | null] => typeof e[1] === 'boolean' || e[1] === null);
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(pending)));
  } catch {
    /* private window */
  }
}
function changed() {
  version++;
  for (const l of listeners) l();
}

export function rememberItems(items: Pick<StudioItem, 'id' | 'nsfw' | 'nsfwUser'>[]) {
  let any = false;
  for (const it of items) {
    if (it.nsfw === true && !flagged.has(it.id)) {
      flagged.add(it.id);
      any = true;
    } else if (it.nsfw === false && flagged.delete(it.id)) {
      any = true;
    }
    const recent = justSaved.get(it.id);
    if (recent && Date.now() - recent.at < 60_000 && recent.nsfw !== (it.nsfwUser ?? null)) continue;
    if (typeof it.nsfwUser === 'boolean') {
      if (marks.get(it.id) !== it.nsfwUser) {
        marks.set(it.id, it.nsfwUser);
        any = true;
      }
    } else if (marks.delete(it.id)) {
      any = true;
    }
  }
  if (any) changed();
  void flush();
}

/** Your say on this item: true (blur), false (never blur) or null (let the check and the words decide). */
export function markOf(id: string | null | undefined): boolean | null {
  if (!id) return null;
  if (pending.has(id)) return pending.get(id) ?? null;
  return marks.get(id) ?? null;
}

/** Whether to blur this item: your say first, then `auto` (its words, its Lab style) or the machine's check. */
export function nsfwFor(id: string | null | undefined, auto = false): boolean {
  const m = markOf(id);
  if (m != null) return m;
  return auto || Boolean(id && flagged.has(id));
}

export function isFlagged(id: string | null | undefined): boolean {
  return nsfwFor(id);
}

/** Blur (true), unblur (false) or hand back to the check (null). Shows at once; saved on the machine when it can be. */
export function setMark(id: string, nsfw: boolean | null) {
  pending.set(id, nsfw);
  save();
  changed();
  void flush();
}

/** Where marks are saved (the AI app connects the machine). */
export function connectMarks(ai: LocalAi | null) {
  sink = ai ? (id, nsfw) => ai.markNsfw(id, nsfw) : null;
  void flush();
}

/** With the machine off, marks are saved here instead (the Gallery connects cloud storage when it has it). */
export function connectMarkFallback(save: ((id: string, nsfw: boolean | null) => Promise<void>) | null) {
  fallback = save;
  void flush();
}

async function saveMark(id: string, nsfw: boolean | null) {
  if (!sink && !fallback) throw new Error('nowhere to save');
  if (sink) {
    try {
      return await sink(id, nsfw);
    } catch (err) {
      if (!fallback || (err as { status?: number })?.status === 404) throw err;
    }
  }
  await fallback!(id, nsfw);
}

async function flush() {
  if ((!sink && !fallback) || flushing || pending.size === 0) return;
  flushing = true;
  try {
    for (const [id, nsfw] of [...pending]) {
      try {
        await saveMark(id, nsfw);
      } catch (err) {
        // Gone from the gallery: nothing to keep. Otherwise (machine off) try again later.
        if ((err as { status?: number })?.status !== 404) break;
      }
      if (pending.get(id) !== nsfw) continue; // changed again meanwhile
      pending.delete(id);
      justSaved.set(id, { nsfw, at: Date.now() });
      if (nsfw == null) marks.delete(id);
      else marks.set(id, nsfw);
    }
  } finally {
    flushing = false;
    save();
  }
}

/** Re-renders when the flags or your marks change. */
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
  connectMarks(ai);
  try {
    rememberItems(await ai.studioItems());
  } catch {
    /* machine off, or an older machine */
  }
}
