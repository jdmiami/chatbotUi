import type { Answers, Choice, StepDef, StudioDef } from '../defs';

/** After Dark: the adult studio. Fictional adults only; the machine's own rules still apply. */

const solo = (a: Answers) => /alone|^a (woman|man)$/i.test(a.cast ?? '');
const director = (a: Answers) => a.cut === "Director's cut";

const CAST: Choice[] = [
  { label: 'A woman', hint: 'One lead, all eyes on her', adds: 'one adult woman' },
  { label: 'A man', hint: 'One lead, all eyes on him', adds: 'one adult man' },
  { label: 'A couple', hint: 'A woman and a man', adds: 'an adult couple, a woman and a man' },
  { label: 'Two women', hint: 'Two leads together', adds: 'two adult women together' },
  { label: 'Two men', hint: 'Two leads together', adds: 'two adult men together' },
];
const LOOKS: Choice[] = [
  { label: 'Late twenties, dark curls, freckles', hint: 'Soft and natural' },
  { label: 'Thirties, sharp jaw, silver rings', hint: 'Confident, a little dangerous' },
  { label: 'Athletic, sun-kissed, short hair', hint: 'Outdoorsy and warm' },
  { label: 'Curvy, red lipstick, sleek bob', hint: 'Old-Hollywood glamour' },
];
const MOOD: Choice[] = [
  { label: 'Slow burn', hint: 'Glances, tension, distance' },
  { label: 'Playful', hint: 'Laughter and warm light' },
  { label: 'Romantic', hint: 'Close, tender, unhurried' },
  { label: 'Intense', hint: 'Shadows and heat' },
];
const ROOM: Choice[] = [
  { label: 'Penthouse at night', hint: 'City lights through glass' },
  { label: 'Velvet lounge', hint: 'Low lamps, deep colour' },
  { label: 'Rainy hotel window', hint: 'Reflections and neon' },
  { label: 'Candlelit studio', hint: 'Painterly and soft' },
  { label: 'Sunlit bedroom', hint: 'White linen, morning light' },
];
const WARDROBE: Choice[] = [
  { label: 'Evening wear', hint: 'Fully dressed, dressed up' },
  { label: 'Lingerie', hint: 'Lace, silk, sheer' },
  { label: 'Implied nude', hint: 'Sheets, shadows, strategic' },
  { label: 'Nude, artistic', hint: 'Fine-art nude' },
];
const FINISH: Choice[] = [
  { label: 'Film noir', hint: 'Black and white, hard light', adds: 'film noir, black and white, hard light, deep shadows' },
  { label: 'Glossy editorial', hint: 'Fashion-magazine polish', adds: 'glossy fashion editorial photograph, studio polish' },
  { label: 'Candlelit painting', hint: 'Oil, warm and grainy', adds: 'oil painting look, warm candlelight, visible grain' },
  { label: 'Super 8 memory', hint: 'Faded, flickering', adds: 'super 8 film, faded colours, soft flicker' },
  { label: 'Polaroid flash', hint: 'Direct flash, instant film', adds: 'polaroid, direct flash, instant film colours' },
];
const SHAPE: Choice[] = [
  { label: 'Portrait', hint: 'Tall, for phones' },
  { label: 'Square', hint: 'Even all round' },
  { label: 'Landscape', hint: 'Wide, cinematic' },
];

const cast = (q = 'Who is *in it?*'): StepDef => ({ id: 'cast', kick: 'Chapter 01 · The cast', q, dek: 'Everyone here is a fictional adult.', key: 'Cast', choices: CAST });
const lookOf = (id: string, key: string, q: string, when?: (a: Answers) => boolean): StepDef => ({
  id,
  kick: 'Chapter 02 · Their look',
  q,
  dek: 'Face, hair, build. The more you say, the more it feels like them.',
  key,
  choices: LOOKS,
  when,
});
const mood: StepDef = { id: 'mood', kick: 'Chapter 03 · Mood', q: 'What is the *mood?*', dek: 'This sets the pace and the light.', key: 'Mood', choices: MOOD };
const room: StepDef = { id: 'room', kick: 'Chapter 04 · The room', q: 'Where are *we?*', dek: 'The place does half the work.', key: 'Setting', choices: ROOM };
const wardrobe: StepDef = { id: 'wardrobe', kick: 'Chapter 05 · Wardrobe', q: 'How *dressed?*', dek: 'From evening wear to nothing at all.', key: 'Wardrobe', choices: WARDROBE };
const finish: StepDef = { id: 'finish', kick: 'Chapter · The look', q: 'How should it *look?*', dek: 'The finish of every frame.', key: 'Look', choices: FINISH };
const shape: StepDef = { id: 'shape', kick: 'Last · The frame', q: 'Which *shape?*', key: 'Shape', choices: SHAPE, closed: true, predict: false, meta: true };

