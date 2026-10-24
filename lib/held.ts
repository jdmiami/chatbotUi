import type { IndexCache, R2 } from './r2';

/**
 * Results held for the owner to look at, read from Cloudflare R2 so this works with the AI machine off.
 * The machine writes them (ai/gate/src/held.js): `held/<id>.json` is the record, `held/<id>.<ext>` the
 * picture or video, `held/thumbs/<id>.webp` its small preview. They are NOT under `gallery/`, so no gallery
 * listing ever shows them. The site keeps `held/_index.v1.json` (lib/r2.ts, IndexCache) so a cold look is a few requests.
 *
 * What the owner can do here: list them, add a note, and approve one (it goes back into that person's
 * gallery with its NSFW mark intact, and an audit line says who and when). There is no delete: a held
 * result is only ever removed by the owner's own separate decision, outside this feature.
 */

export interface HeldNote {
  at: string;
  by: string;
  text: string;
}

interface HeldRecord {
  id: string;
  status: 'held' | 'approved';
  kind: 'image' | 'video';
  ext: string;
  reason: string;
  category: 'checker-unavailable' | 'flagged' | string;
  heldAt: string;
  owner?: string;
  character?: { id: string; name: string };
  request?: Record<string, unknown>;
  prompt?: string;
  width?: number;
  height?: number;
  seconds?: number;
  nsfw?: boolean;
  canApprove?: boolean;
  thumb?: boolean;
  notes?: HeldNote[];
  audit?: { at: string; by: string; action: string }[];
  approvedAt?: string;
  item: Record<string, unknown> & { id: string; file: string };
}

/** One held result as the Held for review screen shows it. */
export interface HeldEntry {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  width?: number;
  height?: number;
  seconds?: number;
  nsfw: boolean;
  reason: string;
  category: string;
  heldAt: string;
  madeBy: string;
  owner?: string;
  character?: { id: string; name: string };
  request?: Record<string, unknown>;
  notes: HeldNote[];
  canApprove: boolean;
  url: string;
  /** Its small preview for the review grid, when the machine made one. */
  thumbUrl?: string;
}

export class HeldError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const KEY = /^held\/([A-Za-z0-9_-]{6,40})\.json$/;
const records: IndexCache<HeldRecord> = { key: 'held/_index.v1.json', memory: new Map(), sig: null };
const heldThumb = (id: string) => `held/thumbs/${id}.webp`;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const WINDOW_MS = 30 * 60_000;
const LINK_SECONDS = 2 * 3600;
const NOTE_MAX = 1000;
/** Bigger than this needs the machine (a whole file is held in memory here). */
const MOVE_MAX = 200 * 1024 * 1024;
export const APPROVE_BLOCKED_MESSAGE = "This result has a real person's photo, or a video that was not made here, so it can't be approved. It stays held.";

const typeOf = (ext: string) => TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
const safeExt = (ext: unknown) => (typeof ext === 'string' && /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '');
const safeFile = (file: unknown) => typeof file === 'string' && file.length > 0 && file.length < 400 && !file.split('/').some((p) => p === '..' || p === '') && !file.endsWith('.json');

async function readRecord(r2: R2, id: string): Promise<HeldRecord> {
  if (!ID.test(id)) throw new HeldError('That is not a held result.');
  const rec = await r2.getJson<HeldRecord>(`held/${id}.json`);
  if (!rec || rec.id !== id) throw new HeldError('That one is not held any more.', 404);
  return rec;
}

