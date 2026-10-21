// The meme lab: while the AI machine is on but nobody is using it, it makes short meme videos made
// to go viral, one after another, and has a second AI watch each one and score how viral it could go.
// Three styles: comedy, spicy (flirty "thirst trap" clips: made-up adults, no nudity, made to
// stay up on the big apps; see spicyProblem), and yours: 30-second movies in your own style, written
// from a profile of your saved prompts (style.js) and made with soReal's auto movie flow (movies.js).
//
//   - Your jobs always come first. Lab videos wait at the back of the queue, and one being made
//     stops the moment you ask for something (studio.js).
//   - Lab videos never keep the machine on: the hour without use still turns it off (machine.js).
//   - Nothing is posted anywhere. The best ones are marked "ready to post" for you to look at.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BLOCKED_MESSAGE, blockedPrompt, mentionsMinor } from './studio.js';
import { checkMovieText } from './story.js';
import { AUTO_OFF } from '../../../shared/autooff.js';

export const STYLES = ['comedy', 'spicy', 'yours'];
/** "Your style" makes movies this long (seconds), vertical, through soReal's auto flow. */
export const MOVIE_SECONDS = 30;

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
/** Thirst-trap setups that travel: a confident look, a reveal or a glance, a beat to loop on. */
export const SPICY_FORMATS = [
  { id: 'fit-check', title: 'Fit check: {vibe}', prompt: 'Vertical phone video. {person} in {outfit} does a slow confident turn in front of a mirror in a {place}, then a playful glance and smirk into the camera. Soft flattering light, fashion-reel style, realistic.' },
  { id: 'glow-up', title: 'The glow-up hit different', prompt: 'Vertical video with a hard cut on the beat. First, {person} in a messy hoodie yawning in a {place}; then the same person in {outfit}, styled and confident, walking toward the camera. Trendy transition, realistic.' },
  { id: 'over-shoulder', title: 'POV: you caught their eye at {place}', prompt: 'Vertical video, slow motion. {person} in {outfit} at a {place} looks back over their shoulder, smiles, and bites their lip slightly before turning away. Golden hour, shallow depth of field, cinematic.' },
  { id: 'gym', title: 'Gym crush energy', prompt: 'Vertical video. {person} in fitted gym wear finishes a set in a modern gym, wipes their brow, and gives a confident nod to the camera. Dramatic side light, sweat sheen, fitness-reel style, realistic.' },
  { id: 'beach-walk', title: 'Main character at the beach', prompt: 'Vertical slow-motion video. {person} in stylish swimwear and an open linen shirt walks along the shoreline at sunset, wind in their hair, glancing at the camera. Warm light, film grain, realistic.' },
  { id: 'hair-flip', title: 'When the {vibe} hits', prompt: 'Vertical video. {person} in {outfit} in a {place} does a slow hair flip on the beat drop and looks straight into the lens with a confident half smile. Neon and soft light, music-video style, realistic.' },
  { id: 'getting-ready', title: 'Getting ready for {vibe}', prompt: 'Vertical video, quick cuts. {person} getting ready in a stylish apartment: cologne or perfume, fixing a collar, a last look in the mirror in {outfit}, then a wink to the camera. Warm interior light, realistic.' },
  { id: 'rooftop', title: 'Rooftop at night, no words needed', prompt: 'Vertical video. {person} in {outfit} leaning on a rooftop railing above city lights at night, turns slowly toward the camera, holds eye contact, and smiles. Moody cinematic light, shallow depth of field.' },
];
const SPICY_SLOTS = {
  person: ['a confident woman in her late twenties', 'a confident man in his early thirties', 'a stylish woman in her thirties', 'a rugged man in his late twenties', 'a fitness coach in her thirties', 'a tall man in his thirties with a beard'],
  outfit: ['a fitted black dress', 'a tailored suit with an open collar', 'a silk shirt and gold jewelry', 'a white tank top and jeans', 'a leather jacket', 'a satin slip dress', 'a crisp linen shirt'],
  place: ['rooftop bar at sunset', 'beach at golden hour', 'neon-lit city street at night', 'hotel lobby', 'poolside lounge', 'stylish loft apartment', 'vineyard at sunset'],
  vibe: ['date night', 'summer', 'the weekend', 'a night out', 'vacation mode', 'Friday'],
};
export const ADULT_NOTE = ' The person is a fictional adult over 25, not a real or famous person. Flirty and confident but tasteful: clothed or in swimwear, no nudity, nothing explicit.';
const fill = (tpl, pick) => tpl.replace(/\{(\w+)\}/g, (_, k) => pick(k));

