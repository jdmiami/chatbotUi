// The meme lab: while the AI machine is on but nobody is using it, it makes short meme videos made
// to go viral, one after another, and has a second AI watch each one and score how viral it could go.
//
//   - Your jobs always come first. Lab videos wait at the back of the queue, and one being made
//     stops the moment you ask for something (studio.js).
//   - Lab videos never keep the machine on: the hour without use still turns it off (machine.js).
//   - Nothing is posted anywhere. The best ones are marked "ready to post" for you to look at.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Meme setups that tend to travel: a relatable situation, a twist in the first second, a payoff. */
export const FORMATS = [
  { id: 'pov', title: 'POV: {situation}', prompt: 'Vertical phone video, first-person POV. {situation}. {subject} reacts with an exaggerated, frozen stare straight into the camera, then slowly turns away. Handheld, natural light, comedic timing, realistic.' },
  { id: 'nobody', title: 'Nobody: … {subject}:', prompt: 'Vertical video. An empty quiet {place}, then {subject} bursts in and starts {action} with total seriousness. Static camera, deadpan comedy, realistic, sharp.' },
  { id: 'expectation', title: 'Expectation vs reality: {thing}', prompt: 'Vertical split video. Top half: a glossy, perfect {thing} in a commercial style. Bottom half: the same {thing} going hilariously wrong, {subject} staring at it in disbelief. Bright, punchy, realistic.' },
  { id: 'slowmo', title: 'When {situation}', prompt: 'Vertical slow-motion video. {subject}, {action} in a {place}, dramatic orchestral mood, dust in the light, an over-the-top epic moment for something tiny. Cinematic, shallow depth of field.' },
  { id: 'nature-doc', title: 'Nature documentary: the wild {subject}', prompt: 'Vertical wildlife-documentary style video. A {subject} is filmed from behind a bush in a {place} as if it were a rare animal, {action}. Long lens, soft focus, golden hour, documentary realism.' },
  { id: 'animal-human', title: 'This {animal} has a 9-to-5', prompt: 'Vertical video. A {animal} sitting at an office desk in a {place}, wearing tiny glasses, {action}, sighing like a tired employee. Realistic fur, fluorescent office light, deadpan.' },
  { id: 'tiny-epic', title: 'The most dramatic {thing} ever', prompt: 'Vertical video, epic movie-trailer style. A close-up of a {thing} on a kitchen counter, wind blowing, lightning flashes, smoke, as if it were the final boss. Cinematic lighting, slow push-in.' },
  { id: 'glitch', title: 'Reality glitched for one second', prompt: 'Vertical phone video in a {place}. Everything is normal, then for one second {subject} is caught {action} in a seamless loop like a video-game glitch, and everything continues. Realistic, handheld, subtle.' },
  { id: 'reverse', title: 'It gets worse every second', prompt: 'Vertical video. {subject} is calmly {action} in a {place} and every second something else goes wrong in the background, escalating chaos, while they stay perfectly calm. Realistic, single shot.' },
  { id: 'grandma', title: 'Grandma discovers {thing}', prompt: 'Vertical video. A sweet elderly woman in a cozy living room discovers a {thing} for the first time, eyes wide, then ends up {action}, slowly breaking into laughter. Warm light, realistic, heartfelt and funny.' },
];
const SLOTS = {
  subject: ['a golden retriever', 'a very serious cat', 'a goose', 'a toddler in a dinosaur costume', 'a corporate office worker', 'a tiny hamster', 'a confused robot vacuum', 'a capybara', 'a raccoon', 'a pigeon'],
  animal: ['cat', 'goose', 'capybara', 'raccoon', 'pug', 'parrot', 'hamster', 'otter'],
  place: ['supermarket aisle', 'office break room', 'laundromat', 'quiet library', 'gym', 'kitchen at 3 a.m.', 'subway car', 'airport gate', 'backyard', 'elevator'],
  action: ['dancing badly', 'eating a single noodle very slowly', 'doing a dramatic slow-motion walk', 'staring at a microwave', 'losing a fight with a folding chair', 'trying to open a jar', 'typing furiously on a laptop', 'balancing a pizza on its head'],
  thing: ['self-checkout machine', 'smart fridge', 'air fryer', 'ring light', 'robot lawnmower', 'karaoke machine', 'massage chair', 'bubble tea'],
  situation: ['you hear your name in a meeting you were not listening to', 'the Wi-Fi drops right before you send the message', 'your food arrives and it is not what you ordered', 'you finally sit down and the doorbell rings', 'someone says "quick question" at 4:59 p.m.'],
};
const fill = (tpl, pick) => tpl.replace(/\{(\w+)\}/g, (_, k) => pick(k));

