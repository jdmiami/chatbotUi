/**
 * What a guide is made of. Every guide runs the same flow engine (./engine); a guide only brings
 * its name, its colours, its rules and its flows: the questions, one at a time, with ready answers.
 * Nothing here knows what the answers are for. A trip, a recipe, a form, a plan: the app decides
 * what the finished answers become.
 */

/** One ready answer to a question. */
export interface Choice {
  /** What is shown, and what is stored as the answer. */
  label: string;
  /** One line under the label. */
  hint?: string;
  /** What the answer contributes to the result (default: the label, lower-cased). */
  value?: string;
  /** Words in the earlier answers that make this the orb's pick ("rain", "friends"…). */
  suits?: string[];
}

/** One question of a flow. */
export interface Step {
  /** The answer's key in `Answers`. */
  id: string;
  /** Running head over the question ("Chapter 02 · The season"). */
  kick: string;
  /** The question, as the orb asks it. *Words between asterisks* are set in italics. */
  q: string;
  /** One line under the question. */
  dek?: string;
  /** Name of the answer on the summary ("Place", "Season"). */
  key: string;
  /**
   * Ready answers. Once one answer that is part of the result is in, an awake assistant's
   * suggestions are shown first and the list is cut to six, so up to four ready answers give way.
   */
  choices: Choice[];
  /** Ask the assistant for fresh choices that fit what was picked so far (default true). */
  suggest?: boolean;
  /** Shown only when this returns true for the answers so far. */
  when?: (a: Answers) => boolean;
  /** No "own words" box (e.g. a yes/no), and no suggestions. */
  closed?: boolean;
  /** The answer is about the result (its length, its shape…), not part of it: left out of `resultOf`. */
  meta?: boolean;
  /** The orb's pick when nothing earlier points elsewhere (default: the first answer). */
  best?: string;
  /**
   * A step the app renders itself (a text box, a date picker, a map…) and answers with its own
   * value. The string names what it is, for the app to switch on ("notes"). Such a step has no
   * ready answers; "Finish it for me" answers it with `CUSTOM_DONE`.
   */
  custom?: string;
}

/** One list of questions: the way to one kind of result. */
export interface Flow {
  id: string;
  /** A noun phrase with its article ("A trip"), used in sentences and on the contents page. */
  label: string;
  hint?: string;
  steps: Step[];
}

/** The colours of a guide: paper, ink and accent for the page; the desk is always dark. */
export interface Theme {
  paper: string;
  ink: string;
  ink2: string;
  accent: string;
  desk: string;
  desk2: string;
  orbA: string;
  orbB: string;
}

/** A guide: one product built on the engine. Each guide is its own site. */
export interface Guide {
  /** Storage key part; the site's id. */
  id: string;
  name: string;
  /** The masthead in two halves; the second is set in italics ("Com", "pass"). */
  mark: [string, string];
  /** The small line over the masthead. */
  kicker: string;
  theme: Theme;
  /** House rules, shown in the options drawer (and on a gate, if the app has one). */
  rules?: string[];
  /** Ready ways to open a conversation, so nobody faces an empty box. */
  starters?: Choice[];
  /** Ready ways to carry a conversation on. */
  followUps?: Choice[];
  flows: Record<string, Flow>;
}

/** The state of a flow: step id → the label picked, the words typed, or a custom step's value. */
export type Answers = Record<string, string>;

/** One go through a flow, kept from the moment it starts (see ./runs). */
export interface Run {
  id: string;
  flowId: string;
  /** Given by the app (from the answers, usually). */
  title: string;
  answers: Answers;
  status: 'draft' | 'done';
  createdAt: string;
  updatedAt: string;
  /** Whatever the app made of the finished answers. */
  result?: unknown;
}
