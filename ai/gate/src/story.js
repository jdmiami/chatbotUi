// soReal: writing a movie from one line. A chat model on the AI machine turns the idea into a story
// (the shots, what the picture looks like where each shot ends, a lead character, a style and the
// sound); when no chat model answers, a plain story is made from the idea so the movie still gets
// made. Everything the movie is made from goes through the studio's content rules.
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, blockedForPhoto, blockedPrompt } from './studio.js';

/** Quick starts: what each kind of movie asks the writer for, and its usual look and sound. */
export const TEMPLATES = {
  trailer: {
    name: 'Trailer',
    brief: 'a movie trailer: an intriguing opening, rising tension, a big reveal, and a final striking image',
    look: 'Cinematic, anamorphic widescreen feel, dramatic lighting, film grain',
    sound: 'shots',
  },
  'music-video': {
    name: 'Music video',
    brief: 'a music video: rhythmic movement, striking performance moments and bold visual changes from shot to shot',
    look: 'Stylish, saturated colour, dynamic camera moves, music-video lighting',
    sound: 'music',
  },
  ad: {
    name: 'Ad',
    brief: 'a short advert: show the product or idea in an appealing way, one clear benefit, end on a hero shot',
    look: 'Clean commercial look, bright soft light, shallow depth of field',
    sound: 'music',
  },
  story: {
    name: 'Story',
    brief: 'a short story with a beginning, a turn and an ending, told in pictures',
    look: 'Naturalistic cinematic look, warm light, 35 mm film',
    sound: 'shots',
  },
  comedy: {
    name: 'Comedy',
    brief: 'a short comedy sketch: a setup, an escalating mishap and a funny payoff',
    look: 'Bright, colourful sitcom look, clear staging, expressive faces',
    sound: 'shots',
  },
};

export const SOUNDS = ['shots', 'music', 'quiet'];

/** One line added to every shot so its sound fits the movie (LTX and H3 make sound with each shot). */
export const SOUND_HINT = {
  shots: 'Natural sound, effects and voices that fit the scene.',
  music: 'Sound: music only, no speech.',
  quiet: '',
};

