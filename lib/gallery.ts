import crypto from 'node:crypto';
import type { IndexCache, R2, R2Object } from './r2';

/**
 * The gallery as it is kept in Cloudflare R2, read by the site so it shows while the AI machine is
 * off. The AI machine mirrors its gallery there (ai/gate/src/studio.js): each picture or video is
 * `gallery/<file>` and its note (what it is, its prompt, the NSFW check) is `gallery/orbit/<id>.json`.
 * Its small picture for the grid (a WebP at most 480 px, a video's from half a second in) is
 * `gallery/thumbs/<id>.webp` once the machine has made it. The Lab's titles, captions and scores are
 * in `state/meme-lab.json`. The site keeps `gallery/_index.v1.json` (lib/r2.ts, IndexCache): every note it
 * has read with its ETag, so a cold listing is a few requests, not one per item.
 *
 * What the site can do here without the machine: list, give short-lived links to view or save,
 * mark NSFW, keep a Lab picture or clip in the main gallery, delete, and add a cloud creation. The
 * machine picks every change up from R2 the next time it lists its gallery.
 */

export type GallerySource = 'make' | 'cloud' | 'lab' | 'soreal' | 'livedraw';

/** A gallery item's note, as the AI machine writes it. */
export interface GalleryNote {
  id: string;
  kind: 'image' | 'video';
  maker?: string;
  prompt?: string;
  width?: number;
  height?: number;
  seconds?: number;
  movie?: string;
  nsfw?: boolean;
  nsfwUser?: boolean;
  lab?: boolean;
  minorGuard?: boolean;
  owner?: string;
  file: string;
  createdAt: string;
  [k: string]: unknown;
}

/** One item as the Gallery app shows it. */
export interface GalleryEntry {
  id: string;
  kind: 'image' | 'video';
  source: GallerySource;
  maker?: string;
  prompt: string;
  /** The Lab's title, caption, hashtags and viral score. */
  title?: string;
  caption?: string;
  hashtags?: string[];
  score?: number;
  width?: number;
  height?: number;
  seconds?: number;
  movie?: string;
  /** The AI machine's NSFW check (unset: not checked yet). */
  nsfw?: boolean;
  /** Your own say (beats the check). */
  nsfwUser?: boolean;
  /** Made by the Lab, kept out of the main gallery until you keep it. */
  lab: boolean;
  createdAt: string;
  /** Short-lived links: to show it, and to save it. */
  url: string;
  downloadUrl: string;
  /** Its small picture for the grid (unset until the AI machine has made one: the grid then uses `url`). */
  thumbUrl?: string;
  bytes: number;
}

interface LabRecord {
  id: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  score?: number;
  movieId?: string;
}

const NOTE = /^gallery\/orbit\/([A-Za-z0-9_-]{6,40})\.json$/;
const thumbKey = (id: string) => `gallery/thumbs/${id}.webp`;
const INDEX_KEY = 'gallery/_index.v1.json';
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const LAB_KEY = 'state/meme-lab.json';
/** The words the Lab adds to spicy prompts for the maker (memes.js ADULT_NOTE): never shown. */
const ADULT_NOTE = ' The person is a fictional adult over 25, not a real or famous person. Flirty and confident but tasteful: clothed or in swimwear, no nudity, nothing explicit.';
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
/** Links are signed for this half hour and last two hours: the same link all half hour, so nothing reloads. */
const WINDOW_MS = 30 * 60_000;
const LINK_SECONDS = 2 * 3600;

export class GalleryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Where a creation came from, for the Gallery's tabs. */
export function sourceOf(n: Pick<GalleryNote, 'maker' | 'movie' | 'lab' | 'file'>): GallerySource {
  const maker = String(n.maker || '');
  if (n.lab) return 'lab';
  if (maker.startsWith('cloud') || String(n.file || '').startsWith('cloud/')) return 'cloud';
  if (maker === 'sketch-finish' || maker.startsWith('live-')) return 'livedraw';
  if (n.movie) return 'soreal';
  return 'make';
}

/** A file path inside the gallery (never outside it). */
const safeFile = (file: unknown) => typeof file === 'string' && file.length > 0 && file.length < 400 && !file.split('/').some((p) => p === '..' || p === '') && !file.endsWith('.json');
const typeOf = (file: string) => TYPES[file.split('.').pop()?.toLowerCase() ?? ''];