/** Everything waiting for a look, newest first, each with a preview link that lasts two hours. */
export async function listHeld(r2: R2, { now = Date.now }: { now?: () => number } = {}): Promise<HeldEntry[]> {
  const [all, index] = await Promise.all([r2.list('held/'), records.memory.size === 0 ? r2.readIndex(records) : null]);
  const sizes = new Map(all.map((o) => [o.key, o.size]));
  const read = await r2.syncIndex(records, all.filter((o) => KEY.test(o.key)), { index });
  const at = new Date(Math.floor(now() / WINDOW_MS) * WINDOW_MS);
  const out: HeldEntry[] = [];
  for (const o of all) {
    const m = KEY.exec(o.key);
    if (!m) continue;
    const rec = read.get(o.key);
    const ext = safeExt(rec?.ext);
    if (!rec || rec.id !== m[1] || rec.status !== 'held' || (rec.kind !== 'image' && rec.kind !== 'video') || !ext) continue;
    const media = `held/${rec.id}${ext}`;
    if (!sizes.has(media)) continue;
    out.push({
      id: rec.id,
      kind: rec.kind,
      prompt: String(rec.prompt || ''),
      width: rec.width,
      height: rec.height,
      seconds: rec.seconds,
      nsfw: rec.nsfw === true,
      reason: String(rec.reason || ''),
      category: String(rec.category || ''),
      heldAt: String(rec.heldAt || ''),
      madeBy: rec.owner ? 'A studio member' : 'You',
      ...(rec.owner ? { owner: rec.owner } : {}),
      ...(rec.character ? { character: rec.character } : {}),
      ...(rec.request ? { request: rec.request } : {}),
      notes: Array.isArray(rec.notes) ? rec.notes : [],
      canApprove: rec.canApprove !== false,
      url: r2.presign(media, LINK_SECONDS, { type: typeOf(ext), at }),
      ...(sizes.has(heldThumb(rec.id)) ? { thumbUrl: r2.presign(heldThumb(rec.id), LINK_SECONDS, { type: 'image/webp', at }) } : {}),
    });
  }
  out.sort((a, b) => b.heldAt.localeCompare(a.heldAt));
  return out;
}

/** The owner's note on why a result stays held. */
export async function noteHeld(r2: R2, id: string, text: unknown, { now = Date.now }: { now?: () => number } = {}) {
  const words = String(text ?? '').trim().slice(0, NOTE_MAX);
  if (!words) throw new HeldError('Write a note first.');
  const rec = await readRecord(r2, id);
  if (rec.status !== 'held') throw new HeldError('That one is not held any more.', 404);
  rec.notes = [...(rec.notes ?? []), { at: new Date(now()).toISOString(), by: 'owner', text: words }].slice(-50);
  await r2.putJson(`held/${id}.json`, rec);
  records.memory.delete(`held/${id}.json`);
  return { ok: true, notes: rec.notes };
}

/**
 * Approve: the file and note go back into that person's gallery (its NSFW mark kept), with an audit line
 * (who, when) on the note. The held record stays, marked approved, so there is a trail.
 */
export async function approveHeld(r2: R2, id: string, { now = Date.now }: { now?: () => number } = {}) {
  const rec = await readRecord(r2, id);
  if (rec.status !== 'held') throw new HeldError('That one is not held any more.', 404);
  if (rec.canApprove === false) throw new HeldError(APPROVE_BLOCKED_MESSAGE, 409);
  const ext = safeExt(rec.ext);
  const item = rec.item;
  if (!ext || !item || item.id !== id || !safeFile(item.file)) throw new HeldError('That held result is damaged and needs the AI machine.', 409);
  const media = `held/${id}${ext}`;
  const head = (await r2.list(media)).find((o) => o.key === media);
  if (!head) throw new HeldError('The held file is missing, so it cannot be approved.', 404);
  if (head.size > MOVE_MAX) throw new HeldError('That file is large: turn the AI machine on to approve it.', 409);
  const file = await r2.get(media);
  if (!file) throw new HeldError('The held file is missing, so it cannot be approved.', 404);
  const stamp = new Date(now()).toISOString();
  const audit = { at: stamp, by: 'owner', action: 'approved' };
  const note = { ...item, review: [...(Array.isArray(item.review) ? (item.review as unknown[]) : []), audit] };
  // The file first: a note without its file would show nothing.
  await r2.put(`gallery/${item.file}`, file, typeOf(ext));
  await r2.putJson(`gallery/orbit/${id}.json`, note);
  rec.status = 'approved';
  rec.approvedAt = stamp;
  rec.audit = [...(rec.audit ?? []), audit];
  await r2.putJson(`held/${id}.json`, rec);
  records.memory.delete(`held/${id}.json`);
  // In the gallery now: the held copy of the file has moved, and its preview with it (now the gallery's).
  await r2.remove(media);
  if (rec.thumb) {
    const thumb = await r2.get(heldThumb(id)).catch(() => null);
    if (thumb) await r2.put(`gallery/thumbs/${id}.webp`, thumb, 'image/webp').catch(() => {});
    await r2.remove(heldThumb(id)).catch(() => {});
  }
  return { ok: true, id, approvedAt: stamp };
}

/** Forget what was read, as a new server instance would (tests). */
export function forgetHeld() {
  records.memory.clear();
  records.sig = null;
}
