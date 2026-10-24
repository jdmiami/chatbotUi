import { useEffect, useRef } from 'react';
import { cloudReady, cloudText } from '../../services/ai/CloudAi';
import { cleanReply } from './write';

/**
 * The orb, aware of the step under it. A screen (a step of a walkthrough) registers what it is
 * about with useOrbAssist: a text box to write in, or a group of choices. That is then the orb's
 * whole focus: it sits beside it, offers ideas when you tap into the box (the more you tap, the more
 * the idea changes), chooses for you when you tap it or say "choose for me", and "approves" what you
 * pick before the next step slides in.
 *
 * ideaFor and pickFor work on their own too (a "Fill for me" button), with the orb switched off, and
 * without cloud AI (then they use a small written list, never an error).
 */

export interface AssistOption {
  id: string;
  label: string;
  el?: HTMLElement | null;
}

export interface OrbAssist {
  /** Stable per step, e.g. 'make:describe'. */
  id: string;
  /** Plain words: what the person is doing now. */
  context: string;
  /** The element the orb stays beside: the text box, or the group of choices. */
  target: HTMLElement | null;
  kind: 'text' | 'choice';
  value?: string;
  setValue?: (text: string) => void;
  options?: AssistOption[];
  selected?: string | null;
  choose?: (id: string) => void;
}

// ---------------------------------------------------------------- what is registered now

type Token = object;
/** Every screen that registered, oldest first: the newest one is the orb's focus. */
const registered = new Map<Token, OrbAssist>();
const listeners = new Set<() => void>();
let shown: OrbAssist | null = null;
/** What the listeners last heard about (they only hear about changes that matter to the orb). */
let shownKey = '';
let lastTarget: HTMLElement | null = null;

const keyOf = (a: OrbAssist | null) =>
  a ? [a.id, a.kind, a.context, a.value ?? '', a.selected ?? '', (a.options ?? []).map((o) => o.id).join(','), a.target ? 1 : 0].join('\u0001') : '';

function publish() {
  const list = [...registered.values()];
  shown = list[list.length - 1] ?? null;
  const key = keyOf(shown);
  // A new target element (a step re-rendered) also counts.
  const targetChanged = shown?.target !== lastTarget;
  lastTarget = shown?.target ?? null;
  if (key === shownKey && !targetChanged) return;
  shownKey = key;
  for (const fn of [...listeners]) fn();
}

/** What the orb should help with now (the newest registration), or null. */
export function currentAssist(): OrbAssist | null {
  return shown;
}

/** Hear when the step under the orb changes (its id, value, choices or target). */
export function onAssistChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Register (or with null, unregister) for a caller. Exported for code outside React and tests. */
export function setAssist(token: Token, assist: OrbAssist | null) {
  if (assist) {
    // Keep its place in the order when it only updates (a re-render), so the newest step stays on top.
    registered.set(token, assist);
  } else registered.delete(token);
  publish();
}

/** Register what the orb should help with while this step is on screen (null = nothing). */
export function useOrbAssist(assist: OrbAssist | null): void {
  const token = useRef<Token>({}).current;
  // Every render: the newest value, choices and callbacks.
  useEffect(() => {
    setAssist(token, assist);
  });
  useEffect(() => () => setAssist(token, null), [token]);
}

// ---------------------------------------------------------------- approve

type Approver = (el: HTMLElement) => Promise<void>;
let approver: Approver | null = null;
let approving: { el: HTMLElement; done: Promise<void> } | null = null;
let lastApproved: { el: HTMLElement; at: number } | null = null;

/** The orb registers how it approves (while it is on screen); null when it goes away. */
export function setApprover(fn: Approver | null) {
  approver = fn;
}

/**
 * The orb flies to the element just picked, "approves" it (a nod and a ring of light around it), and
 * goes back; resolves once the approval has shown, so the next step can slide in while the orb flies
 * back to land beside it. With the orb off (or Motion off) it resolves straight away.
 */
export function orbApprove(el: HTMLElement | null): Promise<void> {
  if (!el || !approver || !el.isConnected) return Promise.resolve();
  // Already approving this one (the orb chose it for you, and the step approves it too): the same show.
  if (approving && approving.el === el) return approving.done;
  if (lastApproved && lastApproved.el === el && performance.now() - lastApproved.at < 900) return Promise.resolve();
  const run = approver;
  const done = (async () => {
    try {
      // Never hold a step up for long, whatever happens.
      await Promise.race([run(el), new Promise((r) => setTimeout(r, 1600))]);
    } catch {
      /* the show is a nicety */
    } finally {
      lastApproved = { el, at: performance.now() };
      if (approving?.el === el) approving = null;
    }
  })();
  approving = { el, done };
  return done;
}

