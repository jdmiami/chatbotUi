/**
 * The orb as the guide. It is quiet: it sits on the thing a screen wants from you (the answer it
 * would pick, the button that moves you on), glows while the app works, and keeps what it would
 * say until you tap it. These are the only ways a flow reaches the orb: window events, so the orb
 * (src/orb) and the screens never import each other.
 */

/**
 * What the orb would tell you here, kept until you tap it (it never talks on its own in a flow).
 * `act` adds a button to its panel; pressing it sends `orb:act` with the id.
 */
export function orbNote(text: string | null, act?: { label: string; id: string }) {
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

/**
 * Listen for the orb's panel buttons: `orb:act` carries the `id` given to `orbNote`. Returns the
 * function that stops listening (use it as an effect's cleanup).
 */
export function onOrbAct(handler: (id: string) => void): () => void {
  const on = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener('orb:act', on);
  return () => window.removeEventListener('orb:act', on);
}
