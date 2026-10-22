/**
 * The writers' room: a film worked out backwards. A finished film is a cut of shots; each shot runs
 * between two storyboard pictures; the pictures come from a script; the script comes from the arc,
 * the ending, the people and the place. So the walkthrough asks those first, then drafts the script
 * here (always, even while the studio rests), and the studio's writer can rewrite any of it.
 */
import type { ChatMessage } from '../services/ai/LocalAi';
import type { Answers, Scene, StudioDef } from './defs';
import { studioAi } from './memberApi';

export interface Person {
  name: string;
  look: string;
}

const WOMEN = ['Mara', 'Elena', 'Simone', 'Vera', 'Noor', 'Celeste', 'Ines', 'Livia'];
const MEN = ['Julian', 'Theo', 'Rafael', 'Dorian', 'Silas', 'Marco', 'Adrien', 'Luca'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Who is in it, named (the same names every time for the same story). */
export function castOf(answers: Answers): Person[] {
  const seed = hash(answers.premise ?? '');
  const w = (k: number) => WOMEN[(seed + k) % WOMEN.length];
  const m = (k: number) => MEN[(seed + k) % MEN.length];
  const lead = answers.lead ?? '';
  const partner = answers.partner ?? '';
  const cast = (answers.cast ?? '').toLowerCase();
  if (cast === 'a woman') return [{ name: w(0), look: lead }];
  if (cast === 'a man') return [{ name: m(0), look: lead }];
  if (cast === 'two women') return [{ name: w(0), look: lead }, { name: w(3), look: partner }];
  if (cast === 'two men') return [{ name: m(0), look: lead }, { name: m(3), look: partner }];
  if (/alone|solo/.test(cast)) return [{ name: w(0), look: lead }];
  return [
    { name: w(0), look: lead },
    { name: m(0), look: partner },
  ];
}

interface Beat {
  /** Ways the scene can go ("Another take" moves to the next). */
  a: string[];
  end: string;
  says: string;
}

const ARCS: Record<string, Beat[]> = {
  slow: [
    { a: ['{A} and {B} notice each other across {place}. Neither looks away first.', '{A} catches {B} watching from across {place}, and lets the look last a beat too long.'], end: '{A} turns away, smiling.', says: '{B}, quietly: "Do I know you?"' },
    { a: ['A careful conversation, close but never touching.', '{A} and {B} share a drink and talk about nothing, every word loaded.'], end: 'Their hands rest an inch apart.', says: '{A}: "You should go."' },
    { a: ['{B} brushes a strand of hair from {A}\'s face. The room goes still.', '{B} reaches out and straightens {A}\'s collar, slowly, deliberately.'], end: '{A} closes both eyes.', says: '{B}, softly: "Tell me to stop."' },
    { a: ['They stop talking. {A} pulls {B} closer by the collar.', '{A} steps into {B}\'s space and holds there, waiting.'], end: 'Foreheads touching, breath held.', says: '{A}, barely a whisper: "Don\'t stop."' },
    { a: ['The kiss: slow at first, then hungry, the room blurring behind them.', 'They finally kiss, and everything they held back comes out at once.'], end: 'They break apart, breathless.', says: '' },
  ],
  argument: [
    { a: ['{A} confronts {B} in {place}, old anger in every word.', '{A} storms into {place} and finds {B} already waiting.'], end: '{B} slams a hand on the table.', says: '{A}: "You left without a word."' },
    { a: ['Voices rise. They circle each other like fighters.', 'Every accusation lands; neither backs down an inch.'], end: 'Face to face, far too close.', says: '{B}: "I came back, didn\'t I?"' },
    { a: ['{A} turns to leave. {B} catches {A}\'s wrist.', '{A} reaches the door; {B} says the one thing that stops {A} cold.'], end: 'Neither lets go.', says: '{B}: "Stay. Just tonight."' },
    { a: ['The anger melts. {A} kisses {B}, hard.', 'One look, and the fight turns into something else entirely.'], end: 'The kiss deepens.', says: '' },
    { a: ['They stumble against the wall, laughing between kisses.', 'Clothes, breath and old jokes, tangled together.'], end: 'A lamp tips over and falls.', says: '{A}, laughing: "I hate you."' },
  ],
  game: [
    { a: ['{A} catches {B} watching from across {place} and raises a glass.', 'A note arrives for {B}: a room number, in {A}\'s handwriting.'], end: '{B} raises a glass back.', says: '' },
    { a: ['A dare: {A} slides a key across the table toward {B}.', '{A} whispers the rules of the game into {B}\'s ear.'], end: '{B} pockets the key.', says: '{A}: "Only if you\'re brave."' },
    { a: ['{B} finds {A} waiting in the half-light, playing it cool.', '{B} lets the door click shut; {A} doesn\'t turn around yet.'], end: 'A slow smile.', says: '{A}: "You\'re late."' },
    { a: ['Each move answered: a button undone, a step closer, a glance away.', 'They trade moves like chess players, closer with every turn.'], end: 'Nose to nose.', says: '{B}: "Your move."' },
    { a: ['{A} gives in first and kisses {B}.', '{B} breaks the rules and pulls {A} in.'], end: '{B} grins against {A}\'s lips.', says: '{B}: "I win."' },
  ],
  reunion: [
    { a: ['{A} waits alone in {place}, glancing at the door.', '{A} sets two glasses on the table in {place} and waits.'], end: 'The door opens.', says: '' },
    { a: ['{B} steps in, older now, the same eyes.', '{B} stands in the doorway, a little out of breath.'], end: 'They stand still, an arm\'s length apart.', says: '{B}: "Hi."' },
    { a: ['They talk about the lost years, laughing, then quiet.', 'Old stories, old names, and the silence after them.'], end: '{A} reaches out.', says: '{A}: "I kept your letters."' },
    { a: ['A long embrace that turns into a kiss.', 'They hold each other as if the years never happened, then kiss.'], end: 'Neither wants to let go.', says: '' },
    { a: ['Slow dancing with no music, foreheads together.', 'They sway in the low light to a song only they remember.'], end: '{B} turns {A} gently.', says: '{B}: "I never stopped."' },
  ],
  solo: [
    { a: ['{A} arrives in {place} alone, shaking off the night.', '{A} lets the door fall shut and leans against it, alone at last in {place}.'], end: 'The coat slides from {A}\'s shoulders.', says: '' },
    { a: ['{A} pours a drink and looks out, thinking of someone.', '{A} stands at the glass, the city light across {A}\'s skin.'], end: 'A reflection in the glass.', says: '{A}, to no one: "One more night."' },
    { a: ['At the mirror, {A} gets ready, slow and deliberate.', '{A} chooses what to wear, then changes the mind, then smiles.'], end: 'A last look in the mirror.', says: '' },
    { a: ['{A} lies back, lost in a memory, warm light across the skin.', '{A} stretches out across the sheets, unhurried, eyes half closed.'], end: 'Eyes half closed.', says: '' },
    { a: ['{A} turns and looks straight into the lens.', '{A} notices the camera and, instead of hiding, steps closer.'], end: 'A knowing smile.', says: '{A}: "Were you watching?"' },
  ],
};

const ENDINGS: Record<string, { pair: Beat; solo: Beat }> = {
  'Together at dawn': {
    pair: { a: ['Morning light finds {A} and {B} tangled in the sheets, asleep.', 'Dawn through the curtains; {B} watches {A} sleep.'], end: '{A} wakes and smiles.', says: '' },
    solo: { a: ['Morning light finds {A} asleep, smiling at the memory.', 'Dawn; {A} wakes slowly, wrapped in white linen.'], end: '{A} stretches into the sun.', says: '' },
  },
  'One last look, then gone': {
    pair: { a: ['{B} dresses in the grey light and stops at the door for one last look.', 'At first light {A} slips out of bed and lingers in the doorway.'], end: 'The door closes; one of them is alone.', says: '{B}: "Goodbye."' },
    solo: { a: ['{A} dresses in the grey light and stops at the door for one last look back.', '{A} leaves the key on the pillow and walks out.'], end: 'The door closes.', says: '' },
  },
  'A twist': {
    pair: { a: ['While {B} sleeps, {A} slips something from {B}\'s jacket: it was never what it seemed.', '{B} wakes to find {A} gone, and a photograph left on the pillow.'], end: '{A} walks out into the night, smiling.', says: '{A}: "Nothing personal."' },
    solo: { a: ['{A} opens the envelope on the bed: someone has been watching all along.', '{A} finds a second key on the dresser that wasn\'t there before.'], end: '{A} looks up, startled, then smiles.', says: '' },
  },
  'Left wanting more': {
    pair: { a: ['Just as it begins, {A} pulls away and walks to the door.', '{A} stops {B} with a finger to the lips and leaves.'], end: 'A look back over the shoulder.', says: '{A}: "Next time."' },
    solo: { a: ['{A} switches off the lamp; only a silhouette and a smile remain.', '{A} draws the curtain closed, eyes on the lens.'], end: 'Darkness, and a laugh.', says: '{A}: "Next time."' },
  },
};

const ARC_OF: Record<string, keyof typeof ARCS> = {
  'Slow burn to a kiss': 'slow',
  'Argument turns to passion': 'argument',
  'A game of seduction': 'game',
  'Tender reunion': 'reunion',
};
const TONE_ARC: Record<string, keyof typeof ARCS> = { 'Slow burn': 'slow', Playful: 'game', Romantic: 'reunion', Intense: 'argument', 'Dark and dangerous': 'argument' };
const TONE_END: Record<string, string> = { 'Slow burn': 'Left wanting more', Playful: 'Left wanting more', Romantic: 'Together at dawn', Intense: 'One last look, then gone', 'Dark and dangerous': 'A twist' };
const TIME: Record<string, string> = {
  'Late night, after the rain': 'NIGHT',
  'Golden hour': 'SUNSET',
  'Snowed-in winter': 'WINTER NIGHT',
  '1950s, jazz and smoke': 'NIGHT, 1955',
};

/** Which beats a film of n scenes keeps (the last is always the ending). */
export function beatsFor(n: number): number[] {
  const pick: Record<number, number[]> = { 1: [5], 2: [0, 5], 3: [0, 3, 5], 4: [0, 2, 4, 5], 5: [0, 1, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  return pick[Math.max(1, Math.min(6, n))];
}

export function sceneCount(answers: Answers): number {
  if (answers.cut !== "Director's cut") return 3;
  return Math.max(1, Math.min(6, Number.parseInt(answers.scenes ?? '', 10) || 4));
}

const placeOf = (answers: Answers) => (answers.world ?? 'a quiet room').replace(/[.]+$/, '');
const withThe = (p: string) => (/^(a|an|the)\s/i.test(p) ? p.toLowerCase() : `the ${p.toLowerCase()}`);
export const headingOf = (answers: Answers) => `INT. ${placeOf(answers).toUpperCase()} — ${TIME[answers.time ?? ''] ?? 'NIGHT'}`;

function fill(text: string, cast: Person[], answers: Answers): string {
  const [a, b] = cast;
  return text
    .replace(/\{A\}/g, a?.name ?? 'The lead')
    .replace(/\{B\}/g, b?.name ?? 'a stranger')
    .replace(/\{place\}/g, withThe(placeOf(answers)));
}

function beatList(answers: Answers): Beat[] {
  const solo = castOf(answers).length < 2;
  const arc = solo ? 'solo' : (ARC_OF[answers.beats ?? ''] ?? TONE_ARC[answers.tone ?? ''] ?? 'slow');
  const ending = ENDINGS[answers.ending ?? ''] ?? ENDINGS[TONE_END[answers.tone ?? ''] ?? 'Left wanting more'];
  return [...ARCS[arc], solo ? ending.solo : ending.pair];
}

const sid = (i: number) => `s${i + 1}`;

/** The first draft, from the answers alone (no writer needed). */
export function draftScript(answers: Answers): Scene[] {
  const cast = castOf(answers);
  const beats = beatList(answers);
  const voices = answers.msound !== 'Music' && answers.msound !== 'Quiet';
  return beatsFor(sceneCount(answers)).map((k, i) => {
    const b = beats[k];
    return { id: sid(i), heading: headingOf(answers), action: fill(b.a[0], cast, answers), end: fill(b.end, cast, answers), says: voices ? fill(b.says, cast, answers) : '' };
  });
}

/** "Another take" on one scene: the next way that beat can go. */
export function anotherTake(answers: Answers, scenes: Scene[], i: number): Scene[] {
  const cast = castOf(answers);
  const k = beatsFor(scenes.length)[i];
  const b = beatList(answers)[k];
  if (!b) return scenes;
  const takes = b.a.map((a) => fill(a, cast, answers));
  const at = takes.indexOf(scenes[i].action);
  const action = takes[(at + 1) % takes.length];
  return scenes.map((s, j) => (j === i ? { ...s, action } : s));
}

/** What the script was drafted from; when these answers change, the draft is written again. */
export function scriptBasis(answers: Answers): string {
  const keys = ['cut', 'premise', 'tone', 'cast', 'lead', 'partner', 'motive', 'world', 'time', 'beats', 'ending', 'scenes'];
  return JSON.stringify(keys.map((k) => answers[k] ?? ''));
}

/** "Mara (late twenties, dark curls)" at the first mention in a shot, so the maker knows who is who. */
export function describe(text: string, cast: Person[]): string {
  let out = text;
  for (const p of cast) {
    if (!p.look) continue;
    const at = out.indexOf(p.name);
    if (at >= 0) out = `${out.slice(0, at)}${p.name} (${p.look.toLowerCase()})${out.slice(at + p.name.length)}`;
  }
  return out;
}

/** The opening picture: the place, before anything happens. */
export function openingOf(answers: Answers): string {
  return `Establishing shot of ${withThe(placeOf(answers))}, ${(TIME[answers.time ?? ''] ?? 'night').toLowerCase()}. ${answers.premise ?? ''}`.trim();
}

/** Pull a JSON list of scenes out of a reply (models wrap it in prose or fences). */
export function parseScenes(text: string, fallbackHeading: string): Scene[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return [];
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    return raw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r, i) => ({ id: sid(i), heading: str(r.heading, 80) || fallbackHeading, action: str(r.action, 500), end: str(r.end, 240), says: str(r.says, 240) }))
      .filter((s) => s.action.length > 3)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function brief(answers: Answers): string {
  const cast = castOf(answers)
    .map((p) => `${p.name}${p.look ? ` (${p.look})` : ''}`)
    .join(' and ');
  const lines = [
    ['Story', answers.premise],
    ['Tone', answers.tone],
    ['Characters', cast],
    ['What the lead wants', answers.motive],
    ['Place', answers.world],
    ['Time', answers.time],
    ['Arc', answers.beats],
    ['Ending', answers.ending],
  ];
  return lines
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

const SHAPE = '[{"heading":"INT. PLACE — TIME","action":"what we see, one or two visual sentences","end":"the exact final moment, one sentence","says":"Name: \\"one short line\\" or empty"}]';

async function ask(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  let text = '';
  await studioAi.chat(messages, (d) => (text += d), signal, 1200);
  return text;
}

/** The studio's writer writes the whole script (only while the studio is awake). */
export async function writeScript(studio: StudioDef, answers: Answers, signal?: AbortSignal): Promise<Scene[]> {
  const n = sceneCount(answers);
  const text = await ask(
    [
      { role: 'system', content: `${studio.writer}\nYou write short film scripts. Each scene becomes a 5-second shot, so keep each one to a single visual action. Reply with only a JSON array.` },
      { role: 'user', content: `${brief(answers)}\n\nWrite exactly ${n} scenes, the last one the ending, as ${SHAPE}. Use the characters' names.` },
    ],
    signal,
  );
  return parseScenes(text, headingOf(answers)).slice(0, n);
}

/** The writer rewrites one scene, the way you asked ("more heat", "softer", "a line"…). */
export async function rewriteScene(studio: StudioDef, answers: Answers, scenes: Scene[], i: number, how: string, signal?: AbortSignal): Promise<Scene[]> {
  const script = scenes.map((s, j) => `${j + 1}. ${s.heading}. ${s.action} Ends on: ${s.end}${s.says ? ` ${s.says}` : ''}`).join('\n');
  const text = await ask(
    [
      { role: 'system', content: `${studio.writer}\nYou revise one scene of a short film script. Reply with only a JSON array holding the one new scene.` },
      { role: 'user', content: `${brief(answers)}\n\nThe script:\n${script}\n\nRewrite scene ${i + 1} so it is ${how}. Keep it one visual action that leads into the next scene, as ${SHAPE}.` },
    ],
    signal,
  );
  const [next] = parseScenes(text, scenes[i].heading);
  return next ? scenes.map((s, j) => (j === i ? { ...next, id: s.id } : s)) : scenes;
}