/** A ready-to-make idea from the written formats (used when no chat model is installed, or as the seed). */
export function draftIdea(rand = Math.random, recent = []) {
  const formats = FORMATS.filter((f) => !recent.slice(-3).includes(f.id));
  const format = formats[Math.floor(rand() * formats.length)] || FORMATS[0];
  const chosen = {};
  const pick = (k) => (chosen[k] ??= SLOTS[k][Math.floor(rand() * SLOTS[k].length)]);
  const prompt = fill(format.prompt, pick);
  const title = fill(format.title, pick);
  return { format: format.id, title, prompt, caption: title, hashtags: ['#meme', '#funny', '#viral', '#fyp'] };
}

/** First JSON object in a model's answer. */
export function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const IDEA_SYSTEM =
  'You write ideas for 5-second vertical meme videos made by an AI video model, for a meme channel. Aim for instant recognition, a twist in the first second and a reaction people want to share. ' +
  'Keep it kind: no real people, celebrities, brands, politics, violence, or anything sexual. Answer only with JSON: ' +
  '{"title": short on-screen hook, "prompt": one detailed visual paragraph for the video model (camera, setting, action, mood, realistic), "caption": post caption under 120 characters, "hashtags": 3 to 5 hashtags}.';
const SCORE_SYSTEM =
  'You judge short meme videos for a meme channel. Look at the frames and the idea, then score how likely it is to go viral from 0 to 100 ' +
  '(hook in the first second, how relatable, how shareable, whether the joke reads without sound, visual quality). Be strict: 80+ is rare. ' +
  'Answer only with JSON: {"score": number, "why": one sentence, "better_caption": optional improved caption}.';

