// The held area: results that must not go straight to the user wait here for the owner to look at.
//
// Nothing in here is ever deleted by the machine. A held result keeps its file, its gallery note,
// what it was made from (prompt, inputs, character), who made it, why it is held and when.
// It is NOT in the gallery: with R2 it lives under the `held/` prefix (the gallery is `gallery/`, which
// the site and every listing read), without R2 in a `held/` folder next to the gallery's `output/`.
//
//   held/<id>.json         the record (see below)
//   held/<id>.<ext>        the picture or video
//   held/thumbs/<id>.webp  its small preview for the review grid (never under gallery/thumbs/)
//
// The one thing that is never kept: results about children or that could show someone under 18
// (studio.js removes those as it always did, and never calls this).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { mediaType, uploadFile } from './r2.js';

export const HELD_PREFIX = 'held/';
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const RECORD = /^held\/([A-Za-z0-9_-]{6,40})\.json$/;
export const NOTE_MAX = 1000;
export const APPROVE_BLOCKED_MESSAGE = "This result has a real person's photo, or a video that was not made here, so it can't be approved. It stays held.";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * dir: the studio folder (held files go in dir/held when there is no R2). r2: the bucket (or null).
 *
 * A record: { id, status: 'held' | 'approved', kind, ext, reason, category, heldAt, owner?, character?,
 *   request?, prompt, width?, height?, seconds?, nsfw?, nsfwScore?, canApprove, notes: [{ at, by, text }],
 *   audit: [{ at, by, action }], item: the gallery note it had }.
 * category: 'checker-unavailable' (nobody has looked), 'flagged' (the check says adult content where
 * that is not allowed). canApprove is false when the result involves a real person's photo or a video
 * not made here and the check flagged it: that one can stay held, never be put in a gallery.
 */
