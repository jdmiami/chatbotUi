/**
 * What the orb helps with on the step that is on screen (a walk-through like Make's). The step
 * says what the person is doing, where the orb should stay, and how to fill or pick for them.
 * Placeholder bodies: the orb fills them in.
 */
export interface AssistOption { id: string; label: string; el?: HTMLElement | null }
export interface OrbAssist {
  id: string;            // stable per step, e.g. 'make:describe'
  context: string;       // plain words: what the person is doing now, e.g. "Step 3 of 5, Describe it: a portrait picture with Krea Real, style Dark brush"
  target: HTMLElement | null; // the element the orb stays beside: the text box, or the group of choices
  kind: 'text' | 'choice';
  value?: string;        // text steps
  setValue?: (text: string) => void;
  options?: AssistOption[]; // choice steps
  selected?: string | null;
  choose?: (id: string) => void;
}
/** Register what the orb should help with while this step is on screen (null = nothing). */
export function useOrbAssist(assist: OrbAssist | null): void { void assist; }
/** The orb flies to the element just picked, "approves" it, and goes back; resolves when done. */
export function orbApprove(el: HTMLElement | null): Promise<void> { void el; return Promise.resolve(); }
/** An idea for a text step (n = 0, 1, 2… gives a different idea each time). */
export async function ideaFor(context: string, current: string, n: number): Promise<string> { void context; void current; void n; return ''; }
/** The orb's pick among choices (an option id). */
export async function pickFor(context: string, options: AssistOption[]): Promise<string | null> { void context; return options[0]?.id ?? null; }
