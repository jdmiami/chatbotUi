import type { Choice, Guide, Step } from '../defs';

/**
 * Compass: a sample guide for planning a trip, or just an evening. It is the package's worked
 * example of the Guide shape: two flows, every ready answer with a hint and with `suits` words so
 * the orb's pick (recommend) visibly follows what was chosen before, one custom step the app
 * renders itself, and one meta step at the end. Copy it and change the words.
 *
 * Notes for anyone copying it:
 *  - Step ids are free; the engine reads none of them. The app reads `custom` to know which body
 *    to render (here: 'notes').
 *  - `suits` words are matched against the earlier answers (the picked label, or the typed words),
 *    lower-cased. Pick words that appear in earlier labels ("harbour", "friends"); the first step's
 *    `suits` can only ever match words someone typed on it, so it needs none.
 */

const PLACE: Choice[] = [
  { label: 'A harbour town', hint: 'Boats, gulls, fish for dinner', value: 'a small harbour town', suits: ['sea', 'coast', 'boat', 'beach', 'fish'] },
  { label: 'A mountain village', hint: 'Stone roofs and clear air', value: 'a mountain village', suits: ['snow', 'hike', 'walk', 'cold', 'alps'] },
  { label: 'A big city', hint: 'Museums, late dinners, a last train', value: 'a big city', suits: ['museum', 'city', 'food', 'night', 'gallery'] },
  { label: 'A desert road', hint: 'One line to the horizon', value: 'a desert road trip', suits: ['drive', 'car', 'sun', 'heat', 'alone'] },
  { label: 'An old town in the rain', hint: 'Cobbles, cafés, umbrellas', value: 'a rainy old town', suits: ['rain', 'autumn', 'cafe', 'quiet'] },
];
const SEASON: Choice[] = [
  { label: 'Early spring', hint: 'Few crowds, cool air', value: 'in early spring', suits: ['quiet', 'walk', 'old town', 'village'] },
  { label: 'High summer', hint: 'Long days, warm nights', value: 'in high summer', suits: ['harbour', 'sea', 'beach', 'sun', 'desert'] },
  { label: 'Autumn', hint: 'Colour and soft light', value: 'in autumn', suits: ['rain', 'old town', 'cafe', 'city'] },
  { label: 'Deep winter', hint: 'Snow, fires, early dark', value: 'in deep winter', suits: ['snow', 'mountain', 'cold', 'village'] },
];
const COMPANY: Choice[] = [
  { label: 'Just me', hint: 'My own pace, my own hours', value: 'travelling alone', suits: ['alone', 'solo', 'quiet', 'road', 'desert'] },
  { label: 'The two of us', hint: 'One other person', value: 'the two of us', suits: ['together', 'two', 'couple', 'spring'] },
  { label: 'A few friends', hint: 'Three to five of us', value: 'a small group of friends', suits: ['friends', 'group', 'city', 'summer'] },
  { label: 'The whole family', hint: 'All ages, all needs', value: 'the whole family', suits: ['family', 'kids', 'children', 'beach'] },
];
const PACE: Choice[] = [
  { label: 'Slow', hint: 'One thing a day, long lunches', value: 'a slow pace', suits: ['alone', 'quiet', 'village', 'old town', 'autumn', 'rain'] },
  { label: 'Steady', hint: 'A plan, with room to wander', value: 'a steady pace', suits: ['two of us', 'together', 'spring', 'family'] },
  { label: 'Packed', hint: 'See everything, sleep later', value: 'a packed schedule', suits: ['city', 'friends', 'museum', 'summer'] },
  { label: 'No plan at all', hint: 'Decide each morning', value: 'no fixed plan', suits: ['road', 'desert', 'drive'] },
];
const BUDGET: Choice[] = [
  { label: 'Shoestring', hint: 'Hostels, markets, buses', value: 'on a shoestring', suits: ['friends', 'road', 'just me', 'alone'] },
  { label: 'Comfortable', hint: 'A nice room, a few treats', value: 'on a comfortable budget', suits: ['two of us', 'family', 'together', 'steady'] },
  { label: 'Splash out', hint: 'The good hotel, the long dinner', value: 'with money to spend', suits: ['city', 'winter', 'slow'] },
];
const SHAPE: Choice[] = [
  { label: 'A day-by-day list', hint: 'Morning, afternoon, evening' },
  { label: 'A loose map', hint: 'Places and ideas, no times' },
  { label: 'One page', hint: 'The essentials only' },
];