export function createHeld({ dir, r2 = null, log = console, now = Date.now }) {
  const local = path.join(dir, 'held');
  const cache = path.join(local, '.cache');
  const at = () => new Date(now()).toISOString();
  const localRecord = (id) => path.join(local, `${id}.json`);
  const mediaName = (rec) => `${rec.id}${rec.ext}`;
  const thumbName = (id) => `thumbs/${id}.webp`;
  const localThumb = (id) => path.join(local, thumbName(id));

  async function readLocal(id) {
    try {
      return JSON.parse(await fsp.readFile(localRecord(id), 'utf8'));
    } catch {
      return null;
    }
  }
  async function saveLocal(rec) {
    await fsp.mkdir(local, { recursive: true });
    await fsp.writeFile(localRecord(rec.id), JSON.stringify(rec));
  }

  async function putMedia(file, key) {
    const size = (await fsp.stat(file)).size;
    if (size > 256 * 1024 * 1024) await uploadFile(r2, file, key, { contentType: mediaType(file) });
    else await r2.put(key, await fsp.readFile(file), mediaType(file));
  }

  /** The record (R2 first, then this machine's folder), or null. */
  async function get(id) {
    if (!ID.test(String(id))) return null;
    if (r2) {
      const rec = await r2.getJson(`${HELD_PREFIX}${id}.json`).catch(() => null);
      if (rec?.id === id) return rec;
    }
    return readLocal(id);
  }

  /** Save a record where it lives: R2 when there is one (this machine's copy only if R2 failed). */
  async function save(rec) {
    if (r2) {
      try {
        await r2.putJson(`${HELD_PREFIX}${rec.id}.json`, rec);
        await fsp.rm(localRecord(rec.id), { force: true });
        return;
      } catch (err) {
        log.warn?.(`[held] could not save ${rec.id} to R2, kept on this machine: ${err.message}`);
      }
    }
    await saveLocal(rec);
  }

  /** Records waiting in this machine's folder that R2 does not have yet (R2 was down when they were held). */
  async function pushLocal() {
    if (!r2) return;
    for (const n of await fsp.readdir(local).catch(() => [])) {
      const m = /^([A-Za-z0-9_-]{6,40})\.json$/.exec(n);
      if (!m) continue;
      const rec = await readLocal(m[1]);
      if (!rec) continue;
      try {
        const mine = path.join(local, mediaName(rec));
        if (rec.status === 'held' && (await fsp.stat(mine).catch(() => null))) await putMedia(mine, `${HELD_PREFIX}${mediaName(rec)}`);
        if (rec.status === 'held' && rec.thumb && (await fsp.stat(localThumb(rec.id)).catch(() => null))) await putMedia(localThumb(rec.id), `${HELD_PREFIX}${thumbName(rec.id)}`);
        await r2.putJson(`${HELD_PREFIX}${rec.id}.json`, rec);
        await fsp.rm(localRecord(rec.id), { force: true });
        await fsp.rm(mine, { force: true });
        await fsp.rm(localThumb(rec.id), { force: true });
      } catch (err) {
        log.warn?.(`[held] ${rec.id} is still only on this machine: ${err.message}`);
      }
    }
  }

  return {
    local,
    /**
     * Keep a result for review. The file is copied (and uploaded) first: only when this returns may the
     * caller take it out of the gallery. Throws if it could not be kept anywhere. `thumb`: its small
     * preview (a WebP made apart from the gallery's), kept with it.
     */
    async hold({ item, file, thumb = null, reason, category, canApprove = true }) {
      if (!ID.test(String(item?.id))) throw new Error('Nothing to hold.');
      const ext = path.extname(file).toLowerCase() || (item.kind === 'video' ? '.mp4' : '.png');
      const rec = {
        id: item.id,
        status: 'held',
        kind: item.kind,
        ext,
        reason,
        category,
        heldAt: at(),
        owner: item.owner || undefined,
        character: item.character || undefined,
        request: item.request || undefined,
        maker: item.maker,
        prompt: item.prompt,
        width: item.width,
        height: item.height,
        seconds: item.seconds,
        nsfw: item.nsfw === true ? true : undefined,
        nsfwScore: item.nsfwScore,
        canApprove,
        thumb: thumb ? true : undefined,
        notes: [],
        audit: [{ at: at(), by: 'machine', action: 'held' }],
        item,
      };
      await fsp.mkdir(local, { recursive: true });
      const mine = path.join(local, mediaName(rec));
      await fsp.copyFile(file, mine);
      if (thumb) {
        await fsp.mkdir(path.dirname(localThumb(rec.id)), { recursive: true });
        await fsp.copyFile(thumb, localThumb(rec.id));
      }
      await saveLocal(rec);
      if (r2) {
        try {
          await putMedia(mine, `${HELD_PREFIX}${mediaName(rec)}`);
          if (thumb) await putMedia(localThumb(rec.id), `${HELD_PREFIX}${thumbName(rec.id)}`);
          await r2.putJson(`${HELD_PREFIX}${rec.id}.json`, rec);
          await fsp.rm(mine, { force: true });
          await fsp.rm(localThumb(rec.id), { force: true });
          await fsp.rm(localRecord(rec.id), { force: true });
        } catch (err) {
          // Still safe on this machine's drive; it goes up the next time held items are looked at.
          log.warn?.(`[held] ${rec.id} kept on this machine, not in R2 yet: ${err.message}`);
        }
      }
      log.warn?.(`[held] ${rec.id} held for review (${category})`);
      return rec;
    },
    get,
    /** What waits for a look, newest first. */
    async list() {
      await pushLocal().catch(() => {});
      const out = [];
      const seen = new Set();
      if (r2) {
        const keys = (await r2.list(HELD_PREFIX)).map((o) => RECORD.exec(o.key)?.[1]).filter(Boolean);
        for (const id of keys) {
          const rec = await r2.getJson(`${HELD_PREFIX}${id}.json`).catch(() => null);
          if (rec?.id === id) {
            seen.add(id);
            out.push(rec);
          }
        }
      }
      for (const n of await fsp.readdir(local).catch(() => [])) {
        const m = /^([A-Za-z0-9_-]{6,40})\.json$/.exec(n);
        if (!m || seen.has(m[1])) continue;
        const rec = await readLocal(m[1]);
        if (rec) out.push(rec);
      }
      return out.filter((r) => r.status === 'held').sort((a, b) => String(b.heldAt).localeCompare(String(a.heldAt)));
    },
    /** The held file for sending: { path, size, type, name }, brought down from R2 when it is only there. */
    async file(id) {
      const rec = await get(id);
      if (!rec || rec.status !== 'held') return null;
      let p = path.join(local, mediaName(rec));
      if (!(await fsp.stat(p).catch(() => null))) {
        if (!r2) return null;
        p = path.join(cache, mediaName(rec));
        if (!(await fsp.stat(p).catch(() => null))) {
          const buf = await r2.get(`${HELD_PREFIX}${mediaName(rec)}`);
          if (!buf) return null;
          await fsp.mkdir(cache, { recursive: true });
          await fsp.writeFile(p, buf);
        }
      }
      const st = await fsp.stat(p);
      return { path: p, size: st.size, type: mediaType(p), name: `${rec.kind}-${rec.id}${rec.ext}` };
    },
    /** A held result's small preview for sending (null when it has none). */
    async thumbFile(id) {
      const rec = await get(id);
      if (!rec || rec.status !== 'held' || !rec.thumb) return null;
      let p = localThumb(rec.id);
      if (!(await fsp.stat(p).catch(() => null))) {
        if (!r2) return null;
        p = path.join(cache, `${rec.id}.thumb.webp`);
        if (!(await fsp.stat(p).catch(() => null))) {
          const buf = await r2.get(`${HELD_PREFIX}${thumbName(rec.id)}`);
          if (!buf) return null;
          await fsp.mkdir(cache, { recursive: true });
          await fsp.writeFile(p, buf);
        }
      }
      const st = await fsp.stat(p);
      return { path: p, size: st.size, type: 'image/webp', name: `thumb-${rec.id}.webp` };
    },
    /** Add a note (the owner's words on why it stays held). */
    async note(id, text, by = 'owner') {
      const words = String(text || '').trim().slice(0, NOTE_MAX);
      if (!words) throw bad('Write a note first.');
      const rec = await get(id);
      if (!rec || rec.status !== 'held') return null;
      rec.notes = [...(rec.notes || []), { at: at(), by, text: words }].slice(-50);
      await save(rec);
      return rec;
    },
    /**
     * Approve: `place(record, filePath)` puts it back in the gallery with its note (studio.js); only when
     * that worked is the record marked approved (kept, with who and when) and the held file let go.
     */
    async approve(id, place, by = 'owner') {
      const rec = await get(id);
      if (!rec || rec.status !== 'held') return null;
      if (rec.canApprove === false) throw bad(APPROVE_BLOCKED_MESSAGE, 409);
      const f = await this.file(id);
      if (!f) throw bad('The held file is missing, so it cannot be approved.', 404);
      const stamp = at();
      const audit = { at: stamp, by, action: 'approved' };
      await place({ ...rec, audit: [...(rec.audit || []), audit] }, f.path, audit);
      rec.status = 'approved';
      rec.approvedAt = stamp;
      rec.audit = [...(rec.audit || []), audit];
      await save(rec);
      // It is in the gallery now: the held copy of the file has served its purpose.
      await fsp.rm(path.join(local, mediaName(rec)), { force: true });
      await fsp.rm(path.join(cache, mediaName(rec)), { force: true });
      await fsp.rm(localThumb(rec.id), { force: true });
      await fsp.rm(path.join(cache, `${rec.id}.thumb.webp`), { force: true });
      if (r2) await r2.remove(`${HELD_PREFIX}${mediaName(rec)}`).catch((err) => log.warn?.(`[held] ${rec.id}: ${err.message}`));
      // Its preview goes too: the gallery makes its own once it is back there.
      if (r2 && rec.thumb) await r2.remove(`${HELD_PREFIX}${thumbName(rec.id)}`).catch((err) => log.warn?.(`[held] ${rec.id}: ${err.message}`));
      return rec;
    },
  };
}
