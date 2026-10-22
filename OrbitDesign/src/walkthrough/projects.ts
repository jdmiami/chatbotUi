/**
 * Projects: every walkthrough is a project, from its first answer. Drafts save themselves after
 * each answer, so "Save draft" is only ever a way out, never a chore. Kept per studio, on this
 * device (an app with accounts can move them to its own storage; the functions are the contract).
 * Copied from Orbit Studios (src/studio/projects.ts), unchanged.
 */
import type { Answers, MakeKind, Scene } from './defs';

export interface Project {
  id: string;
  kind: Exclude<MakeKind, 'talk'>;
  title: string;
  answers: Answers;
  /** A film's script: drafted from the answers (`basis`), then yours to change. */
  script?: { basis: string; scenes: Scene[]; by: 'draft' | 'writer' | 'you' };
  status: 'draft' | 'making' | 'done' | 'error';
  /** Picture or video job, or the movie, wherever the app makes them. */
  jobId?: string;
  movieId?: string;
  /** What it made (gallery item ids). */
  items: string[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  itemId?: string | null;
  createdAt: string;
}

const key = (studio: string, what: string) => `orbit:studio:${studio}:${what}`;

function read<T>(k: string): T[] {
  try {
    const raw = localStorage.getItem(k);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}
function write<T>(k: string, list: T[]) {
  try {
    localStorage.setItem(k, JSON.stringify(list));
  } catch {
    /* private mode or full: the session still works, it just won't be remembered */
  }
}

export function listProjects(studio: string): Project[] {
  return read<Project>(key(studio, 'projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProject(studio: string, p: Project): Project {
  const now = { ...p, updatedAt: new Date().toISOString() };
  const rest = read<Project>(key(studio, 'projects')).filter((x) => x.id !== p.id);
  write(key(studio, 'projects'), [now, ...rest].slice(0, 200));
  return now;
}

export function removeProject(studio: string, id: string) {
  write(
    key(studio, 'projects'),
    read<Project>(key(studio, 'projects')).filter((x) => x.id !== id),
  );
}

export function newProject(kind: Project['kind']): Project {
  const at = new Date().toISOString();
  return { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, title: '', answers: {}, status: 'draft', items: [], createdAt: at, updatedAt: at };
}

export function listCharacters(studio: string): Character[] {
  return read<Character>(key(studio, 'characters'));
}

/** Keep a character described in a walkthrough (once per description). */
export function keepCharacter(studio: string, name: string, description: string): Character[] {
  const list = listCharacters(studio);
  if (list.some((c) => c.description === description)) return list;
  const next = [{ id: `c${Date.now().toString(36)}`, name, description, createdAt: new Date().toISOString() }, ...list].slice(0, 100);
  write(key(studio, 'characters'), next);
  return next;
}

/** "Last month", "Today": when a project was touched, the way a contents page would say it. */
export function whenOf(iso: string, now = Date.now()): string {
  const d = (now - Date.parse(iso)) / 86_400_000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
