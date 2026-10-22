/**
 * Runs: every go through a flow is a run, from the moment it starts. Drafts save themselves after each
 * answer, so "Save draft" is only ever a way out, never a chore. Kept per guide, on this device
 * (an app with accounts can move them to its own storage; the functions are the contract).
 */
import type { Run } from './defs';

const key = (guide: string) => `orbit:guide:${guide}:runs`;

function read(k: string): Run[] {
  try {
    const raw = localStorage.getItem(k);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as Run[]) : [];
  } catch {
    return [];
  }
}
function write(k: string, list: Run[]) {
  try {
    localStorage.setItem(k, JSON.stringify(list));
  } catch {
    /* private mode or full: the session still works, it just won't be remembered */
  }
}

/** Every run of this guide, newest first. Missing or broken storage gives []. */
export function listRuns(guideId: string): Run[] {
  return read(key(guideId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Keep a run (replacing one with the same id); at most 200 are kept. Returns the saved copy. */
export function saveRun(guideId: string, r: Run): Run {
  const now = { ...r, updatedAt: new Date().toISOString() };
  const rest = read(key(guideId)).filter((x) => x.id !== r.id);
  write(key(guideId), [now, ...rest].slice(0, 200));
  return now;
}

export function removeRun(guideId: string, id: string) {
  write(
    key(guideId),
    read(key(guideId)).filter((x) => x.id !== id),
  );
}

/** A fresh, empty run of one flow. */
export function newRun(flowId: string): Run {
  const at = new Date().toISOString();
  return { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, flowId, title: '', answers: {}, status: 'draft', createdAt: at, updatedAt: at };
}

/** "Today", "Yesterday", "3 days ago", then a short date: when a run was touched, as a contents page would say it. */
export function whenOf(iso: string, now = Date.now()): string {
  const d = (now - Date.parse(iso)) / 86_400_000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
