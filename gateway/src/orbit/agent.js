// Antigravity runner for Orbit. Drives the installed `agy` CLI one turn at a time:
//   agy --print "<text>" --output-format json [--conversation <id>] [--mode plan|accept-edits] [--model <id>]
// Only verified agy behaviour is used. It never passes --dangerously-skip-permissions.
//
// Sessions and transcripts are stored on the machine (default ~/.orbit/agent.json), so every
// device sees the same history. A turn keeps running if the browser disconnects; the result
// lands in the transcript either way.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './files.js';

const run = promisify(execFile);
const MODES = new Set(['default', 'plan', 'accept-edits']);
const now = () => Date.now();
const id = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

/** Must match orbit/src/services/runner/agyCapabilities.ts (verified facts only). */
export const AGY_CAPABILITIES = {
  newConversation: { status: 'supported', note: 'Each new session starts a fresh `agy --print` conversation.' },
  continueConversation: {
    status: 'supported',
    note: 'Follow-ups pass `--conversation <id>`; verified that context carries over between turns.',
  },
  streamOutput: {
    status: 'unverified',
    note: '`--output-format stream-json` exists, but its event format has not been verified yet.',
  },
  stop: { status: 'supported', note: 'Stopping ends the running `agy` process. The turn is cancelled, not paused.' },
  pauseResume: { status: 'unsupported', note: 'agy documents no way to pause and later resume an in-flight turn.' },
  approvals: {
    status: 'unverified',
    note: 'Whether print mode can surface tool-approval requests to another program is not verified.',
  },
  modes: { status: 'supported', note: '`--mode plan` or `--mode accept-edits`; default omits the flag.' },
  models: { status: 'supported', note: '`agy models` lists the models your account can use; `--model <id>` selects one.' },
};

