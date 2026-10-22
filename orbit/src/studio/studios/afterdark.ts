import type { Answers, Choice, StepDef, StudioDef } from '../defs';

/** After Dark: the adult studio. Fictional adults only; the machine's own rules still apply. */

const solo = (a: Answers) => /alone|^a (woman|man)$/i.test(a.cast ?? '');
const director = (a: Answers) => a.cut === "Director's cut";

const CAST: Choice[] = [
  { label: 'A woman', hint: 'One lead, all eyes on her', adds: 'one adult woman' },
  { label: 'A man', hint: 'One lead, all eyes on him', adds: 'one adult man' },
  { label: 'A couple', hint: 'A woman and a man', adds: 'an adult couple, a woman and a man', suits: ['strangers', 'lovers', 'wedding', 'reunit', 'affair', 'masquerade', 'couple', 'romantic'] },
  { label: 'Two women', hint: 'Two leads together', adds: 'two adult women together', suits: ['her muse', 'two women'] },
  { label: 'Two men', hint: 'Two leads together', adds: 'two adult men together' },
];
const LOOKS: Choice[] = [
  { label: 'Late twenties, dark curls, freckles', hint: 'Soft and natural' },
  { label: 'Thirties, sharp jaw, silver rings', hint: 'Confident, a little dangerous' },
  { label: 'Athletic, sun-kissed, short hair', hint: 'Outdoorsy and warm' },
  { label: 'Curvy, red lipstick, sleek bob', hint: 'Old-Hollywood glamour' },
];
const MOOD: Choice[] = [
  { label: 'Slow burn', hint: 'Glances, tension, distance', suits: ['strangers', 'cabin', 'snow', 'tension', 'slow'] },
  { label: 'Playful', hint: 'Laughter and warm light', suits: ['game', 'masquerade', 'tease', 'play', 'flirt'] },
  { label: 'Romantic', hint: 'Close, tender, unhurried', suits: ['reunit', 'lovers', 'wedding', 'years', 'tender'] },
  { label: 'Intense', hint: 'Shadows and heat', suits: ['forbidden', 'secret', 'dark', 'neon', 'power'] },
];
const ROOM: Choice[] = [
  { label: 'Penthouse at night', hint: 'City lights through glass', suits: ['power', 'game', 'glossy', 'thirties'] },
  { label: 'Velvet lounge', hint: 'Low lamps, deep colour', suits: ['intense', 'forbidden', 'secret', 'lipstick'] },
  { label: 'Rainy hotel window', hint: 'Reflections and neon', suits: ['slow burn', 'strangers', 'midnight', 'rain', 'neon'] },
  { label: 'Candlelit studio', hint: 'Painterly and soft', suits: ['romantic', 'muse', 'photographer', 'painting', 'freckles'] },
  { label: 'Sunlit bedroom', hint: 'White linen, morning light', suits: ['playful', 'tender', 'sun-kissed', 'morning'] },
];
const WARDROBE: Choice[] = [
  { label: 'Evening wear', hint: 'Fully dressed, dressed up' },
  { label: 'Lingerie', hint: 'Lace, silk, sheer' },
  { label: 'Implied nude', hint: 'Sheets, shadows, strategic' },
  { label: 'Nude, artistic', hint: 'Fine-art nude' },
];
const FINISH: Choice[] = [
  { label: 'Film noir', hint: 'Black and white, hard light', adds: 'film noir, black and white, hard light, deep shadows', suits: ['rain', 'noir', '1950s', 'twist', 'dark', 'forbidden'] },
  { label: 'Glossy editorial', hint: 'Fashion-magazine polish', adds: 'glossy fashion editorial photograph, studio polish', suits: ['penthouse', 'photographer', 'muse', 'game', 'glamour'] },
  { label: 'Candlelit painting', hint: 'Oil, warm and grainy', adds: 'oil painting look, warm candlelight, visible grain', suits: ['candle', 'cabin', 'venice', 'palazzo', 'romantic'] },
  { label: 'Super 8 memory', hint: 'Faded, flickering', adds: 'super 8 film, faded colours, soft flicker', suits: ['reunion', 'reunit', 'years', 'letters', 'memory'] },
  { label: 'Polaroid flash', hint: 'Direct flash, instant film', adds: 'polaroid, direct flash, instant film colours', suits: ['playful', 'party', 'sunlit'] },
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
  talk: {
    starters: [
      { label: 'Slow-burn tension', hint: 'Glances, waiting, the long build-up' },
      { label: 'Strangers after midnight', hint: 'A hotel bar, one more drink' },
      { label: 'Lovers reunited', hint: 'Years apart, one night back' },
      { label: 'Something forbidden', hint: 'A secret neither should keep' },
      { label: 'Playful and teasing', hint: 'Light, flirty, a little wicked' },
      { label: 'Dark and intense', hint: 'Power, rain, neon, no small talk' },
    ],
    followUps: [
      { label: 'Take it further', hint: 'What happens next' },
      { label: 'Make it more intense', hint: 'Turn the heat up' },
      { label: 'Give me three directions', hint: 'Different ways it could go' },
      { label: 'Turn it into a scene', hint: 'Who, where, the moment' },
      { label: 'Change the setting', hint: 'Same story, somewhere new' },
    ],
  },
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
      hint: 'Story, script, storyboard, film',
      steps: [
        {
          id: 'cut',
          kick: 'Opening · The cut',
          q: 'Quick film or *director’s cut?*',
          dek: 'Quick asks five questions and drafts a three-scene script. Director’s cut builds every part with you: the people, the arc, the ending, the script and the storyboard.',
          key: 'Cut',
          choices: [
            { label: 'Quick film', hint: 'Five questions, about 15 seconds of film' },
            { label: "Director's cut", hint: 'Characters, script and storyboard, up to 30 seconds' },
          ],
          best: "Director's cut",
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'premise',
          kick: 'Chapter 01 · The idea',
          q: 'What is the *story?*',
          dek: 'One line is enough. Everything after builds on it.',
          key: 'Story',
          choices: [
            { label: 'Strangers snowed in at a cabin', hint: 'One fire, one bed' },
            { label: 'Ex-lovers meet at a wedding', hint: 'Unfinished business' },
            { label: 'A photographer and her muse', hint: 'The shoot runs late' },
            { label: 'A masquerade in Venice', hint: 'Masks on, rules off' },
            { label: 'A forbidden affair at the office', hint: 'After hours, blinds down' },
          ],
        },
        {
          id: 'tone',
          kick: 'Chapter 02 · The tone',
          q: 'How should it *feel?*',
          dek: 'The tone sets the pace, the light and how the script talks.',
          key: 'Tone',
          choices: [
            ...MOOD,
            { label: 'Dark and dangerous', hint: 'Secrets, power, a little fear', suits: ['forbidden', 'office', 'secret', 'affair'] },
          ],
        },
        cast('Who is the *cast?*'),
        { ...lookOf('lead', 'Lead', 'Describe the *lead.*', director), kick: 'Chapter 04 · The lead' },
        {
          id: 'motive',
          kick: 'Chapter 05 · The want',
          q: 'What does the lead *want?*',
          dek: 'A character who wants something is worth watching. This drives every scene.',
          key: 'Want',
          when: director,
          choices: [
            { label: 'One night to forget', hint: 'No names, no tomorrow', suits: ['strangers', 'snowed', 'masquerade', 'forbidden'] },
            { label: 'To win the game', hint: 'Control, then surrender', suits: ['game', 'playful', 'office', 'masquerade'] },
            { label: 'To be truly seen', hint: 'Undone by attention', suits: ['photographer', 'muse', 'romantic'] },
            { label: 'To say what was never said', hint: 'Old feelings, finally out', suits: ['ex-lovers', 'wedding', 'reunit', 'years'] },
          ],
        },
        { ...lookOf('partner', 'Partner', 'And the *other one?*', (a) => director(a) && !solo(a)), kick: 'Chapter 06 · The partner', best: LOOKS[1].label },
        {
          id: 'world',
          kick: 'Chapter 07 · The world',
          q: 'Where does it *happen?*',
          dek: 'One place, so every scene feels like the same film.',
          key: 'Setting',
          choices: [
            { label: 'Snowed-in cabin', hint: 'Firelight, frost on the glass', suits: ['cabin', 'snow'] },
            { label: 'Venetian palazzo', hint: 'Candles, masks, old gold', suits: ['venice', 'masquerade', 'mask'] },
            { label: 'Wedding hotel suite', hint: 'Champagne and loose ties', suits: ['wedding', 'ex-lovers'] },
            { label: 'Photo studio after hours', hint: 'Backdrop paper, one hot light', suits: ['photographer', 'muse', 'shoot'] },
            { label: 'Corner office at night', hint: 'City below, blinds half down', suits: ['office', 'affair', 'forbidden'] },
            ...ROOM,
          ],
        },
        {
          id: 'time',
          kick: 'Chapter 08 · The hour',
          q: 'When is *it?*',
          key: 'Time',
          when: director,
          choices: [
            { label: 'Late night, after the rain', hint: 'Wet streets, neon', suits: ['rain', 'intense', 'dark', 'office', 'penthouse'] },
            { label: 'Golden hour', hint: 'Warm, low sun', suits: ['playful', 'romantic', 'photographer', 'sunlit'] },
            { label: 'Snowed-in winter', hint: 'Blue outside, gold inside', suits: ['cabin', 'snow'] },
            { label: '1950s, jazz and smoke', hint: 'A period piece', suits: ['venice', 'palazzo', 'masquerade', 'velvet'] },
          ],
        },
        {
          id: 'beats',
          kick: 'Chapter 09 · The arc',
          q: 'How does it *unfold?*',
          dek: 'The shape of the story, start to finish.',
          key: 'Arc',
          when: (a) => director(a) && !solo(a),
          choices: [
            { label: 'Slow burn to a kiss', hint: 'Tension, then release', suits: ['slow burn', 'strangers', 'snowed', 'forget'] },
            { label: 'Argument turns to passion', hint: 'Heat both ways', suits: ['ex-lovers', 'intense', 'dark', 'never said'] },
            { label: 'A game of seduction', hint: 'Who gives in first', suits: ['game', 'playful', 'masquerade', 'win'] },
            { label: 'Tender reunion', hint: 'Years apart, one night', suits: ['romantic', 'reunit', 'wedding', 'seen'] },
          ],
          predict: false,
        },
        {
          id: 'ending',
          kick: 'Chapter 10 · The ending',
          q: 'How does it *end?*',
          dek: 'We write towards this, so every scene leads here.',
          key: 'Ending',
          when: director,
          choices: [
            { label: 'Together at dawn', hint: 'Sunlight, sheets, a smile', suits: ['romantic', 'tender', 'reunion', 'golden'] },
            { label: 'One last look, then gone', hint: 'Bittersweet', suits: ['strangers', 'forget', 'masquerade', 'snowed'] },
            { label: 'A twist', hint: 'Nothing was what it seemed', suits: ['dark', 'forbidden', 'game', 'office'] },
            { label: 'Left wanting more', hint: 'Cut before the end', suits: ['slow burn', 'playful'] },
          ],
          closed: true,
          predict: false,
        },
        {
          id: 'scenes',
          kick: 'Chapter 11 · Length',
          q: 'How many *scenes?*',
          dek: 'Each scene is a five-second shot.',
          key: 'Scenes',
          when: director,
          choices: [
            { label: '3 scenes', hint: 'About 15 seconds' },
            { label: '4 scenes', hint: 'About 20 seconds' },
            { label: '6 scenes', hint: 'About 30 seconds, the whole arc' },
          ],
          best: '4 scenes',
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'script',
          kind: 'script',
          kick: 'Chapter 12 · The script',
          q: 'Here is the *script.*',
          dek: 'Scene by scene: what we see, the moment it ends on and what is said. Change anything.',
          key: 'Script',
          choices: [],
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'mcamera',
          kick: 'Chapter 13 · Camera',
          q: 'How is it *shot?*',
          key: 'Camera',
          when: director,
          choices: [
            { label: 'Classic and slow', hint: 'Long, patient takes', adds: 'slow classic camera work, long takes', suits: ['slow burn', 'romantic', 'reunion', '1950s'] },
            { label: 'Handheld and intimate', hint: 'Close, breathing with them', adds: 'intimate handheld camera, close-ups', suits: ['intense', 'argument', 'dark', 'cabin'] },
            { label: 'Music-video gloss', hint: 'Slow motion, glints', adds: 'glossy music-video style, slow motion', suits: ['playful', 'game', 'masquerade', 'penthouse'] },
          ],
        },
        {
          id: 'msound',
          kick: 'Chapter 14 · Sound',
          q: 'What do we *hear?*',
          dek: 'Their voices speak the lines in the script.',
          key: 'Sound',
          when: director,
          choices: [
            { label: 'Their voices', hint: 'The lines, spoken in the shots', suits: ['argument', 'game', 'never said'] },
            { label: 'Music', hint: 'A score under every scene', suits: ['slow burn', 'romantic', 'masquerade', 'reunion'] },
            { label: 'Quiet', hint: 'Only the room', suits: ['dark'] },
            { label: 'You choose', hint: 'The writer picks per scene' },
          ],
          closed: true,
          predict: false,
          meta: true,
        },
        { ...finish, kick: 'Chapter 15 · The look' },
        {
          id: 'review',
          kick: 'Last · Storyboard',
          q: 'See the *storyboard* first?',
          dek: 'One picture where each scene starts and ends. Redraw any of them before the film is made.',
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
