/**
 * The guided flow: pure rules (engine), suggested choices (suggest), drafts on this device (runs),
 * the orb hooks (orbGuide) and the one adapter an app fills in to bring any assistant (adapter).
 * No network calls live in here.
 */
export type { Answers, Choice, Flow, Guide, Run, Step, Theme } from './defs';
export { assistantAwake, getAssistant, setAssistant } from './adapter';
export type { Assistant, ChatMessage } from './adapter';
export { CUSTOM_DONE, answer, back, finishAll, nextStep, pickFor, progressOf, recommend, resultOf, stepsFor, summaryOf, valueOf } from './engine';
export type { Pick } from './engine';
export { mergeChoices, parseChoices, suggestChoices, suggestionMessages, wantsSuggestions } from './suggest';
export { listRuns, newRun, removeRun, saveRun, whenOf } from './runs';
export { onOrbAct, orbHome, orbNote, orbThink } from './orbGuide';
export { COMPASS } from './guides/example';

import type { Guide } from './defs';

/**
 * Which guide this page is, if any. Each guide is its own site: its address picks it (`hosts`,
 * "compass.example.com=compass,…"), or a build for one guide (`fixed`), or ?guide=<id> for previews.
 * Remembered for the tab, so links inside keep it; ?guide=off forgets. An app usually passes
 * `hosts` and `fixed` from its build-time environment.
 */
export function guideFromLocation(guides: Record<string, Guide>, opts: { hosts?: string; fixed?: string } = {}, loc: Location = window.location): Guide | null {
  const hosts = String(opts.hosts ?? '')
    .split(',')
    .map((p) => p.trim().split('='))
    .filter((p) => p.length === 2);
  const byHost = hosts.find(([h]) => h === loc.hostname)?.[1];
  const byQuery = new URLSearchParams(loc.search).get('guide');
  let id = byHost || opts.fixed || byQuery || null;
  try {
    if (byQuery === 'off') {
      sessionStorage.removeItem('orbit:guide');
      return null;
    }
    if (id) sessionStorage.setItem('orbit:guide', id);
    else id = sessionStorage.getItem('orbit:guide');
  } catch {
    /* storage blocked: the address alone decides */
  }
  return (id && guides[id]) || null;
}
