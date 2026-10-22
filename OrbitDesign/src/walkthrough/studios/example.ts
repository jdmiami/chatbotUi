import type { Answers, Choice, StepDef, StudioDef } from '../defs';

/**
 * Postcard: a sample studio for travel postcards, pictures and short films from a place and a
 * moment. It is the package's worked example of the StudioDef shape: safe for anyone, no gate,
 * one image flow, one short video flow, one short movie flow. Copy it and change the words.
 *
 * Notes for anyone copying it:
 *  - Step ids are not free: the engine reads `shape`, `vshape`, `length`, `cut`, `scenes`, `msound`,
 *    `finish`, `review`, `premise`, `lead`, `partner`; the writers' room reads `cast`, `lead`,
 *    `partner`, `premise`, `world`, `time`, `tone`, `beats`, `ending`, `scenes`, `msound`, `cut`.
 *  - The script draft's beat tables live in ../writer.ts and were written for a romance studio; a
 *    solo cast (a label matching /alone|solo/) gets the quieter solo beats, which fit a traveller.
 */

const director = (a: Answers) => a.cut === "Director's cut";

const PLACE: Choice[] = [
  { label: 'A harbour at dawn', hint: 'Boats, gulls, pink light', adds: 'a small fishing harbour at dawn', suits: ['sea', 'boat', 'fish', 'coast', 'morning'] },
  { label: 'A mountain village', hint: 'Stone roofs and woodsmoke', adds: 'a mountain village of stone houses', suits: ['snow', 'hike', 'alps', 'cold', 'winter'] },
  { label: 'A night market', hint: 'Lanterns, steam, crowds', adds: 'a busy night market under paper lanterns', suits: ['food', 'city', 'neon', 'crowd', 'night'] },
  { label: 'A desert road', hint: 'One line to the horizon', adds: 'an empty desert road at the horizon', suits: ['drive', 'car', 'sun', 'heat', 'alone'] },
  { label: 'A rainy old town', hint: 'Cobbles and umbrellas', adds: 'a rainy old town of cobbled streets', suits: ['rain', 'autumn', 'cafe', 'umbrella'] },
];
const LIGHT: Choice[] = [
  { label: 'Golden hour', hint: 'Warm, low sun', adds: 'golden hour light', suits: ['dawn', 'sunset', 'harbour', 'warm', 'evening'] },
  { label: 'Blue hour', hint: 'Just after sunset', adds: 'blue hour, lights coming on', suits: ['night', 'market', 'lantern', 'city'] },
  { label: 'Overcast and soft', hint: 'No shadows, rich colour', adds: 'soft overcast light', suits: ['rain', 'autumn', 'old town'] },
  { label: 'Harsh noon', hint: 'Bright and graphic', adds: 'hard midday sun, deep shadows', suits: ['desert', 'heat', 'road', 'summer'] },
];
const FINISH: Choice[] = [
  { label: 'Vintage postcard', hint: 'Faded ink, a white border', adds: 'vintage printed postcard look, faded inks, white border', suits: ['old town', 'harbour', 'memory', 'village'] },
  { label: 'Film photograph', hint: 'Grain and gentle colour', adds: '35mm film photograph, fine grain', suits: ['rain', 'overcast', 'autumn', 'road'] },
  { label: 'Travel poster', hint: 'Flat colour, bold shapes', adds: 'mid-century travel poster, flat colour, bold shapes', suits: ['desert', 'noon', 'mountain', 'poster'] },
  { label: 'Watercolour sketch', hint: 'Loose, from a journal', adds: 'loose watercolour journal sketch', suits: ['market', 'cafe', 'village', 'sketch'] },
];
const SHAPE: Choice[] = [
  { label: 'Portrait', hint: 'Tall, for phones' },
  { label: 'Square', hint: 'Even all round' },
  { label: 'Landscape', hint: 'Wide, a real postcard' },
];
const CAST: Choice[] = [
  { label: 'A traveller alone', hint: 'One person and the place', adds: 'one traveller alone', suits: ['alone', 'solo', 'quiet', 'road'] },
  { label: 'Two friends', hint: 'Travelling together', adds: 'two friends travelling together', suits: ['friends', 'two', 'laugh', 'together'] },
  { label: 'Nobody', hint: 'Just the place', adds: 'no people, only the place' },
];

const place: StepDef = { id: 'world', kick: 'Chapter 01 · The place', q: 'Where are *we?*', dek: 'The place does half the work.', key: 'Place', choices: PLACE };
const light: StepDef = { id: 'light', kick: 'Chapter 02 · The light', q: 'What is the *light* like?', dek: 'The time of day sets the colour of everything.', key: 'Light', choices: LIGHT };
const finish: StepDef = { id: 'finish', kick: 'Chapter · The look', q: 'How should it *look?*', dek: 'The finish of every frame.', key: 'Look', choices: FINISH };
const shape: StepDef = { id: 'shape', kick: 'Last · The frame', q: 'Which *shape?*', key: 'Shape', choices: SHAPE, closed: true, predict: false, meta: true, best: 'Landscape' };

