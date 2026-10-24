import { ideaFor } from '../../shell/orb/assist';
import { cloudReady, cloudText } from '../../services/ai/CloudAi';

/**
 * "Fill for me": an idea for a text box in Make. The orb's own idea first; if it has none, a quick
 * one from cloud AI; offline, one from a short list written here. Each tap (n = 0, 1, 2…) gives a
 * different one.
 */

export type IdeaBox = 'picture' | 'video' | 'edit' | 'vedit' | 'replace' | 'erase' | 'swap' | 'restyle' | 'extend' | 'motion' | 'talking' | CharacterBox;
/** The boxes of the character maker. */
export type CharacterBox = 'charname' | 'charidea' | 'charmarks' | 'charoutfit' | 'charpersonality';

const LOCAL: Record<IdeaBox, string[]> = {
  picture: [
    'A lighthouse on a cliff at dawn, mist rolling over a silver sea, warm light in the window',
    'A fox curled up asleep in fresh snow under a pine tree, soft blue evening light',
    'A tiny café on a rainy Paris street at night, neon reflections on the cobbles',
    'A hot air balloon drifting over lavender fields in Provence, golden hour',
    'An astronaut reading a book in a field of sunflowers, cinematic, shallow focus',
    'A cosy cabin library with a fireplace, a sleeping cat and snow outside the window',
  ],
  video: [
    'Waves rolling onto a beach at sunset, slow camera push in, the hiss of the surf and distant gulls',
    'A paper boat sailing down a rainy street gutter, close tracking shot, rain pattering',
    'A barista pours latte art in slow motion, steam rising, soft café chatter',
    'Fireflies rising from a meadow at dusk as the camera drifts forward, crickets singing',
    'A red kite dancing in a blue sky above a hill, wind rushing, children laughing',
    'City lights flickering on at dusk seen from a rooftop, slow pan, distant traffic hum',
  ],
  edit: [
    'Make it night with a full moon and soft blue light',
    'Add gentle snow falling and frost on every surface',
    'Turn it into a watercolour painting',
    'Change the season to autumn, with orange leaves everywhere',
    'Make the sky a dramatic sunset in pink and gold',
    'Give it the look of an old film photo, warm and grainy',
  ],
  vedit: [
    'Turn the whole scene into a watercolour painting',
    'Make it look like a claymation film',
    'Give it the warm look of an old home movie',
  ],
  replace: ['A white horse', 'A vintage red bicycle', 'A giant friendly whale', 'A bunch of yellow balloons'],
  erase: ['The person in the background', 'The watermark in the corner', 'The car on the left', 'The power lines in the sky'],
  // Who to swap: a person, named by where they are or what they wear.
  swap: ['The man in the red jacket', 'The woman on the left', 'The person dancing in the middle', 'The runner in the blue top'],
  restyle: ['A watercolour painting', 'A claymation film', 'A comic book with bold ink lines', 'An oil painting in the style of the old masters'],
  extend: ['The camera pulls back to reveal the whole city', 'She turns, smiles and walks out of frame', 'The sun sets and the lights come on', 'A flock of birds flies across the sky'],
  motion: ['She dances in a sunlit room', 'He waves and walks towards the camera', 'They turn their head and laugh', 'A slow spin with the arms out wide'],
  talking: ['She sings softly on a small stage, warm spotlight', 'He talks to the camera in a cosy study', 'A friendly hello in a sunny garden'],
  // The character maker: invented names and looks only, never real people.
  charname: ['Mira Vale', 'Tomas Reyes', 'Ines Okafor', 'Kenji Hale', 'Saoirse Lund', 'Dario Voss', 'Noor Castell', 'Elio Marsh'],
  charidea: [
    'A retired lighthouse keeper who restores old clocks',
    'A sharp-tongued detective who loves jazz and rainy nights',
    'A cheerful pastry chef with a secret past as a sailor',
    'A calm space pilot who writes letters home',
    'A wandering healer with silver hair and a long coat',
    'A sunny botanist who talks to her plants',
  ],
  charmarks: ['A small scar over the left eyebrow', 'Freckles across the nose and a gap in the front teeth', 'A silver streak in the hair and laugh lines', 'A tiny mole under the right eye', 'Ink on the fingers and a worn leather watch'],
  charoutfit: ['A charcoal wool coat over a cream sweater and dark jeans', 'A forest-green linen shirt, brown trousers and boots', 'A tailored navy suit with a white open collar', 'A mustard raincoat over a striped top and black trousers', 'A denim jacket, white tee and tan boots'],
  charpersonality: [
    'Dry humour, fiercely loyal, hates early mornings and loves good coffee.',
    'Warm and curious, always asking questions, a little bit clumsy.',
    'Calm and watchful, speaks softly, never wastes a word.',
    'Bold and playful, laughs easily, loves a dare.',
  ],
};

/** Words that change between ideas (the cloud is asked for a fresh one each time). */
const ASK =
  'You suggest ideas for a picture and video maker. Reply with one idea only: a vivid description in plain everyday words, under 40 words. ' +
  'No quotes, no lists, no title, nothing else. Keep it suitable for everyone and never about real, named people.';

function tidy(text: string) {
  return text
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/^(idea|here'?s? (is )?(an|one) idea)\s*[:\-–]\s*/i, '')
    .split('\n')[0]
    .trim();
}

/** What each character box wants, so a name is a name and not a picture prompt. */
const CHARACTER_ASK: Record<CharacterBox, string> = {
  charname: 'You suggest a name for a made-up adult character. Reply with a first name and a last name only, invented, never a real or famous person. Nothing else.',
  charidea: 'You suggest a one-line idea for a made-up adult character (25 or older): who they are and what they are like, in plain words, under 20 words. Never a real or famous person. Nothing else.',
  charmarks: 'You suggest distinguishing marks for a made-up adult character: a scar, freckles, a tattoo, glasses or similar, in plain words, under 15 words. Nothing else.',
  charoutfit: 'You suggest an everyday outfit for a made-up adult character: clothes and colours, fully dressed, in plain words, under 20 words. Nothing else.',
  charpersonality: 'You suggest personality notes for a made-up adult character: two or three traits and a habit, in plain words, under 25 words. Nothing else.',
};
const isCharacterBox = (box: IdeaBox): box is CharacterBox => box in CHARACTER_ASK;

export async function fillIdea(box: IdeaBox, context: string, current: string, n: number, before: string[]): Promise<string> {
  const character = isCharacterBox(box);
  if (!character) {
    try {
      const own = tidy(await ideaFor(context, current, n));
      if (own) return own;
    } catch {
      /* the orb had nothing */
    }
  }
  try {
    if (await cloudReady()) {
      const text = tidy(
        await cloudText({
          task: 'write',
          maxTokens: 120,
          temperature: 1,
          messages: [
            { role: 'system', content: isCharacterBox(box) ? CHARACTER_ASK[box] : ASK },
            {
              role: 'user',
              content: `${context}\n${current.trim() ? `What is written now: ${current.trim()}\n` : ''}${before.length ? `Not any of these: ${before.slice(-4).join(' | ')}\n` : ''}Give idea number ${n + 1}.`,
            },
          ],
        }),
      );
      if (text && !before.includes(text)) return text;
    }
  } catch {
    /* offline, or cloud AI is off */
  }
  const list = LOCAL[box];
  // Never the same as what is already in the box.
  for (let k = 0; k < list.length; k++) {
    const pick = list[(n + k) % list.length];
    if (pick !== current.trim()) return pick;
  }
  return list[0];
}
