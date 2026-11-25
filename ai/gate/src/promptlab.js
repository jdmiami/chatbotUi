// The Lab: a prompt multiplier. It reads the prompts you wrote in Make (pictures and videos), has the
// site's writer (NVIDIA's open-weight models) write new prompts in exactly your style, and makes them
// on this machine one after another with the same maker, size and look you used. Not remakes of what
// you already have: new scenes that read as if you wrote them.
//
//   - Your jobs always come first: Lab work is background work and makes way the moment you ask for
//     something (studio.js), then carries on.
//   - The Lab never keeps the machine on: the hour without use still turns it off.
//   - What it makes stays in the Lab until you keep it (then it moves to your gallery) or delete it.
//   - Words only go to the writer: pictures never leave the machine.
import { BLOCKED_MESSAGE, blockedPrompt, mentionsMinor } from './studio.js';
import { CLIP_SECONDS, MIXES, forMix, remixSources } from './remix.js';

/** How many new prompts one writing round asks for. */
export const BATCH = 6;
/** How many of your own prompts the writer is shown each round. */
export const EXAMPLES = 12;
/** When fewer than this many are waiting, the next round is written: the line never runs dry. */
const LOW_WATER = 3;
/** With fewer video prompts of yours than this, your picture prompts teach the writer your style too. */
const FEW = 4;
const MAKER_KIND = { picture: 'image', clip: 'video' };

export const WRITER_SYSTEM =
  'You write prompts for an AI picture or video maker, in the exact style of one creator. You are shown their own prompts. ' +
  'Write new prompts that read as if they wrote them: the same kind of subjects, look, mood, wording, structure, punctuation and length. ' +
  'Each one is a new scene, not a copy or a light edit of one of theirs, and no two of yours are alike. ' +
  'For a video, describe what moves in one short shot. ' +
  'Everyone in them is an adult; never anyone under 18, and no real or famous people. ' +
  'Answer only with JSON: {"prompts": ["...", "..."]}.';

const clean = (s, max = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The writer's request: `count` new prompts for pictures or videos, from `examples` (your own). */
export function writerMessages({ kind, examples, count = BATCH, avoid = [], focus = '' }) {
  const what = kind === 'clip' ? `${CLIP_SECONDS}-second videos` : 'pictures';
  const user =
    `Their prompts for ${what}:\n` +
    examples.map((p, i) => `${i + 1}. ${p}`).join('\n') +
    (focus ? `\n\nBuild every new one on this prompt of theirs (same subject, new scenes): ${focus}` : '') +
    (avoid.length ? `\n\nAlready written, don't repeat: ${avoid.join(' | ')}` : '') +
    `\n\nWrite ${count} new prompts for ${what}.`;
  return { system: WRITER_SYSTEM, user };
}

/** The prompts in the writer's answer: JSON {prompts: [...]}, a JSON list, or one per line. */
export function parsePrompts(text) {
  const s = String(text || '');
  const tryJson = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  const obj = tryJson(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)) || null;
  let list = Array.isArray(obj?.prompts) ? obj.prompts : null;
  if (!list) {
    const arr = tryJson(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1));
    if (Array.isArray(arr)) list = arr;
  }
  if (!list) {
    list = s
      .split('\n')
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, ''))
      .filter((l) => l.trim().length > 12 && !/^[{[\]}]/.test(l.trim()) && !/^(here|sure|okay)\b/i.test(l.trim()));
  }
  return list.map((p) => clean(typeof p === 'string' ? p : p?.prompt)).filter((p) => p.length >= 3);
}

/** Whether a written prompt may be made: nothing past the site's line, never minors. */
export const promptOk = (p) => !blockedPrompt(p) && !mentionsMinor(p);

/**
 *   studio        studio.js: items, makers, state, createJob, job, cancel, labItems, promote, remove, hasUserWork
 *   chat          async ({ system, user, temperature }) => text: the writer (NVIDIA through the site)
 *   movies        optional: its ownerBusy() also counts as you being busy
 *   load / save   the Lab's saved state (R2 or a file)
 */
