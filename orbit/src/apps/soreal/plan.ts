/**
 * soReal: the words and small rules behind the screens (quick starts, steps and what the orb says
 * on each, how long things take, what the machine is doing). Kept apart from the screens so they
 * can be tested on their own.
 */
import type { Movie, MovieSound } from '../../services/ai/LocalAi';

export type TemplateId = 'trailer' | 'music-video' | 'ad' | 'story' | 'comedy';

/** Quick starts. The machine knows the same ids and adds the right brief, look and sound. */
export const TEMPLATES: { id: TemplateId; name: string; example: string; length: number }[] = [
  { id: 'trailer', name: 'Trailer', example: 'A lighthouse keeper finds a door at the bottom of the sea', length: 30 },
  { id: 'music-video', name: 'Music video', example: 'A dancer on a neon rooftop as the city lights pulse to the beat', length: 20 },
  { id: 'ad', name: 'Ad', example: 'A coffee that wakes up a whole sleepy town', length: 10 },
  { id: 'story', name: 'Story', example: 'An old man and a stray dog become friends over one rainy day', length: 30 },
  { id: 'comedy', name: 'Comedy', example: 'A cat tries very hard to be a serious news anchor', length: 20 },
];

/** Ideas for when you skip the idea. */
export const SURPRISES = [
  'A paper boat sails through a flooded city at sunrise',
  'A robot gardener grows the first flower on Mars',
  'Two strangers share an umbrella and a secret in the rain',
  'A chef cooks a midnight feast for a family of foxes',
];

export const LENGTHS = [10, 20, 30] as const;
/** The machine makes shots of about this long; the length decides how many. */
export const SHOT_SECONDS = 5;
export const shotsFor = (length: number, shotSeconds = SHOT_SECONDS) => Math.max(1, Math.round(length / shotSeconds));

export const STYLES: { name: string; look: string }[] = [
  { name: 'Cinematic', look: 'Cinematic, dramatic lighting, shallow depth of field, film grain' },
  { name: 'Anime', look: 'Hand-drawn anime style, vivid colours, soft cel shading' },
  { name: 'Documentary', look: 'Natural light, handheld documentary feel, realistic' },
  { name: 'Retro film', look: 'Faded 1970s 35 mm film, warm tones, soft grain' },
  { name: 'Dreamy', look: 'Soft pastel colours, hazy glow, dreamy slow motion feel' },
  { name: 'Noir', look: 'Black and white film noir, hard shadows, rain and smoke' },
];

/** LTX and H3 make the sound with each shot, voices and songs included: what is said or sung is written into the shot's prompt. */
export const SOUNDS: { value: MovieSound; label: string; hint: string }[] = [
  { value: 'auto', label: 'Let the AI choose', hint: 'Picked to fit this movie' },
  { value: 'shots', label: 'Voices and sound', hint: 'People speak or sing the lines in the story, with effects and ambience' },
  { value: 'music', label: 'Music only', hint: 'Every shot asks for music and no talking or singing' },
  { value: 'quiet', label: 'Quiet', hint: 'No sound at all' },
];
export const soundName = (s: MovieSound | null | undefined) => SOUNDS.find((x) => x.value === s)?.label ?? 'Voices and sound';

export type StepId = 'idea' | 'shape' | 'story' | 'cast' | 'storyboard' | 'sound' | 'make';

/** The walkthrough, and the one line the orb says on each step. */
export const STEPS: { id: StepId; title: string; guide: string }[] = [
  { id: 'idea', title: 'Your idea', guide: "Say what your movie is about in a sentence. Skip it and I’ll pick an idea." },
  { id: 'shape', title: 'Length and shape', guide: 'Pick how long and which way up. Skip to keep it as it is.' },
  { id: 'story', title: 'The story', guide: 'Here is the story, one line per shot. Change any line, or skip and keep mine.' },
  { id: 'cast', title: 'Cast and look', guide: "Choose who stars and the style. Skip and I’ll design them." },
  { id: 'storyboard', title: 'Storyboard', guide: 'I draw a picture for every cut first. Turn this on to check them before the video.' },
  { id: 'sound', title: 'Sound', guide: 'I picked the sound for this movie. Change it if you like, or skip.' },
  { id: 'make', title: 'Make it', guide: 'All set. Here is how long it takes. Your phone can sleep meanwhile.' },
];

/** "about 12 minutes", in plain words. */
export function aboutTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  if (min < 60) return `about ${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const rest = Math.round((min % 60) / 5) * 5;
  return rest ? `about ${h} h ${rest} min` : `about ${h} hour${h === 1 ? '' : 's'}`;
}

/** What the machine is doing for this movie, in one line. */
export function phaseLine(m: Movie): string {
  if (m.flow !== 'auto') {
    const done = m.shots.filter((s) => s.status === 'done').length;
    if (m.running) return `Making shot ${Math.min(done + 1, m.shots.length)} of ${m.shots.length}${m.runningOn === 'helper' ? ' on the helper' : ''}`;
    if (m.shots.some((s) => s.status === 'error')) return 'A shot needs a look';
    return done === m.shots.length && done ? 'All shots made' : `${done} of ${m.shots.length} shots made`;
  }
  const frames = m.frames ?? [];
  const where = m.runningOn === 'helper' ? ' on the helper' : '';
  switch (m.phase) {
    case 'story':
      return `Writing the story${where}`;
    case 'lead':
      return m.lead?.mode === 'photo' ? `Getting your lead ready${where}` : `Designing the lead${where}`;
    case 'storyboard': {
      const done = frames.filter((f) => f.status === 'done').length;
      return `Drawing the storyboard: picture ${Math.min(done + 1, frames.length)} of ${frames.length}${where}`;
    }
    case 'review':
      return 'The storyboard is ready for you to check';
    case 'shots': {
      const at = m.shots.findIndex((s) => s.status === 'making');
      const done = m.shots.filter((s) => s.status === 'done').length;
      return `Making shot ${(at < 0 ? done : at) + 1} of ${m.shots.length}${where}`;
    }
    case 'final':
      return 'Putting the movie together';
    case 'done':
      return m.render?.stale ? 'Changed: update the movie to see it' : 'Your movie is ready';
    case 'stopped':
      return 'Stopped. Carry on whenever you like';
    case 'error':
      return m.error || 'Something went wrong';
    default:
      return 'Not started yet';
  }
}

/** The stages of a movie, for the progress list. */
export function stages(m: Movie): { name: string; state: 'done' | 'now' | 'todo' | 'skip' }[] {
  const order = ['story', 'lead', 'storyboard', 'review', 'shots', 'final', 'done'];
  const at = m.phase === 'done' ? 6 : order.indexOf(m.phase ?? 'draft');
  const frames = m.frames ?? [];
  const leadNone = m.lead?.mode === 'none';
  const st = (i: number, done: boolean): 'done' | 'now' | 'todo' => (done ? 'done' : at === i && m.running ? 'now' : 'todo');
  return [
    { name: 'Story', state: st(0, m.shots.some((s) => s.prompt.trim())) },
    { name: 'Lead', state: leadNone ? 'skip' : st(1, Boolean(m.lead?.itemId)) },
    { name: 'Storyboard', state: st(2, frames.length > 0 && frames.every((f) => f.status === 'done')) },
    { name: 'Shots', state: st(4, m.shots.length > 0 && m.shots.every((s) => s.status === 'done')) },
    { name: 'Final cut', state: st(5, Boolean(m.render && !m.render.stale)) },
  ];
}