/** Three frames of a video (as base64 JPEGs) for the judge to look at. */
export function framesOf(file, seconds = 5, run = spawn) {
  const at = [0.6, seconds * 0.5, Math.max(1, seconds - 0.6)];
  return Promise.all(
    at.map(async (t, i) => {
      const out = path.join(os.tmpdir(), `meme-${process.pid}-${Date.now()}-${i}.jpg`);
      await new Promise((resolve, reject) => {
        const p = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', out], { stdio: 'ignore' });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      });
      const b64 = (await fsp.readFile(out)).toString('base64');
      await fsp.rm(out, { force: true });
      return b64;
    }),
  ).catch(() => []);
}

/**
 * o: {
 *   studio        createStudio() result (createJob with background, job, labItems, itemPath, remove, promote, hasUserWork, yieldGpu, state)
 *   quietSeconds  () => seconds since someone last used the machine
 *   chat          async ({ system, user, images? }) => text, or null when no chat model is installed
 *   load / save   async () => saved state | async (state) => void
 *   readyScore    score from which a video is marked ready to post (default 75)
 *   quietMinutes  how long nobody must have used the machine before the lab starts (default 3)
 *   maxPerHour    at most this many lab videos an hour (default 6)
 * }
 */
export function createMemeLab(o) {
  const { studio, quietSeconds, log = console, now = Date.now, rand = Math.random } = o;
  const readyScore = o.readyScore ?? 75;
  const quietMinutes = o.quietMinutes ?? 3;
  const maxPerHour = o.maxPerHour ?? 6;
  let saved = { enabled: true, records: [] };
  let loaded = false;
  let current = null; // { jobId, idea, startedAt }
  let ticking = false;
  let lastError = null;

  const persist = () => Promise.resolve(o.save?.(saved)).catch((err) => log.warn?.(`[lab] could not save: ${err.message}`));

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const s = await o.load?.();
      if (s && typeof s === 'object') saved = { enabled: s.enabled !== false, records: Array.isArray(s.records) ? s.records : [] };
    } catch {
      /* first run */
    }
  }

  async function newIdea() {
    const seed = draftIdea(rand, saved.records.map((r) => r.format));
    if (!o.chat) return seed;
    try {
      const recentTitles = saved.records.slice(-8).map((r) => r.title).join(' | ');
      const text = await o.chat({
        system: IDEA_SYSTEM,
        user: `Use this setup as a starting point and make it funnier and sharper: ${seed.title}. ${seed.prompt}\nDon't repeat these recent ones: ${recentTitles || 'none'}.`,
      });
      const j = parseJson(text);
      if (j?.prompt && j?.title) {
        return {
          format: seed.format,
          title: String(j.title).slice(0, 120),
          prompt: String(j.prompt).slice(0, 1500),
          caption: String(j.caption || j.title).slice(0, 200),
          hashtags: (Array.isArray(j.hashtags) ? j.hashtags : seed.hashtags).map(String).slice(0, 5),
        };
      }
    } catch (err) {
      log.warn?.(`[lab] idea model failed, using a written one: ${err.message}`);
    }
    return seed;
  }

  async function judge(record) {
    if (!o.chat) return { score: null, why: 'No chat model is installed to judge it.' };
    const file = await studio.itemPath(record.id).catch(() => null);
    const images = file ? await framesOf(file, record.seconds || 5) : [];
    const text = await o.chat({ system: SCORE_SYSTEM, user: `Idea: ${record.title}. Caption: ${record.caption}. Video prompt: ${record.prompt}`, images });
    const j = parseJson(text) || {};
    const score = Number.isFinite(Number(j.score)) ? Math.max(0, Math.min(100, Math.round(Number(j.score)))) : null;
    return { score, why: String(j.why || '').slice(0, 300), caption: j.better_caption ? String(j.better_caption).slice(0, 200) : undefined, judgedFrames: images.length };
  }

  const madeLastHour = () => saved.records.filter((r) => now() - Date.parse(r.createdAt) < 3_600_000).length;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await ensureLoaded();
      // A lab video being made: wait for it, then judge it.
      if (current) {
        const j = studio.job(current.jobId);
        if (!j || j.status === 'queued' || j.status === 'running') return;
        const idea = current.idea;
        current = null;
        if (j.status !== 'done' || !j.item) {
          // Stopped to make way for your job, or failed: nothing to keep.
          return;
        }
        const record = { id: j.item.id, ...idea, seconds: j.item.seconds || 5, createdAt: new Date(now()).toISOString(), status: 'judging' };
        saved.records.push(record);
        saved.records = saved.records.slice(-200);
        await persist();
        if (studio.hasUserWork()) {
          record.status = 'made';
          return; // judge it later, after your job
        }
        await studio.yieldGpu();
        Object.assign(record, await judge(record).catch((err) => ({ score: null, why: `Could not judge it: ${err.message}` })));
        record.status = record.score != null && record.score >= readyScore ? 'ready' : 'judged';
        await persist();
        return;
      }
      // Judge anything made earlier that was waiting.
      const waiting = saved.records.find((r) => r.status === 'made');
      if (waiting && !studio.hasUserWork()) {
        await studio.yieldGpu();
        Object.assign(waiting, await judge(waiting).catch((err) => ({ score: null, why: `Could not judge it: ${err.message}` })));
        waiting.status = waiting.score != null && waiting.score >= readyScore ? 'ready' : 'judged';
        await persist();
        return;
      }
      if (!saved.enabled) return;
      if (studio.hasUserWork()) return;
      if (quietSeconds() < quietMinutes * 60) return;
      if (madeLastHour() >= maxPerHour) return;
      const st = await studio.state().catch(() => null);
      if (!st?.video?.ready) return;
      const idea = await newIdea();
      const job = await studio.createJob({ kind: 'video', prompt: idea.prompt, size: 'portrait', seconds: 5, background: true });
      current = { jobId: job.id, idea, startedAt: now() };
      lastError = null;
      log.info?.(`[lab] making "${idea.title}"`);
    } catch (err) {
      lastError = err.message;
      log.warn?.(`[lab] ${err.message}`);
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start(everyMs = 60_000) {
      const t = setInterval(() => void tick(), everyMs);
      t.unref?.();
    },
    async state() {
      await ensureLoaded();
      const live = new Set((await studio.labItems().catch(() => [])).map((i) => i.id));
      const records = saved.records.filter((r) => live.has(r.id)).slice().reverse();
      return {
        enabled: saved.enabled,
        quietMinutes,
        readyScore,
        making: current ? { title: current.idea.title, job: studio.job(current.jobId) } : null,
        madeLastHour: madeLastHour(),
        lastError,
        records,
      };
    },
    async setEnabled(on) {
      await ensureLoaded();
      saved.enabled = Boolean(on);
      if (!saved.enabled && current) {
        await studio.cancel(current.jobId).catch(() => {});
        current = null;
      }
      await persist();
      return saved.enabled;
    },
    /** Move a lab video into the gallery. */
    async keep(id) {
      await ensureLoaded();
      const ok = await studio.promote(id);
      if (ok) {
        saved.records = saved.records.filter((r) => r.id !== id);
        await persist();
      }
      return ok;
    },
    async remove(id) {
      await ensureLoaded();
      saved.records = saved.records.filter((r) => r.id !== id);
      await persist();
      return studio.remove(id);
    },
  };
}