export const POSTCARD: StudioDef = {
  id: 'postcard',
  name: 'Postcard',
  mark: ['Post', 'card'],
  kicker: 'A sample studio',
  adult: false,
  theme: {
    paper: '#f4efe6',
    ink: '#1d2430',
    ink2: '#5b6472',
    accent: '#2a6f8f',
    desk: '#0b1016',
    desk2: '#141c25',
    orbA: '#cfe8f5',
    orbB: '#1f5570',
  },
  writer: 'You are the writer of Postcard, a studio for travel pictures, videos and short films: places, light and quiet moments. Write vivid, warm, cinematic suggestions.',
  tail: 'travel photograph, natural colour, high detail',
  characters: 'Travellers',
  makers: { image: ['image-default'], video: ['video-default'], movie: 'ltx' },
  rules: ['Real places, imagined moments', 'No real or famous people', 'Keep it kind'],
  talk: {
    starters: [
      { label: 'Somewhere by the sea', hint: 'Salt, gulls, slow mornings' },
      { label: 'A city after dark', hint: 'Lanterns, steam, a last train' },
      { label: 'High and cold', hint: 'Mountains, woodsmoke, clear air' },
      { label: 'A long road', hint: 'One car, one horizon' },
    ],
    followUps: [
      { label: 'Take it further', hint: 'What happens next' },
      { label: 'Give me three directions', hint: 'Different ways it could go' },
      { label: 'Turn it into a scene', hint: 'Who, where, the moment' },
      { label: 'Change the place', hint: 'Same story, somewhere new' },
    ],
  },
  flows: {
    image: {
      kind: 'image',
      label: 'A postcard',
      hint: 'One frame, made in under a minute',
      steps: [place, light, finish, shape],
    },
    video: {
      kind: 'video',
      label: 'A video',
      hint: 'A few seconds, moving, with sound',
      steps: [
        place,
        light,
        {
          id: 'action',
          kick: 'Chapter 03 · The action',
          q: 'What *moves?*',
          key: 'Action',
          choices: [
            { label: 'Boats rocking', hint: 'Water and ropes', adds: 'boats rocking gently at their moorings' },
            { label: 'A slow pan', hint: 'Across the whole view', adds: 'a slow panning view' },
            { label: 'Rain on glass', hint: 'A window, the street beyond', adds: 'rain running down a window' },
            { label: 'Lanterns swaying', hint: 'Wind and warm light', adds: 'paper lanterns swaying in the wind' },
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
      label: 'A short film',
      hint: 'A story, a script, then the film',
      steps: [
        {
          id: 'cut',
          kick: 'Opening · The cut',
          q: 'Quick film or *director’s cut?*',
          dek: 'Quick asks a few questions and drafts a three-scene script. Director’s cut lets you choose the length and read the script first.',
          key: 'Cut',
          choices: [
            { label: 'Quick film', hint: 'Three scenes, about 15 seconds' },
            { label: "Director's cut", hint: 'Choose the length, read the script' },
          ],
          best: 'Quick film',
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
            { label: 'The last ferry of the season', hint: 'One passenger, one harbour' },
            { label: 'A night market in the rain', hint: 'Steam, lanterns, a lost umbrella' },
            { label: 'A road trip with no map', hint: 'The desert decides' },
          ],
        },
        { id: 'cast', kick: 'Chapter 02 · The cast', q: 'Who is *in it?*', key: 'Cast', choices: CAST, best: 'A traveller alone' },
        { ...place, kick: 'Chapter 03 · The place' },
        {
          id: 'scenes',
          kick: 'Chapter 04 · Length',
          q: 'How many *scenes?*',
          dek: 'Each scene is a five-second shot.',
          key: 'Scenes',
          when: director,
          choices: [
            { label: '3 scenes', hint: 'About 15 seconds' },
            { label: '4 scenes', hint: 'About 20 seconds' },
            { label: '6 scenes', hint: 'About 30 seconds' },
          ],
          best: '4 scenes',
          closed: true,
          predict: false,
          meta: true,
        },
        {
          id: 'script',
          kind: 'script',
          kick: 'Chapter 05 · The script',
          q: 'Here is the *script.*',
          dek: 'Scene by scene: what we see, the moment it ends on and what is said. Change anything.',
          key: 'Script',
          choices: [],
          closed: true,
          predict: false,
          meta: true,
        },
        { ...finish, kick: 'Chapter 06 · The look' },
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
