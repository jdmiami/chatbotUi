import { cloudReady, cloudText } from '../../services/ai/CloudAi';
import { MIN_AGE, type Character, type CharacterGender, type CharacterInput, type CharacterStyle } from '../../services/ai/Characters';

/**
 * What the character maker offers on each step, the draft a person fills in, and "design it for
 * me": a whole character from a one-line idea (cloud AI when it is on, else written rules here).
 * The AI machine has the last word on every rule (no kids, nobody real, nothing sexual); the age
 * is checked here too so it can be said straight away.
 */

export const STYLES: { id: CharacterStyle; label: string; hint: string }[] = [
  { id: 'photoreal', label: 'Photoreal', hint: 'Like a photograph' },
  { id: 'anime', label: 'Anime', hint: 'Clean lines, anime colours' },
  { id: 'illustration', label: 'Illustration', hint: 'Painted, storybook look' },
];
export const GENDERS: { id: CharacterGender; label: string }[] = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'androgynous', label: 'Androgynous' },
];

export type TraitKey = 'build' | 'height' | 'skin' | 'face' | 'eyes' | 'hair';
export const OPTIONS: Record<TraitKey, string[]> = {
  build: ['Slim', 'Athletic', 'Average', 'Curvy', 'Muscular', 'Stocky'],
  height: ['Short', 'Average height', 'Tall'],
  skin: ['Fair', 'Light', 'Olive', 'Tan', 'Brown', 'Dark'],
  face: ['Oval', 'Round', 'Square', 'Heart-shaped', 'Long', 'Angular'],
  eyes: ['Brown', 'Hazel', 'Green', 'Blue', 'Grey', 'Amber'],
  hair: ['Long wavy dark brown', 'Short black', 'Curly red', 'Silver bob', 'Blonde ponytail', 'Shaved sides, dark curls'],
};
export const TRAIT_LABEL: Record<TraitKey, string> = { build: 'Build', height: 'Height', skin: 'Skin', face: 'Face shape', eyes: 'Eyes', hair: 'Hair' };

export interface Draft {
  name: string;
  age: string;
  idea: string;
  style: CharacterStyle;
  gender: CharacterGender;
  build: string;
  height: string;
  skin: string;
  face: string;
  eyes: string;
  hair: string;
  marks: string;
  outfits: string[];
  personality: string;
}

export const emptyDraft = (): Draft => ({
  name: '',
  age: '',
  idea: '',
  style: 'photoreal',
  gender: 'woman',
  build: '',
  height: '',
  skin: '',
  face: '',
  eyes: '',
  hair: '',
  marks: '',
  outfits: [''],
  personality: '',
});

export function draftOf(c: Character): Draft {
  const t = c.traits;
  return {
    name: c.name,
    age: String(c.age),
    idea: c.idea ?? '',
    style: t.style,
    gender: t.gender,
    build: t.build ?? '',
    height: t.height ?? '',
    skin: t.skin ?? '',
    face: t.face ?? '',
    eyes: t.eyes ?? '',
    hair: t.hair ?? '',
    marks: t.marks ?? '',
    outfits: t.outfits?.length ? [...t.outfits] : [''],
    personality: t.personality ?? '',
  };
}

export function inputOf(d: Draft): CharacterInput {
  return {
    name: d.name.trim(),
    age: d.age.trim(),
    idea: d.idea.trim() || undefined,
    traits: {
      style: d.style,
      gender: d.gender,
      build: d.build.trim(),
      height: d.height.trim(),
      skin: d.skin.trim(),
      face: d.face.trim(),
      eyes: d.eyes.trim(),
      hair: d.hair.trim(),
      marks: d.marks.trim(),
      outfits: d.outfits.map((o) => o.trim()).filter(Boolean),
      personality: d.personality.trim(),
    },
  };
}

