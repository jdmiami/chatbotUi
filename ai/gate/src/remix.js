// Your own prompts from Make, as the Lab reads them (promptlab.js): your words, the maker, the size and
// the style you picked, so what the Lab writes in your style is made the way you make things.

/** What the Lab makes from your prompts: both (as you made them), only pictures, or only videos. */
export const MIXES = ['both', 'pictures', 'videos'];
/** A Lab video is this long (seconds): short clips, so there can be many. */
export const CLIP_SECONDS = 5;
/** How many of your newest prompts the Lab reads (your style now, not a year ago). */
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
 * Your prompts for the Lab, newest first, one per wording: pictures and videos you made in Make with a
 * picture or video maker that is installed here, from words alone (the Lab has no photo to start
 * from, so ones made from a photo, edits and Lab work are left out).
 *   items    gallery items (studio.items): { id, kind, maker, prompt, width, height, style, fromImage, photo, lab, movie, nsfw, createdAt }
 *   makers   studio.makers(): { id, kind, installed }
 *   anyMaker  count prompts made with any maker, installed here or not
 */
export function remixSources(items = [], makers = [], { anyMaker = false } = {}) {
  const ok = new Map(makers.filter((m) => m && m.installed && (m.kind === 'image' || m.kind === 'video')).map((m) => [m.id, m.kind]));
  const seen = new Set();
  const out = [];
  for (const it of [...items].sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))) {
    if (!it || it.lab || it.movie || it.fromImage || it.photo || it.owner) continue;
    // anyMaker: every prompt of yours counts, whatever made it (the Lab learns your style from all of them).
    const kind = anyMaker ? (it.kind === 'image' || it.kind === 'video' ? it.kind : null) : ok.get(it.maker);
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