// ---------------------------------------------------------------- ideas for a text step

export type IdeaKind = 'picture' | 'portrait' | 'video' | 'music' | 'words';

/** What kind of words a box wants, from its context. */
export function ideaKind(context: string): IdeaKind {
  const c = context.toLowerCase();
  if (/\b(video|clip|movie|film|animation|animate)\b/.test(c)) return 'video';
  if (/\b(song|music|lyrics?|tune|melody|beat)\b/.test(c)) return 'music';
  if (/\b(portrait|selfie|headshot|person|face|people)\b/.test(c)) return 'portrait';
  if (/\b(picture|image|photo|drawing|painting|art|illustration|poster|wallpaper|meme|prompt)\b/.test(c)) return 'picture';
  return 'words';
}

const IDEAS: Record<IdeaKind, string[]> = {
  picture: [
    'A red fox curled up in fresh snow at dawn, soft pink light, breath misting in the cold air',
    'A lighthouse on black cliffs in a storm, waves bursting into spray, one warm window glowing',
    'A neon-lit noodle stall in the rain at night, steam rising, reflections shining on wet stone',
    'A tiny cabin under a sky full of northern lights, snowy pines, deep blue night',
    'A koi pond seen from above, orange fish gliding under lily pads, sunlight dancing on the ripples',
    'A cyclist crossing a desert road at golden hour, a long shadow, heat haze on the horizon',
    'A field of sunflowers under a summer thunderstorm, dark clouds, one beam of light breaking through',
    'A cat asleep on a stack of old books by a rainy window, soft grey light, cosy and quiet',
    'A spice market at dusk, glowing lanterns, mountains of saffron, paprika and turmeric',
    'A whale leaping beside a small sailing boat, spray glittering, snowy mountains behind',
    'A greenhouse full of giant ferns and orchids, morning mist, light pouring through the glass roof',
    'An old steam train crossing a stone bridge over a misty valley in autumn colours',
  ],
  portrait: [
    'A portrait of an old fisherman with a weathered smile, soft window light, deep wrinkles, warm tones',
    'A portrait of a young dancer mid-laugh, golden hour backlight, hair glowing, shallow depth of field',
    'A portrait of a chef in a busy kitchen, steam and copper pans behind, confident look, cinematic light',
    'A portrait of a woman reading under a tree, dappled sunlight on her face, calm and thoughtful',
    'A portrait of a musician holding a trumpet, smoky club, one warm spotlight, rich shadows',
    'A portrait of a grandmother in her garden, flowers all around, bright morning light, kind eyes',
    'A portrait of a climber on a mountain ridge, wind in the hair, clouds below, sharp evening light',
    'A portrait of a painter covered in colourful paint, studio window light, playful expression',
  ],
  video: [
    'A slow drone shot rising over a misty forest at sunrise, birds lifting from the trees',
    'Waves rolling onto a black sand beach in slow motion, foam glowing in the low sun',
    'A paper boat drifting down a rainy city gutter, the camera following close to the water',
    'Time-lapse of clouds racing over snowy mountains, light and shadow sweeping across the peaks',
    'A hummingbird hovering at a red flower, wings a blur, the background softly out of focus',
    'Lanterns floating up into a night sky over a quiet lake, the camera slowly tilting up',
    'A barista pouring latte art in close-up, steam curling, warm morning café light',
    'A train window view of green hills and villages sliding past in the rain',
  ],
  music: [
    'A warm acoustic song about a long drive home at night, soft guitar and brushed drums',
    'An upbeat summer pop tune with handclaps, bright synths and a catchy chorus',
    'A slow piano piece for a rainy Sunday morning, gentle and hopeful',
    'A funky groove with a walking bass line, horns and a big singalong hook',
    'A dreamy lo-fi beat with vinyl crackle, mellow keys and a lazy rhythm',
    'An epic orchestral theme that builds from a quiet cello to a full choir',
  ],
  words: [
    'A short, friendly line that says what this is for and why it matters',
    'Something bright and simple, with one clear idea and a little warmth',
    'A few vivid words that paint the scene and set the mood',
    'Keep it clear and kind, and finish with a small surprise',
    'A bold, playful idea told in one short sentence',
    'A calm, honest description with one memorable detail',
  ],
};