/** The age on its own: said straight away, before the machine is asked. */
export function ageProblem(age: string): string | null {
  if (!age.trim()) return null;
  const n = Number(age.trim());
  if (!/^\d{1,3}$/.test(age.trim()) || !Number.isInteger(n)) return `Type their age as a number, ${MIN_AGE} or more.`;
  if (n < MIN_AGE) return `A character must be ${MIN_AGE} or older.`;
  if (n > 120) return 'Pick an age up to 120.';
  return null;
}

/** What is still missing before the sheet can be made, in plain words (null: nothing). */
export function missingFor(d: Draft): string | null {
  if (!d.name.trim()) return 'Give them a name.';
  if (!d.age.trim()) return `Give them an age (${MIN_AGE} or older).`;
  const a = ageProblem(d.age);
  if (a) return a;
  if (!d.hair.trim() && !d.eyes.trim() && !d.face.trim() && !d.build.trim()) return 'Say a little about how they look: hair, eyes, face or build.';
  return null;
}

// ---------------------------------------------------------------- design it for me

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const pick = <T,>(list: T[], seed: number, shift = 0) => list[(seed >>> shift) % list.length];

const NAMES = ['Mira Vale', 'Tomas Reyes', 'Ines Okafor', 'Kenji Hale', 'Saoirse Lund', 'Dario Voss', 'Noor Castell', 'Elio Marsh', 'Wren Alder', 'Soledad Park', 'Anselm Rook', 'Priya Lindqvist'];
const OUTFITS: [RegExp, string][] = [
  [/knight|armou?r|paladin/, 'polished steel armour over a dark blue tabard and leather boots'],
  [/detective|noir|spy/, 'a long trench coat over a grey suit and a loosened tie'],
  [/pirate|sailor|captain/, 'a weathered navy captain coat, white shirt and tall boots'],
  [/space|astronaut|pilot/, 'a fitted orange flight suit with patches and worn gloves'],
  [/doctor|healer|nurse/, 'a long green coat over a cream shirt with a leather satchel'],
  [/chef|baker|pastry/, 'a crisp white chef jacket with rolled sleeves and a blue apron'],
  [/wizard|witch|mage|sorcer/, 'deep purple robes with silver stitching and a heavy cloak'],
  [/botanist|gardener|farmer/, 'a linen shirt, canvas apron, muddy boots and a straw hat'],
  [/cyber|neon|hacker/, 'a black tech jacket with glowing teal trim and cargo trousers'],
  [/lighthouse|clock|keeper|retired/, 'a thick cable-knit jumper, corduroy trousers and round glasses'],
];
const DEFAULT_OUTFITS = ['A charcoal wool coat over a cream sweater and dark jeans', 'A forest-green linen shirt, brown trousers and boots', 'A mustard raincoat over a striped top and black trousers', 'A tailored navy suit with a white open collar'];
const PERSONALITIES = [
  'Dry humour, fiercely loyal, hates early mornings and loves good coffee.',
  'Warm and curious, always asking questions, a little bit clumsy.',
  'Calm and watchful, speaks softly, never wastes a word.',
  'Bold and playful, laughs easily, loves a dare.',
];
const MARKS = ['A small scar over the left eyebrow', 'Freckles across the nose', 'Laugh lines and a silver streak in the hair', 'A tiny mole under the right eye', 'Ink stains on the fingers'];
const COLOURS: [RegExp, string][] = [
  [/\bred\b|ginger/, 'red'],
  [/silver|grey|gray|white/, 'silver'],
  [/blond/, 'blonde'],
  [/black/, 'black'],
  [/brown/, 'brown'],
];

