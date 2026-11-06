/**
 * Flipbook saves on this device as you draw (IndexedDB, which holds far more than localStorage).
 * Backing up to your account comes later; until then a scene lives only on the device it was drawn on.
 */
import { newScene, sanitize, type Scene } from './model';

const DB = 'orbit-flipbook';
const STORE = 'scenes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no storage'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
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
