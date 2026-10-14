import { FileStoreError, normalizePath, type FileEntry, type FileStore } from '../types';
import { HostError, type HostClient } from '../../host/connection';

/**
 * Real project files on the Linux machine (Orbit host /orbit/api/files).
 * Changes made elsewhere (terminal, Antigravity, another device) are picked up by polling
 * the file list while the page is visible.
 */
/** sha256 of the UTF-8 bytes, as the host computes it; null where Web Crypto is unavailable (then no check). */
async function sha256Hex(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ServerFileStore implements FileStore {
  readonly kind = 'server' as const;
  readonly label = 'Saved on your Linux machine';
  rootName = 'projects';
  /** The host lists at most 5000 files; true when this listing was cut off. */
  truncated = false;

  private listeners = new Set<() => void>();
  private snapshot = new Map<string, number>(); // path -> updatedAt
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: HostClient) {}

  private toStoreError(err: unknown): never {
    if (err instanceof HostError) {
      const known = ['not-found', 'exists', 'invalid-path', 'changed', 'binary', 'too-large'] as const;
      const code = known.find((k) => k === err.code) ?? 'io';
      throw new FileStoreError(err.message, code);
    }
    throw new FileStoreError((err as Error).message ?? 'Unknown error', 'io');
  }

  async list(): Promise<FileEntry[]> {
    try {
      const body = await this.host.json<{ root: string; files: FileEntry[]; truncated?: boolean }>('/files');
      this.rootName = body.root;
      this.truncated = Boolean(body.truncated);
      this.remember(body.files);
      return body.files;
    } catch (err) {
      return this.toStoreError(err);
    }
  }

  async read(path: string): Promise<string> {
    const p = normalizePath(path);
    try {
      const body = await this.host.json<{ content: string }>(`/files/content?path=${encodeURIComponent(p)}`);
      return body.content;
    } catch (err) {
      return this.toStoreError(err);
    }
  }

  async write(path: string, content: string, opts: { expected?: string } = {}): Promise<void> {
    const p = normalizePath(path);
    const base = opts.expected === undefined ? null : await sha256Hex(opts.expected);
    try {
      const query = `path=${encodeURIComponent(p)}${base ? `&base=${base}` : ''}`;
      const body = await this.host.json<{ updatedAt: number }>(`/files/content?${query}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: content,
      });
      this.snapshot.set(p, body.updatedAt);
    } catch (err) {
      return this.toStoreError(err);
    }
    this.emit();
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      await this.host.json('/files/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: normalizePath(from), to: normalizePath(to) }),
      });
    } catch (err) {
      return this.toStoreError(err);
    }
    // Keep the poll snapshot current so the next poll doesn't report this change a second time.
    const at = this.snapshot.get(normalizePath(from)) ?? Date.now();
    this.snapshot.delete(normalizePath(from));
    this.snapshot.set(normalizePath(to), at);
    this.emit();
  }

  async remove(path: string): Promise<void> {
    try {
      await this.host.json(`/files/content?path=${encodeURIComponent(normalizePath(path))}`, { method: 'DELETE' });
    } catch (err) {
      return this.toStoreError(err);
    }
    this.snapshot.delete(normalizePath(path));
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 8000);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** Not applicable on the server (nothing to reset); kept for the services registry. */
  reset() {}

  private remember(files: FileEntry[]) {
    this.snapshot = new Map(files.map((f) => [f.path, f.updatedAt]));
  }

  private async poll() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const body = await this.host.json<{ files: FileEntry[] }>('/files');
      const changed =
        body.files.length !== this.snapshot.size || body.files.some((f) => this.snapshot.get(f.path) !== f.updatedAt);
      this.remember(body.files);
      if (changed) this.emit();
    } catch {
      /* offline for a moment; try again next tick */
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
