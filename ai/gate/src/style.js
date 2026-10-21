// "Your style": a short profile of how the owner writes their own prompts, so the Lab can make
// 30-second movies that look like theirs. It reads what the owner wrote on this machine (gallery
// prompts, soReal movies, the Lab ideas they wrote or kept) and asks the chat model on this machine
// (the same one the Lab and soReal's story writer use) to sum it up. Nothing leaves the machine: no
// cloud AI is asked. With no chat model installed, a plain word count builds the profile instead.
//
// The profile is JSON (see EMPTY): what the owner keeps coming back to, how it looks, how it feels,
// how it sounds, and what they never ask for; plus a summary in plain words they can read and edit.
// Edits steer it: an edited summary is handed to the idea writer, and the next rebuild keeps it.
import { mentionsMinor } from './studio.js';

/** The fields of a profile; every one is a short list of short phrases. */
export const FIELDS = ['subjects', 'characters', 'settings', 'light', 'colour', 'lens', 'camera', 'mood', 'genre', 'pacing', 'sound', 'voice', 'words', 'never'];
const EMPTY = () => Object.fromEntries(FIELDS.map((k) => [k, []]));

/** Rebuilt when this many new prompts have come in, or once a day when any have. */
export const REBUILD_AFTER = 10;
const DAY_MS = 24 * 3_600_000;
/** At most this many prompts (the newest) go to the chat model. */
const MAX_PROMPTS = 200;
const MAX_CHARS = 14_000;

