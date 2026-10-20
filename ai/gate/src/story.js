// soReal: writing a movie from one line. A chat model on the AI machine turns the idea into a story
// (the shots, what the picture looks like where each shot ends, a lead character, a style and the
// sound); when no chat model answers, a plain story is made from the idea so the movie still gets
// made. Everything the movie is made from goes through the studio's content rules.
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, blockedForPhoto, blockedPrompt } from './studio.js';
import { wordBudget } from './prompting.js';

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
    brief: 'a music video: the lead sings short lyric lines to camera, with rhythmic movement, striking performance moments and bold visual changes from shot to shot',
    look: 'Stylish, saturated colour, dynamic camera moves, music-video lighting',
    sound: 'shots',
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

// The sound of a shot is written inside its prompt for the maker that makes it (prompting.js): what
// people say or sing is the shot's "says", and the rest is described as the audio.

/** A shot's spoken or sung lines as plain text, one per line (the writer gives a list or a string). */
const saysText = (v) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map((x) => clean(typeof x === 'string' ? x : x?.who ? `${x.who}${x.how ? `, ${x.how}` : ''}: "${x.line ?? x.text ?? ''}"` : (x?.line ?? x?.text ?? ''), 300))
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');

const clean = (s, max = 600) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function storyMessages({ idea, template, count, seconds, lead, look, shape, sound }) {
  const t = TEMPLATES[template];
  const speech = wordBudget(seconds);
  const sung = wordBudget(seconds, true);
  const voices =
    sound === 'music' || sound === 'quiet'
      ? 'Nobody speaks or sings in this film: leave "says" empty in every shot. '
      : `The video maker makes the sound with the picture, so people's words go in the film as text. For each shot write "says": a list of the lines spoken or sung in that shot (empty when nobody talks), each written exactly as \`Name, how it is said: "the words"\` or, for a song, \`Name sings, how: "the lyric"\`. ` +
        `Use the character's name, or "Narrator" for an unseen voice. Say how it sounds in a few words (softly, a tired whisper, shouting over the crowd, warm and low). ` +
        `Keep it short: at most 2 lines per shot and about ${speech} spoken words in all (${sung} if sung) so they finish before the shot does. ` +
        'Real people talk in short phrases, so break long ideas into small lines; never put stage directions or emotions inside the quotation marks. ' +
        'Write the words in the language of the idea. Not every shot needs words: silence and action also tell a story. ';
  const system =
    `You write very short films for an AI video maker. The film has exactly ${count} shots of about ${seconds} seconds each. ` +
    'Every shot is one continuous clip that starts on one still picture and ends on another, and the next shot starts on the picture the last one ended on. ' +
    'For each shot write "action": one to three plain present-tense sentences, in this order: who or what is in the shot, what they do, and how the camera moves (for example: slow push in, tracks alongside, handheld, static frame, over the shoulder). ' +
    'Use concrete actions (walks, turns, lifts, pours), not feelings: show sadness with a visible cue instead of writing that someone feels sad. Never write the words of a line inside "action". ' +
    'Also write "end": one sentence describing the still picture at the very end of the shot (who is where, framing, light). ' +
    'Also write "opening": the still picture the film starts on. ' +
    'Keep it simple and visual: one clear action per shot, no text on screen, no logos, no scene the camera could not film in one take, no crowds of characters acting at once. ' +
    voices +
    'Do not describe what the lead looks like inside the shots; that is added to every shot. ' +
    'Never write sexual content involving minors. ' +
    'Reply with only JSON: {"title": "...", "lead": "the main character in one sentence (looks, age as an adult, clothes), or empty if there is none", ' +
    '"look": "the visual style in one short line", "sound": "shots" (natural sound and voices) or "music" (music only) or "quiet", ' +
    '"opening": "...", "shots": [{"action": "...", "says": ["Name, how: \\"words\\""], "end": "..."}]}';
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
      .map((s) => (typeof s === 'string' ? { action: clean(s), end: '', says: '' } : { action: clean(s?.action ?? s?.shot ?? s?.text), end: clean(s?.end ?? s?.endFrame ?? s?.last), says: saysText(s?.says ?? s?.dialogue) }))
      .filter((s) => s.action);
  } else {
    shots = text
      .split('\n')
      .map((l) => /^\s*(?:\d+[.):]|[-*•]|shot\s*\d+\s*[:.-])\s*(.+)$/i.exec(l)?.[1]?.trim() ?? '')
      .map((l) => ({ action: clean(l.replace(/^\*\*[^*]+\*\*\s*[:-]?\s*/, '')), end: '', says: '' }))
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
    out.push({ action: `${last.action.replace(/\.$/, '')}, and the moment carries on as the camera slowly pulls back.`, end: '', says: '' });
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
    return { action: `${base}. ${stage}. ${cam}`, end: '', says: '' };
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
