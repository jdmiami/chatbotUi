import { FileStoreError, normalizePath, type FileEntry, type FileStore } from '../types';
import { DEMO_PROJECT_FILES, DEMO_PROJECT_NAME } from './seed';

/**
 * Browser-local file store (Phase 1).
 *
 * Files live in this browser's localStorage under one key. They survive reloads but do NOT sync
 * to other devices or browsers, and Safari may evict site data after weeks of not visiting.
 */

interface StoredFile {
  content: string;
  updatedAt: number;
}
interface Snapshot {
  version: 1;
  files: Record<string, StoredFile>;
}

export const LOCAL_FILES_KEY = 'orbit:files:v1';

export class LocalFileStore implements FileStore {
  readonly kind = 'browser-local' as const;
  readonly label = 'Saved in this browser only — not synced';
  readonly rootName = DEMO_PROJECT_NAME;

  private listeners = new Set<() => void>();
  private cache: Snapshot | null = null;

  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly key = LOCAL_FILES_KEY,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) {
          this.cache = null;
          this.emit();
        }
      });
    }
  }

  private load(): Snapshot {
    if (this.cache) return this.cache;
    let snap: Snapshot | null = null;
    try {
      const raw = this.storage.getItem(this.key);
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed && parsed.version === 1 && parsed.files) snap = parsed;
      }
    } catch {
      snap = null; // corrupted or blocked storage: fall back to seed
    }
    if (!snap) {
      const now = Date.now();
      snap = {
        version: 1,
        files: Object.fromEntries(DEMO_PROJECT_FILES.map((f) => [f.path, { content: f.content, updatedAt: now }])),
      };
      this.persist(snap);
    }
    this.cache = snap;
    return snap;
  }

  private persist(snap: Snapshot) {
    try {
      this.storage.setItem(this.key, JSON.stringify(snap));
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
        throw new FileStoreError('Browser storage is full. Delete some files and try again.', 'quota');
      }
      throw new FileStoreError('Could not save to browser storage (it may be disabled in private browsing).', 'io');
    }
  }

  private commit(next: Snapshot) {
    this.persist(next);
    this.cache = next;
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async list(): Promise<FileEntry[]> {
    const { files } = this.load();
    return Object.entries(files)
      .map(([path, f]) => ({ path, size: new Blob([f.content]).size, updatedAt: f.updatedAt }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<string> {
    const p = normalizePath(path);
    const file = this.load().files[p];
    if (!file) throw new FileStoreError(`No such file: ${p}`, 'not-found');
    return file.content;
  }

  async write(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const snap = this.load();
    // A file can't share its path with an implicit directory.
    if (Object.keys(snap.files).some((k) => k.startsWith(p + '/'))) {
      throw new FileStoreError(`"${p}" is a folder.`, 'exists');
    }
    this.commit({ ...snap, files: { ...snap.files, [p]: { content, updatedAt: Date.now() } } });
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    const snap = this.load();
    const file = snap.files[src];
    if (!file) throw new FileStoreError(`No such file: ${src}`, 'not-found');
    if (src === dst) return;
    if (snap.files[dst]) throw new FileStoreError(`A file named "${dst}" already exists.`, 'exists');
    const files = { ...snap.files };
    delete files[src];
    files[dst] = { content: file.content, updatedAt: Date.now() };
    this.commit({ ...snap, files });
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    const snap = this.load();
    if (!snap.files[p]) throw new FileStoreError(`No such file: ${p}`, 'not-found');
    const files = { ...snap.files };
    delete files[p];
    this.commit({ ...snap, files });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restore the seeded demo project (Settings → Reset demo data). */
  reset() {
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* ignore */
    }
    this.cache = null;
    this.load();
    this.emit();
  }
}
