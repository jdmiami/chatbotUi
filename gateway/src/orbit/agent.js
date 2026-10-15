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
const MAX_PROMPT_BYTES = 100 * 1024;
const now = () => Date.now();
const id = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

// What agy prints when it has no saved sign-in (verified against agy 1.3.4/1.3.5): `agy models` exits 1 with
// "Please sign in to view available models", and `agy --print` prints "Authentication required. Please visit
// the URL to log in:" plus a Google sign-in link and waits. Match those exact prompts only: a real reply can
// mention signing in.
const SIGNED_OUT_MODELS = /Please sign in to view available models/i;
const SIGNED_OUT_PRINT = /Authentication required\.\s*Please visit the URL to log in/i;
export const SIGN_IN_HINT =
  'Antigravity is not signed in on your Linux machine yet. Open Terminal, run `agy`, and follow the sign-in link once. Then try again.';

/** Must match orbit/src/services/runner/agyCapabilities.ts (verified facts only). */
export const AGY_CAPABILITIES = {
  newConversation: { status: 'supported', note: 'Each new session starts a fresh `agy --print` conversation.' },
  continueConversation: {
    status: 'supported',
    note: 'Follow-ups pass `--conversation <id>`; verified that context carries over between turns.',
  },
  streamOutput: {
    status: 'unverified',
    note: '`--output-format stream-json` events are verified (init, step_update, result), but not yet whether they arrive live during long turns, so Orbit shows each reply when the turn ends.',
  },
  stop: { status: 'supported', note: 'Stopping ends the running `agy` process. The turn is cancelled, not paused.' },
  pauseResume: { status: 'unsupported', note: 'agy documents no way to pause and later resume an in-flight turn.' },
  approvals: {
    status: 'unsupported',
    note: "In print mode agy can't ask for approval: tools that need it (such as shell commands) are skipped, and Orbit says which. Allow them ahead of time with permissions.allow rules in ~/.gemini/antigravity-cli/settings.json, or run agy in Terminal to approve interactively.",
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
    // Sessions whose folder was renamed or deleted stay reachable, so they can be read or deleted.
    const known = new Set(projects.map((p) => p.id));
    for (const sess of Object.values(this.data.sessions)) {
      if (!known.has(sess.projectId)) {
        known.add(sess.projectId);
        projects.push({
          id: sess.projectId,
          name: `${sess.projectId} (folder missing)`,
          path: path.join(this.projectsDir, sess.projectId),
          missing: true,
        });
      }
    }
    return projects;
  }

  async projectPath(projectId) {
    const p = (await this.listProjects()).find((x) => x.id === projectId);
    if (!p) throw new HttpError(404, 'Unknown project.', 'not-found');
    if (p.missing) {
      throw new HttpError(
        409,
        `The folder "${projectId}" is no longer in your projects folder (renamed or deleted). Recreate it, or start a new session in another project.`,
        'project-missing',
      );
    }
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
    // A session deleted while its turn was running stays deleted (no orphan transcript).
    if (!this.data.sessions[sessionId]) return item;
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
      const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
      if (SIGNED_OUT_MODELS.test(output) || SIGNED_OUT_PRINT.test(output)) {
        throw new HttpError(424, SIGN_IN_HINT, 'agy-signed-out');
      }
      // 424, not 502: Runpod's proxy replaces 502 responses with its own "waiting for service" page.
      throw new HttpError(424, `Could not list models: ${firstLine(err.stderr || err.message)}`, 'agy');
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
    // The message is passed to agy as one argument; Linux caps a single argument at 128 KB.
    if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
      throw new HttpError(
        413,
        'This message is too long to send (over 100 KB). Save the text to a file in your project and ask Antigravity to read that file instead.',
        'too-large',
      );
    }
    if (this.running.has(sessionId)) throw new HttpError(409, 'This session is already running a turn.', 'busy');
    const cwd = await this.projectPath(s.projectId);

    // `--print=<text>`: a message such as "--help" stays a message, never an agy option.
    const args = [`--print=${prompt}`, '--output-format', 'json', '--print-timeout', `${this.turnTimeoutSec}s`];
    if (s.conversationId) args.push('--conversation', s.conversationId);
    if (s.mode && s.mode !== 'default') args.push('--mode', s.mode);
    if (s.model) args.push(`--model=${s.model}`);

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

    let child;
    try {
      child = spawn(this.agy, args, { cwd, env: cleanEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      // spawn can throw synchronously (e.g. E2BIG): end the turn instead of leaving it "running".
      activity.status = 'failed';
      activity.title = 'Antigravity did not start';
      broadcast('update', { ...activity });
      broadcast('item', this.push(sessionId, notice(`Could not start agy: ${err.message}`, 'error')));
      s.status = 'error';
      s.updatedAt = now();
      await this.save();
      broadcast('done', { ...s });
      return { userItem, activity };
    }
    const job = { child, listeners, stopped: false, signedOut: false };
    this.running.set(sessionId, job);
    let stdout = '';
    let stderr = '';
    // Without a saved sign-in, agy prints a sign-in link and waits; nobody can answer it here, so end the turn.
    const checkSignIn = () => {
      // With --output-format json a working agy prints only the JSON result, so a reply is never inspected.
      const head = stdout.trimStart();
      const prompt = `${head.startsWith('{') ? '' : head.slice(0, 4000)}\n${stderr}`;
      if (!job.signedOut && SIGNED_OUT_PRINT.test(prompt)) {
        job.signedOut = true;
        killGroup(child, 'SIGTERM');
      }
    };
    child.stdout.on('data', (d) => {
      stdout += d;
      checkSignIn();
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-8000);
      checkSignIn();
    });

    const startedAt = now();
    const finish = async (result) => {
      this.running.delete(sessionId);
      activity.status = result.ok ? 'done' : 'failed';
      const secs = Math.max(1, Math.round((now() - startedAt) / 1000));
      activity.title = result.ok
        ? `Antigravity worked for ${secs} s`
        : result.status === 'stopped'
          ? 'Stopped'
          : 'Antigravity did not finish';
      broadcast('update', { ...activity });
      const items = result.items ?? (result.item ? [result.item] : []);
      for (const item of items) broadcast('item', this.push(sessionId, item));
      s.status = result.status;
      s.updatedAt = now();
      if (result.conversationId) s.conversationId = result.conversationId;
      if (items.some((i) => i.kind === 'assistant')) s.messageCount += 1;
      if (!this.data.sessions[sessionId]) {
        // Deleted during the turn: tell any watchers it ended, but store nothing.
        broadcast('done', { ...s });
        return;
      }
      await this.save();
      broadcast('done', { ...s });
    };

    child.on('error', (err) =>
      finish({ ok: false, status: 'error', item: notice(`Could not start agy: ${err.message}`, 'error') }),
    );
    child.on('close', async (code, signal) => {
      if (job.signedOut) {
        return finish({ ok: false, status: 'error', item: notice(SIGN_IN_HINT, 'error') });
      }
      if (job.stopped) {
        return finish({
          ok: false,
          status: 'stopped',
          item: notice('Stopped. The agy process was ended; the turn was cancelled, not paused.', 'warning'),
        });
      }
      const parsed = parseResult(stdout);
      if (parsed && parsed.status === 'SUCCESS') {
        const text = String(parsed.response ?? '').trimEnd();
        const items = [];
        if (text) items.push({ kind: 'assistant', id: id('itm'), at: now(), text });
        // Print mode can't ask for approval: agy skips tools that need it and lists them in denied_actions.
        const denied = deniedNames(parsed.denied_actions);
        if (denied.length) items.push(notice(deniedText(denied), 'warning'));
        else if (!text) items.push(notice('Antigravity finished without a reply.', 'info'));
        return finish({ ok: true, status: 'idle', conversationId: parsed.conversation_id, items });
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
    killGroup(job.child, 'SIGTERM');
    return true;
  }
}

/** Signal agy's whole process group, then make sure it is gone after 5 s. */
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* exited */
    }
  }, 5000).unref();
}