export const AFTER_DARK: StudioDef = {
  id: 'afterdark',
  name: 'After Dark',
  mark: ['After', 'Dark'],
  kicker: 'An Orbit studio · 18+',
  adult: true,
  theme: {
    paper: '#f1e6e3',
    ink: '#1f1320',
    ink2: '#634f5f',
    accent: '#7a2d68',
    desk: '#0e0a0e',
    desk2: '#1a121a',
    orbA: '#ffd0e6',
    orbB: '#6b2a5c',
  },
  writer:
    'You are the writer of After Dark, an adult studio for sensual and erotic pictures, videos and short films. Every character is a fictional adult aged 25 or older. Never involve minors or anyone young-looking, real or famous people, or anything without clear consent. Write vivid, tasteful, cinematic suggestions.',
  tail: 'fictional adults aged 25 or older, consenting, cinematic lighting, high detail',
  characters: 'Characters',
  makers: { image: ['qwen-real', 'krea-real', 'qwen'], video: ['h3-max', 'ltx'], movie: 'h3-max' },
  rules: ['Fictional adults only, every one 25 or older', 'No real or famous people, and no photos of real people', 'Consent always', 'Nothing involving minors, ever'],
  flows: {
    image: {
      kind: 'image',
      label: 'A picture',
      hint: 'One frame, made in under a minute',
      steps: [
        cast(),
        lookOf('looks', 'Appearance', 'Describe *them.*'),
        mood,
        room,
        wardrobe,
        {
          id: 'moment',
          kick: 'Chapter 06 · The moment',
          q: 'What are they *doing?*',
          key: 'Moment',
          choices: [
            { label: 'Looking into the lens', hint: 'A direct, knowing gaze' },
            { label: 'An embrace', hint: 'Close, skin to skin' },
            { label: 'Getting ready', hint: 'A mirror, a zip, a glance back' },
            { label: 'Lying back, relaxed', hint: 'Unhurried, at ease' },
          ],
        },
        finish,
        shape,
      ],
    },
    video: {
      kind: 'video',
      label: 'A video',
      hint: 'A few seconds, moving, with sound',
      steps: [
        cast(),
        lookOf('looks', 'Appearance', 'Describe *them.*'),
        mood,
        room,
        wardrobe,
        {
          id: 'action',
          kick: 'Chapter 06 · The action',
          q: 'What *happens?*',
          key: 'Action',
          choices: [
            { label: 'A slow dance', hint: 'Swaying close' },
            { label: 'A first kiss', hint: 'The moment before, then it' },
            { label: 'A slow undress', hint: 'One piece at a time' },
            { label: 'Turning to the camera', hint: 'A look over the shoulder' },
          ],
        },
        {
          id: 'camera',
          kick: 'Chapter 07 · Camera',
          q: 'How does the *camera* move?',
          key: 'Camera',
          choices: [
            { label: 'Slow push-in', hint: 'Drawing closer', adds: 'slow push-in camera move' },
            { label: 'Handheld, close', hint: 'Intimate and alive', adds: 'handheld close-up camera' },
            { label: 'Circling them', hint: 'A slow orbit', adds: 'camera slowly circling around them' },
            { label: 'Locked off', hint: 'Still frame, they move', adds: 'static locked-off camera' },
          ],
        },
        {
          id: 'sound',
          kick: 'Chapter 08 · Sound',
          q: 'What do we *hear?*',
          key: 'Sound',
          choices: [
            { label: 'Room tone and breath', hint: 'Quiet and close', adds: 'sound: quiet room tone and soft breathing' },
            { label: 'Soft music', hint: 'Slow, low strings', adds: 'sound: soft slow music' },
            { label: 'Whispered words', hint: 'A line or two', adds: 'sound: whispered words' },
            { label: 'Rain outside', hint: 'On the window', adds: 'sound: rain on the window' },
          ],
        },
        finish,
        {
          id: 'length',
          kick: 'Last · Length',
          q: 'How *long?*',
          key: 'Length',
          choices: [
            { label: '3 seconds', hint: 'A glance' },
            { label: '5 seconds', hint: 'A moment' },
            { label: '8 seconds', hint: 'A whole beat' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
        { ...shape, id: 'vshape', choices: [SHAPE[2], SHAPE[0], SHAPE[1]] },
      ],
    },
    movie: {
      kind: 'movie',
      label: 'A movie',
      hint: 'Several scenes, cut together',
      steps: [
        {
          id: 'cut',
          kick: 'Opening · The cut',
          q: 'Quick film or *director’s cut?*',
          dek: 'Quick asks five questions and writes the rest. Director’s cut builds every part with you.',
          key: 'Cut',
          choices: [
            { label: 'Quick film', hint: 'Five questions, about 15 seconds of film' },
            { label: "Director's cut", hint: 'Cast, story, scenes and storyboard, up to 30 seconds' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'premise',
          kick: 'Chapter 01 · The story',
          q: 'What is the *story?*',
          dek: 'One line is enough. We build on it.',
          key: 'Story',
          choices: [
            { label: 'Strangers snowed in at a cabin', hint: 'One fire, one bed' },
            { label: 'Ex-lovers meet at a wedding', hint: 'Unfinished business' },
            { label: 'A photographer and her muse', hint: 'The shoot runs late' },
            { label: 'A masquerade in Venice', hint: 'Masks on, rules off' },
          ],
        },
        cast('Who is the *cast?*'),
        lookOf('lead', 'Lead', 'Describe the *lead.*', director),
        lookOf('partner', 'Partner', 'And the *other one?*', (a) => director(a) && !solo(a)),
        { ...room, id: 'world', kick: 'Chapter 03 · The world', q: 'Where does it *happen?*', when: director },
        {
          id: 'beats',
          kick: 'Chapter 04 · The arc',
          q: 'How does it *unfold?*',
          dek: 'The shape of the story, start to finish.',
          key: 'Arc',
          when: director,
          choices: [
            { label: 'Slow burn to a kiss', hint: 'Tension, then release' },
            { label: 'Argument turns to passion', hint: 'Heat both ways' },
            { label: 'A game of seduction', hint: 'Who gives in first' },
            { label: 'Tender reunion', hint: 'Years apart, one night' },
          ],
        },
        {
          id: 'scenes',
          kick: 'Chapter 05 · Scenes',
          q: 'How many *scenes?*',
          key: 'Scenes',
          when: director,
          choices: [
            { label: '3 scenes', hint: 'About 15 seconds' },
            { label: '4 scenes', hint: 'About 20 seconds' },
            { label: '6 scenes', hint: 'About 30 seconds' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'mcamera',
          kick: 'Chapter 06 · Camera',
          q: 'How is it *shot?*',
          key: 'Camera',
          when: director,
          choices: [
            { label: 'Classic and slow', hint: 'Long, patient takes', adds: 'slow classic camera work, long takes' },
            { label: 'Handheld and intimate', hint: 'Close, breathing with them', adds: 'intimate handheld camera, close-ups' },
            { label: 'Music-video gloss', hint: 'Slow motion, glints', adds: 'glossy music-video style, slow motion' },
          ],
        },
        {
          id: 'msound',
          kick: 'Chapter 07 · Sound',
          q: 'What do we *hear?*',
          key: 'Sound',
          when: director,
          choices: [
            { label: 'Music', hint: 'A score under every scene' },
            { label: 'Their voices', hint: 'Lines spoken in the shots' },
            { label: 'Quiet', hint: 'Only the room' },
            { label: 'You choose', hint: 'The writer picks per scene' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
        finish,
        {
          id: 'review',
          kick: 'Last · Storyboard',
          q: 'See the *storyboard* first?',
          dek: 'One picture per scene. Approve it, or change a frame, before the film is made.',
          key: 'Storyboard',
          when: director,
          choices: [
            { label: 'Yes, show me first', hint: 'Approve before filming' },
            { label: 'No, make it all', hint: 'Straight to the film' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
      ],
    },
  },
};
