import { useSyncExternalStore } from 'react';

/**
 * Transient status messages, announced politely to screen readers. A self-contained store (no
 * state library): `toast()` from anywhere, `<Toasts/>` once near the root. The markup and timing
 * match Orbit's shell (src/shell/Toasts.tsx + the toast part of src/state/shell.ts).
 */

export type ToastTone = 'info' | 'error' | 'success';
export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

/** How long a toast stays, in ms (Orbit: 3200). */
export const TOAST_MS = 3200;

let toasts: Toast[] = [];
let seq = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Show a message for a moment. Returns its id (for `dismissToast`). */
export function toast(text: string, tone: ToastTone = 'info'): number {
  const id = seq++;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => dismissToast(id), TOAST_MS);
  return id;
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const snapshot = () => toasts;

/** The current toasts (for tests or a custom view). */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className="toast glass"
          style={
            t.tone === 'error'
              ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
              : t.tone === 'success'
                ? { borderColor: 'var(--success)' }
                : undefined
          }
          onClick={() => dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
