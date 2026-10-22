/**
 * The orb, as a package. Mount `<OrbCursor brain={…} settings={…} />` once, at the end of your app,
 * and load `orb.css` and `face.css`. Pages mark what matters with data-orb-* attributes (see
 * docs/09-orb.md) and talk to the orb with the helpers in events.tsx.
 */
export { OrbCursor } from './OrbCursor';
export type { OrbBrain, OrbSettings, OrbCursorProps } from './OrbCursor';
export { OrbSpot, orbSay, orbNote, orbThink, orbHome, orbRun, onOrbAct } from './events';
export type { OrbNote, OrbAct } from './events';
export { OrbFace } from './OrbFace';
export type { OrbFaceState } from './OrbFace';
export * from './physics';
export { findFocus, restSpot, besideRect, coversControl } from './attention';
export type { Focus } from './attention';
export { caretField, caretOf, caretAt, caretsAt, offsetAt } from './caret';
export type { Caret } from './caret';
export { insertText, writable, textOf, caretAtEnd, selectionIn, wantsGhost, cleanReply, joinGhost, privateField, labelOf, GHOST_PROMPT, REWRITES, rewritePrompt } from './write';
export type { Field, RewriteKind } from './write';
export { screenText, snapshot, isExplain, EXPLAIN_PROMPT } from './screen';
export type { PageItem } from './screen';
