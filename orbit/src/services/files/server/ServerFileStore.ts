import { FileStoreError, normalizePath, type FileEntry, type FileStore } from '../types';
import { HostError, type HostClient } from '../../host/connection';

/**
 * Real project files on the Linux machine (Orbit host /orbit/api/files).
 * Changes made elsewhere (terminal, Antigravity, another device) are picked up by polling
 * the file list while the page is visible.
 */
export class ServerFileStore implements FileStore {
  readonly kind = 'server' as const;
  readonly label = 'Saved on your Linux machine';
  rootName = 'projects';

  private listeners = new Set<() => void>();
  private snapshot = new Map<string, number>(); // path -> updatedAt
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: HostClient) {}

  private toStoreError(err: unknown): never {
    if (err instanceof HostError) {
      const code =
        err.code === 'not-found'
          ? 'not-found'
          : err.code === 'exists'
            ? 'exists'
            : err.code === 'invalid-path'
              ? 'invalid-path'
              : 'io';
      throw new FileStoreError(err.message, code);
    }
    throw new FileStoreError((err as Error).message ?? 'Unknown error', 'io');
  }

  async list(): Promise<FileEntry[]> {
    try {
      const body = await this.host.json<{ root: string; files: FileEntry[] }>('/files');
      this.rootName = body.root;
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

  async write(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    try {
      const body = await this.host.json<{ updatedAt: number }>(`/files/content?path=${encodeURIComponent(p)}`, {
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
    this.emit();
  }

  async remove(path: string): Promise<void> {
    try {
      await this.host.json(`/files/content?path=${encodeURIComponent(normalizePath(path))}`, { method: 'DELETE' });
    } catch (err) {
      return this.toStoreError(err);
    }
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