/** Extra detail added to what someone already wrote (when there is no cloud AI to continue it). */
const EXTRAS: Record<IdeaKind, string[]> = {
  picture: ['soft golden light, rich detail', 'dramatic shadows, cinematic mood', 'misty morning, calm and dreamy', 'bold colours, high contrast', 'gentle pastel colours, airy', 'sharp detail, shallow depth of field'],
  portrait: ['soft window light, natural skin tones', 'golden hour backlight, shallow depth of field', 'dramatic studio lighting, rich shadows', 'warm candid smile, film photo look', 'clean background, sharp eyes'],
  video: ['slow camera push in, golden light', 'smooth drone shot, misty atmosphere', 'slow motion, shallow depth of field', 'handheld close-up, warm tones', 'time-lapse, sweeping light'],
  music: ['with a big singalong chorus', 'soft and slow, with gentle piano', 'upbeat, with handclaps and bright synths', 'with a warm acoustic guitar', 'building to an epic finish'],
  words: ['and keep it short and clear', 'with a warm, friendly tone', 'with one vivid detail', 'ending on a hopeful note'],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A written idea (no AI): different for each n, and different contexts start in different places. */
export function fallbackIdea(context: string, current: string, n: number): string {
  const kind = ideaKind(context);
  const now = current.trim();
  const i = Math.max(0, Math.floor(n));
  if (now && kind !== 'words') {
    const extras = EXTRAS[kind];
    const add = extras[(hash(context + now) + i) % extras.length];
    return `${now.replace(/[\s,.;]+$/, '')}, ${add}`;
  }
  const list = IDEAS[kind];
  return list[(hash(context) + i) % list.length];
}

function ideaPrompt(kind: IdeaKind): string {
  const what: Record<IdeaKind, string> = {
    picture: 'a vivid picture prompt: the subject, the setting, the light, the mood and one striking detail, 15 to 35 words',
    portrait: 'a vivid portrait prompt: who they are, what they are doing, the light, the mood and the setting, 15 to 35 words. Keep people dressed and the mood wholesome',
    video: 'a vivid short video idea: the subject, what moves, how the camera moves and the mood, 15 to 35 words',
    music: 'a short description of a song: the feeling, the instruments, the tempo and the theme, 12 to 30 words',
    words: 'a short, helpful text for this box, at most 30 words',
  };
  return (
    `You give the person one idea for the text box they are in: ${what[kind]}. ` +
    'Reply with ONLY the text that goes in the box, on one line: no quotes, no title, no explanation. ' +
    'If something is already written, keep it and build on it (start with what is written, then add to it). ' +
    'Each idea must be clearly different from the earlier ones.'
  );
}

/** Ideas already given, per box and what was in it, so each new one is different. */
const given = new Map<string, string[]>();
const ideas = new Map<string, Promise<string>>();

/** Forget the ideas given so far (tests, or a new walkthrough). */
export function forgetIdeas() {
  given.clear();
  ideas.clear();
}

function tidyIdea(raw: string): string {
  let t = cleanReply(raw)
    .replace(/^(idea|prompt|text)\s*\d*\s*[:\-–]\s*/i, '')
    .split(/\n\s*\n/)[0]
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  const q = t.match(/^["“'](.*)["”']$/);
  if (q) t = q[1].trim();
  return t.length > 600 ? `${t.slice(0, 600).replace(/\s+\S*$/, '')}…` : t;
}

/** An idea for a text step (n = 0, 1, 2… gives a different idea each time). */
export async function ideaFor(context: string, current: string, n: number): Promise<string> {
  const key = `${context}\u0000${current}\u0000${n}`;
  const known = ideas.get(key);
  if (known) return known;
  const p = makeIdea(context, current, n);
  ideas.set(key, p);
  if (ideas.size > 120) ideas.delete(ideas.keys().next().value as string);
  return p;
}

async function makeIdea(context: string, current: string, n: number): Promise<string> {
  const box = `${context}\u0000${current}`;
  const before = given.get(box) ?? [];
  const remember = (idea: string) => {
    given.set(box, [...before, idea].slice(-8));
    return idea;
  };
  const written = () => {
    // Not one already given (a cloud idea can match a written one).
    for (let k = 0; k < 6; k++) {
      const idea = fallbackIdea(context, current, n + k);
      if (!before.includes(idea)) return remember(idea);
    }
    return remember(fallbackIdea(context, current, n));
  };
  try {
    if (!(await cloudReady())) return written();
    const kind = ideaKind(context);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let raw = '';
    try {
      raw = await cloudText({
        task: 'write',
        maxTokens: 160,
        temperature: Math.min(1.2, 0.85 + n * 0.05),
        signal: ctrl.signal,
        messages: [
          { role: 'system', content: ideaPrompt(kind) },
          {
            role: 'user',
            content:
              `What they are doing: ${context}\n` +
              (current.trim() ? `Already written: ${current.trim().slice(-1200)}\n` : 'The box is empty.\n') +
              `Idea number ${n + 1}.` +
              (before.length ? `\nEarlier ideas (give something different):\n${before.map((b) => `- ${b}`).join('\n')}` : ''),
          },
        ],
      });
    } finally {
      clearTimeout(timer);
    }
    const idea = tidyIdea(raw);
    if (!idea || before.includes(idea) || idea === current.trim()) return written();
    return remember(idea);
  } catch {
    // Quiet: an idea is a nicety, so a written one stands in.
    return written();
  }
}

// ---------------------------------------------------------------- picks for a choice step

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'step', 'is', 'it', 'this', 'that', 'what', 'your', 'you', 'pick', 'choose']);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 1 && !STOP.has(w)) ?? [];