export function createPromptLab(o) {
  const { studio, log = console, now = Date.now } = o;
  const maxPerHour = o.maxPerHour ?? 60;
  // Videos by default: the Lab always has videos waiting to be made.
  let saved = { enabled: true, mix: 'videos', mixChosen: false, queue: [], records: [], making: null };
  let loaded = false;
  let current = null; // { jobId, idea, startedAt }
  let ticking = null; // the step running now (a promise)
  let writing = null; // the round being written (a promise)
  let lastError = null;
  let sources = []; // your prompts, whatever made them (the writer's examples)
  let makerList = []; // studio.makers()
  let sourcesAt = 0;
  let turn = 0;
  let seq = 0;
  const id = () => `q${now().toString(36)}${(++seq).toString(36)}`;
  const ownerBusy = () => studio.hasUserWork() || Boolean(o.movies?.ownerBusy?.());
  const persist = () => Promise.resolve(o.save?.(saved)).catch((err) => log.warn?.(`[lab] could not save: ${err.message}`));
  const madeLastHour = () => saved.records.filter((r) => now() - Date.parse(r.createdAt) < 3_600_000).length;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const s = await o.load?.();
      if (s && typeof s === 'object') {
        saved = {
          enabled: s.enabled !== false,
          // Until you pick, the Lab makes videos.
          mix: s.mixChosen && MIXES.includes(s.mix) ? s.mix : 'videos',
          mixChosen: Boolean(s.mixChosen),
          // Only this Lab's own prompts (the old Lab's movie ideas are dropped).
          queue: Array.isArray(s.queue) ? s.queue.filter((q) => q?.prompt && (q.kind === 'picture' || q.kind === 'clip')) : [],
          records: Array.isArray(s.records) ? s.records.filter((r) => r?.id && r.prompt).map((r) => ({ ...r, prompt: String(r.prompt) })) : [],
          making: null,
        };
        // One being made when the machine stopped: its job is gone, so it is made again first.
        if (s.making?.idea?.prompt) saved.queue.unshift(s.making.idea);
      }
    } catch {
      /* first run */
    }
  }

  /** Your prompts, read again from the gallery at most every 2 minutes (or now: force). */
  async function refreshSources(force = false) {
    if (!force && now() - sourcesAt < 120_000) return;
    sourcesAt = now();
    try {
      const [items, makers] = await Promise.all([studio.items(1000), studio.makers ? studio.makers() : []]);
      makerList = makers;
      sources = remixSources(items, makers, { anyMaker: true });
    } catch (err) {
      log.warn?.(`[lab] could not read your prompts: ${err.message}`);
    }
  }

  /** Makers loaded on this machine that make a picture or a video from words alone. */
  const wordMakers = (kind) => makerList.filter((m) => m && m.installed && m.kind === MAKER_KIND[kind] && !(m.needs || []).length);

  /**
   * The maker a Lab picture or video is made with: the one you last used yourself (already loaded,
   * so nothing reloads), else the one loaded now, else the one behind your newest prompt of that
   * kind, else any loaded one. Only makers loaded here that work from words alone.
   */
  function makerFor(kind) {
    const ok = wordMakers(kind);
    if (!ok.length) return null;
    const recent = studio.recentMakers?.() || {};
    const newest = sources.find((s) => s.kind === kind && ok.some((m) => m.id === s.maker));
    const order = [recent[MAKER_KIND[kind]], recent.loaded, newest?.maker];
    for (const id of order) {
      const m = id && ok.find((x) => x.id === id);
      if (m) return m;
    }
    return ok[0];
  }

  /** The shape and look: like your newest prompt of that kind made with that maker (or of that kind). */
  function lookFor(kind, maker) {
    const same = sources.find((s) => s.kind === kind && s.maker === maker.id);
    const any = sources.find((s) => s.kind === kind);
    return { size: (same || any)?.size || 'portrait', ...(kind === 'picture' && same?.style ? { style: same.style } : {}) };
  }

  /** Which kind the next round writes: what the mix allows and a loaded maker can make, taking turns. */
  function nextKind() {
    const want = saved.mix === 'pictures' ? ['picture'] : saved.mix === 'videos' ? ['clip'] : ['clip', 'picture'];
    const kinds = want.filter((k) => wordMakers(k).length);
    if (!kinds.length) return null;
    return kinds[turn++ % kinds.length];
  }

  const noMaker = (mix) =>
    Object.assign(new Error(`Load a ${mix === 'pictures' ? 'picture' : mix === 'videos' ? 'video' : 'picture or video'} maker in Make first: the Lab makes with the makers loaded on your machine.`), { status: 409 });

  /**
   * One writing round: `count` new prompts in your style. `focus`: one prompt of yours to build them
   * all on (Multiply). New ones go to the back of the line, or the front with `first`.
   */
  async function write({ kind, focus = '', count = BATCH, first = false } = {}) {
    if (!o.chat) throw Object.assign(new Error('The prompt writer is not set up on this machine (the site address is missing).'), { status: 503 });
    await refreshSources();
    kind ||= nextKind();
    if (!kind || !wordMakers(kind).length) throw noMaker(kind ? (kind === 'clip' ? 'videos' : 'pictures') : saved.mix);
    // Your prompts of that kind teach the writer your style; with few video prompts, your picture
    // prompts too (it turns them into moving shots).
    let like = sources.filter((s) => s.kind === kind);
    if (kind === 'clip' && like.length < FEW) like = like.concat(sources.filter((s) => s.kind === 'picture'));
    if (!like.length && !focus) throw Object.assign(new Error('Make a few pictures or videos in Make first: the Lab writes in the style of your own prompts.'), { status: 409 });
    const examples = (like.length ? like : [{ prompt: focus }]).slice(0, EXAMPLES).map((s) => s.prompt);
    const avoid = [...saved.queue, ...saved.records.slice(-12)].map((q) => q.prompt.slice(0, 90)).slice(-16);
    const text = await o.chat({ ...writerMessages({ kind, examples, count, avoid, focus }), temperature: 1 });
    const seen = new Set([...examples, ...saved.queue.map((q) => q.prompt)].map((p) => p.toLowerCase()));
    const fresh = [];
    for (const p of parsePrompts(text)) {
      if (seen.has(p.toLowerCase()) || !promptOk(p)) continue;
      seen.add(p.toLowerCase());
      // The maker is picked when it is made: the one you used last by then.
      fresh.push({ id: id(), prompt: p, kind, writtenAt: new Date(now()).toISOString(), ...(focus ? { from: focus.slice(0, 200) } : {}) });
      if (fresh.length >= count) break;
    }
    if (!fresh.length) throw Object.assign(new Error('The writer gave nothing new this time. Try again.'), { status: 502 });
    if (first) saved.queue.unshift(...fresh);
    else saved.queue.push(...fresh);
    saved.queue = saved.queue.slice(0, 60);
    await persist();
    return fresh.length;
  }

  /** A round in the background: one at a time, and its error shown on the Lab. */
  function writeSoon(opts) {
    if (writing) return writing;
    writing = write(opts)
      .then((n) => {
        lastError = null;
        return n;
      })
      .catch((err) => {
        lastError = err.message;
        log.warn?.(`[lab] ${err.message}`);
        return 0;
      })
      .finally(() => (writing = null));
    return writing;
  }

  async function check() {
    const j = studio.job(current.jobId);
    if (j && (j.status === 'queued' || j.status === 'running')) return;
    const { idea, startedAt } = current;
    current = null;
    saved.making = null;
    if (j?.status === 'done' && j.item?.id) {
      saved.records.push({ id: j.item.id, prompt: idea.prompt, kind: idea.kind === 'clip' ? 'video' : 'image', maker: idea.maker, seconds: j.item.seconds, madeMs: now() - startedAt, createdAt: new Date(now()).toISOString(), ...(idea.from ? { from: idea.from } : {}) });
      saved.records = saved.records.slice(-300);
    } else if (!j || (j.notes || []).some((n) => /made way/i.test(String(n)))) {
      // It made way for your job (or the machine lost it): made again first, once you are done.
      saved.queue.unshift(idea);
    } else lastError = `Could not make "${idea.prompt.slice(0, 60)}": ${j.error || 'unknown problem'}`;
    await persist();
  }

  async function start(next, maker) {
    const look = lookFor(next.kind, maker);
    const idea = { ...next, maker: maker.id };
    try {
      const job = await studio.createJob({ maker: maker.id, prompt: next.prompt, size: look.size, ...(next.kind === 'clip' ? { seconds: CLIP_SECONDS } : {}), ...(look.style ? { style: look.style } : {}), background: true });
      current = { jobId: job.id, idea, startedAt: now() };
      saved.making = { jobId: job.id, idea };
      lastError = null;
    } catch (err) {
      lastError = `Skipped "${next.prompt.slice(0, 60)}": ${err.message}`;
    }
    await persist();
  }

  /** One step. A tick already running is waited for, not doubled. */
  function tick() {
    ticking ||= step().finally(() => (ticking = null));
    return ticking;
  }

  async function step() {
    try {
      await ensureLoaded();
      if (current) {
        await check();
        if (current) return;
      }
      if (!saved.enabled) return;
      await refreshSources();
      // Writing needs no graphics card: the next round is written even while you work (waited for
      // only when there is nothing else to make).
      if (forMix(saved.queue, saved.mix).length < LOW_WATER && !writing && o.chat && nextKind()) {
        const round = writeSoon();
        if (!forMix(saved.queue, saved.mix).length) await round;
      }
      if (ownerBusy() || madeLastHour() >= maxPerHour) return;
      const st = await studio.state().catch(() => null);
      const i = saved.queue.findIndex((q) => st?.[MAKER_KIND[q.kind]]?.ready && forMix([q], saved.mix).length && makerFor(q.kind));
      if (i < 0) {
        if (!nextKind()) lastError = noMaker(saved.mix).message;
        return;
      }
      const [next] = saved.queue.splice(i, 1);
      await start(next, makerFor(next.kind));
    } catch (err) {
      lastError = err.message;
      log.warn?.(`[lab] ${err.message}`);
    }
  }

  async function dropCurrent() {
    if (!current) return false;
    const c = current;
    current = null;
    saved.making = null;
    await studio.cancel(c.jobId).catch(() => {});
    return true;
  }

  const find = (qid) => saved.queue.findIndex((q) => q.id === qid);
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });

  return {
    tick,
    start(everyMs = 20_000) {
      const t = setInterval(() => void tick(), everyMs);
      t.unref?.();
    },
    async state() {
      await ensureLoaded();
      await refreshSources();
      const live = new Map((await studio.labItems().catch(() => [])).map((i) => [i.id, i]));
      const records = saved.records
        .filter((r) => live.has(r.id))
        .map((r) => {
          const it = live.get(r.id);
          return { ...r, ...(it.nsfw ? { nsfw: true } : {}), ...(typeof it.nsfwUser === 'boolean' ? { nsfwUser: it.nsfwUser } : {}) };
        })
        .reverse();
      return {
        kind: 'multiply',
        enabled: saved.enabled,
        mix: saved.mix,
        writerReady: Boolean(o.chat),
        writing: Boolean(writing),
        yours: { pictures: sources.filter((s) => s.kind === 'picture').length, videos: sources.filter((s) => s.kind === 'clip').length },
        // The makers it uses now: the ones you used last (loaded), for pictures and for videos.
        makers: Object.fromEntries(['picture', 'clip'].map((k) => {
          const m = makerFor(k);
          return [k, m ? { id: m.id, name: m.name || m.id } : null];
        })),
        making: current ? { prompt: current.idea.prompt, kind: current.idea.kind, maker: current.idea.maker, makerName: makerList.find((m) => m.id === current.idea.maker)?.name, job: studio.job(current.jobId) } : null,
        queue: saved.queue.map(({ id: qid, prompt, kind, from }) => ({ id: qid, prompt, kind, maker: makerFor(kind)?.id ?? null, ...(from ? { from } : {}) })),
        madeLastHour: madeLastHour(),
        maxPerHour,
        lastError,
        records,
      };
    },
    /** { enabled?, mix? }: on or off; pictures, videos or both. */
    async configure({ enabled, mix } = {}) {
      await ensureLoaded();
      if (mix !== undefined && !MIXES.includes(mix)) throw fail('The Lab makes pictures, videos or both.');
      if (MIXES.includes(mix)) {
        saved.mix = mix;
        saved.mixChosen = true;
      }
      if (typeof enabled === 'boolean') {
        saved.enabled = enabled;
        if (!enabled) await dropCurrent();
      }
      await persist();
      if (saved.enabled) void tick();
    },
    /** Stop the one being made now (the next one starts on the next tick). */
    async cancelCurrent() {
      const had = await dropCurrent();
      if (had) await persist();
      return had;
    },
    /** Write a fresh round now (waits for it). The ones waiting are replaced unless `keep`. */
    async writeNow({ keep = false } = {}) {
      await ensureLoaded();
      await refreshSources(true);
      if (!keep) saved.queue = [];
      if (writing) await writing;
      const n = await write({ first: true });
      lastError = null;
      return n;
    },
    /**
     * Multiply one prompt: { prompt, count? } writes `count` (default 6) new ones built on it, in your
     * style, made next. With no prompt, a round from all your prompts.
     */
    async addIdea({ prompt, count, kind } = {}) {
      await ensureLoaded();
      const p = clean(prompt);
      if (p && !promptOk(p)) throw fail(BLOCKED_MESSAGE, 422);
      await refreshSources(true);
      const k = kind === 'clip' || kind === 'picture' ? kind : null;
      const n = Math.max(1, Math.min(12, Number(count) || BATCH));
      const made = await write({ focus: p, count: n, first: true, ...(k ? { kind: k } : {}) });
      lastError = null;
      return made > 0;
    },
    async editIdea(qid, { prompt } = {}) {
      await ensureLoaded();
      const i = find(qid);
      if (i < 0) return false;
      const p = clean(prompt);
      if (!p) return false;
      if (!promptOk(p)) throw fail(BLOCKED_MESSAGE, 422);
      saved.queue[i].prompt = p;
      await persist();
      return true;
    },
    async removeIdea(qid) {
      await ensureLoaded();
      const i = find(qid);
      if (i < 0) return false;
      saved.queue.splice(i, 1);
      await persist();
      return true;
    },
    async makeNext(qid) {
      await ensureLoaded();
      const i = find(qid);
      if (i < 0) return false;
      saved.queue.unshift(...saved.queue.splice(i, 1));
      await persist();
      return true;
    },
    /** Move one into your gallery. */
    async keep(itemId) {
      await ensureLoaded();
      const record = saved.records.find((r) => r.id === itemId);
      const ok = await studio.promote(itemId);
      // A movie from the old Lab moves into soReal with it.
      if (ok && record?.movieId) await o.movies?.adopt?.(record.movieId).catch(() => false);
      if (ok) {
        saved.records = saved.records.filter((r) => r.id !== itemId);
        await persist();
      }
      return ok;
    },
    async remove(itemId) {
      await ensureLoaded();
      const record = saved.records.find((r) => r.id === itemId);
      saved.records = saved.records.filter((r) => r.id !== itemId);
      await persist();
      if (record?.movieId) await o.movies?.remove?.(record.movieId).catch(() => {});
      const had = Boolean(record);
      return (await studio.remove(itemId)) || had;
    },
  };
}
