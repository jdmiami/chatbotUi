// Characters: fictional adults made from words, saved with a reference sheet (the same person seen
// from the front, a three-quarter angle, the side, the back and up close, plus expressions and other
// outfits), so a prompt, a video's first frame or "Swap a person" can use the same person again.
//
// What a character is, and is not:
//   - Made from words only. There is no way to turn a photo into a character: uploads stay ordinary
//     photo inputs with the photo rules (studio.js).
//   - A fictional adult: 25 or older, no kids, teens, school or young looks, nobody real or famous,
//     and nothing sexual (the sheet is clothed and neutral; adult content is handled elsewhere).
//
// The store keeps one folder per character (character.json and its sheet pictures) under `dir`, and a
// copy in R2 when R2 is used (the same bucket as the gallery, under characters/), so the library still
// lists with the AI machine off (the site reads it: lib/characters.ts).
//
// The sheet is made on the AI machine with the makers that already exist: the text-to-picture maker
// that matches the look makes the front view, then "New angle" and "Edit with words" make every other
// view *from that front picture*, with one locked seed and one locked description. A vision model on
// the machine, when there is one, then checks that each view is the same person and remakes the ones
// that are not.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { mentionsMinor } from './studio.js';
import { createMirror } from './r2.js';
import { GENDER_WORDS, STYLE_WORDS, descriptorOf, plainText } from './characterPrompt.js';

export const MIN_AGE = 25;
export const MAX_AGE = 120;
/** The most characters one person keeps (a character's sheet is a dozen pictures). */
export const MAX_CHARACTERS = 60;
export const ADULT_FICTIONAL_NOTE = 'Characters are made-up adults (25 or older), made here from words.';

const newId = () => crypto.randomBytes(9).toString('base64url');
const ID = /^[A-Za-z0-9_-]{6,40}$/;

// ---------------------------------------------------------------- the rules

