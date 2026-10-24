// How a saved character turns into words for the makers. Pure functions with no imports, so the
// studio (studio.js) and the character store (characters.js) can both use them.
//
// A character's description is built here from its checked fields only: letters, numbers and plain
// punctuation, each field cut short. Nothing a person typed goes into a prompt unchanged, so a
// character can't smuggle instructions or links into what the makers read.

export const STYLE_WORDS = { photoreal: 'photorealistic', anime: 'anime-style', illustration: 'digitally illustrated' };
export const GENDER_WORDS = { woman: 'woman', man: 'man', androgynous: 'androgynous person' };

/** Plain words only: letters, numbers, spaces and , . ' - & ( ) / ; cut to `max` characters. */
export function plainText(value, max = 120) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/[^\p{L}\p{N}\s,.'’\-&()/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

const lower = (s) => plainText(s, 200).toLowerCase();
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * The description that goes at the start of a prompt: who they are, in plain words. Clothes are not
 * part of it (the outfit goes in separately, see injectCharacter).
 */
export function descriptorOf({ age, traits = {} }) {
  const gender = GENDER_WORDS[traits.gender] || GENDER_WORDS.woman;
  const style = STYLE_WORDS[traits.style] || STYLE_WORDS.photoreal;
  const who = `${article(style)} ${style} ${Number(age)}-year-old ${gender}`;
  const bits = [];
  const add = (v, suffix = '') => {
    const t = lower(v);
    if (t) bits.push(`${t}${suffix}`);
  };
  add(traits.build, ' build');
  add(traits.height);
  add(traits.skin, ' skin');
  add(traits.face, ' face');
  add(traits.eyes, ' eyes');
  add(traits.hair, ' hair');
  const marks = lower(traits.marks);
  if (marks) bits.push(marks);
  const text = `${who}${bits.length ? `, ${bits.join(', ')}` : ''}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The clothes a character usually wears (the first outfit), or ''. */
export const usualOutfit = (character) => lower(character?.traits?.outfits?.[0] ?? '');

const CLOTHES = /\b(wear|wears|wearing|wore|dressed|dress|outfit|clothes|clothing|suit|jacket|coat|shirt|sweater|hoodie|uniform|costume|gown|armou?r|robe|jeans|skirt)\b/i;

/**
 * Put a character's description at the start of a prompt. Their usual outfit follows unless the
 * prompt already talks about clothes. The prompt itself is kept as it is.
 */
export function injectCharacter(prompt, character) {
  const descriptor = plainText(character?.descriptor, 700);
  if (!descriptor) return String(prompt || '');
  const text = String(prompt || '').trim();
  const outfit = usualOutfit(character);
  const wearing = outfit && !CLOTHES.test(text) ? `, wearing ${outfit}` : '';
  return text ? `${descriptor}${wearing}. ${text}` : `${descriptor}${wearing}.`;
}