const clean = (s, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The owner's own prompts, newest first, from what the machine has:
 *   items      gallery items (studio, not Lab): { prompt, createdAt, lab?, movie?, nsfw? }
 *   movies     soReal movies: { idea, look, shots: [{ prompt, says }], lab?, updatedAt }
 *   labIdeas   Lab ideas the owner wrote or kept: { title, prompt, createdAt }
 * Returns [{ text, source, at, nsfw }].
 */
export function gatherPrompts({ items = [], movies = [], labIdeas = [] } = {}) {
  const out = [];
  const add = (text, source, at, nsfw = false) => {
    const t = clean(text);
    if (t.length >= 3) out.push({ text: t, source, at: String(at || ''), nsfw: Boolean(nsfw) });
  };
  for (const it of items) {
    // Lab videos aren't the owner's until kept; a movie's cut is named after the movie (read below).
    if (!it || it.lab || it.movie) continue;
    add(it.prompt, 'gallery', it.createdAt, it.nsfw);
  }
  for (const m of movies) {
    if (!m || m.lab) continue;
    const at = m.updatedAt || m.createdAt;
    add(m.idea, 'movie', at);
    add(m.look, 'movie-look', at);
    for (const s of m.shots || []) {
      add(s.prompt, 'shot', at);
      add(s.says, 'line', at);
    }
  }
  for (const q of labIdeas) add(q.prompt || q.title, 'lab', q.createdAt);
  // The same words written twice count once.
  const seen = new Set();
  return out
    .filter((p) => (seen.has(p.text.toLowerCase()) ? false : seen.add(p.text.toLowerCase())))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------- the plain word count (no chat model)

const STOP = new Set(
  ('a an and the of in on at to for with from by into onto over under is are was were be been being it its this that these those as or but ' +
    'not no so very just then than there their they them he she his her him you your we our i me my mine us who what which while when where ' +
    'up down out off about after before again all any each few more most other some such only own same too can will should now has have had ' +
    'do does did one two three shot shots video picture image make made making scene camera vertical film movie frame first last next like ' +
    'slowly slow very looks look looking says said say sound realistic detailed high quality style').split(' '),
);
/** Words that say which part of the look they are. */
const LEXICON = {
  light: /^(golden|hour|sunset|sunrise|dusk|dawn|neon|backlit|backlight|silhouette|moonlight|candlelight|candle|soft|harsh|rim|glow|glowing|shadows?|noir|daylight|night|studio|lamp|fluorescent|moody|bright|dim|warm|cool)$/,
  colour: /^(red|blue|green|teal|orange|pink|purple|gold|amber|black|white|grey|gray|pastel|saturated|desaturated|monochrome|muted|vivid|colourful|colorful|sepia|cyan|magenta|turquoise)$/,
  lens: /^(anamorphic|35mm|50mm|85mm|wide|telephoto|macro|fisheye|bokeh|shallow|depth|focus|grain|grainy|16mm|8mm|lens|close-up|closeup|portrait)$/,
  camera: /^(dolly|tracking|tracks|handheld|drone|aerial|pan|pans|tilt|zoom|push|pull|orbit|orbiting|crane|static|steadicam|gimbal|whip|pov|overhead|low-angle|angle)$/,
  mood: /^(dreamy|dark|funny|epic|romantic|melancholy|eerie|calm|tense|playful|cozy|cosy|nostalgic|mysterious|joyful|sad|hopeful|gritty|flirty|confident|sensual|chaotic|peaceful|dramatic|whimsical|haunting)$/,
  genre: /^(comedy|horror|thriller|romance|sci-fi|scifi|fantasy|documentary|noir|western|drama|anime|cyberpunk|music|trailer|ad|commercial|fashion|action|mystery|surreal)$/,
  settings: /^(beach|city|street|forest|desert|kitchen|bedroom|rooftop|bar|club|office|gym|pool|ocean|sea|mountains?|space|spaceship|cafe|diner|alley|park|garden|studio|stage|car|train|subway|apartment|loft|hotel|castle|village|jungle|lake|river|snow|rain|island|warehouse|mall|library|church)$/,
  sound: /^(music|synth|piano|guitar|bass|drums|orchestral|ambient|silence|silent|quiet|whisper|whispers|whispering|beat|lofi|jazz|choir|rain|waves|crowd)$/,
};
const FLIRTY = /\b(nude|naked|nsfw|sexy|sex|sexual|erotic\w*|topless|lingerie|seductive|sensual|thirst\s*trap\w*|bikini|swimwear|swimsuit|underwear|lewd|flirty|flirt\w*|provocative|intimate|shirtless|boudoir)\b/i;

/** A profile from counting words: the most used words of each kind, the rest as subjects. */
export function wordProfile(prompts) {
  const counts = new Map();
  for (const p of prompts) {
    const words = p.text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/);
    for (const w of new Set(words)) {
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()].filter(([, n]) => n >= (prompts.length >= 20 ? 2 : 1)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const profile = EMPTY();
  const used = new Set();
  for (const [kind, re] of Object.entries(LEXICON)) {
    profile[kind] = ranked.filter(([w]) => re.test(w)).slice(0, 5).map(([w]) => w);
    profile[kind].forEach((w) => used.add(w));
  }
  const rest = ranked.filter(([w]) => !used.has(w));
  profile.subjects = rest.slice(0, 8).map(([w]) => w);
  profile.words = rest.slice(8, 16).map(([w]) => w);
  const lines = prompts.filter((p) => p.source === 'line').length;
  profile.voice = lines ? [lines > prompts.length / 4 ? 'lots of spoken lines' : 'a few spoken lines'] : ['few or no spoken lines'];
  profile.pacing = [];
  return profile;
}

/** Whether the owner's prompts lean adult and flirty (then the Lab's spicy rules apply to its ideas). */
export function leansSpicy(prompts) {
  if (!prompts.length) return false;
  const flagged = prompts.filter((p) => p.nsfw || FLIRTY.test(p.text)).length;
  return flagged / prompts.length >= 0.25;
}

// ---------------------------------------------------------------- the chat model's profile

export const PROFILE_SYSTEM =
  "You study one person's prompts for an AI image and video maker and describe their personal style, so new short films can be made that feel like theirs. " +
  'Look for what keeps coming back, not one-offs. Use short phrases of 1 to 4 words, at most 6 per list, in the language of the prompts. ' +
  'Never name real people. Answer only with JSON: {' +
  '"subjects": recurring subjects, "characters": recurring characters (what they are like, not names of real people), "settings": places, ' +
  '"light": lighting, "colour": colour palette, "lens": lens and focus, "camera": camera moves, "mood": moods, "genre": genres, ' +
  '"pacing": pacing and editing, "sound": sound and music habits, "voice": how people speak in their films (or "no dialogue"), ' +
  '"words": favourite words they use, "never": things they never ask for, ' +
  '"spicy": true when their prompts are often flirty, sexy or adult, otherwise false, ' +
  '"summary": 2 to 3 plain sentences to the person ("You like ..."), describing their style}.';

export function profileMessages(prompts, { notes = '', removed = [] } = {}) {
  const lines = [];
  let used = 0;
  for (const p of prompts.slice(0, MAX_PROMPTS)) {
    const line = `- (${p.source}) ${p.text}`;
    if (used + line.length > MAX_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  const user = [
    `${lines.length} prompts, newest first:`,
    lines.join('\n'),
    notes ? `\nWhat they say about their own style (follow this over the prompts): ${clean(notes, 1200)}` : '',
    removed.length ? `\nLeave these out, they asked not to use them: ${removed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { system: PROFILE_SYSTEM, user };
}

const list = (v) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : [])
    .map((x) => clean(typeof x === 'string' ? x : x?.name ?? x?.text ?? '', 60))
    .filter(Boolean)
    .slice(0, 8);

/** The chat model's answer as a profile, or null when it isn't one. */
export function parseProfile(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || '').replace(/<think>[\s\S]*?<\/think>/g, ''));
  if (!m) return null;
  let v;
  try {
    v = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const profile = EMPTY();
  // Some models nest the look: { look: { light, colour, ... } }.
  const look = v.look && typeof v.look === 'object' ? v.look : {};
  for (const k of FIELDS) profile[k] = list(v[k] ?? look[k] ?? (k === 'colour' ? (v.color ?? look.color) : undefined));
  if (!FIELDS.some((k) => profile[k].length)) return null;
  return { profile, summary: clean(v.summary, 600), spicy: v.spicy === true };
}

/** A summary in plain words from the profile (when the chat model wrote none). */
export function summaryOf(p) {
  const join = (a, n = 3) => a.slice(0, n).join(', ');
  const parts = [];
  if (p.subjects.length) parts.push(`You keep coming back to ${join(p.subjects)}`);
  if (p.settings.length) parts.push(`often in places like ${join(p.settings, 2)}`);
  const look = [...p.light, ...p.colour, ...p.lens].slice(0, 3);
  if (look.length) parts.push(`with a ${look.join(', ')} look`);
  if (p.mood.length) parts.push(`and a ${join(p.mood, 2)} feel`);
  return parts.length ? `${parts.join(', ')}.` : 'Not enough of your own prompts yet to tell your style.';
}

/** Drop chips the owner removed (and anything about kids or teens, which the Lab never uses). */
function prune(profile, removed) {
  const gone = new Set(removed.map((r) => r.toLowerCase()));
  const out = EMPTY();
  for (const k of FIELDS) out[k] = (profile[k] || []).filter((x) => !gone.has(String(x).toLowerCase()) && (k === 'never' || !mentionsMinor(x)));
  return out;
}

/** The chips the Lab shows: the top subjects and looks the profile picked up. */
export function chipsOf(p) {
  const chips = [];
  for (const t of [...p.subjects, ...p.characters].slice(0, 6)) chips.push({ kind: 'subject', text: t });
  for (const t of [...p.light, ...p.colour, ...p.lens, ...p.camera].slice(0, 6)) chips.push({ kind: 'look', text: t });
  for (const t of p.mood.slice(0, 3)) chips.push({ kind: 'mood', text: t });
  return chips;
}

/**
 * o: {
 *   sources   async () => ({ items, movies, labIdeas }) (see gatherPrompts)
 *   chat      async ({ system, user }) => text (the chat model on this machine), or null
 *   load / save   async () => saved | async (saved) => void
 * }
 */
export function createStyleProfile(o) {
  const { log = console, now = Date.now } = o;
  let saved = null; // { profile, summary, edited, removed, count, builtAt, by, spicy, seen }
  let loaded = false;
  let building = null;
  let checkedAt = 0;
  let lastError = null;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const s = await o.load?.();
      if (s && typeof s === 'object' && s.profile) {
        saved = {
          profile: prune({ ...EMPTY(), ...s.profile }, []),
          summary: clean(s.summary, 1200),
          edited: Boolean(s.edited),
          removed: Array.isArray(s.removed) ? s.removed.map((x) => clean(x, 60)).filter(Boolean).slice(0, 100) : [],
          count: Number(s.count) || 0,
          builtAt: s.builtAt || null,
          by: s.by === 'ai' ? 'ai' : 'words',
          spicy: Boolean(s.spicy),
        };
      }
    } catch {
      /* first run */
    }
  }
  const persist = () => Promise.resolve(o.save?.(saved)).catch((err) => log.warn?.(`[style] could not save: ${err.message}`));

  async function prompts() {
    return gatherPrompts((await o.sources?.().catch((err) => (log.warn?.(`[style] could not read your prompts: ${err.message}`), null))) || {});
  }

  /** Build the profile again from every prompt there is now. */
  function rebuild() {
    building ??= (async () => {
      try {
        await ensureLoaded();
        const all = await prompts();
        const removed = saved?.removed || [];
        const notes = saved?.edited ? saved.summary : '';
        let result = null;
        if (o.chat && all.length) {
          try {
            result = parseProfile(await o.chat(profileMessages(all, { notes, removed })));
            if (!result) log.warn?.('[style] the chat model wrote no profile; counting words instead');
          } catch (err) {
            log.warn?.(`[style] the chat model could not build your style, counting words instead: ${err.message}`);
          }
        }
        const by = result ? 'ai' : 'words';
        const profile = prune(result ? result.profile : wordProfile(all), removed);
        saved = {
          profile,
          // Your own words stay until you change them.
          summary: saved?.edited ? saved.summary : result?.summary || summaryOf(profile),
          edited: Boolean(saved?.edited),
          removed,
          count: all.length,
          builtAt: new Date(now()).toISOString(),
          by,
          spicy: Boolean(result?.spicy) || leansSpicy(all),
        };
        lastError = null;
        await persist();
        return view();
      } catch (err) {
        lastError = err.message;
        throw err;
      } finally {
        building = null;
      }
    })();
    return building;
  }

  /** Rebuild when 10+ new prompts arrived, or a day passed with any new; checked at most every 10 minutes. */
  async function maybeRebuild({ force = false } = {}) {
    await ensureLoaded();
    if (!force && now() - checkedAt < 10 * 60_000) return false;
    checkedAt = now();
    if (!saved) {
      await rebuild();
      return true;
    }
    const n = (await prompts()).length;
    const fresh = n - saved.count;
    const old = now() - Date.parse(saved.builtAt || 0) > DAY_MS;
    if (fresh >= REBUILD_AFTER || (old && fresh > 0)) {
      await rebuild();
      return true;
    }
    return false;
  }

  function view() {
    if (!saved) return { ready: false, building: Boolean(building), summary: '', edited: false, count: 0, builtAt: null, by: null, spicy: false, profile: EMPTY(), chips: [], removed: [], lastError };
    return { ready: true, building: Boolean(building), summary: saved.summary, edited: saved.edited, count: saved.count, builtAt: saved.builtAt, by: saved.by, spicy: saved.spicy, profile: saved.profile, chips: chipsOf(saved.profile), removed: saved.removed, lastError };
  }

  return {
    async get() {
      await ensureLoaded();
      return view();
    },
    /** The profile for writing ideas (null before the first build). */
    async current() {
      await ensureLoaded();
      return saved ? { ...saved.profile, summary: saved.summary, edited: saved.edited, spicy: saved.spicy } : null;
    },
    rebuild,
    maybeRebuild,
    /** { summary?, remove?: [chip text], restore?: [chip text] }: your edits steer the profile. */
    async edit({ summary, remove, restore } = {}) {
      await ensureLoaded();
      if (!saved) await rebuild();
      if (typeof summary === 'string') {
        const s = clean(summary, 1200);
        if (mentionsMinor(s)) throw Object.assign(new Error('Your style can never be about kids or teens: the Lab only makes films about adults.'), { status: 422 });
        saved.summary = s || summaryOf(saved.profile);
        saved.edited = Boolean(s);
      }
      if (Array.isArray(remove)) saved.removed = [...new Set([...saved.removed, ...remove.map((x) => clean(x, 60)).filter(Boolean)])].slice(-100);
      if (Array.isArray(restore)) {
        const back = new Set(restore.map((x) => clean(x, 60).toLowerCase()));
        saved.removed = saved.removed.filter((x) => !back.has(x.toLowerCase()));
      }
      saved.profile = prune(saved.profile, saved.removed);
      await persist();
      return view();
    },
  };
}