const place: Step = { id: 'where', kick: 'Chapter 01 · The place', q: 'Where *to?*', dek: 'The place sets the pace of everything after it.', key: 'Place', choices: PLACE };
const season: Step = { id: 'when', kick: 'Chapter 02 · The season', q: 'When do we *go?*', dek: 'The season decides the light, the crowds and the coat.', key: 'Season', choices: SEASON };
const company: Step = { id: 'who', kick: 'Chapter 03 · The company', q: 'Who is *coming?*', key: 'Company', choices: COMPANY };
const pace: Step = { id: 'pace', kick: 'Chapter 04 · The pace', q: 'How *fast?*', dek: 'How many things a day, and how long a lunch.', key: 'Pace', choices: PACE, best: 'Steady' };
const budget: Step = { id: 'budget', kick: 'Chapter 05 · The budget', q: 'How much to *spend?*', key: 'Budget', choices: BUDGET, best: 'Comfortable' };
/** The app renders this one: a text box for anything the ready answers could not cover. */
const notes: Step = { id: 'notes', custom: 'notes', kick: 'Chapter 06 · Notes', q: 'Anything *else?*', dek: 'A place you must see, a date to avoid, a friend to visit. Or nothing at all.', key: 'Notes', choices: [], closed: true, suggest: false, meta: true };
const shape: Step = { id: 'shape', kick: 'Last · The plan', q: 'What *shape* should the plan take?', key: 'Shape', choices: SHAPE, closed: true, suggest: false, meta: true, best: 'A day-by-day list' };

export const COMPASS: Guide = {
  id: 'compass',
  name: 'Compass',
  mark: ['Com', 'pass'],
  kicker: 'A sample guide',
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
  rules: ['Real places, your own pace', 'Nothing is booked for you; the plan is yours to act on', 'Change any answer, any time'],
  starters: [
    { label: 'Somewhere by the sea', hint: 'Salt air, slow mornings' },
    { label: 'A big city weekend', hint: 'Museums, late dinners' },
    { label: 'High and quiet', hint: 'Mountains, clear air' },
    { label: 'A long road', hint: 'One car, one horizon' },
  ],
  followUps: [
    { label: 'Take it further', hint: 'What comes next' },
    { label: 'Give me three options', hint: 'Different ways it could go' },
    { label: 'Make it cheaper', hint: 'Same trip, less spent' },
    { label: 'Change the place', hint: 'Same idea, somewhere new' },
  ],
  flows: {
    trip: {
      id: 'trip',
      label: 'A trip',
      hint: 'A week away, planned in a few questions',
      steps: [place, season, company, pace, budget, notes, shape],
    },
    evening: {
      id: 'evening',
      label: 'An evening',
      hint: 'Tonight, sorted in three',
      steps: [
        {
          id: 'mood',
          kick: 'Chapter 01 · The mood',
          q: 'What kind of *evening?*',
          key: 'Mood',
          choices: [
            { label: 'Quiet', hint: 'A book, a bath, an early night', value: 'a quiet evening', suits: ['rain', 'alone', 'tired', 'slow'] },
            { label: 'Out with people', hint: 'Dinner, a bar, a walk home', value: 'an evening out with people', suits: ['friends', 'city', 'together'] },
            { label: 'Something new', hint: 'A class, a show, a place you have never been', value: 'trying something new', suits: ['curious', 'city', 'new'] },
            { label: 'Make something', hint: 'Cook, build, draw', value: 'an evening making something', suits: ['home', 'cook', 'craft'] },
          ],
        },
        {
          id: 'where',
          kick: 'Chapter 02 · The place',
          q: 'In or *out?*',
          key: 'Place',
          choices: [
            { label: 'At home', hint: 'Nowhere to be', value: 'at home', suits: ['quiet', 'book', 'bath', 'make', 'cook'] },
            { label: 'Close by', hint: 'Walking distance', value: 'somewhere close by', suits: ['walk', 'out', 'people', 'dinner'] },
            { label: 'Across town', hint: 'Worth the trip', value: 'across town', suits: ['new', 'show', 'class'] },
          ],
        },
        {
          id: 'hours',
          kick: 'Last · The hours',
          q: 'How *long?*',
          key: 'Hours',
          choices: [
            { label: 'An hour', hint: 'A small thing, done well' },
            { label: 'The evening', hint: 'Six till late' },
            { label: 'All night', hint: 'No alarm tomorrow' },
          ],
          closed: true,
          suggest: false,
          meta: true,
          best: 'The evening',
        },
      ],
    },
  },
};
