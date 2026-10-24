import type { R2 } from './r2';

/**
 * The characters as the AI machine keeps them in Cloudflare R2, read by the site so the Characters
 * library shows while the AI machine is off. The machine saves each character as
 * `characters/<id>/character.json` with its sheet pictures next to it (ai/gate/src/characters.js).
 *
 * The site only reads them: making, changing and deleting a character needs the machine (a sheet is
 * made there, and a delete has to reach its files and its saved note together).
 */

export interface CharacterView {
  view: string;
  label: string;
  core: boolean;
  /** A short-lived link to the picture. */
  url: string;
  identity?: { score: number; checked: boolean };
}

export interface CharacterEntry {
  id: string;
  name: string;
  adult: true;
  fictional: true;
  age: number;
  /** draft: the sheet is not finished (or must be made again); ready: it can be used. */
  status: 'draft' | 'ready';
  sheetStale?: boolean;
  createdAt: string;
  updatedAt: string;
  descriptor: string;
  traits: Record<string, unknown>;
  sheet: CharacterView[];
}

interface Note {
  id: string;
  name: string;
  age: number;
  status: 'draft' | 'ready';
  owner?: string;
  sheetStale?: boolean;
  createdAt?: string;
  updatedAt?: string;
  descriptor?: string;
  traits?: Record<string, unknown>;
  sheet?: { view: string; label: string; core?: boolean; file: string; identity?: { score: number; checked: boolean } }[];
}

const NOTE = /^characters\/([A-Za-z0-9_-]{6,40})\/character\.json$/;
const FILE = /^[A-Za-z0-9_-]{6,40}\/[a-z0-9-]+\.(png|jpg|webp)$/;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
/** Links are signed for this half hour and last two hours: the same link all half hour, so nothing reloads. */
const WINDOW_MS = 30 * 60_000;
const LINK_SECONDS = 2 * 3600;

const notes = new Map<string, { etag: string; note: Note | null }>();

/** Every character of yours kept in cloud storage, newest first, each sheet picture with a link that works for two hours. */
export async function listCharacters(r2: R2, { now = Date.now }: { now?: () => number } = {}): Promise<CharacterEntry[]> {
  const all = await r2.list('characters/');
  const sizes = new Map(all.map((o) => [o.key, o.size]));
  const wanted = all.filter((o) => NOTE.test(o.key));
  await Promise.all(
    wanted.map(async (o) => {
      if (notes.get(o.key)?.etag === o.etag && o.etag) return;
      const note = await r2.getJson<Note>(o.key).catch(() => null);
      notes.set(o.key, { etag: o.etag, note });
    }),
  );
  for (const key of notes.keys()) if (!sizes.has(key)) notes.delete(key);
  const at = new Date(Math.floor(now() / WINDOW_MS) * WINDOW_MS);
  const out: CharacterEntry[] = [];
  for (const o of wanted) {
    const n = notes.get(o.key)?.note;
    const id = NOTE.exec(o.key)![1];
    // A member's character is not the owner's.
    if (!n || n.id !== id || n.owner || typeof n.name !== 'string' || !Number.isInteger(n.age)) continue;
    const sheet: CharacterView[] = [];
    for (const e of n.sheet ?? []) {
      if (!FILE.test(e.file) || !sizes.has(`characters/${e.file}`)) continue;
      const type = TYPES[e.file.split('.').pop() ?? ''] ?? 'image/png';
      sheet.push({ view: e.view, label: e.label, core: Boolean(e.core), url: r2.presign(`characters/${e.file}`, LINK_SECONDS, { type, at }), ...(e.identity ? { identity: e.identity } : {}) });
    }
    out.push({
      id,
      name: n.name,
      adult: true,
      fictional: true,
      age: n.age,
      status: n.status === 'ready' ? 'ready' : 'draft',
      ...(n.sheetStale ? { sheetStale: true } : {}),
      createdAt: String(n.createdAt ?? ''),
      updatedAt: String(n.updatedAt ?? n.createdAt ?? ''),
      descriptor: String(n.descriptor ?? ''),
      traits: n.traits ?? {},
      sheet,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Forget what was read (tests). */
export function forgetCharacters() {
  notes.clear();
}
