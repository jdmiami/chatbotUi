/**
 * How a page talks to the orb. Everything goes over `window` CustomEvents, so any framework (or
 * none) can use it. The helpers here are typed wrappers; the event names are the contract:
 *
 *   orb:say     detail: string                    → the orb shows the line as a caption
 *   orb:energy  detail: number (0…1) | null       → its glow / stir (null = rest)
 *   orb:home    (no detail)                       → back to following, if it was parked or tucked
 *   orb:note    detail: { text, act? } | null     → kept quiet until the orb is tapped (its panel)
 *   orb:act     detail: string (the act id)       ← sent BY the orb when the note's button is pressed
 *   orb:run     detail: string                    → open the panel and ask the adapter this
 *
 * The same helpers are exported from src/flow (orbGuide.ts) and src/components (OrbSpot), so a
 * page never has to import the orb itself. In Orbit, `orb:run` was called `orbit:orb-run`.
 */

export interface OrbAct {
  /** The button's label in the orb's panel. */
  label: string;
  /** Sent back as the detail of `orb:act` when it is pressed. */
  id: string;
}

export interface OrbNote {
  text: string;
  act?: OrbAct;
}

/** Have the orb say one line (a caption above it, and a talking face). It also goes to whatever is marked data-orb-focus. */
export function orbSay(line: string) {
  window.dispatchEvent(new CustomEvent('orb:say', { detail: line }));
}

/**
 * What the orb would tell you here, kept until you tap it (it never talks on its own in a guided flow).
 * `act` adds a button to its panel; pressing it sends `orb:act` with the id.
 */
export function orbNote(text: string | null, act?: OrbAct) {
  window.dispatchEvent(new CustomEvent('orb:note', { detail: text ? { text, act } : null }));
}

/** The orb's glow: 0..1 while it is busy for you, null to let it rest. */
export function orbThink(energy: number | null) {
  window.dispatchEvent(new CustomEvent('orb:energy', { detail: energy }));
}

/** Bring the orb back to its place beside what matters (after you dragged or threw it). */
export function orbHome() {
  window.dispatchEvent(new CustomEvent('orb:home'));
}

/** Hand the orb a request: its panel opens and the line goes to the adapter as if typed there. */
export function orbRun(goal: string) {
  window.dispatchEvent(new CustomEvent('orb:run', { detail: goal }));
}

/** Listen for the note's button. Returns the function that stops listening. */
export function onOrbAct(handler: (id: string) => void): () => void {
  const on = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener('orb:act', on);
  return () => window.removeEventListener('orb:act', on);
}

/**
 * A place kept for the orb: it sits centred on it, grown to `size` px (see attention.ts). Not
 * aria-hidden, since the orb skips anything hidden; it is an empty span, so there is nothing to read.
 * Give it a class that positions and sizes it (in Orbit: `.st-orb-spot`, 52×52 absolute at the top
 * right of a headline; `.st-choice-spot`, 40×40 at the right of an answer).
 */
export function OrbSpot({ size = 52, className = 'st-orb-spot' }: { size?: number; className?: string }) {
  return <span className={className} data-orb-spot="" data-orb-size={size} role="presentation" />;
}
