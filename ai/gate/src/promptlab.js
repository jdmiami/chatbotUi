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
/** When fewer than this many are waiting, the next round is written. */
const LOW_WATER = 2;

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
  let saved = { enabled: true, mix: 'both', queue: [], records: [], making: null };
  let loaded = false;
  let current = null; // { jobId, idea, startedAt }
  let ticking = null; // the step running now (a promise)
  let writing = null; // the round being written (a promise)
  let lastError = null;
  let sources = [];
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
          mix: MIXES.includes(s.mix) ? s.mix : 'both',
          // Only this Lab's own prompts (the old Lab's movie ideas are dropped).
          queue: Array.isArray(s.queue) ? s.queue.filter((q) => q?.prompt && q.maker && (q.kind === 'picture' || q.kind === 'clip')) : [],
          records: Array.isArray(s.records) ? s.records.filter((r) => r?.id && r.prompt).map((r) => ({ ...r, prompt: String(r.prompt) })) : [],
          making: null,
        };
        // One being made when the machine stopped: its job is gone, so it is made again first.
        if (s.making?.idea?.maker) saved.queue.unshift(s.making.idea);
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
      sources = remixSources(items, makers);
    } catch (err) {
      log.warn?.(`[lab] could not read your prompts: ${err.message}`);
    }
  }

  /** Which kind the next round writes: what the mix allows and you have made, taking turns. */
  function nextKind() {
    const kinds = ['picture', 'clip'].filter((k) => forMix(sources, saved.mix).some((s) => s.kind === k));
    if (!kinds.length) return null;
    return kinds[turn++ % kinds.length];
  }

  /**
   * One writing round: `count` new prompts in your style. `focus`: one prompt of yours to build them
   * all on (Multiply). New ones go to the back of the line, or the front with `first`.
   */
  async function write({ kind, focus = '', count = BATCH, first = false } = {}) {
    if (!o.chat) throw Object.assign(new Error('The prompt writer is not set up on this machine (the site address is missing).'), { status: 503 });
    await refreshSources();
    kind ||= nextKind();
    const from = forMix(sources, saved.mix).filter((s) => s.kind === kind);
    const all = sources.filter((s) => s.kind === kind);
    const like = from.length ? from : all;
    if (!kind || !like.length) throw Object.assign(new Error('Make a few pictures or videos in Make first: the Lab writes in the style of your own prompts.'), { status: 409 });
    const examples = like.slice(0, EXAMPLES).map((s) => s.prompt);
    const avoid = [...saved.queue, ...saved.records.slice(-12)].map((q) => q.prompt.slice(0, 90)).slice(-16);
    const text = await o.chat({ ...writerMessages({ kind, examples, count, avoid, focus }), temperature: 1 });
    const seen = new Set([...examples, ...saved.queue.map((q) => q.prompt)].map((p) => p.toLowerCase()));
    const fresh = [];
    for (const p of parsePrompts(text)) {
      if (seen.has(p.toLowerCase()) || !promptOk(p)) continue;
      seen.add(p.toLowerCase());
      // Each one is made like one of yours (its maker, size and look), taking them in turn.
      const s = like[fresh.length % like.length];
      fresh.push({ id: id(), prompt: p, kind, maker: s.maker, size: s.size, ...(s.style ? { style: s.style } : {}), writtenAt: new Date(now()).toISOString(), ...(focus ? { from: focus.slice(0, 200) } : {}) });
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

  async function start(next) {
    try {
      const job = await studio.createJob({ maker: next.maker, prompt: next.prompt, size: next.size, ...(next.kind === 'clip' ? { seconds: CLIP_SECONDS } : {}), ...(next.style ? { style: next.style } : {}), background: true });
      current = { jobId: job.id, idea: next, startedAt: now() };
      saved.making = { jobId: job.id, idea: next };
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
      if (saved.queue.length < LOW_WATER && !writing && o.chat) {
        const round = writeSoon();
        if (!saved.queue.length) await round;
      }
      if (ownerBusy() || madeLastHour() >= maxPerHour) return;
      const st = await studio.state().catch(() => null);
      const i = saved.queue.findIndex((q) => st?.[q.kind === 'clip' ? 'video' : 'image']?.ready && forMix([q], saved.mix).length);
      if (i < 0) return;
      const [next] = saved.queue.splice(i, 1);
      await start(next);
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
        making: current ? { prompt: current.idea.prompt, kind: current.idea.kind, maker: current.idea.maker, job: studio.job(current.jobId) } : null,
        queue: saved.queue.map(({ id: qid, prompt, kind, maker, size, from }) => ({ id: qid, prompt, kind, maker, size, ...(from ? { from } : {}) })),
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
      if (MIXES.includes(mix) && mix !== saved.mix) saved.mix = mix;
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
