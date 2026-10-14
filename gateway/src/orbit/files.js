// Project files for Orbit's Code app. Everything is confined to one root directory:
// paths are project-relative, ".." and absolute paths are rejected, and symlinks that point
// outside the root are refused.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next']);
const MAX_FILES = 5000;
const MAX_READ_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function normalizeRelPath(input) {
  const s = String(input ?? '').trim().replace(/\\/g, '/');
  if (!s) throw new HttpError(400, 'Path is empty.', 'invalid-path');
  if (s.startsWith('/')) throw new HttpError(400, 'Use a path inside the project.', 'invalid-path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new HttpError(400, 'Path contains control characters.', 'invalid-path');
  const parts = s.split('/').filter((p) => p && p !== '.');
  if (!parts.length) throw new HttpError(400, 'Path is empty.', 'invalid-path');
  if (parts.includes('..')) throw new HttpError(400, '".." is not allowed.', 'invalid-path');
  return parts.join('/');
}

export class FileService {
  constructor(root) {
    this.root = path.resolve(root);
  }

  async init(seed) {
    await fs.mkdir(this.root, { recursive: true });
    const entries = await fs.readdir(this.root);
    if (entries.length === 0 && seed) {
      for (const [rel, content] of Object.entries(seed)) {
        const abs = path.join(this.root, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
      }
    }
    this.realRoot = await fs.realpath(this.root);
  }

  /** Resolve a project-relative path to an absolute one, refusing anything outside the root. */
  async resolve(rel, { mustExist = false } = {}) {
    const clean = normalizeRelPath(rel);
    const abs = path.join(this.root, clean);
    // Check the deepest existing ancestor's real path to catch symlink escapes.
    let probe = abs;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (real !== this.realRoot && !real.startsWith(this.realRoot + path.sep)) {
          throw new HttpError(403, 'Path is outside the project.', 'invalid-path');
        }
        break;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err.code !== 'ENOENT') throw err;
        if (mustExist && probe === abs) throw new HttpError(404, `No such file: ${clean}`, 'not-found');
        probe = path.dirname(probe);
      }
    }
    return { abs, clean };
  }

  async list() {
    const out = [];
    let truncated = false;
    const walk = async (dir, prefix) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), rel);
        } else if (e.isFile()) {
          try {
            const st = await fs.stat(path.join(dir, e.name));
            out.push({ path: rel, size: st.size, updatedAt: Math.round(st.mtimeMs) });
          } catch {
            /* vanished */
          }
        }
      }
    };
    await walk(this.root, '');
    out.sort((a, b) => a.path.localeCompare(b.path));
    return { files: out, truncated };
  }

  async read(rel) {
    const { abs, clean } = await this.resolve(rel, { mustExist: true });
    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isFile()) throw new HttpError(404, `No such file: ${clean}`, 'not-found');
    if (st.size > MAX_READ_BYTES) throw new HttpError(413, 'File is too large to open in the editor (over 2 MB).', 'too-large');
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) throw new HttpError(415, 'This looks like a binary file.', 'binary');
    return { content: buf.toString('utf8'), updatedAt: Math.round(st.mtimeMs) };
  }

  /**
   * Create or overwrite a file. With `baseHash` (sha256 hex of the content the edit was based on), an
   * existing file that no longer matches it is left alone (409 'changed'): someone else changed it.
   */
  async write(rel, content, baseHash = null) {
    const { abs } = await this.resolve(rel);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isDirectory()) throw new HttpError(409, 'That path is a folder.', 'exists');
    if (baseHash && st?.isFile()) {
      const current = crypto.createHash('sha256').update(await fs.readFile(abs)).digest('hex');
      if (current !== baseHash) {
        throw new HttpError(409, 'This file changed on your Linux machine since you opened it.', 'changed');
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Write to a temp file then rename, so a dropped connection never leaves a half-written file.
    const tmp = `${abs}.orbit-tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, abs);
    const after = await fs.stat(abs);
    return { updatedAt: Math.round(after.mtimeMs) };
  }

  async rename(from, to) {
    const src = await this.resolve(from, { mustExist: true });
    const dst = await this.resolve(to);
    if (src.clean === dst.clean) return;
    if (await fs.stat(dst.abs).catch(() => null)) throw new HttpError(409, `"${dst.clean}" already exists.`, 'exists');
    await fs.mkdir(path.dirname(dst.abs), { recursive: true });
    await fs.rename(src.abs, dst.abs);
  }

  async remove(rel) {
    const { abs, clean } = await this.resolve(rel, { mustExist: true });
    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isFile()) throw new HttpError(404, `No such file: ${clean}`, 'not-found');
    await fs.unlink(abs);
  }
}
