// Lab remixes: the Lab reads what you made in Make (your words, the maker, the size and the style you
// picked) and makes new pictures and short videos from it, one after another: each one your prompt
// rewritten in a creative new way by the chat model on this machine (a new moment, angle, place or
// twist), made with the same maker, size and style so it looks like yours. Pictures take about a
// minute, so the Lab makes many. Used by memes.js (the Lab's "Remix" style).

/** What the Lab makes from your prompts: both (as you made them), only pictures, or only videos. */
export const MIXES = ['both', 'pictures', 'videos'];
/** A remixed video is this long (seconds): short clips, so there can be many. */
export const CLIP_SECONDS = 5;
/** How many of your newest prompts it remixes from (your style now, not a year ago). */
const MAX_SOURCES = 40;

const clean = (s, max = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** portrait · landscape · square, from a picture's width and height. */
export function sizeOf(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0 && h > 0)) return 'square';
  if (h / w > 1.15) return 'portrait';
  if (w / h > 1.15) return 'landscape';
  return 'square';
}

/**
 * Your prompts to remix, newest first, one per wording: pictures and videos you made in Make with a
 * picture or video maker that is installed here, from words alone (a remix has no photo to start
 * from, so ones made from a photo, edits and Lab work are left out).
 *   items    gallery items (studio.items): { id, kind, maker, prompt, width, height, style, fromImage, photo, lab, movie, nsfw, createdAt }
 *   makers   studio.makers(): { id, kind, installed }
 */
export function remixSources(items = [], makers = []) {
  const ok = new Map(makers.filter((m) => m && m.installed && (m.kind === 'image' || m.kind === 'video')).map((m) => [m.id, m.kind]));
  const seen = new Set();
  const out = [];
  for (const it of [...items].sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))) {
    if (!it || it.lab || it.movie || it.fromImage || it.photo || it.owner) continue;
    const kind = ok.get(it.maker);
    if (!kind || (kind === 'image') !== (it.kind === 'image')) continue;
    const prompt = clean(it.prompt);
    if (prompt.length < 3 || seen.has(prompt.toLowerCase())) continue;
    seen.add(prompt.toLowerCase());
    out.push({ id: it.id, kind: kind === 'image' ? 'picture' : 'clip', maker: it.maker, prompt, size: sizeOf(it.width, it.height), style: it.style || null, nsfw: Boolean(it.nsfw) });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/** The sources the mix allows. */
export const forMix = (sources, mix = 'both') => sources.filter((s) => mix === 'both' || (mix === 'pictures' ? s.kind === 'picture' : s.kind === 'clip'));

/**
 * The next prompt to remix: the one remixed least so far (newest first among equals), so every
 * prompt gets its turn and your newest ones lead. `done`: { sourceId: times remixed }.
 */
export function pickSource(sources, done = {}) {
  let best = null;
  for (const s of sources) if (!best || (done[s.id] || 0) < (done[best.id] || 0)) best = s;
  return best;
}

/** The creative turn each remix takes, in order, so the same prompt comes back different every time. */
export const TWISTS = [
  'the same subject at a different moment: just before or just after what they described',
  'a new place that fits their world, with the same look and mood',
  'a bold new camera angle and framing: a close-up detail, a wide shot or from above',
  'a different time of day, season or weather that changes the light',
  'a surprising twist on the idea that still feels like theirs',
  'a new character or creature in the same world, in the same style',
  'the same idea pushed further: bigger, stranger, more dramatic',
  'a quieter, more intimate version of the same idea',
];
/** The same turns, in plain words, for when there is no chat model to rewrite the prompt. */
const WRITTEN = [
  'A moment later.',
  'In a new place with the same look and mood.',
  'Seen from a bold new angle, close up.',
  'At golden hour, in different light.',
  'With a surprising twist.',
  'With a new character in the same world.',
  'Bigger and more dramatic.',
  'A quieter, more intimate take.',
];

const short = (t, n = 48) => {
  const s = clean(t, 400);
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/** A planned remix of one of your prompts (the chat model rewrites it just before it is made). */
export function planRemix(source, turn = 0) {
  const n = ((turn % TWISTS.length) + TWISTS.length) % TWISTS.length;
  return {
    format: 'remix',
    style: 'remix',
    kind: source.kind,
    twist: n,
    source: { id: source.id, kind: source.kind, maker: source.maker, prompt: source.prompt, size: source.size, style: source.style || null },
    title: `Remix: ${short(source.prompt, 40)}`,
    // Made as written if there is no chat model: your words with the turn.
    prompt: `${source.prompt.replace(/[.\s]+$/, '')}. ${WRITTEN[n]}`,
    caption: short(source.prompt, 110),
    hashtags: ['#aiart', '#remix', '#fyp'],
    ...(source.nsfw ? { nsfw: true } : {}),
  };
}

export const REMIX_SYSTEM =
  'You remake one creator’s prompt for an AI picture or video maker in a creative new way. ' +
  'Keep what makes it theirs: the subject matter, the art style or medium, the look (light, colour, lens), the mood, and how they write (about the same length and detail). ' +
  'Change it the way you are asked, so it is a new piece and not a copy. For a video, say what moves in one 5-second shot. ' +
  'Never anyone under 18, no real or famous people, no brands, no text on screen. ' +
  'Answer only with JSON: {"title": 2 to 6 words, "prompt": the new prompt, "caption": post caption under 120 characters, "hashtags": 3 to 5 hashtags}.';

/** The chat model's request for one remix. */
export function remixMessages(idea, { summary = '', recent = [] } = {}) {
  const what = idea.kind === 'clip' ? `a ${CLIP_SECONDS}-second video` : 'a picture';
  const user =
    `Their prompt (for ${what}): ${idea.source.prompt}\n` +
    `Remake it as ${TWISTS[idea.twist] || TWISTS[0]}.` +
    (summary ? `\nTheir style in general: ${summary}` : '') +
    (recent.length ? `\nAlready made from it, don't repeat: ${recent.join(' | ')}` : '');
  return { system: REMIX_SYSTEM, user };
}

export const REMIX_SCORE_SYSTEM =
  'You judge remixes: new pictures and short videos made from one creator’s own prompts. Look at it, their original prompt and the remix, then score from 0 to 100 how striking and shareable it is ' +
  '(stopping power at first sight, how fresh it is next to their original while keeping their style, visual quality). Be strict: 80+ is rare. ' +
  'Answer only with JSON: {"score": number, "why": one sentence, "better_caption": optional improved caption}.';
