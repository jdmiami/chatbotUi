/**
 * Flipbook saves on this device as you draw (IndexedDB, which holds far more than localStorage).
 * Backing up to your account comes later; until then a scene lives only on the device it was drawn on.
 */
import { newScene, sanitize, type Scene } from './model';
import { sanitizeCharacter, type Character } from './character';

const DB = 'orbit-flipbook';
const STORE = 'scenes';
/** The character library: every character you have made, for any flipbook. */
const CHARS = 'characters';
/** Saved versions of flipbooks ("Save a version"), to go back to. */
const VERSIONS = 'versions';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no storage'));
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      for (const name of [STORE, CHARS, VERSIONS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listScenes(): Promise<Scene[]> {
  try {
    const all = await run<unknown[]>('readonly', (s) => s.getAll());
    return all
      .map(sanitize)
      .filter((s): s is Scene => s !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** The scene you were last drawing, or a fresh pad. */
export async function loadLatest(): Promise<{ scene: Scene; saved: boolean }> {
  const all = await listScenes();
  return all.length ? { scene: all[0], saved: true } : { scene: newScene(), saved: false };
}

export async function saveScene(scene: Scene): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(scene));
    return true;
  } catch {
    return false;
  }
}

export async function listCharacters(): Promise<Character[]> {
  try {
    const all = await run<unknown[]>('readonly', (s) => s.getAll(), CHARS);
    return all
      .map(sanitizeCharacter)
      .filter((c): c is Character => c !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveCharacter(c: Character): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(c), CHARS);
    return true;
  } catch {
    return false;
  }
}

/** Remove a flipbook from this device (its saved versions go too). */
export async function deleteScene(id: string): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.delete(id));
    for (const v of await listVersions(id)) await run('readwrite', (s) => s.delete(v.id), VERSIONS);
    return true;
  } catch {
    return false;
  }
}

export interface Version {
  id: string;
  sceneId: string;
  /** When it was saved (ms). */
  at: number;
  label: string;
  scene: Scene;
}

export async function saveVersion(scene: Scene, label: string): Promise<Version | null> {
  const v: Version = { id: `ver-${scene.id}-${Date.now().toString(36)}`, sceneId: scene.id, at: Date.now(), label, scene };
  try {
    await run('readwrite', (s) => s.put(v), VERSIONS);
    return v;
  } catch {
    return null;
  }
}

/** A flipbook's saved versions, newest first. */
export async function listVersions(sceneId: string): Promise<Version[]> {
  try {
    const all = await run<Version[]>('readonly', (s) => s.getAll() as IDBRequest<Version[]>, VERSIONS);
    return all
      .filter((v) => v && v.sceneId === sceneId)
      .map((v) => ({ ...v, scene: sanitize(v.scene)! }))
      .filter((v) => v.scene)
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}