const clean = (s, max = 600) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function storyMessages({ idea, template, count, seconds, lead, look, shape }) {
  const t = TEMPLATES[template];
  const system =
    `You write very short films for an AI video maker. The film has exactly ${count} shots of about ${seconds} seconds each. ` +
    'Every shot is one continuous clip that starts on one still picture and ends on another, and the next shot starts on the picture the last one ended on. ' +
    'For each shot write "action": one or two plain present-tense sentences saying what happens and how the camera moves, and "end": one sentence describing the still picture at the very end of the shot (who is where, framing, light). ' +
    'Also write "opening": the still picture the film starts on. ' +
    'Keep it simple and visual: one clear action per shot, no text on screen, no scene the camera could not film in one take. ' +
    'Do not describe what the lead looks like inside the shots; that is added to every shot. ' +
    'Never write sexual content involving minors. ' +
    'Reply with only JSON: {"title": "...", "lead": "the main character in one sentence (looks, age as an adult, clothes), or empty if there is none", ' +
    '"look": "the visual style in one short line", "sound": "shots" (natural sound and voices) or "music" (music only) or "quiet", ' +
    '"opening": "...", "shots": [{"action": "...", "end": "..."}]}';
  const user = [
    `The movie: ${clean(idea, 2000)}`,
    t ? `Kind of movie: ${t.brief}.` : '',
    lead ? `The lead: ${clean(lead)}` : '',
    look ? `Style: ${clean(look)}` : '',
    `Shape: ${shape === 'portrait' ? 'vertical 9:16, framed for a phone' : 'wide 16:9'}.`,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

/** Read the writer's answer: JSON (possibly wrapped in prose or a code block), or else a numbered list. */
export function parseStory(reply, count) {
  const text = String(reply || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const obj = /\{[\s\S]*\}/.exec(text);
  let v = null;
  if (obj) {
    try {
      v = JSON.parse(obj[0]);
    } catch {
      v = null;
    }
  }
  let shots = [];
  if (v && Array.isArray(v.shots)) {
    shots = v.shots
      .map((s) => (typeof s === 'string' ? { action: clean(s), end: '' } : { action: clean(s?.action ?? s?.shot ?? s?.text), end: clean(s?.end ?? s?.endFrame ?? s?.last) }))
      .filter((s) => s.action);
  } else {
    shots = text
      .split('\n')
      .map((l) => /^\s*(?:\d+[.):]|[-*•]|shot\s*\d+\s*[:.-])\s*(.+)$/i.exec(l)?.[1]?.trim() ?? '')
      .map((l) => ({ action: clean(l.replace(/^\*\*[^*]+\*\*\s*[:-]?\s*/, '')), end: '' }))
      .filter((s) => s.action);
  }
  if (!shots.length) return null;
  const sound = SOUNDS.includes(v?.sound) ? v.sound : null;
  return {
    title: clean(v?.title, 120),
    lead: clean(v?.lead),
    look: clean(v?.look, 300),
    sound,
    opening: clean(v?.opening),
    shots: fitCount(shots, count),
  };
}

/** Exactly `count` shots: extra ones are dropped, missing ones continue the last. */
function fitCount(shots, count) {
  const out = shots.slice(0, count);
  while (out.length < count) {
    const last = out[out.length - 1];
    out.push({ action: `${last.action.replace(/\.$/, '')}, and the moment carries on as the camera slowly pulls back.`, end: '' });
  }
  return out;
}

const CAMERA = [
  'Wide establishing shot, the camera slowly pushes in.',
  'Medium shot, the camera tracks alongside.',
  'Close-up, the camera holds steady on the key moment.',
  'Low angle, the camera rises as the action builds.',
  'Over-the-shoulder shot, the camera drifts around.',
  'Wide shot, the camera pulls back to end the scene.',
];

/** A plain story from the idea alone (no chat model on the machine): the same idea, shot by shot. */
export function fallbackStory({ idea, template, count }) {
  const t = TEMPLATES[template];
  const base = clean(idea, 400).replace(/[.!?]+$/, '') || 'A short film';
  const shots = Array.from({ length: count }, (_, i) => {
    const cam = i === count - 1 ? CAMERA[5] : CAMERA[i % 5];
    const stage = i === 0 ? 'It begins' : i === count - 1 ? 'It ends' : 'It continues';
    return { action: `${base}. ${stage}. ${cam}`, end: '' };
  });
  return { title: clean(idea, 60) || 'Untitled movie', lead: '', look: t?.look || '', sound: t?.sound || null, opening: '', shots };
}

/**
 * @param o.chat async ({ system, user }) => reply text (a chat model on this machine)
 */
export function createWriter({ chat, log = console } = {}) {
  /** The story for a movie; never throws for a missing or confused chat model (falls back). */
  return async function write(args) {
    if (chat) {
      try {
        const reply = await chat(storyMessages(args));
        const story = parseStory(reply, args.count);
        if (story) return { ...story, by: 'ai' };
        log.warn?.('[movies] the chat model wrote no shots; using a plain story');
      } catch (err) {
        log.warn?.(`[movies] could not write the story with a chat model: ${err.message}`);
      }
    }
    return { ...fallbackStory(args), by: 'plain' };
  };
}

/**
 * The content rules for everything a movie is made from: never sexual content involving minors,
 * and nothing sexual or undressing when the lead is an uploaded photo. Throws a 422 like the studio.
 */
export function checkMovieText(texts, { photo = false } = {}) {
  const all = texts.filter(Boolean).map(String);
  if (all.some((t) => blockedPrompt(t)) || blockedPrompt(all.join('\n'))) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 422, blocked: true });
  if (photo && all.some((t) => blockedForPhoto(t))) throw Object.assign(new Error(PHOTO_MESSAGE), { status: 422, blocked: true });
}