// Notes already read, by key and ETag (a warm server reads only what changed), and the index in R2
// that a cold one starts from (lib/r2.ts, IndexCache).
const notes: IndexCache<GalleryNote> = { key: INDEX_KEY, memory: new Map(), sig: null };
type LabState = { records?: LabRecord[] } | null;
const fetchLab = (r2: R2): Promise<LabState> => r2.getJson<{ records?: LabRecord[] }>(LAB_KEY).catch(() => null);

/**
 * The listing and every note (read the cheap way: the index, then only what changed), and with `withLab`
 * the Lab's titles: what listGallery and makeThumbs work from.
 */
async function scanGallery(r2: R2, { withLab = true }: { withLab?: boolean } = {}) {
  // At once: the listing, the index (only when this instance has read nothing yet), and the Lab's
  // titles as soon as it is known there are Lab items (from what was read before, or the index).
  const cold = notes.memory.size === 0;
  const hasLab = (entries: Iterable<{ value: GalleryNote | null }>) => [...entries].some((e) => e.value?.lab);
  let labP: Promise<LabState> | null = !cold && hasLab(notes.memory.values()) ? fetchLab(r2) : null;
  const indexP = cold
    ? r2.readIndex(notes).then((idx) => {
        if (!labP && idx && hasLab(idx.values())) labP = fetchLab(r2);
        return idx;
      })
    : Promise.resolve(null);
  const [all, index] = await Promise.all([r2.list('gallery/'), indexP]);
  const sizes = new Map(all.map((o) => [o.key, o.size]));
  const wanted = all.filter((o) => NOTE.test(o.key));
  const read = await r2.syncIndex(notes, wanted, { index });
  if (withLab && !labP && [...read.values()].some((n) => n?.lab)) labP = fetchLab(r2);
  const labState = withLab && labP ? await labP : null;
  const lab = new Map<string, LabRecord>();
  for (const r of labState?.records ?? []) if (r && typeof r.id === 'string') lab.set(r.id, r);
  // Each note that may be shown, with its id (never one about children before the check said it is fine,
  // never one whose file is not up yet).
  const shown: { o: R2Object; id: string; n: GalleryNote }[] = [];
  for (const o of wanted) {
    const n = read.get(o.key);
    const id = NOTE.exec(o.key)![1];
    if (!n || n.id !== id || (n.kind !== 'image' && n.kind !== 'video') || !safeFile(n.file)) continue;
    // A drawing about children is looked at before anyone sees it: not until the check said it is fine.
    if (n.minorGuard && n.nsfw !== false) continue;
    // Still on its way up (or lost): nothing to show yet.
    if (!sizes.has(`gallery/${n.file}`)) continue;
    shown.push({ o, id, n });
  }
  return { sizes, shown, lab };
}

