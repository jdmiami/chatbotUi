/**
 * What a studio is made of. Every studio runs the same walkthrough engine; a studio only brings its
 * name, colours, questions and writer. Copied from Orbit Studios (src/studio/defs.ts), unchanged.
 */

export type MakeKind = 'talk' | 'image' | 'video' | 'movie';

export interface Choice {
  label: string;
  /** One line under the label. */
  hint?: string;
  /** What it adds to the prompt (default: the label, lower-cased). */
  adds?: string;
  /** Words in the earlier answers that make this the orb's pick ("rain", "slow burn"…). */
  suits?: string[];
}

/** One scene of a film's script: what happens, the moment it ends on, and what is said. */
export interface Scene {
  id: string;
  /** "INT. SNOWED-IN CABIN — NIGHT" */
  heading: string;
  action: string;
  end: string;
  says: string;
}

export interface StepDef {
  id: string;
  /** Running head over the question ("Chapter 02 · The room"). */
  kick: string;
  /** The question, as the orb asks it. *Words between asterisks* are set in italics. */
  q: string;
  dek?: string;
  /** Name of the answer on the brief ("Mood", "Setting"). */
  key: string;
  /** Ready answers. The writer adds its own predictions on top once a few answers are in. */
  choices: Choice[];
  /** Ask the writer for fresh choices that fit what was picked so far (default true). */
  predict?: boolean;
  /** Shown only when this returns true (e.g. the movie-only questions). */
  when?: (a: Answers) => boolean;
  /** No "own words" box (e.g. a yes/no). */
  closed?: boolean;
  /** The answer isn't part of the prompt (length, shape…), only of the job. */
  meta?: boolean;
  /** The orb's pick when nothing earlier points elsewhere (default: the first answer). */
  best?: string;
  /** 'script': the writer drafts the script and you go through it scene by scene. */
  kind?: 'choose' | 'script';
}

export interface Flow {
  kind: MakeKind;
  label: string;
  hint: string;
  steps: StepDef[];
}

export interface StudioTheme {
  /** Paper, ink and accent; the desk is always dark. */
  paper: string;
  ink: string;
  ink2: string;
  accent: string;
  desk: string;
  desk2: string;
  orbA: string;
  orbB: string;
}

export interface StudioDef {
  id: string;
  name: string;
  /** The italic half of the masthead ("After *Dark*"). */
  mark: [string, string];
  kicker: string;
  /** 18+: the gate comes first, and the rules below are shown on it. */
  adult: boolean;
  theme: StudioTheme;
  /** The writer: who it is (system prompt for predictions and Talk). */
  writer: string;
  /** Ends every prompt (the studio's house look and its rules in words). */
  tail: string;
  /** What the gallery calls characters here. */
  characters: string;
  makers: { image: string[]; video: string[]; movie: 'ltx' | 'h3-max' };
  rules: string[];
  /** Ready ways to start talking with the writer (Talk), so nobody faces an empty box. */
  talk: { starters: Choice[]; followUps: Choice[] };
  flows: Record<Exclude<MakeKind, 'talk'>, Flow>;
}

export type Answers = Record<string, string>;