export class AgentService {
  constructor({ dataFile, projectsDir, agyPath = 'agy', log, turnTimeoutSec = 900 }) {
    this.dataFile = dataFile;
    this.projectsDir = path.resolve(projectsDir);
    this.agy = agyPath;
    this.log = log;
    this.turnTimeoutSec = turnTimeoutSec;
    this.running = new Map(); // sessionId -> { child, listeners:Set, stopped }
    this.data = { version: 1, sessions: {}, transcripts: {} };
    this.saving = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.dataFile, 'utf8'));
      if (parsed?.version === 1) this.data = parsed;
    } catch {
      /* first run */
    }
    // Turns that were running when the service stopped can't be resumed.
    for (const s of Object.values(this.data.sessions)) {
      if (s.status === 'running') {
        s.status = 'error';
        this.push(s.id, notice('The Linux machine restarted during this turn, so it did not finish.', 'warning'));
      }
    }
    await this.save();
  }

  save() {
    // Serialise writes; write to a temp file then rename so the store is never half-written.
    this.saving = this.saving.then(async () => {
      const tmp = `${this.dataFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data));
      await fs.rename(tmp, this.dataFile);
    });
    return this.saving;
  }

  // ---- projects: the project root itself plus each top-level folder in it
  async listProjects() {
    const projects = [{ id: '.', name: path.basename(this.projectsDir) || 'projects', path: this.projectsDir }];
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        projects.push({ id: e.name, name: e.name, path: path.join(this.projectsDir, e.name) });
      }
    }
    return projects;
  }

  async projectPath(projectId) {
    const p = (await this.listProjects()).find((x) => x.id === projectId);
    if (!p) throw new HttpError(404, 'Unknown project.', 'not-found');
    return p.path;
  }

  // ---- sessions
  listSessions(projectId) {
    return Object.values(this.data.sessions)
      .filter((s) => !projectId || s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId) {
    const s = this.data.sessions[sessionId];
    if (!s) throw new HttpError(404, 'Unknown session.', 'not-found');
    return s;
  }

  transcript(sessionId) {
    this.getSession(sessionId);
    return this.data.transcripts[sessionId] ?? [];
  }

  async createSession({ projectId = '.', title, model, mode = 'default' }) {
    await this.projectPath(projectId);
    if (!MODES.has(mode)) throw new HttpError(400, 'Unknown mode.', 'invalid');
    const t = now();
    const s = {
      id: id('ses'),
      projectId,
      title: (title || '').trim().slice(0, 120) || 'New session',
      createdAt: t,
      updatedAt: t,
      status: 'idle',
      model: model || undefined,
      mode,
      conversationId: undefined,
      messageCount: 0,
      simulated: false,
    };
    this.data.sessions[s.id] = s;
    this.data.transcripts[s.id] = [];
    await this.save();
    return s;
  }

  async updateSession(sessionId, patch) {
    const s = this.getSession(sessionId);
    if (patch.title !== undefined) s.title = String(patch.title).trim().slice(0, 120) || s.title;
    if (patch.model !== undefined) s.model = patch.model || undefined;
    if (patch.mode !== undefined) {
      if (!MODES.has(patch.mode)) throw new HttpError(400, 'Unknown mode.', 'invalid');
      s.mode = patch.mode;
    }
    s.updatedAt = now();
    await this.save();
    return s;
  }

  async deleteSession(sessionId) {
    this.getSession(sessionId);
    this.stop(sessionId);
    delete this.data.sessions[sessionId];
    delete this.data.transcripts[sessionId];
    await this.save();
  }

  push(sessionId, item) {
    (this.data.transcripts[sessionId] ??= []).push(item);
    return item;
  }

  // ---- models: parsed from `agy models` (lines of "<id>\t<label>")
  async listModels() {
    try {
      const { stdout } = await run(this.agy, ['models'], { timeout: 30_000, cwd: this.projectsDir });
      return stdout
        .split('\n')
        .map((l) => l.split('\t'))
        .filter((p) => p.length >= 2 && p[0].trim())
        .map(([mid, label]) => ({ id: mid.trim(), label: label.trim() }));
    } catch (err) {
      throw new HttpError(502, `Could not list models: ${firstLine(err.stderr || err.message)}`, 'agy');
    }
  }

  async info() {
    try {
      const { stdout } = await run(this.agy, ['--version'], { timeout: 15_000 });
      return { installed: true, version: stdout.trim() };
    } catch {
      return { installed: false, version: null };
    }
  }

  /**
   * Run one turn. `emit(event, payload)` receives 'item' | 'update' | 'done' | 'error'.
   * Several listeners can watch the same running turn (e.g. iPhone and iPad).
   */
  async send(sessionId, text, emit) {
    const s = this.getSession(sessionId);
    const prompt = String(text ?? '').trim();
    if (!prompt) throw new HttpError(400, 'Message is empty.', 'invalid');
    if (this.running.has(sessionId)) throw new HttpError(409, 'This session is already running a turn.', 'busy');
    const cwd = await this.projectPath(s.projectId);

    const args = ['--print', prompt, '--output-format', 'json', '--print-timeout', `${this.turnTimeoutSec}s`];
    if (s.conversationId) args.push('--conversation', s.conversationId);
    if (s.mode && s.mode !== 'default') args.push('--mode', s.mode);
    if (s.model) args.push('--model', s.model);

    const listeners = new Set([emit]);
    const broadcast = (event, payload) => listeners.forEach((l) => l(event, payload));

    const userItem = this.push(sessionId, { kind: 'user', id: id('itm'), at: now(), text: prompt });
    broadcast('item', userItem);
    const activity = this.push(sessionId, {
      kind: 'activity',
      id: id('itm'),
      at: now(),
      title: s.conversationId ? 'Antigravity is working (continuing conversation)' : 'Antigravity is working',
      detail: `agy ${redactArgs(args).join(' ')}`,
      status: 'running',
    });
    broadcast('item', activity);
    s.status = 'running';
    s.updatedAt = now();
    s.messageCount += 1;
    await this.save();

    const child = spawn(this.agy, args, { cwd, env: cleanEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = { child, listeners, stopped: false };
    this.running.set(sessionId, job);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-8000)));

    const finish = async (result) => {
      this.running.delete(sessionId);
      activity.status = result.ok ? 'done' : 'failed';
      broadcast('update', { ...activity });
      if (result.item) broadcast('item', this.push(sessionId, result.item));
      s.status = result.status;
      s.updatedAt = now();
      if (result.conversationId) s.conversationId = result.conversationId;
      if (result.item?.kind === 'assistant') s.messageCount += 1;
      await this.save();
      broadcast('done', { ...s });
    };

    child.on('error', (err) =>
      finish({ ok: false, status: 'error', item: notice(`Could not start agy: ${err.message}`, 'error') }),
    );
    child.on('close', async (code, signal) => {
      if (job.stopped) {
        return finish({
          ok: false,
          status: 'stopped',
          item: notice('Stopped. The agy process was ended; the turn was cancelled, not paused.', 'warning'),
        });
      }
      const parsed = parseResult(stdout);
      if (parsed && parsed.status === 'SUCCESS') {
        return finish({
          ok: true,
          status: 'idle',
          conversationId: parsed.conversation_id,
          item: { kind: 'assistant', id: id('itm'), at: now(), text: String(parsed.response ?? '').trimEnd() },
        });
      }
      const reason = parsed?.response || firstLine(stderr) || `agy exited with ${signal ?? `code ${code}`}`;
      return finish({
        ok: false,
        status: 'error',
        conversationId: parsed?.conversation_id,
        item: notice(`Antigravity did not finish: ${reason}`, 'error'),
      });
    });

    return { userItem, activity };
  }

  /** Attach another viewer to a running turn. Returns false if nothing is running. */
  watch(sessionId, emit) {
    const job = this.running.get(sessionId);
    if (!job) return false;
    job.listeners.add(emit);
    return () => job.listeners.delete(emit);
  }

  stop(sessionId) {
    const job = this.running.get(sessionId);
    if (!job) return false;
    job.stopped = true;
    try {
      process.kill(-job.child.pid, 'SIGTERM'); // whole process group
    } catch {
      job.child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-job.child.pid, 'SIGKILL');
      } catch {
        /* exited */
      }
    }, 5000).unref();
    return true;
  }
}

function notice(text, tone) {
  return { kind: 'notice', id: id('itm'), at: now(), text, tone };
}

function parseResult(stdout) {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && 'status' in obj) return obj;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function firstLine(s) {
  return String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 300) || '';
}

function redactArgs(args) {
  // Show the command shape in the activity row without repeating the whole prompt.
  return args.map((a, i) => (args[i - 1] === '--print' ? '"…"' : a));
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['GATEWAY_SECRET', 'RDP_PASSWORD', 'DESKTOP_PASSWORD']) delete env[k];
  return env;
}