/** Cues for a young look or a young setting, on top of mentionsMinor (studio.js). */
const YOUNG = [
  /\b(looks?|looking|looked|appears?|appearing|seems?|seeming|passes?|passing)\s+(very\s+|quite\s+|rather\s+|a\s+bit\s+|a\s+little\s+)?(young|younger|youthful|juvenile|childlike|child-like|innocent|underage|under-age|like\s+a\s+(kid|child|teen|girl|boy|student|minor)|a\s+(kid|child|teen\w*|minor|student))\b/,
  /\b(young|youthful|juvenile|baby|child|childish|girlish|boyish|teen|teenage|teeny)[-\s]*(looking|looks|faced|face|appearance|vibes?|energy|body|figure|frame)\b/,
  /\b(girlish|childish|childlike)\b/,
  /\b(teen|teens|teenager|teenage|teenaged|tween|adolescent|juvenile|minor|underage|under-age|youngster|youth|schoolchild\w*|pupil|freshman|sophomore|prom|cheerleader|loli\w*|shota\w*|jailbait|nymphet|barely\s+(legal|adult|of\s+age)|just\s+turned\s+(18|19|20|21)|fresh[-\s]faced|petite\s+(school|girl|boy|teen))\b/,
  /\b(school|schools|schoolgirl|schoolboy|schoolyard|classroom|classmates?|kindergarten|nursery|daycare|playground|homework|sorority|high[-\s]?school\w*|middle[-\s]?school|junior[-\s]?high|college\s+freshman)\b/,
  /\b(little|small|tiny)\s+(girl|boy|lady|man|one|child|kid|sister|brother)\b/,
  /\b(mini|small[-\s]?framed|flat[-\s]?chested)\s+(school|teen|girl|boy)\w*\b/,
  /\b(girl|girls|boy|boys|kid|kids|child|children)\b/,
  /\b(early|mid|late)?[-\s]*(teens|1\ds)\b(?!\s*(million|k|%|km|cm|mm))/,
  /\bearly\s+(20s|twenties|20's)\b/,
];
/** An age under 25 written in the words: "22 years old", "aged 19", "looks 20". */
const UNDER_AGE = [
  /\b([1-9]|1\d|2[0-4])\s*-?\s*(yo|y\/o|y\.o\.?|yrs?|years?)(\s*-?\s*old)?\b/,
  /\b(age|aged|ages|looks?|looking|appears?|appearing|seems?)\s+(about\s+|around\s+|like\s+|to\s+be\s+)?([1-9]|1\d|2[0-4])\b/,
  /\b(eighteen|nineteen|twenty|twenty-?one|twenty-?two|twenty-?three|twenty-?four)\s*-?\s*(years?|yrs?|y\/o|yo)(\s*-?\s*old)?\b/,
  /\bin\s+(his|her|their)\s+(teens|early\s+twenties)\b/,
];
/** Phrases with a word that looks like a child's but is not ("baby blue", "a minor scar"). */
const SAFE_PHRASES = [/\bbaby[-\s]+(blue|pink|powder|doll)\b/g, /\bminor\s+(scars?|moles?|freckles|blemish\w*|wrinkles?|imperfections?|asymmetry|limp|tattoos?)\b/g];
/** Real and famous people, and ways of asking for one. */
const REAL = [
  /\b(celebrity|celebrities|celeb|famous|lookalike|look-alike|look\s*alike|deepfake|doppelganger|doppelg[aä]nger|dead\s+ringer|spitting\s+image|real\s+person|real\s+people|real\s+life|real-life|actual\s+person|someone\s+i\s+know|person\s+i\s+know|influencer\s+named)\b/,
  /\bmy\s+(ex|exes|girlfriend|boyfriend|wife|husband|partner|fianc\w+|coworker|co-worker|colleague|boss|neighbou?r|friend|friends|crush|mom|mum|mother|dad|father|sister|brother|cousin|aunt|uncle|teacher|roommate|classmate|landlord|therapist|doctor|nurse|girl|boy)\b/,
  /\b(looks?|looking|look(s)?|resembl\w+|reminds?\s+me\s+of|modell?ed\s+(on|after)|based\s+(on|off)|inspired\s+by|copy\s+of|clone\s+of|version\s+of|twin\s+of|same\s+as|the\s+spit\s+of)\s+(like\s+|of\s+)?(a\s+|an\s+|the\s+)?(real|famous|actual|specific|certain|particular|celebrity|actor|actress|singer|model|musician|athlete|player|star|person|woman\s+i|man\s+i|guy\s+i|girl\s+i)\b/,
  /\b(photo|photograph|picture|selfie|snapshot|screenshot|upload\w*|my\s+face|her\s+face\s+from|his\s+face\s+from|from\s+a\s+(photo|picture))\b/,
];
/** Words that name a real person after "like" (case matters, so this one runs on the original text). */
const LIKE_NAME = /\b(?:like|resembles?|resembling|play(?:ed|ing|s)?\s+by|portrayed\s+by)\s+(?:[A-Z][\p{L}'’.-]+\s+){1,2}[A-Z][\p{L}'’-]+\b/u;
/** Well-known people, best effort: a list can never be complete, which is why the cues above exist too. */
const FAMOUS = [
  'taylor swift', 'beyonce', 'beyoncé', 'rihanna', 'ariana grande', 'selena gomez', 'billie eilish', 'dua lipa', 'lady gaga', 'katy perry', 'miley cyrus', 'justin bieber', 'harry styles', 'ed sheeran', 'bruno mars', 'the weeknd', 'kanye west', 'kim kardashian', 'kylie jenner', 'kendall jenner', 'khloe kardashian', 'kris jenner', 'hailey bieber', 'gigi hadid', 'bella hadid', 'emily ratajkowski', 'scarlett johansson', 'emma watson', 'emma stone', 'margot robbie', 'zendaya', 'sydney sweeney', 'jennifer lawrence', 'jennifer aniston', 'angelina jolie', 'brad pitt', 'leonardo dicaprio', 'tom cruise', 'tom hanks', 'tom holland', 'robert downey', 'chris hemsworth', 'chris evans', 'chris pratt', 'ryan reynolds', 'ryan gosling', 'dwayne johnson', 'keanu reeves', 'johnny depp', 'will smith', 'morgan freeman', 'denzel washington', 'george clooney', 'matt damon', 'ben affleck', 'jennifer lopez', 'anne hathaway', 'natalie portman', 'gal gadot', 'jessica alba', 'megan fox', 'ana de armas', 'florence pugh', 'anya taylor', 'timothee chalamet', 'timothée chalamet', 'pedro pascal', 'henry cavill', 'jason momoa', 'idris elba', 'michael b jordan', 'cardi b', 'nicki minaj', 'megan thee stallion', 'doja cat', 'olivia rodrigo', 'sabrina carpenter', 'madonna', 'britney spears', 'christina aguilera', 'jennifer garner', 'elon musk', 'jeff bezos', 'mark zuckerberg', 'bill gates', 'donald trump', 'joe biden', 'barack obama', 'michelle obama', 'kamala harris', 'hillary clinton', 'vladimir putin', 'queen elizabeth', 'king charles', 'prince harry', 'meghan markle', 'kate middleton', 'princess diana', 'oprah winfrey', 'ellen degeneres', 'kevin hart', 'lionel messi', 'cristiano ronaldo', 'lebron james', 'serena williams', 'michael jordan', 'tiger woods', 'mr beast', 'mrbeast', 'pewdiepie', 'charli damelio', 'addison rae', 'emma chamberlain', 'marilyn monroe', 'audrey hepburn', 'elvis presley', 'michael jackson', 'nicole kidman', 'charlize theron', 'salma hayek', 'sofia vergara', 'eva mendes', 'monica bellucci', 'kate winslet', 'cate blanchett', 'meryl streep', 'julia roberts', 'sandra bullock', 'reese witherspoon', 'amber heard', 'lily collins', 'lily james', 'daisy ridley', 'millie bobby brown', 'jenna ortega', 'chloe grace', 'dakota johnson', 'rosie huntington',
];
const famousRe = new RegExp(`\\b(${FAMOUS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
const LINKS = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b|@\w|<\/?[a-z][^>]*>|\{\{|\}\}|\[\[|\]\]|```)/i;
const COMMANDS = /\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|above|all|any|prior|earlier|the|these|your)\b.{0,20}\b(instructions?|rules?|prompts?|filters?|limits?|safety)\b|\b(system|developer)\s+prompt\b|\bjailbreak\b/i;
const EXPLICIT = /\b(nude|nudes|naked|nsfw|porn\w*|explicit|topless|bottomless|nipples?|genital\w*|penis|vagina|pussy|cock|dick|orgasm\w*|masturbat\w*|undress\w*|strip(ping|s|ped|per|tease)?|sex|sexual|sexy|erotic\w*|intercourse|blowjob|handjob|cum|fetish|bdsm|hentai|lewd|onlyfans|see[-\s]?through|lingerie|thong|panties|bikini|revealing|skimpy|provocative|seductive|sensual|cleavage|busty|horny|aroused|bondage|slutty|slut|whore|escort)\b/;

const fold = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[_*~`]/g, ' ')
    .toLowerCase();

/** The messages people see. */
export const MESSAGES = {
  young: 'Characters are grown-ups only, 25 or older. Leave out anything about kids, teens, school or a young look.',
  age: `A character must be ${MIN_AGE} or older. Type their age as a number, ${MIN_AGE} or more.`,
  real: 'Characters are made-up people, never real or famous ones. Leave out names of real people, “looks like” someone, lookalikes and people you know, and describe the face in your own words.',
  explicit: 'A character is shown clothed and neutral here. Leave out anything sexual or revealing: adult results come from using the character elsewhere.',
  plain: 'Describe the character in plain words: no links, no code and no instructions.',
  name: 'Give the character a name (up to 40 letters).',
  empty: 'Say what the character looks like: at least their style, hair and eyes.',
};

/** All the words a person typed into a character, in one string. */
export function wordsOf(input) {
  const t = input?.traits || {};
  return [input?.name, input?.idea, t.build, t.height, t.skin, t.face, t.eyes, t.hair, t.marks, t.personality, ...(Array.isArray(t.outfits) ? t.outfits : [])].filter((x) => x != null && String(x).trim()).join(' . ');
}

/** Why these words can't make a character, in plain words; null when they are fine. Age is checked apart. */
export function wordsProblem(text) {
  const raw = String(text ?? '');
  const t = fold(raw);
  if (LINKS.test(raw) || COMMANDS.test(t)) return MESSAGES.plain;
  const soft = SAFE_PHRASES.reduce((x, re) => x.replace(re, ' '), t);
  if (mentionsMinor(soft) || YOUNG.some((re) => re.test(soft))) return MESSAGES.young;
  if (UNDER_AGE.some((re) => re.test(t))) return MESSAGES.age;
  if (famousRe.test(t) || REAL.some((re) => re.test(t)) || LIKE_NAME.test(raw)) return MESSAGES.real;
  if (EXPLICIT.test(t)) return MESSAGES.explicit;
  return null;
}

/** Normalise the age: a whole number from 25 up, or null. */
export function ageOf(value) {
  const n = typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= MIN_AGE && n <= MAX_AGE ? n : null;
}

const STYLE_IDS = Object.keys(STYLE_WORDS);
const GENDER_IDS = Object.keys(GENDER_WORDS);
const field = (v, max) => plainText(v, max);

/**
 * Check and tidy what a person typed. Returns { value } (name, age, traits, descriptor…) or
 * { problem } in plain words. `partial` skips the "enough detail" check (the live check while typing).
 */
export function checkCharacter(input, { partial = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const t = src.traits && typeof src.traits === 'object' ? src.traits : {};
  const outfits = (Array.isArray(t.outfits) ? t.outfits : t.outfit ? [t.outfit] : []).map((x) => field(x, 140)).filter(Boolean).slice(0, 4);
  const traits = {
    style: STYLE_IDS.includes(t.style) ? t.style : 'photoreal',
    gender: GENDER_IDS.includes(t.gender) ? t.gender : 'woman',
    build: field(t.build, 60),
    height: field(t.height, 60),
    skin: field(t.skin, 60),
    face: field(t.face, 60),
    eyes: field(t.eyes, 60),
    hair: field(t.hair, 100),
    marks: field(t.marks, 200),
    outfits,
    personality: field(t.personality, 500),
  };
  const name = field(src.name, 40);
  const idea = field(src.idea, 300);
  const value = { name, age: null, traits, idea: idea || undefined };
  // The rules read everything typed, before it is cut or tidied (a link or a name must not slip through).
  const rawWords = wordsOf({ name: src.name, idea: src.idea, traits: { ...t, outfits: Array.isArray(t.outfits) ? t.outfits : t.outfit ? [t.outfit] : [] } });
  const problem = wordsProblem(rawWords) || wordsProblem(wordsOf(value));
  if (problem) return { problem, value };
  if (src.age == null || src.age === '') {
    if (!partial) return { problem: MESSAGES.age, value };
  } else {
    const age = ageOf(src.age);
    if (age == null) return { problem: MESSAGES.age, value };
    value.age = age;
  }
  if (!partial) {
    if (!name || !/\p{L}/u.test(name)) return { problem: MESSAGES.name, value };
    if (!traits.hair && !traits.eyes && !traits.face && !traits.build) return { problem: MESSAGES.empty, value };
  }
  value.descriptor = value.age ? descriptorOf(value) : '';
  return { value };
}

// ---------------------------------------------------------------- the sheet's views

/** The five views every sheet needs, then the extras made as time allows. */
export const CORE_VIEWS = [
  { id: 'front', label: 'Front', core: true, kind: 'front' },
  { id: 'three-quarter', label: 'Three-quarter', core: true, kind: 'angle', angle: 'front-right quarter view, eye-level shot', words: 'a three-quarter view, turned a little to her or his right' },
  { id: 'side', label: 'Side', core: true, kind: 'angle', angle: 'right side view, eye-level shot', words: 'the right side, in profile' },
  { id: 'back', label: 'Back', core: true, kind: 'angle', angle: 'back view, eye-level shot', words: 'directly from behind' },
  { id: 'face', label: 'Face close-up', core: true, kind: 'angle', angle: 'front view, eye-level shot close-up', words: 'a close-up of the face, head and shoulders only' },
];
export const EXPRESSIONS = [
  { id: 'smile', label: 'Smiling', kind: 'expression', words: 'a warm, natural smile' },
  { id: 'serious', label: 'Serious', kind: 'expression', words: 'a calm, serious look' },
];
/** The views a character has: the core five, and (extras) expressions plus one view per extra outfit. */
export function viewsFor(character, { extras = true } = {}) {
  const list = [...CORE_VIEWS];
  if (extras) {
    list.push(...EXPRESSIONS);
    (character?.traits?.outfits || []).slice(1, 3).forEach((outfit, i) => list.push({ id: `outfit-${i + 2}`, label: `Outfit ${i + 2}`, kind: 'outfit', outfit }));
  }
  return list;
}
export const viewById = (character, id) => viewsFor(character).find((v) => v.id === id) || null;

const LOOKS = {
  photoreal: 'Photograph, natural skin texture, realistic.',
  anime: 'Anime character design, clean line art, even colours.',
  illustration: 'Digital illustration, clean painterly shapes.',
};
const BACKGROUND = 'Plain light grey studio background, soft even light, sharp focus, no text.';

/** What to ask the maker for one view. `edit` views describe the change to the front picture. */
export function viewPrompt(spec, character, { angles = true } = {}) {
  const outfit = character.traits?.outfits?.[0];
  const dress = outfit ? `, wearing ${plainText(outfit, 140).toLowerCase()}` : '';
  if (spec.kind === 'front') {
    return `${character.descriptor}${dress}. ${LOOKS[character.traits?.style] || LOOKS.photoreal} Full-length character reference: the whole body from head to feet, standing straight and facing the camera, arms relaxed, calm neutral expression, fully clothed. ${BACKGROUND}`;
  }
  if (spec.kind === 'angle') {
    if (angles) return spec.angle;
    return `Show exactly the same person from ${spec.words}. Keep the same face, hair, skin, body, clothes and light grey background. Fully clothed, neutral expression.`;
  }
  const same = 'Keep exactly the same person: the same face, hair, skin, body, clothes and light grey background.';
  if (spec.kind === 'expression') return `${same} Change only the expression to ${spec.words}. Fully clothed.`;
  return `Keep exactly the same person: the same face, hair, skin, body, pose and light grey background. Change only the clothes: they now wear ${plainText(spec.outfit, 140).toLowerCase()}. Fully clothed.`;
}

/** The text-to-picture makers that suit each look, best first. */
const TEXT_MAKERS = { photoreal: ['qwen-real', 'krea-real', 'qwen'], anime: ['anime', 'qwen'], illustration: ['qwen', 'anime'] };

/** An identity check below this score remakes the view once. */
export const IDENTITY_OK = 60;

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// ---------------------------------------------------------------- the store

/**
 * @param {object} o
 *   dir        where characters are kept (one folder each)
 *   r2         an R2 client when characters are kept in R2 too (the gallery's), else null
 *   now, log, wait   (tests)
 *   pollMs     how often a sheet job is looked at
 * Then characters.attach({ studio, judge, check }) once the studio exists:
 *   studio     createJob(req, { refs }), job(id), itemPath(id), remove(id), cancel(id), makerInstalled(id), estimate()
 *   judge      ({ reference, candidate }) -> { score } | null   (a vision model: is it the same person?)
 *   check      (file) -> { nsfw } | null                          (the NSFW check)
 */
export function createCharacters(o) {
  const dir = o.dir;
  const now = o.now || Date.now;
  const log = o.log || console;
  const wait = o.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 1500;
  const mirror = o.r2 ? createMirror({ r2: o.r2, root: dir, prefix: 'characters/', log }) : null;
  let studio = o.studio || null;
  let judge = o.judge || null;
  let check = o.check || null;

  const cache = new Map(); // id -> record
  const runs = new Map(); // id -> the latest sheet run
  const locks = new Map();
  const iso = () => new Date(now()).toISOString();
  const bad = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
  const refused = (message) => bad(message, 422, { blocked: true });
  const jsonPath = (id) => path.join(dir, id, 'character.json');
  const filePath = (id, name) => path.join(dir, id, name);
  const mine = (c, owner) => Boolean(c) && (c.owner || '') === (owner || '');

  /** One change at a time per character. */
  function locked(id, fn) {
    const run = (locks.get(id) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    void tail.then(() => locks.get(id) === tail && locks.delete(id));
    return run;
  }

  function readSync(id) {
    if (!ID.test(id)) return null;
    try {
      const c = JSON.parse(fs.readFileSync(jsonPath(id), 'utf8'));
      return c && c.id === id ? c : null;
    } catch {
      return null;
    }
  }
  async function save(c) {
    c.updatedAt = iso();
    await fsp.mkdir(path.join(dir, c.id), { recursive: true });
    const tmp = `${jsonPath(c.id)}.${newId()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(c));
    await fsp.rename(tmp, jsonPath(c.id));
    cache.set(c.id, c);
    await mirror?.save(jsonPath(c.id));
    return c;
  }
  async function loadAll() {
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      const c = readSync(name);
      if (c) cache.set(c.id, c);
    }
  }
  let pulled = 0;
  /** Characters kept in R2 come down (a restart wiped the disk, or the other machine made one). */
  async function pull() {
    if (!mirror || now() - pulled < 20_000) return;
    pulled = now();
    try {
      await mirror.pull('', (rel) => /^[A-Za-z0-9_-]+\/character\.json$/.test(rel));
      await loadAll();
    } catch (err) {
      log.warn?.(`[characters] could not read characters from R2: ${err.message}`);
    }
  }

  /** The sheet pictures' files exist on this machine (fetched from R2 when only kept there). */
  async function ensureFile(c, name) {
    const p = filePath(c.id, name);
    if (await fsp.stat(p).catch(() => null)) return p;
    if (mirror && (await mirror.fetch(p).catch(() => false))) return p;
    return null;
  }
  const entryOf = (c, view) => (c.sheet || []).find((e) => e.view === view) || null;

  /** What the app and the other modules see of a character. */
  const publicOf = (c) => ({
    id: c.id,
    name: c.name,
    adult: true,
    fictional: true,
    age: c.age,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    owner: c.owner || undefined,
    idea: c.idea || undefined,
    descriptor: c.descriptor,
    traits: c.traits,
    seed: c.seed,
    seeds: c.seeds || {},
    maker: c.maker || undefined,
    sheetStale: c.sheetStale || undefined,
    sheet: (c.sheet || []).map((e) => ({ view: e.view, label: e.label, core: Boolean(e.core), file: e.file, seed: e.seed, identity: e.identity || undefined })),
  });

  // ---- reading
  async function list({ owner } = {}) {
    await pull();
    return [...cache.values()]
      .filter((c) => mine(c, owner))
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .map(publicOf);
  }
  /** A saved character that can be used: the other modules read it with this (draft ones are not). */
  function readyOf(id) {
    const c = lookup(id);
    return c && c.status === 'ready' ? c : null;
  }
  /**
   * A character that can be used, for the other modules (studio.js, the held-review rules):
   * `{ id, name, adult, fictional, age, owner?, descriptor, traits, sheet: [{ view, label, file }] }`.
   * The sheet is ordered for use (index 0 the front view, index 1 the face close-up, then the rest)
   * and each `file` is an absolute path to a picture on this machine's disk: pictures kept only in R2
   * are brought down first. A draft (sheet not accepted) returns null.
   */
  async function get(id) {
    const c = readyOf(id);
    if (!c) return null;
    const order = ['front', 'face'];
    const rank = (e) => (order.includes(e.view) ? order.indexOf(e.view) : order.length);
    const sheet = [];
    for (const e of [...(c.sheet || [])].sort((a, b) => rank(a) - rank(b))) {
      const p = await ensureFile(c, path.basename(e.file));
      if (p) sheet.push({ view: e.view, label: e.label, file: p });
    }
    return { ...publicOf(c), sheet };
  }
  function lookup(id) {
    const c = cache.get(String(id)) || readSync(String(id));
    if (c && !cache.has(c.id)) cache.set(c.id, c);
    return c || null;
  }
  const getAny = (id, owner) => {
    const c = lookup(id);
    return c && mine(c, owner) ? c : null;
  };
  const need = (id, owner) => {
    const c = getAny(id, owner);
    if (!c) throw bad('That character is not in your library any more.', 404);
    return c;
  };
  async function view(id, owner) {
    await pull();
    return publicOf(need(id, owner));
  }

  /**
   * A sheet picture of a character, to use as a reference: the view asked for, else the front.
   * Returns { path, view } or null. `view` is 'front' | 'face' | …
   */
  async function reference(id, wanted = 'front') {
    const c = lookup(id);
    if (!c) return null;
    for (const v of [wanted, 'front']) {
      const e = entryOf(c, v);
      if (!e) continue;
      const p = await ensureFile(c, path.basename(e.file));
      if (p) return { path: p, view: v };
    }
    return null;
  }
  /** A sheet file for sending: { path, size, type, name } or null. */
  async function file(id, name, owner) {
    const c = getAny(String(id), owner);
    if (!c || !/^[a-z0-9-]+\.(png|jpg|webp)$/.test(String(name))) return null;
    if (!(c.sheet || []).some((e) => path.basename(e.file) === name)) return null;
    const p = await ensureFile(c, name);
    const st = p && (await fsp.stat(p).catch(() => null));
    return st ? { path: p, size: st.size, type: MIME[path.extname(name)] || 'application/octet-stream', name: `${c.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character'}-${name}` } : null;
  }

  // ---- writing
  const sigOf = (c) => `${c.descriptor}|${(c.traits?.outfits || [])[0] || ''}`;

  function problemOf(input, partial = false) {
    const r = checkCharacter(input, { partial });
    return r.problem ? { problem: r.problem, value: r.value } : { value: r.value };
  }
  /** Check words without saving anything (the live check while typing). */
  function checkWords(input) {
    return problemOf(input, true).problem || null;
  }

  async function create(input, { owner } = {}) {
    const r = checkCharacter(input);
    if (r.problem) throw refused(r.problem);
    const have = [...cache.values()].filter((c) => mine(c, owner)).length;
    if (have >= MAX_CHARACTERS) throw bad(`You can keep up to ${MAX_CHARACTERS} characters. Delete one you don't use first.`, 409);
    const v = r.value;
    const c = {
      id: newId(),
      name: v.name,
      adult: true,
      fictional: true,
      age: v.age,
      status: 'draft',
      createdAt: iso(),
      owner: owner || undefined,
      idea: v.idea,
      descriptor: v.descriptor,
      traits: v.traits,
      // The seed is locked here: every view of this character starts from it.
      seed: crypto.randomInt(1, 2 ** 31 - 1),
      seeds: {},
      reroll: {},
      rev: 0,
      sheet: [],
    };
    c.sig = sigOf(c);
    return publicOf(await save(c));
  }

  async function update(id, patch, { owner } = {}) {
    return locked(id, async () => {
      const c = need(id, owner);
      const merged = { name: c.name, age: c.age, idea: c.idea, ...patch, traits: { ...c.traits, ...(patch?.traits || {}) } };
      const r = checkCharacter(merged);
      if (r.problem) throw refused(r.problem);
      const v = r.value;
      Object.assign(c, { name: v.name, age: v.age, idea: v.idea, descriptor: v.descriptor, traits: v.traits });
      // Looks changed: the sheet no longer shows this person, so it has to be made again.
      if (sigOf(c) !== c.sig && (c.sheet || []).length) {
        c.sheetStale = true;
        c.status = 'draft';
      }
      return publicOf(await save(c));
    });
  }

  async function rename(id, name, { owner } = {}) {
    return locked(id, async () => {
      const c = need(id, owner);
      const r = checkCharacter({ name, age: c.age, traits: c.traits, idea: c.idea });
      if (r.problem) throw refused(r.problem);
      c.name = r.value.name;
      return publicOf(await save(c));
    });
  }

  async function duplicate(id, { owner } = {}) {
    const c = need(id, owner);
    const copy = JSON.parse(JSON.stringify(c));
    copy.id = newId();
    copy.name = `${c.name.slice(0, 33)} copy`;
    copy.createdAt = iso();
    copy.sheet = [];
    await fsp.mkdir(path.join(dir, copy.id), { recursive: true });
    for (const e of c.sheet || []) {
      const name = path.basename(e.file);
      const from = await ensureFile(c, name);
      if (!from) continue;
      await fsp.copyFile(from, filePath(copy.id, name));
      await mirror?.save(filePath(copy.id, name));
      copy.sheet.push({ ...e, file: `${copy.id}/${name}` });
    }
    return publicOf(await save(copy));
  }

  async function dropFiles(c, entries) {
    for (const e of entries) {
      const p = filePath(c.id, path.basename(e.file));
      await fsp.rm(p, { force: true });
      await mirror?.drop(p);
    }
  }

  /** Deleting a character never touches the pictures and videos made with it. */
  async function remove(id, { owner } = {}) {
    const c = getAny(id, owner);
    if (!c) return false;
    await stop(id, { owner }).catch(() => {});
    runs.delete(c.id);
    await dropFiles(c, c.sheet || []);
    await fsp.rm(jsonPath(c.id), { force: true });
    await mirror?.drop(jsonPath(c.id));
    await fsp.rm(path.join(dir, c.id), { recursive: true, force: true });
    cache.delete(c.id);
    return true;
  }

  const CORE_IDS = CORE_VIEWS.map((v) => v.id);
  /** Accept the sheet: the character is saved and can be used. */
  async function accept(id, { owner } = {}) {
    return locked(id, async () => {
      const c = need(id, owner);
      if (runs.get(c.id)?.status === 'running') throw bad('The sheet is still being made.', 409);
      const missing = CORE_IDS.filter((v) => !entryOf(c, v));
      if (missing.length) throw bad('The reference sheet is not finished yet: it needs the front, three-quarter, side, back and face views.', 409);
      if (c.sheetStale) throw bad('Their looks changed: make the reference sheet again first.', 409);
      c.status = 'ready';
      c.acceptedAt = iso();
      return publicOf(await save(c));
    });
  }

  // ---- the sheet
  function attach(deps) {
    if (deps.studio) studio = deps.studio;
    if ('judge' in deps) judge = deps.judge;
    if ('check' in deps) check = deps.check;
  }

  async function chooseMakers(c) {
    let text = null;
    for (const id of TEXT_MAKERS[c.traits?.style] || TEXT_MAKERS.photoreal) {
      if (await studio.makerInstalled(id)) {
        text = id;
        break;
      }
    }
    const angles = await studio.makerInstalled('angles');
    const edit = (await studio.makerInstalled('edit')) ? 'edit' : null;
    return { text, angles, angle: angles ? 'angles' : edit, edit };
  }

  const seedFor = (c, view, attempt) => (c.seed + 101 * (c.reroll?.[view] || 0) + 1013 * attempt) % 2_147_483_647;

  const runOf = (c) => runs.get(c.id) || null;

  /** Start (or carry on) making the sheet. Views already made are kept unless `redo`. */
  async function startSheet(id, { views, extras = true, redo = false, owner } = {}) {
    if (!studio) throw bad('The picture maker is not on this machine.', 503);
    const c = need(id, owner);
    const active = runOf(c);
    if (active?.status === 'running') return runState(c);
    const wanted = Array.isArray(views) && views.length ? views.map(String) : null;
    const all = viewsFor(c, { extras });
    if (wanted && wanted.some((v) => !all.some((a) => a.id === v))) throw bad('That view is not part of the sheet.', 400);
    let plan = all.filter((v) => (wanted ? wanted.includes(v.id) : redo || !entryOf(c, v.id)));
    if (redo && !wanted) {
      await locked(id, async () => {
        await dropFiles(c, c.sheet || []);
        c.sheet = [];
        c.sheetStale = false;
        c.sig = sigOf(c);
        await save(c);
      });
    }
    if (!plan.length) return runState(c);
    // Everything else is made from the front: it comes first, and a new front means a new sheet.
    if (plan.some((v) => v.id === 'front') && !wanted) plan = [plan.find((v) => v.id === 'front'), ...plan.filter((v) => v.id !== 'front')];
    if (!entryOf(c, 'front') && !plan.some((v) => v.id === 'front')) plan = [CORE_VIEWS[0], ...plan];
    const run = {
      id: newId(),
      characterId: c.id,
      status: 'running',
      startedAt: now(),
      stopped: false,
      message: null,
      jobId: null,
      entries: plan.map((v) => ({ view: v.id, label: v.label, core: Boolean(v.core), status: 'todo', progress: 0, attempt: 0, error: null, job: null, identity: null })),
    };
    runs.set(c.id, run);
    void execute(run, c).catch((err) => {
      run.status = 'error';
      run.message = err.message;
      log.warn?.(`[characters] ${c.id}: ${err.message}`);
    });
    return runState(c);
  }

  /** Make one view again with a new seed (the front: every other view is then made again from it). */
  async function regenerate(id, viewId, { owner } = {}) {
    const c = need(id, owner);
    const spec = viewById(c, viewId);
    if (!spec) throw bad('That view is not part of the sheet.', 400);
    if (runOf(c)?.status === 'running') throw bad('The sheet is still being made. Wait for it, or stop it first.', 409);
    c.reroll = { ...(c.reroll || {}), [viewId]: (c.reroll?.[viewId] || 0) + 1 };
    await save(c);
    if (viewId === 'front') return startSheet(id, { redo: true, owner });
    if (!entryOf(c, 'front')) return startSheet(id, { owner });
    return startSheet(id, { views: [viewId], owner });
  }

  async function stop(id, { owner } = {}) {
    const c = getAny(id, owner);
    const run = c && runOf(c);
    if (!run || run.status !== 'running') return c ? runState(c) : null;
    run.stopped = true;
    if (run.jobId) await studio?.cancel?.(run.jobId).catch(() => {});
    return runState(c);
  }

  function runState(c) {
    const run = runOf(c);
    const have = (c.sheet || []).map((e) => e.view);
    if (!run) return { id: null, characterId: c.id, status: 'idle', entries: [], etaSeconds: 0, done: have.length, message: null };
    let eta = 0;
    const entries = run.entries.map((e) => {
      const job = e.jobId && studio?.job ? studio.job(e.jobId) : null;
      const out = {
        view: e.view,
        label: e.label,
        core: e.core,
        status: e.status,
        progress: e.status === 'done' ? 100 : job?.progress ?? e.progress,
        attempt: e.attempt,
        error: e.error,
        position: job?.position || 0,
        etaSeconds: job?.etaSeconds ?? null,
        identity: e.identity,
        note: e.note,
      };
      if (e.status === 'making') eta += job?.etaSeconds ?? e.expected ?? 60;
      else if (e.status === 'todo') eta += e.expected ?? 60;
      return out;
    });
    return {
      id: run.id,
      characterId: c.id,
      status: run.status,
      message: run.message,
      checking: Boolean(run.checking),
      entries,
      etaSeconds: run.status === 'running' ? Math.round(eta + (run.checking ? 30 : 0)) : 0,
      done: have.length,
    };
  }
  const sheetState = async (id, owner) => runState(need(id, owner));

  /** Follow one job to its end. */
  async function follow(run, entry) {
    const t0 = now();
    for (;;) {
      if (run.stopped) throw Object.assign(new Error('Stopped.'), { stopped: true });
      const j = studio.job(entry.jobId);
      if (!j) throw new Error('The maker lost the job.');
      entry.progress = j.progress || 0;
      if (j.status === 'done' && j.item) return j;
      if (j.status === 'error') throw new Error(j.error || 'The maker could not finish it.');
      if (j.status === 'stopped') throw Object.assign(new Error('Stopped.'), { stopped: true });
      if (now() - t0 > 60 * 60_000) throw new Error('The maker took too long.');
      await wait(pollMs);
    }
  }

  /** Make one view (up to two tries), keep the picture in the character's folder, and take it out of the gallery. */
  async function makeView(run, c, entry, spec, makers) {
    const front = entryOf(c, 'front');
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (run.stopped) throw Object.assign(new Error('Stopped.'), { stopped: true });
      entry.attempt = attempt + 1;
      entry.status = 'making';
      entry.error = null;
      entry.progress = 0;
      const seed = seedFor(c, spec.id, attempt);
      try {
        let req;
        let refs = [];
        if (spec.kind === 'front') {
          if (!makers.text) throw new Error('No picture maker for this look is installed on your AI machine yet. Add one in the Store.');
          req = { kind: 'image', maker: makers.text, prompt: viewPrompt(spec, c), size: 'portrait', seed };
          c.maker = makers.text;
        } else {
          const baseView = spec.kind === 'expression' && entryOf(c, 'face') ? 'face' : 'front';
          const base = entryOf(c, baseView) || front;
          if (!base) throw new Error('Make the front view first: every other view is made from it.');
          const basePath = await ensureFile(c, path.basename(base.file));
          if (!basePath) throw new Error('The front picture is not on this machine any more. Make the sheet again.');
          refs = [basePath];
          const angled = spec.kind === 'angle' && makers.angles;
          const maker = spec.kind === 'angle' ? makers.angle : makers.edit;
          if (!maker) throw new Error('The picture editor is not installed on your AI machine yet. Add it in the Store.');
          req = { kind: 'image', maker, prompt: viewPrompt(spec, c, { angles: angled }), seed };
        }
        entry.expected = studio.estimate ? studio.estimate({ kind: 'image', maker: req.maker }) : 60;
        const job = await studio.createJob(req, { refs });
        entry.jobId = job.id;
        run.jobId = job.id;
        const done = await follow(run, entry);
        const src = await studio.itemPath(done.item.id);
        if (!src) throw new Error('The picture could not be found.');
        // The sheet is clothed and neutral: anything the NSFW check flags is thrown away.
        const verdict = check ? await check(src).catch(() => null) : null;
        if (verdict?.nsfw) {
          await studio.remove(done.item.id).catch(() => {});
          throw new Error('That picture did not come out suitable, so it was not kept.');
        }
        c.rev = (c.rev || 0) + 1;
        const name = `${spec.id}-${c.rev}.png`;
        await fsp.mkdir(path.join(dir, c.id), { recursive: true });
        await fsp.copyFile(src, filePath(c.id, name));
        await mirror?.save(filePath(c.id, name));
        await studio.remove(done.item.id).catch(() => {});
        const old = entryOf(c, spec.id);
        const next = { view: spec.id, label: spec.label, core: Boolean(spec.core), file: `${c.id}/${name}`, seed, maker: req.maker, createdAt: iso() };
        c.sheet = [...(c.sheet || []).filter((e) => e.view !== spec.id), next];
        c.seeds = { ...(c.seeds || {}), [spec.id]: seed };
        await locked(c.id, () => save(c));
        entry.previous = old || null;
        entry.status = 'done';
        entry.progress = 100;
        return next;
      } catch (err) {
        if (err.stopped) throw err;
        lastError = err;
        entry.note = attempt === 0 ? 'The first try did not work, so it is trying once more.' : undefined;
        // A missing maker or file won't get better on a second try.
        if (/installed|Make the front|not on this machine|No picture maker/.test(err.message)) break;
      }
    }
    entry.status = 'error';
    entry.error = lastError?.message || 'It could not be made.';
    throw lastError;
  }

  /** Ask the vision model whether each new view is the front's person; remake the ones that are not. */
  async function verify(run, c, entries) {
    if (!judge) return;
    const front = entryOf(c, 'front');
    const frontPath = front && (await ensureFile(c, path.basename(front.file)));
    if (!frontPath) return;
    run.checking = true;
    try {
      const score = async (e) => {
        const p = await ensureFile(c, path.basename(e.file));
        return p ? judge({ reference: frontPath, candidate: p, view: e.view }).catch(() => null) : null;
      };
      const pending = entries.filter((e) => e.status === 'done' && e.view !== 'front');
      const first = [];
      for (const e of pending) {
        if (run.stopped) return;
        const s = await score(entryOf(c, e.view));
        if (s && typeof s.score === 'number') {
          const rec = entryOf(c, e.view);
          rec.identity = { score: Math.round(s.score), checked: true };
          e.identity = rec.identity;
          first.push(e);
        }
      }
      await locked(c.id, () => save(c));
      // One remake round for the ones that do not look like the front.
      for (const e of first.filter((x) => x.identity.score < IDENTITY_OK)) {
        if (run.stopped) return;
        const spec = viewById(c, e.view);
        const before = entryOf(c, e.view);
        c.reroll = { ...(c.reroll || {}), [e.view]: (c.reroll?.[e.view] || 0) + 1 };
        e.note = 'It did not look enough like the front, so it is being made again.';
        const makers = await chooseMakers(c);
        try {
          await makeView(run, c, e, spec, makers);
        } catch (err) {
          if (err.stopped) return;
          // Keep the earlier picture if the remake failed.
          c.sheet = [...(c.sheet || []).filter((s) => s.view !== e.view), before];
          e.status = 'done';
          e.error = null;
          continue;
        }
        const after = entryOf(c, e.view);
        const s = await score(after);
        if (s && typeof s.score === 'number') after.identity = { score: Math.round(s.score), checked: true };
        // Keep whichever matches the front better.
        if (!after.identity || after.identity.score < before.identity.score) {
          await dropFiles(c, [after]);
          c.sheet = [...(c.sheet || []).filter((x) => x.view !== e.view), before];
        } else await dropFiles(c, [before]);
        e.identity = entryOf(c, e.view).identity;
        e.note = undefined;
        await locked(c.id, () => save(c));
      }
    } finally {
      run.checking = false;
    }
  }

  async function execute(run, c) {
    const makers = await chooseMakers(c);
    for (const entry of run.entries) {
      if (run.stopped) break;
      const spec = viewById(c, entry.view);
      try {
        await makeView(run, c, entry, spec, makers);
        // An earlier picture of this view is replaced only now that the new one is in.
        if (entry.previous && entry.previous.file !== entryOf(c, entry.view)?.file) await dropFiles(c, [entry.previous]);
        entry.previous = null;
      } catch (err) {
        if (err.stopped) break;
        // Nothing else can be made without the front.
        if (entry.view === 'front') {
          run.status = 'error';
          run.message = entry.error;
          run.jobId = null;
          return;
        }
      }
    }
    if (run.stopped) {
      for (const e of run.entries) if (e.status === 'todo' || e.status === 'making') e.status = 'stopped';
      run.status = 'stopped';
      run.jobId = null;
      return;
    }
    await verify(run, c, run.entries).catch((err) => log.warn?.(`[characters] identity check: ${err.message}`));
    run.jobId = null;
    const failed = run.entries.filter((e) => e.status === 'error');
    run.status = failed.some((e) => e.core) ? 'error' : 'done';
    if (run.status === 'error') run.message = failed[0].error;
    if (run.status === 'done') c.sheetStale = false;
    await locked(c.id, () => save(c));
  }

  async function start() {
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    await loadAll();
    await pull();
  }

  return {
    dir,
    start,
    attach,
    list,
    get,
    /** Whether a character is saved and usable (no files are fetched). */
    has: (id) => Boolean(readyOf(id)),
    getAny: lookup,
    view,
    create,
    update,
    rename,
    duplicate,
    remove,
    accept,
    reference,
    file,
    check: checkWords,
    startSheet,
    regenerate,
    stop,
    sheet: sheetState,
    views: viewsFor,
  };
}