function notice(text, tone) {
  return { kind: 'notice', id: id('itm'), at: now(), text, tone };
}

function parseResult(stdout) {
  const whole = stdout.trim();
  try {
    const obj = JSON.parse(whole);
    if (obj && typeof obj === 'object' && 'status' in obj) return obj;
  } catch {
    /* not a single JSON document; look for the last JSON line */
  }
  const lines = whole.split('\n').reverse();
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

function deniedNames(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((d) => String(d?.display_name || d?.action || '').trim()).filter(Boolean))];
}

function deniedText(names) {
  const what = names.join(', ');
  return (
    `Antigravity wanted to use ${what}, but it can't ask for your approval from Orbit, so ` +
    `${names.length === 1 ? 'that step was' : 'those steps were'} skipped. To allow it, add a rule under ` +
    'permissions.allow in ~/.gemini/antigravity-cli/settings.json on your Linux machine (for example ' +
    'command(git)), or run agy in Terminal and approve it there.'
  );
}

function firstLine(s) {
  return String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 300) || '';
}

function redactArgs(args) {
  // Show the command shape in the activity row without repeating the whole prompt.
  return args.map((a) => (a.startsWith('--print=') ? '--print "…"' : a));
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['GATEWAY_SECRET', 'RDP_PASSWORD', 'DESKTOP_PASSWORD']) delete env[k];
  return env;
}
