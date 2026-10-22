/**
 * The walkthrough: pure rules (engine), the writers' room (writer), predicted choices (predict),
 * drafts on this device (projects), the orb hooks (orbGuide) and the one adapter an app fills in
 * to bring any writer (adapter). No network calls live in here.
 */
export type { Answers, Choice, Flow, MakeKind, Scene, StepDef, StudioDef, StudioTheme } from './defs';
export type { MovieDraft, MovieShotDraft, MovieSound, StudioRequest } from './jobs';
export { setWriter, getWriter, writerAwake } from './adapter';
export type { ChatMessage, Writer } from './adapter';
export { answer, back, briefOf, finishAll, jobOf, makerFor, nextStep, pickFor, progressOf, promptOf, recommend, SCRIPT_OK, stepsFor } from './engine';
export type { Job, Pick } from './engine';
export { mergeChoices, parseChoices, predictChoices, predictionMessages } from './predict';
export {
  anotherTake,
  beatsFor,
  castOf,
  describe,
  draftScript,
  headingOf,
  openingOf,
  parseScenes,
  rewriteMessages,
  rewriteScene,
  sceneCount,
  scriptBasis,
  scriptMessages,
  writeScript,
} from './writer';
export type { Person } from './writer';
export { keepCharacter, listCharacters, listProjects, newProject, removeProject, saveProject, whenOf } from './projects';
export type { Character, Project } from './projects';
export { onOrbAct, orbHome, orbNote, orbThink } from './orbGuide';
export { POSTCARD } from './studios/example';

import type { StudioDef } from './defs';

/**
 * Which studio this page is, if any. Each studio is its own site: its address picks it
 * (`hosts`, "afterdark.example.com=afterdark,…"), or a build for one studio (`fixed`), or
 * ?studio=<id> for previews. Remembered for the tab, so links inside keep it; ?studio=off forgets.
 * In Orbit `hosts` and `fixed` came from build-time environment variables (VITE_STUDIO_HOSTS,
 * VITE_STUDIO); here the app passes them in.
 */
export function studioFromLocation(studios: Record<string, StudioDef>, opts: { hosts?: string; fixed?: string } = {}, loc: Location = window.location): StudioDef | null {
  const hosts = String(opts.hosts ?? '')
    .split(',')
    .map((p) => p.trim().split('='))
    .filter((p) => p.length === 2);
  const byHost = hosts.find(([h]) => h === loc.hostname)?.[1];
  const byQuery = new URLSearchParams(loc.search).get('studio');
  let id = byHost || opts.fixed || byQuery || null;
  try {
    if (byQuery === 'off') {
      sessionStorage.removeItem('orbit:studio');
      return null;
    }
    if (id) sessionStorage.setItem('orbit:studio', id);
    else id = sessionStorage.getItem('orbit:studio');
  } catch {
    /* storage blocked: the address alone decides */
  }
  return (id && studios[id]) || null;
}