/** A whole character from a one-line idea, by rules written here (no AI, always something sensible). */
export function localDesign(idea: string, n = 0): Draft {
  const text = idea.toLowerCase();
  const seed = hash(`${text}#${n}`);
  const d = emptyDraft();
  d.idea = idea.trim();
  d.style = /anime|manga/.test(text) ? 'anime' : /illustrat|painting|storybook|comic|cartoon/.test(text) ? 'illustration' : 'photoreal';
  d.gender = /androgyn|non-?binary/.test(text) ? 'androgynous' : /\b(man|male|guy|he|him|king|knight|gentleman|husband|father|grandfather|uncle|brother)\b/.test(text) ? 'man' : /\b(woman|female|she|her|queen|lady|wife|mother|grandmother|aunt|sister)\b/.test(text) ? 'woman' : pick(['woman', 'man'] as CharacterGender[], seed, 3);
  const said = /\b([2-9]\d|1[01]\d)\b/.exec(text);
  d.age = String(said && Number(said[1]) >= MIN_AGE ? said[1] : /old|elder|retired|grand/.test(text) ? 64 : 28 + (seed % 22));
  d.name = pick(NAMES, seed, 5);
  d.build = pick(OPTIONS.build, seed, 7);
  d.height = pick(OPTIONS.height, seed, 9);
  d.skin = pick(OPTIONS.skin, seed, 11);
  d.face = pick(OPTIONS.face, seed, 13);
  d.eyes = pick(OPTIONS.eyes, seed, 15);
  const colour = COLOURS.find(([re]) => re.test(text))?.[1];
  d.hair = colour ? `${/short|bob|crop/.test(text) ? 'short' : 'long wavy'} ${colour}` : pick(OPTIONS.hair, seed, 17);
  d.marks = pick(MARKS, seed, 19);
  d.outfits = [OUTFITS.find(([re]) => re.test(text))?.[1] ?? pick(DEFAULT_OUTFITS, seed, 21)];
  d.personality = pick(PERSONALITIES, seed, 23);
  return d;
}

const DESIGN_ASK =
  'You design a made-up adult character (25 or older) from a one-line idea. Never a real or famous person, never a child or teenager, nothing sexual, fully clothed. ' +
  'Reply with ONLY a JSON object with these keys, each a short plain-words phrase: ' +
  '"name" (an invented first and last name), "age" (a number from 25 to 80), "style" (photoreal, anime or illustration), "gender" (woman, man or androgynous), ' +
  '"build", "height", "skin", "face" (face shape), "eyes", "hair", "marks" (distinguishing marks, may be empty), "outfit" (everyday clothes), "personality" (two or three traits and a habit).';

const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');

/** Read a design from a model's reply; null when it is not usable. */
export function parseDesign(reply: string, idea: string): Draft | null {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const age = Math.round(Number(o.age));
  if (!text(o.name, 40) || !Number.isFinite(age) || age < MIN_AGE || age > 120) return null;
  const d = emptyDraft();
  d.idea = idea.trim();
  d.name = text(o.name, 40);
  d.age = String(age);
  d.style = o.style === 'anime' || o.style === 'illustration' ? o.style : 'photoreal';
  d.gender = o.gender === 'man' || o.gender === 'androgynous' ? o.gender : 'woman';
  for (const k of ['build', 'height', 'skin', 'face', 'eyes'] as const) d[k] = text(o[k], 60);
  d.hair = text(o.hair, 100);
  d.marks = text(o.marks, 200);
  d.outfits = [text(o.outfit, 140)].filter(Boolean);
  if (!d.outfits.length) d.outfits = [''];
  d.personality = text(o.personality, 300);
  return d;
}

/** Design a whole character from one line: cloud AI when it is on, else the rules above. `n` asks for another. */
export async function designFromIdea(idea: string, n = 0): Promise<Draft> {
  try {
    if (await cloudReady()) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const reply = await cloudText({
          task: 'write',
          maxTokens: 400,
          temperature: Math.min(1.2, 0.8 + n * 0.1),
          signal: ctrl.signal,
          messages: [
            { role: 'system', content: DESIGN_ASK },
            { role: 'user', content: `Idea: ${idea.trim()}${n ? `\nGive a different take (attempt ${n + 1}).` : ''}` },
          ],
        });
        const d = parseDesign(reply, idea);
        if (d) return d;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    /* cloud AI is off or offline */
  }
  return localDesign(idea, n);
}