/** A ready-to-make idea from the written formats (used when no chat model is installed, or as the seed). */
export function draftIdea(rand = Math.random, recent = [], topics = [], style = 'comedy') {
  const spicy = style === 'spicy';
  const all = spicy ? SPICY_FORMATS : FORMATS;
  const slots = spicy ? SPICY_SLOTS : SLOTS;
  const formats = all.filter((f) => !recent.slice(-3).includes(f.id));
  const format = formats[Math.floor(rand() * formats.length)] || all[0];
  // Your topics drive it: a topic stands in for who or what the joke is about, or for the vibe and place.
  const topic = topics.length ? topics[Math.floor(rand() * topics.length)] : null;
  const chosen = !topic ? {} : spicy ? { vibe: topic } : { subject: topic, thing: topic, situation: topic };
  const pick = (k) => (chosen[k] ??= slots[k][Math.floor(rand() * slots[k].length)]);
  // "a my dog" reads badly: drop the article in front of a topic that brings its own.
  const tidy = (t) => t.replace(/\b(a|an) (my|our|your|the|his|her|their) /gi, '$2 ');
  const prompt = tidy(fill(format.prompt, pick)) + (spicy ? ADULT_NOTE : '');
  const title = tidy(fill(format.title, pick));
  return { format: format.id, style: spicy ? 'spicy' : 'comedy', topic, title, prompt, caption: title, hashtags: spicy ? ['#fitcheck', '#glowup', '#aesthetic', '#fyp'] : ['#meme', '#funny', '#comedy', '#fyp'] };
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/** "a my dog" reads badly: no article in front of words that bring their own. */
const article = (t) => (/^(a|an|the|my|our|your|his|her|their|\d)\b/i.test(t) ? t : /^[aeiou]/i.test(t) ? `an ${t}` : `a ${t}`);

/**
 * A 30-second movie idea in your style, from the profile alone (the chat model sharpens it, or it is
 * made as written when there is none). profile: style.js's profile (subjects, settings, light, ...).
 */
export function draftMovieIdea(profile, rand = Math.random, recent = []) {
  const p = profile || {};
  const pick = (a, d = '') => (Array.isArray(a) && a.length ? a[Math.floor(rand() * a.length)] : d);
  const who = [...(p.subjects || []), ...(p.characters || [])];
  // Not the same subject as the last two, when there is a choice.
  const fresh = who.filter((w) => !recent.slice(-2).some((r) => String(r).toLowerCase().includes(w.toLowerCase())));
  const subject = pick(fresh.length ? fresh : who, 'a stranger with a secret');
  const setting = pick(p.settings, 'the city at night');
  const mood = pick(p.mood, 'cinematic');
  const genre = pick(p.genre, 'short film');
  const look = [pick(p.light), pick(p.colour), pick(p.lens), pick(p.camera)].filter(Boolean).join(', ') || 'Cinematic, natural light, 35 mm film';
  const extra = [p.pacing?.length ? `Pacing: ${p.pacing.slice(0, 2).join(', ')}.` : '', p.sound?.length ? `Sound: ${p.sound.slice(0, 2).join(', ')}.` : ''].filter(Boolean).join(' ');
  const place = setting.replace(/^(in|at) /i, '');
  const title = cap(`${subject} in ${place.replace(/^(a|an|the) /i, '')}`).slice(0, 120);
  const prompt = `${cap(article(mood))} ${genre} about ${subject} in ${place}, with a clear beginning, a turn and an ending in 30 seconds. ${extra}`.trim();
  return { format: 'movie', kind: 'movie', style: 'yours', length: MOVIE_SECONDS, topic: null, title, prompt, look, caption: title, hashtags: ['#shortfilm', '#aifilm', '#fyp'] };
}

/** Why an idea for a movie in your style can't be made, or null. Spicy rules apply when your style leans that way. */
export function yoursProblem(text, { spicy = false } = {}) {
  const t = String(text || '');
  if (blockedPrompt(t)) return BLOCKED_MESSAGE;
  if (spicy) return spicyProblem(t);
  return null;
}

// Spicy means the kind of clip that stays up on TikTok, Reels and Shorts: anything that would be
// taken down (nudity, sex) or that could involve someone under age is never made.
const EXPLICIT = /\b(nude|nudes|naked|nsfw|porn\w*|explicit|topless|bottomless|nipples?|genital\w*|penis|vagina|pussy|cock|dick|orgasm\w*|masturbat\w*|undress\w*|strip(ping|s|ped|per|tease)?|sex|sexual|intercourse|blowjob|handjob|cum|fetish|bdsm|hentai|lewd|onlyfans|see[-\s]?through)\b/;
const REAL = /\b(celebrity|famous|lookalike|look-alike|deepfake|influencer named|my (ex|girlfriend|boyfriend|wife|husband|coworker|neighbou?r|friend|crush))\b/;
/** Why a spicy idea can't be made, or null when it's fine. */
export function spicyProblem(text) {
  const t = String(text || '').toLowerCase();
  if (mentionsMinor(t)) return 'Spicy videos only ever show adults: leave out anything about kids, teens or school.';
  if (EXPLICIT.test(t)) return 'Spicy stays flirty, not explicit: no nudity or sex, so the videos can be posted.';
  if (REAL.test(t)) return 'Spicy videos only show made-up people, never real or famous ones.';
  return null;
}
const badTag = (h) => Boolean(spicyProblem(String(h).replace(/#/g, ' ')));

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

// The video maker (LTX-2.3) makes the sound with the picture, so the prompt carries what is said.
const LTX_PROMPT =
  ' Write the "prompt" for the LTX-2.3 video model: one flowing paragraph in the present tense, 4 to 6 sentences, in this order: who or what is in the shot, what they do (concrete motion, never feelings), how the camera moves, the light and mood. ' +
  'If someone speaks or sings, put the exact words in quotation marks and say how they sound (She whispers, "Not again."), one short line of at most 10 words for the 5 seconds. Finish with the sound: ambient noise and how clear the voice is. No on-screen text or logos.';
const IDEA_SYSTEMS = {};
IDEA_SYSTEMS.comedy =
  'You write ideas for 5-second vertical comedy meme videos made by an AI video model, for a comedy meme channel. Aim for instant recognition, a twist in the first second and a reaction people want to share. ' +
  'Keep it kind: no real people, celebrities, brands, politics, violence, or anything sexual. Answer only with JSON: ' +
  '{"title": short on-screen hook, "prompt": one detailed visual paragraph for the video model (camera, setting, action, mood, realistic), "caption": post caption under 120 characters, "hashtags": 3 to 5 hashtags}.' +
  LTX_PROMPT;
IDEA_SYSTEMS.spicy =
  'You write ideas for 5-second vertical "thirst trap" style videos made by an AI video model: flirty, confident, stylish clips of attractive fictional adults (25 or older) of the kind that go viral on TikTok and Reels: fit checks, glow-ups, slow-motion glances, gym and beach reels. ' +
  'Aim for a strong look in the first second, eye contact, confidence and a beat to loop on. Keep it platform-safe: clothed or swimwear, no nudity, nothing sexual or explicit, never anyone under 25 or anyone young-looking, no real or famous people, no brands. Answer only with JSON: ' +
  '{"title": short on-screen hook, "prompt": one detailed visual paragraph for the video model (camera, setting, outfit, action, light, realistic), "caption": post caption under 120 characters, "hashtags": 3 to 5 hashtags}.' +
  LTX_PROMPT;
IDEA_SYSTEMS.yours =
  'You write ideas for 30-second vertical short films made by an AI movie maker (six 5-second shots), in the personal style of one filmmaker. ' +
  'You are given a profile of their style made from their own prompts: keep to their subjects, settings, look, mood, pacing and sound, and never use what they never ask for. ' +
  'Make it something they would have written themselves, but new: not a copy of a past prompt. One clear story: an opening image, a turn, a striking ending. ' +
  'No real or famous people, no brands, no on-screen text, never anyone under 18. Answer only with JSON: ' +
  '{"title": short title, "idea": what the film is about in 2 to 3 sentences (who, where, what happens), "look": the visual style in one short line (light, colour, lens, camera), ' +
  '"caption": post caption under 120 characters, "hashtags": 3 to 5 hashtags}.';
const SCORE_SYSTEMS = {};
SCORE_SYSTEMS.yours =
  "You judge 30-second short films made in one filmmaker's personal style. Look at the frames, the idea and their style, then score from 0 to 100 how good and how shareable it is " +
  '(a strong first second, a story that reads without sound, how well it matches their style, visual quality and consistency between shots). Be strict: 80+ is rare. ' +
  'Answer only with JSON: {"score": number, "why": one sentence, "better_caption": optional improved caption}.';
SCORE_SYSTEMS.comedy =
  'You judge short meme videos for a meme channel. Look at the frames and the idea, then score how likely it is to go viral from 0 to 100 ' +
  '(hook in the first second, how relatable, how shareable, whether the joke reads without sound, visual quality). Be strict: 80+ is rare. ' +
  'Answer only with JSON: {"score": number, "why": one sentence, "better_caption": optional improved caption}.';
SCORE_SYSTEMS.spicy =
  'You judge short flirty "thirst trap" style videos for a social channel. Look at the frames and the idea, then score how likely it is to go viral from 0 to 100 ' +
  '(stopping power in the first second, confidence and charisma, styling and light, how well it loops, visual quality). Score 0 if it shows nudity, anything explicit, or anyone who looks under 25, since it would be taken down. Be strict: 80+ is rare. ' +
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
 *   studio        createStudio() result (createJob with background, job, labItems, itemPath, remove, promote, hasUserWork, yieldGpu, state, cancel)
 *   quietSeconds  () => seconds since someone last used the machine
 *   minutesLeft   () => minutes until the machine turns itself off: the auto-off timer's offAt
 *                 (shared/autooff.js), the time the lab fills
 *   chat          async ({ system, user, images? }) => text, or null when no chat model is installed
 *   load / save   async () => saved state | async (state) => void
 *   readyScore    score from which a video is marked ready to post (default 75)
 *   quietMinutes  how long nobody must have used the machine before the lab starts (default 0: as soon as it is ready)
 *   maxPerHour    at most this many lab videos an hour (default 12)
 *   movies        createMovies() result: "your style" makes 30-second movies with it (create, run, get, remove, adopt, estimate, ownerBusy)
 *   profile       createStyleProfile() result (style.js): your style, from your saved prompts
 * }
 */
export function createMemeLab(o) {
  const { studio, quietSeconds = () => Infinity, log = console, now = Date.now, rand = Math.random } = o;
  const readyScore = o.readyScore ?? 75;
  const quietMinutes = o.quietMinutes ?? 0;
  const maxPerHour = o.maxPerHour ?? 12;
  const minutesLeft = o.minutesLeft ?? (() => AUTO_OFF.defaultMinutes);
  let saved = { enabled: true, style: 'spicy', topics: [], queue: [], records: [], making: null };
  const spicy = () => saved.style === 'spicy';
  const yours = () => saved.style === 'yours';
  // Your style, as last read (plan() is not async); null until it is built.
  let profile = null;
  const yoursSpicy = () => Boolean(profile?.spicy);
  /** The owner is making something: a job of theirs, or one of their own movies between shots. */
  const ownerBusy = () => studio.hasUserWork() || Boolean(o.movies?.ownerBusy?.());
  let loaded = false;
  let current = null; // { jobId, idea, startedAt }
  let ticking = false;
  let lastError = null;
  let qseq = 0;
  const qid = () => `q${now().toString(36)}${(++qseq).toString(36)}`;

  const persist = () => Promise.resolve(o.save?.(saved)).catch((err) => log.warn?.(`[lab] could not save: ${err.message}`));

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const s = await o.load?.();
      if (s && typeof s === 'object') {
        saved = {
          enabled: s.enabled !== false,
          style: STYLES.includes(s.style) ? s.style : 'spicy',
          topics: Array.isArray(s.topics) ? s.topics.map(String).slice(0, 20) : [],
          queue: Array.isArray(s.queue) ? s.queue : [],
          records: Array.isArray(s.records) ? s.records : [],
          // A Lab movie being made when the machine stopped: carried on after the restart.
          making: s.making?.movieId ? s.making : null,
        };
        if (saved.making && o.movies) current = { ...saved.making };
      }
    } catch {
      /* first run */
    }
  }

  /**
   * Minutes one lab video takes, learned from the last ones (about 6 at first). A 30-second movie in
   * your style takes much longer (a story, a storyboard and six shots): learned from the last ones,
   * or else what soReal says a movie like it takes here (movies.estimate, from the studio's timings).
   */
  function minutesPerVideo(style = saved.style) {
    const movie = style === 'yours';
    const ms = saved.records.filter((r) => (r.style === 'yours') === movie).map((r) => r.madeMs).filter((x) => x > 0).slice(-6);
    if (movie) {
      if (ms.length) return Math.max(10, Math.min(240, Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 60_000)));
      const est = Number(o.movies?.estimate?.({ length: MOVIE_SECONDS, size: 'portrait', maker: 'ltx', lead: { mode: 'auto' } })?.seconds);
      // Background work waits behind yours, so a little slack on top.
      return Math.max(10, Math.min(240, Number.isFinite(est) && est > 0 ? Math.ceil((est * 1.2) / 60) : 45));
    }
    if (!ms.length) return 6;
    return Math.max(2, Math.min(20, Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 60_000)));
  }

  /**
   * Keep enough planned ideas to fill the time left before the machine turns off. Clips: 2 to 12.
   * Movies in your style: as many as fit, 1 to 3 (often just 1: one takes most of the hour).
   */
  function plan() {
    const per = minutesPerVideo();
    const busyFor = current ? (current.etaMinutes ?? per) : 0;
    const left = Math.max(0, Number(minutesLeft()) || 0) - busyFor;
    const want = yours() ? Math.max(1, Math.min(3, Math.floor(left / per))) : Math.max(2, Math.min(12, Math.ceil(left / per)));
    let added = false;
    while (saved.queue.length < want) {
      if (yours()) {
        const recent = [...saved.records, ...saved.queue].filter((r) => r.style === 'yours').map((r) => r.title);
        saved.queue.push({ qid: qid(), ...draftMovieIdea(profile, rand, recent), ...(yoursSpicy() ? { spicyLean: true } : {}), planned: true });
      } else {
        const recent = [...saved.records, ...saved.queue].map((r) => r.format);
        saved.queue.push({ qid: qid(), ...draftIdea(rand, recent, saved.topics, saved.style), planned: true });
      }
      added = true;
    }
    return added;
  }

  /** Your style changed (rebuilt, or you edited it): the planned movies follow it; the ones you wrote stay. */
  async function replanYours() {
    profile = (await o.profile?.current().catch(() => null)) || profile;
    if (!yours()) return;
    saved.queue = saved.queue.filter((q) => q.yours);
    if (saved.enabled) plan();
    await persist();
  }

  /** A 30-second movie idea in your style, sharpened by the chat model with your profile (unless you wrote it). */
  async function sharpenMovie(seed) {
    if (!o.chat || seed.yours) return seed;
    try {
      const p = profile || {};
      const brief = Object.entries(p)
        .filter(([, v]) => Array.isArray(v) && v.length)
        .map(([k, v]) => `${k}: ${v.join(', ')}`)
        .join('\n');
      const recentTitles = saved.records.filter((r) => r.style === 'yours').slice(-8).map((r) => r.title).join(' | ');
      const text = await o.chat({
        system: IDEA_SYSTEMS.yours,
        user: `Their style${p.summary ? ` in their words: ${p.summary}` : ':'}\n${brief || 'Not known yet: make a strong cinematic short.'}\nA starting point you may change: ${seed.title}. ${seed.prompt} Look: ${seed.look}\nDon't repeat these recent ones: ${recentTitles || 'none'}.`,
      });
      const j = parseJson(text);
      const idea = String(j?.idea || j?.prompt || '').trim();
      if (idea && j?.title) {
        const out = {
          ...seed,
          title: String(j.title).slice(0, 120),
          prompt: idea.slice(0, 1500),
          look: String(j.look || seed.look).slice(0, 300),
          caption: String(j.caption || j.title).slice(0, 200),
          hashtags: (Array.isArray(j.hashtags) ? j.hashtags : seed.hashtags).map(String).slice(0, 5),
        };
        // An idea past the line is thrown away; the one written from your profile is made instead.
        const words = `${out.title} ${out.prompt} ${out.look} ${out.caption}`;
        if (yoursProblem(words, { spicy: yoursSpicy() }) || (yoursSpicy() && out.hashtags.some(badTag))) return seed;
        return out;
      }
    } catch (err) {
      log.warn?.(`[lab] movie idea model failed, using the written one: ${err.message}`);
    }
    return seed;
  }

  /** Stop and throw away what is being made now (a clip's job, or a movie with its pictures and shots). */
  async function dropCurrent() {
    if (!current) return false;
    const c = current;
    current = null;
    if (c.movieId) {
      saved.making = null;
      await o.movies?.remove(c.movieId).catch(() => {});
    } else await studio.cancel(c.jobId).catch(() => {});
    return true;
  }

  /** Make the next idea sharper with the chat model, unless you wrote or edited it yourself. */
  async function sharpen(seed) {
    if (!o.chat || seed.yours) return seed;
    const style = seed.style === 'spicy' ? 'spicy' : 'comedy';
    try {
      const recentTitles = saved.records.slice(-8).map((r) => r.title).join(' | ');
      const text = await o.chat({
        system: IDEA_SYSTEMS[style],
        user: `${seed.topic ? `Topic: ${seed.topic}. ` : ''}Use this setup as a starting point and make it ${style === 'spicy' ? 'more striking and scroll-stopping' : 'funnier and sharper'}: ${seed.title}. ${seed.prompt}\nDon't repeat these recent ones: ${recentTitles || 'none'}.`,
      });
      const j = parseJson(text);
      if (j?.prompt && j?.title) {
        const idea = {
          ...seed,
          title: String(j.title).slice(0, 120),
          prompt: String(j.prompt).slice(0, 1500) + (style === 'spicy' ? ADULT_NOTE : ''),
          caption: String(j.caption || j.title).slice(0, 200),
          hashtags: (Array.isArray(j.hashtags) ? j.hashtags : seed.hashtags).map(String).slice(0, 5),
        };
        // A model that drifts past the line gets its idea thrown away; the written one is made instead.
        if (style === 'spicy' && (spicyProblem(`${idea.title} ${idea.prompt.replace(ADULT_NOTE, '')} ${idea.caption}`) || idea.hashtags.some(badTag))) return seed;
        return idea;
      }
    } catch (err) {
      log.warn?.(`[lab] idea model failed, using the written one: ${err.message}`);
    }
    return seed;
  }

  async function judge(record) {
    if (!o.chat) return { score: null, why: 'No chat model is installed to judge it.' };
    const file = await studio.itemPath(record.id).catch(() => null);
    // A movie's frames come from its final cut: near the start, the middle and the end.
    const images = file ? await framesOf(file, record.seconds || 5) : [];
    const style = SCORE_SYSTEMS[record.style] ? record.style : 'comedy';
    const theirs = style === 'yours' && profile?.summary ? ` Their style: ${profile.summary}` : '';
    const what = `${style === 'yours' ? 'Movie' : 'Video prompt'}: ${String(record.prompt).replace(ADULT_NOTE, '')}${record.look ? ` Look: ${record.look}.` : ''}`;
    const text = await o.chat({ system: SCORE_SYSTEMS[style], user: `Idea: ${record.title}. Caption: ${record.caption}. ${what}${theirs}`, images });
    const j = parseJson(text) || {};
    const score = Number.isFinite(Number(j.score)) ? Math.max(0, Math.min(100, Math.round(Number(j.score)))) : null;
    return { score, why: String(j.why || '').slice(0, 300), caption: j.better_caption ? String(j.better_caption).slice(0, 200) : undefined, judgedFrames: images.length };
  }

  const madeLastHour = () => saved.records.filter((r) => now() - Date.parse(r.createdAt) < 3_600_000).length;
  const finishJudging = async (r) => {
    await studio.yieldGpu();
    Object.assign(r, await judge(r).catch((err) => ({ score: null, why: `Could not judge it: ${err.message}` })));
    r.status = r.score != null && r.score >= readyScore ? 'ready' : 'judged';
    await persist();
  };

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await ensureLoaded();
      if (yours() && o.profile) {
        // Your style is rebuilt as new prompts come in, while nothing else needs the graphics card.
        if (saved.enabled && !current && !ownerBusy()) {
          const rebuilt = await o.profile.maybeRebuild().catch((err) => (log.warn?.(`[lab] could not rebuild your style: ${err.message}`), false));
          profile = (await o.profile.current().catch(() => null)) || profile;
          if (rebuilt) await replanYours();
        } else profile ??= await o.profile.current().catch(() => null);
      }
      if (saved.enabled && plan()) await persist();
      // A movie in your style being made: soReal makes it in the background (it makes way for your
      // jobs and carries on after them); when its final cut is ready, it is judged like a video.
      if (current?.movieId) {
        await checkMovie();
        return;
      }
      // A lab video being made: wait for it, then judge it.
      if (current) {
        const j = studio.job(current.jobId);
        if (!j || j.status === 'queued' || j.status === 'running') return;
        const { idea, startedAt } = current;
        current = null;
        if (j.status !== 'done' || !j.item) return; // stopped for your job or cancelled: nothing to keep
        const { qid: _q, planned: _p, ...rest } = idea;
        const record = { id: j.item.id, ...rest, seconds: j.item.seconds || 5, madeMs: now() - startedAt, createdAt: new Date(now()).toISOString(), status: 'judging' };
        saved.records.push(record);
        saved.records = saved.records.slice(-200);
        await persist();
        if (studio.hasUserWork()) {
          record.status = 'made';
          return; // judged later, after your job
        }
        await finishJudging(record);
        return;
      }
      const waiting = saved.records.find((r) => r.status === 'made');
      if (waiting && !ownerBusy()) {
        await finishJudging(waiting);
        return;
      }
      if (!saved.enabled || ownerBusy()) return;
      if (quietSeconds() < quietMinutes * 60) return;
      if (madeLastHour() >= maxPerHour) return;
      const st = await studio.state().catch(() => null);
      if (!st?.video?.ready) return;
      if (yours() && !o.movies) return;
      const next = saved.queue.shift();
      if (!next) return;
      if (next.kind === 'movie') {
        await startMovie(next);
        return;
      }
      const idea = await sharpen(next);
      // Last check before making: a spicy idea must still pass, whoever wrote it.
      const problem = idea.style === 'spicy' ? spicyProblem(`${idea.title} ${idea.prompt.replace(ADULT_NOTE, '')}`) : null;
      if (problem) {
        lastError = `Skipped "${idea.title}": ${problem}`;
        plan();
        await persist();
        return;
      }
      const job = await studio.createJob({ kind: 'video', prompt: idea.prompt, size: 'portrait', seconds: 5, background: true });
      current = { jobId: job.id, idea, startedAt: now() };
      lastError = null;
      plan();
      await persist();
      log.info?.(`[lab] making "${idea.title}"`);
    } catch (err) {
      lastError = err.message;
      log.warn?.(`[lab] ${err.message}`);
    } finally {
      ticking = false;
    }
  }

  /** Start a 30-second movie in your style with soReal's auto flow: story, storyboard, shots, final cut. */
  async function startMovie(next) {
    const idea = await sharpenMovie(next);
    const spicyLean = yoursSpicy() || Boolean(idea.spicyLean);
    const plain = idea.prompt.replace(ADULT_NOTE, '');
    // Last check before making, whoever wrote it: never minors, and spicy rules when your style leans spicy.
    const problem = yoursProblem(`${idea.title} ${plain} ${idea.look || ''}`, { spicy: spicyLean });
    if (problem) {
      lastError = `Skipped "${idea.title}": ${problem}`;
      plan();
      await persist();
      return;
    }
    const text = spicyLean ? plain + ADULT_NOTE : plain;
    try {
      // soReal's own content rules too (its photo rule never comes up: a Lab movie never uses a photo).
      checkMovieText([idea.title, text, idea.look]);
      const movie = await o.movies.create({ flow: 'auto', title: idea.title, idea: text, look: idea.look || '', length: MOVIE_SECONDS, size: 'portrait', maker: 'ltx', lead: { mode: 'auto' }, sound: 'auto', lab: true, nsfw: spicyLean });
      current = { movieId: movie.id, idea: { ...idea, spicyLean: spicyLean || undefined }, startedAt: now(), phase: 'story' };
      saved.making = { ...current };
      await o.movies.run(movie.id);
    } catch (err) {
      lastError = `Skipped "${idea.title}": ${err.message}`;
      if (current?.movieId) await dropCurrent();
      plan();
      await persist();
      return;
    }
    lastError = null;
    plan();
    await persist();
    log.info?.(`[lab] making the movie "${idea.title}"`);
  }

  /** The movie being made: note how far it is; when its final cut is ready, record and judge it. */
  async function checkMovie() {
    const m = o.movies ? await o.movies.get(current.movieId).catch(() => null) : null;
    if (!m) {
      current = null;
      saved.making = null;
      await persist();
      return;
    }
    current.phase = m.phase;
    current.paused = Boolean(m.paused);
    current.etaMinutes = Number.isFinite(m.etaSeconds) ? m.etaSeconds / 60 : current.etaMinutes;
    current.shots = (m.shots || []).length;
    current.shotsDone = (m.shots || []).filter((s) => s.status === 'done').length;
    current.etaSeconds = m.etaSeconds ?? null;
    if (m.running) return;
    if (m.phase === 'done' && m.render?.itemId) {
      const { idea, startedAt, movieId } = current;
      current = null;
      saved.making = null;
      const { qid: _q, planned: _p, ...rest } = idea;
      const record = { id: m.render.itemId, movieId, ...rest, seconds: m.length || MOVIE_SECONDS, madeMs: now() - startedAt, createdAt: new Date(now()).toISOString(), status: 'judging', nsfw: Boolean(idea.spicyLean) || undefined };
      saved.records.push(record);
      saved.records = saved.records.slice(-200);
      await persist();
      if (ownerBusy()) {
        record.status = 'made';
        await persist();
        return; // judged later, after your job
      }
      await finishJudging(record);
      return;
    }
    if (m.phase === 'error') {
      lastError = `"${current.idea.title}" could not be made: ${m.error || 'unknown problem'}`;
      await dropCurrent();
      plan();
      await persist();
      return;
    }
    // Stopped (the machine restarted under it): carry on where it was, once you are not using it.
    if (!ownerBusy()) {
      await o.movies.run(current.movieId).catch(async (err) => {
        lastError = err.message;
        await dropCurrent();
        await persist();
      });
    }
  }

  const find = (id) => saved.queue.findIndex((q) => q.qid === id);

  return {
    tick,
    start(everyMs = 30_000) {
      const t = setInterval(() => void tick(), everyMs);
      t.unref?.();
    },
    async state() {
      await ensureLoaded();
      const live = new Map((await studio.labItems().catch(() => [])).map((i) => [i.id, i]));
      // The NSFW check's answer lives on the video itself (studio.js): pass it along for the blur.
      const records = saved.records
        .filter((r) => live.has(r.id))
        .map((r) => (live.get(r.id).nsfw ? { ...r, nsfw: true } : r))
        .reverse();
      const job = current?.jobId ? studio.job(current.jobId) : null;
      const movie = current?.movieId
        ? { id: current.movieId, phase: current.phase || 'story', paused: Boolean(current.paused), shots: current.shots || 0, shotsDone: current.shotsDone || 0, etaSeconds: current.etaSeconds ?? null, seconds: MOVIE_SECONDS }
        : null;
      return {
        enabled: saved.enabled,
        style: saved.style,
        topics: saved.topics,
        quietMinutes,
        readyScore,
        minutesPerVideo: minutesPerVideo(),
        minutesLeft: Math.max(0, Math.round(Number(minutesLeft()) || 0)),
        making: current ? { title: current.idea.title, topic: current.idea.topic || null, prompt: current.idea.prompt.replace(ADULT_NOTE, ''), job, movie, nsfw: Boolean(current.idea.spicyLean) || undefined } : null,
        queue: saved.queue.map(({ qid: id, title, prompt, topic, yours, kind, length, look, spicyLean }) => ({
          id,
          title,
          prompt: String(prompt).replace(ADULT_NOTE, ''),
          topic: topic || null,
          yours: Boolean(yours),
          ...(kind === 'movie' ? { kind: 'movie', seconds: length || MOVIE_SECONDS, look: look || '', nsfw: Boolean(spicyLean) || undefined } : {}),
        })),
        madeLastHour: madeLastHour(),
        lastError,
        records,
      };
    },
    /** { enabled?, style?, topics? } */
    async configure({ enabled, style, topics } = {}) {
      await ensureLoaded();
      if (Array.isArray(topics)) {
        const clean = topics.map((t) => String(t).trim().slice(0, 60)).filter(Boolean);
        const bad = clean.find((t) => mentionsMinor(t) || ((style ?? saved.style) === 'spicy' && spicyProblem(t)));
        if (bad) throw Object.assign(new Error(spicyProblem(bad) || 'Lab topics can never be about kids or teens.'), { status: 422 });
      }
      if (STYLES.includes(style) && style !== saved.style) {
        saved.style = style;
        if (!Array.isArray(topics)) topics = saved.topics;
        await dropCurrent();
        // Your own ideas belong to the style you wrote them for.
        saved.queue = [];
        if (style === 'yours') profile = (await o.profile?.current().catch(() => null)) || profile;
      }
      if (typeof enabled === 'boolean') {
        saved.enabled = enabled;
        if (!enabled) await dropCurrent();
      }
      if (Array.isArray(topics)) {
        saved.topics = [...new Set(topics.map((t) => String(t).trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
        // Planned ideas follow the new topics; the ones you wrote stay.
        saved.queue = saved.queue.filter((q) => q.yours);
        if (saved.enabled) plan();
      }
      await persist();
    },
    async setEnabled(on) {
      await this.configure({ enabled: Boolean(on) });
      return saved.enabled;
    },
    /** Stop the video being made now (the next idea starts on the next tick). */
    async cancelCurrent() {
      const had = await dropCurrent();
      if (had) await persist();
      return had;
    },
    /** Your own idea, made next. */
    async addIdea({ title, prompt }) {
      await ensureLoaded();
      const p = String(prompt || title || '').trim().slice(0, 1500);
      if (!p) return false;
      if (yours()) {
        // Your own idea for a 30-second movie: the look comes from your style.
        const problem = yoursProblem(`${title || ''} ${p}`, { spicy: yoursSpicy() });
        if (problem) throw Object.assign(new Error(problem), { status: 422 });
        const seed = draftMovieIdea(profile, rand);
        saved.queue.unshift({ qid: qid(), ...seed, title: String(title || p).trim().slice(0, 120), prompt: p, caption: String(title || p).slice(0, 200), ...(yoursSpicy() ? { spicyLean: true } : {}), yours: true });
        await persist();
        return true;
      }
      const problem = spicy() ? spicyProblem(`${title || ''} ${p}`) : null;
      if (problem) throw Object.assign(new Error(problem), { status: 422 });
      const tags = spicy() ? ['#fitcheck', '#aesthetic', '#fyp'] : ['#comedy', '#meme', '#fyp'];
      saved.queue.unshift({ qid: qid(), format: 'yours', style: saved.style, topic: null, title: String(title || p).trim().slice(0, 120), prompt: spicy() ? p + ADULT_NOTE : p, caption: String(title || p).slice(0, 200), hashtags: tags, yours: true });
      await persist();
      return true;
    },
    async editIdea(id, { title, prompt }) {
      await ensureLoaded();
      const i = find(id);
      if (i < 0) return false;
      const q = saved.queue[i];
      const problem = q.style === 'spicy' ? spicyProblem(`${title ?? ''} ${prompt ?? ''}`) : q.style === 'yours' ? yoursProblem(`${title ?? ''} ${prompt ?? ''}`, { spicy: Boolean(q.spicyLean) }) : null;
      if (problem) throw Object.assign(new Error(problem), { status: 422 });
      if (prompt != null && q.style === 'spicy' && !String(prompt).includes(ADULT_NOTE.trim())) prompt = String(prompt).trim().slice(0, 1500 - ADULT_NOTE.length) + ADULT_NOTE;
      if (title != null) q.title = String(title).trim().slice(0, 120) || q.title;
      if (prompt != null) q.prompt = String(prompt).trim().slice(0, 1500) || q.prompt;
      q.yours = true;
      await persist();
      return true;
    },
    async removeIdea(id) {
      await ensureLoaded();
      const i = find(id);
      if (i < 0) return false;
      saved.queue.splice(i, 1);
      await persist();
      return true;
    },
    async makeNext(id) {
      await ensureLoaded();
      const i = find(id);
      if (i < 0) return false;
      saved.queue.unshift(...saved.queue.splice(i, 1));
      await persist();
      return true;
    },
    /** Move a lab video into the main gallery. */
    async keep(id) {
      await ensureLoaded();
      const record = saved.records.find((r) => r.id === id);
      const ok = await studio.promote(id);
      // A movie in your style moves into soReal too, to open and change like your own.
      if (ok && record?.movieId) await o.movies?.adopt(record.movieId).catch(() => false);
      if (ok) {
        saved.records = saved.records.filter((r) => r.id !== id);
        await persist();
      }
      return ok;
    },
    async remove(id) {
      await ensureLoaded();
      const record = saved.records.find((r) => r.id === id);
      saved.records = saved.records.filter((r) => r.id !== id);
      await persist();
      // A movie goes with its storyboard and shots.
      if (record?.movieId && o.movies) await o.movies.remove(record.movieId).catch(() => {});
      return (await studio.remove(id)) || Boolean(record?.movieId);
    },
    /** What you wrote or kept in the Lab, for your style (style.js). */
    async ownIdeas() {
      await ensureLoaded();
      return [...saved.queue, ...saved.records].filter((q) => q.yours).map((q) => ({ title: q.title, prompt: String(q.prompt || '').replace(ADULT_NOTE, ''), createdAt: q.createdAt || '' }));
    },
    /** Your style: the profile, as the Lab panel shows it. */
    async profile() {
      if (!o.profile) throw Object.assign(new Error('Your style is not available on this machine.'), { status: 404 });
      return o.profile.get();
    },
    /** { summary?, remove?, restore? }: your edits steer your style, and the planned movies follow. */
    async editProfile(edit) {
      if (!o.profile) throw Object.assign(new Error('Your style is not available on this machine.'), { status: 404 });
      const view = await o.profile.edit(edit);
      await ensureLoaded();
      await replanYours();
      return view;
    },
    /** Build your style again now (in the background: the chat model can take a minute). */
    async rebuildProfile({ wait = false } = {}) {
      if (!o.profile) throw Object.assign(new Error('Your style is not available on this machine.'), { status: 404 });
      await ensureLoaded();
      const done = o.profile.rebuild().then(() => replanYours());
      done.catch((err) => log.warn?.(`[lab] could not rebuild your style: ${err.message}`));
      if (wait) await done;
      return o.profile.get();
    },
  };
}