/** Everything in the gallery (the Lab's too), newest first, each with links that work for two hours. */
export async function listGallery(r2: R2, { now = Date.now }: { now?: () => number } = {}): Promise<GalleryEntry[]> {
  const { sizes, shown, lab } = await scanGallery(r2);
  const at = new Date(Math.floor(now() / WINDOW_MS) * WINDOW_MS);
  const out: GalleryEntry[] = [];
  for (const { o, id, n } of shown) {
    const fileKey = `gallery/${n.file}`;
    const r = lab.get(id);
    const ext = n.file.split('.').pop() || (n.kind === 'video' ? 'mp4' : 'png');
    const type = typeOf(n.file) ?? (n.kind === 'video' ? 'video/mp4' : 'image/png');
    out.push({
      id,
      kind: n.kind,
      source: sourceOf(n),
      maker: n.maker,
      prompt: String(n.prompt || '').replace(ADULT_NOTE, '').trim(),
      ...(r?.title ? { title: r.title } : {}),
      ...(r?.caption ? { caption: r.caption } : {}),
      ...(Array.isArray(r?.hashtags) ? { hashtags: r!.hashtags } : {}),
      ...(typeof r?.score === 'number' ? { score: r.score } : {}),
      width: n.width,
      height: n.height,
      seconds: n.seconds,
      movie: n.movie || r?.movieId,
      ...(typeof n.nsfw === 'boolean' ? { nsfw: n.nsfw } : {}),
      ...(typeof n.nsfwUser === 'boolean' ? { nsfwUser: n.nsfwUser } : {}),
      lab: Boolean(n.lab),
      createdAt: String(n.createdAt || ''),
      url: r2.presign(fileKey, LINK_SECONDS, { type, at }),
      downloadUrl: r2.presign(fileKey, LINK_SECONDS, { type, at, download: `${n.kind}-${id}.${ext}` }),
      // Only when the listing has it: never a link to a thumbnail that isn't there.
      ...(sizes.has(thumbKey(id)) ? { thumbUrl: thumbLink(r2, id, at) } : {}),
      bytes: (sizes.get(fileKey) ?? 0) + o.size + (sizes.get(thumbKey(id)) ?? 0),
    });
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

const thumbLink = (r2: R2, id: string, at: Date) => r2.presign(thumbKey(id), LINK_SECONDS, { type: 'image/webp', at });

// ---------------------------------------------------------------- thumbnails made here (machine off)

/** At most this many thumbnails a call, and never for longer than this: a request never runs long. */
export const THUMBS_PER_CALL = 8;
const THUMBS_BUDGET_MS = 25_000;
/** Bigger originals are left to the machine (a whole file is held in memory here). */
const THUMB_SOURCE_MAX = 40 * 1024 * 1024;
/** How long a browser may keep a thumbnail (its link changes every half hour anyway). */
export const THUMB_CACHE = 'private, max-age=86400';
// Pictures this server could not read: not tried again until it restarts.
const unreadable = new Set<string>();

/** A picture as the grid's thumbnail, as the machine makes them: at most 480 px on its long side, WebP. */
export async function pictureThumb(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buf, { failOn: 'none', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer();
}

/** Whether an item may have a public thumbnail now (the machine's rule, thumbs.js wantsThumb). */
const wantsThumb = (n: GalleryNote) => !(n.minorGuard && n.nsfw !== false) && !(n.photoGuard && typeof n.nsfw !== 'boolean');

/**
 * With the AI machine off, the site makes missing picture thumbnails itself, a few a call (the Gallery
 * asks after it has shown the list; `ids` first: the ones on screen). It reads the picture from R2 and
 * writes `gallery/thumbs/<id>.webp`, the same as the machine does. Videos wait for the machine (it takes
 * their frame). Held results are not under gallery/, so they never get one. A thumbnail is only a smaller
 * copy: whether it shows blurred is decided exactly as for the picture. Returns the new links, and how
 * many pictures still have none.
 */
export async function makeThumbs(
  r2: R2,
  { ids = [], limit = THUMBS_PER_CALL, budgetMs = THUMBS_BUDGET_MS, now = Date.now, thumb = pictureThumb }: { ids?: string[]; limit?: number; budgetMs?: number; now?: () => number; thumb?: (buf: Buffer) => Promise<Buffer> } = {},
): Promise<{ made: { id: string; thumbUrl: string }[]; left: number }> {
  const started = now();
  const { sizes, shown } = await scanGallery(r2, { withLab: false });
  const first = new Set(ids.slice(0, 100));
  const todo = shown
    .filter(({ id, n }) => n.kind === 'image' && !sizes.has(thumbKey(id)) && wantsThumb(n) && !unreadable.has(id) && (sizes.get(`gallery/${n.file}`) ?? 0) <= THUMB_SOURCE_MAX)
    .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || String(b.n.createdAt).localeCompare(String(a.n.createdAt)));
  const at = new Date(Math.floor(now() / WINDOW_MS) * WINDOW_MS);
  const made: { id: string; thumbUrl: string }[] = [];
  let tried = 0;
  for (const { id, n } of todo) {
    if (made.length >= limit || now() - started > budgetMs) break;
    tried++;
    const buf = await r2.get(`gallery/${n.file}`).catch(() => null);
    if (!buf) continue;
    const webp = await thumb(buf).catch(() => null);
    if (!webp?.length) {
      unreadable.add(id);
      continue;
    }
    await r2.put(thumbKey(id), webp, 'image/webp', { cacheControl: THUMB_CACHE });
    // Deleted while it was being made: no thumbnail of it may stay behind.
    const still = (await r2.list(`gallery/orbit/${id}.json`).catch(() => [{ key: `gallery/orbit/${id}.json` }])).some((o) => o.key === `gallery/orbit/${id}.json`);
    if (!still) {
      await r2.remove(thumbKey(id)).catch(() => {});
      continue;
    }
    made.push({ id, thumbUrl: thumbLink(r2, id, at) });
  }
  return { made, left: todo.length - tried };
}

async function readNote(r2: R2, id: string): Promise<GalleryNote> {
  if (!ID.test(id)) throw new GalleryError('That is not a gallery item.');
  const note = await r2.getJson<GalleryNote>(`gallery/orbit/${id}.json`);
  if (!note) throw new GalleryError('That picture is gone.', 404);
  return note;
}

async function saveNote(r2: R2, note: GalleryNote) {
  await r2.putJson(`gallery/orbit/${note.id}.json`, note);
  notes.memory.delete(`gallery/orbit/${note.id}.json`);
}

/** Your own NSFW say: true blurs it, false never blurs it, null hands it back to the machine's check. */
export async function markNsfw(r2: R2, id: string, nsfw: boolean | null) {
  const note = await readNote(r2, id);
  if (typeof nsfw === 'boolean') note.nsfwUser = nsfw;
  else delete note.nsfwUser;
  await saveNote(r2, note);
  return { ok: true, nsfwUser: note.nsfwUser ?? null };
}

/** Move a Lab picture or clip into the main gallery. A Lab movie also moves into soReal: that needs the machine. */
export async function keepLabItem(r2: R2, id: string) {
  const note = await readNote(r2, id);
  if (!note.lab) return { ok: true };
  if (note.movie) throw new GalleryError('Keeping a Lab movie needs the AI machine on (it also moves into soReal to change like your own).', 409);
  delete note.lab;
  await saveNote(r2, note);
  return { ok: true };
}

/** Delete a creation: its file, its thumbnail, then its note. The machine drops it too the next time it looks. */
export async function deleteItem(r2: R2, id: string) {
  const note = await readNote(r2, id);
  if (safeFile(note.file)) await r2.remove(`gallery/${note.file}`);
  await r2.remove(thumbKey(id));
  await r2.remove(`gallery/orbit/${id}.json`);
  notes.memory.delete(`gallery/orbit/${id}.json`);
  return { ok: true };
}

/** fal.ai's file hosts and Runpod Serverless results: the only places a cloud creation is fetched from. */
const CLOUD_HOST = (h: string) => /(^|\.)fal\.(media|run|ai)$/.test(h) || h === 'image.runpod.ai';

/**
 * A picture or video made in the cloud (a data: URL, or a link on the cloud makers' file servers)
 * saved straight into the gallery, the way the AI machine's import does it.
 */
export async function importCloudItem(
  r2: R2,
  input: { url?: unknown; kind?: unknown; prompt?: unknown; maker?: unknown },
  { fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<GalleryNote> {
  const kind = input.kind;
  if (kind !== 'image' && kind !== 'video') throw new GalleryError('kind must be image or video');
  const max = kind === 'video' ? 300 * 1024 * 1024 : 40 * 1024 * 1024;
  let buf: Buffer;
  let type = '';
  const data = /^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(String(input.url || ''));
  if (data) {
    type = data[1];
    buf = Buffer.from(data[2], 'base64');
  } else {
    let u: URL;
    try {
      u = new URL(String(input.url));
    } catch {
      throw new GalleryError('Not a link');
    }
    if (u.protocol !== 'https:' || !CLOUD_HOST(u.hostname)) throw new GalleryError('Only files from the cloud makers can be added');
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(45_000), redirect: 'error' });
    if (!res.ok) throw new GalleryError(`Could not fetch it (${res.status})`, 502);
    if (Number(res.headers.get('content-length')) > max) throw new GalleryError('That file is too large', 413);
    type = (res.headers.get('content-type') || '').split(';')[0];
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (buf.length > max) throw new GalleryError('That file is too large', 413);
  const ext = kind === 'video' ? '.mp4' : type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';
  const id = crypto.randomBytes(9).toString('base64url');
  const file = `cloud/${crypto.randomBytes(9).toString('base64url')}${ext}`;
  await r2.put(`gallery/${file}`, buf, TYPES[ext.slice(1)]);
  const note: GalleryNote = {
    id,
    kind,
    maker: String(input.maker || 'cloud').slice(0, 40),
    prompt: String(input.prompt || '').slice(0, 2000),
    file,
    createdAt: new Date(now()).toISOString(),
  };
  await saveNote(r2, note);
  return note;
}

/** Forget what was read, as a new server instance would (tests). */
export function forgetNotes() {
  notes.memory.clear();
  notes.sig = null;
}
