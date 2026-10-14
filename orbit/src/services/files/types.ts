/**
 * File store contract used by the Editor (and by the simulated terminal's `cat`, `ls`, etc.).
 *
 * Phase 1: `LocalFileStore` (services/files/local) keeps a demo project in this browser's
 * localStorage. It does NOT sync between devices.
 * Phase 2: a `ServerFileStore` will call an authenticated file API rooted at a project directory
 * on the Ubuntu host.
 *
 * Paths are POSIX-style and relative to the project root, e.g. "src/main.py".
 * Directories are implicit (derived from file paths), like a git tree.
 */

export interface FileEntry {
  path: string;
  size: number;
  /** ms since epoch */
  updatedAt: number;
}

export class FileStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'exists' | 'invalid-path' | 'quota' | 'io',
  ) {
    super(message);
    this.name = 'FileStoreError';
  }
}

export interface FileStore {
  /** 'browser-local' = this browser only; 'server' = files on the Ubuntu host. */
  readonly kind: 'browser-local' | 'server';
  readonly label: string;
  /** Display name of the project root, e.g. "orbit-demo". */
  readonly rootName: string;
  /** True when the last list() hit the server's file limit, so some files are not shown. */
  readonly truncated?: boolean;

  list(): Promise<FileEntry[]>;
  read(path: string): Promise<string>;
  /** Create or overwrite. */
  write(path: string, content: string): Promise<void>;
  /** Fails with code 'exists' if `to` already exists. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Fires after any change (from this tab or, for local storage, another tab). */
  subscribe(listener: () => void): () => void;
}

/**
 * Normalise and validate a project-relative path.
 * Rejects absolute paths, "..", empty segments and control characters.
 * Returns the cleaned path or throws FileStoreError('invalid-path').
 */
export function normalizePath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (!trimmed) throw new FileStoreError('File name is empty.', 'invalid-path');
  if (trimmed.startsWith('/')) throw new FileStoreError('Use a path inside the project, not an absolute path.', 'invalid-path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new FileStoreError('File name contains control characters.', 'invalid-path');
  const parts = trimmed.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) throw new FileStoreError('File name is empty.', 'invalid-path');
  if (parts.some((p) => p === '..')) throw new FileStoreError('".." is not allowed in paths.', 'invalid-path');
  if (parts.some((p) => p.length > 255)) throw new FileStoreError('A path segment is too long.', 'invalid-path');
  return parts.join('/');
}