/** The orb's pick without AI: what matches the context best, else a recommended one, else any. */
export function fallbackPick(context: string, options: AssistOption[], random = Math.random): string | null {
  if (!options.length) return null;
  if (options.length === 1) return options[0].id;
  const ctx = new Set(words(context));
  let best: AssistOption[] = [];
  let top = 0;
  for (const o of options) {
    const score = words(o.label).filter((w) => ctx.has(w)).length + (/\b(recommended|best|popular|default|auto|standard)\b/i.test(o.label) ? 0.5 : 0);
    if (score > top) ((top = score), (best = [o]));
    else if (score === top && score > 0) best.push(o);
  }
  const pool = best.length ? best : options;
  return pool[Math.floor(random() * pool.length) % pool.length].id;
}

/** The orb's pick among choices (an option id). */
export async function pickFor(context: string, options: AssistOption[]): Promise<string | null> {
  if (!options.length) return null;
  if (options.length === 1) return options[0].id;
  try {
    if (!(await cloudReady())) return fallbackPick(context, options);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let raw = '';
    try {
      raw = await cloudText({
        task: 'fast',
        maxTokens: 12,
        temperature: 0.7,
        signal: ctrl.signal,
        messages: [
          {
            role: 'system',
            content: 'You choose for the person: the option that suits what they are doing best (vary your pick when several fit). Reply with ONLY the number of the option.',
          },
          { role: 'user', content: `What they are doing: ${context}\nOptions:\n${options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}` },
        ],
      });
    } finally {
      clearTimeout(timer);
    }
    const text = cleanReply(raw);
    const num = text.match(/\d+/);
    if (num) {
      const o = options[Number(num[0]) - 1];
      if (o) return o.id;
    }
    const low = text.toLowerCase();
    const named = options.find((o) => low.includes(o.label.toLowerCase()) || low === o.id.toLowerCase());
    return named?.id ?? fallbackPick(context, options);
  } catch {
    return fallbackPick(context, options);
  }
}

// ---------------------------------------------------------------- asking the orb in words

/** "Choose for me", "write it for me", "another idea"…: what someone can say to the orb on a step. */
export function assistIntent(text: string): 'choose' | 'another' | null {
  const t = text.toLowerCase().trim();
  if (/\b(another|different|new|next|other) (idea|one|suggestion)\b|\bsomething else\b|\btry again\b/.test(t)) return 'another';
  if (
    /\b(choose|pick|decide|select)\b.*\b(for me|for us)\b|\byou (choose|pick|decide)\b|\bsurprise me\b|\b(fill|write|type)\b.*\b(for me|it in|this in)\b|\bgive me an idea\b|\bdo (it|this) for me\b|\bhelp me (choose|pick|write)\b/.test(
      t,
    )
  )
    return 'choose';
  return null;
}
