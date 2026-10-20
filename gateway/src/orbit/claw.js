// OpenClaw on this machine, with Orbit as its screen (Orbit's agent screen, "OpenClaw" choice).
//
// Same shape as AgentService (projects, sessions, transcripts, send/watch/stop) so Orbit can show
// it the same way, plus approvals: OpenClaw asks before every command (tools.exec.ask = "always"),
// and each request becomes an approval card in the transcript that the owner allows once or denies.
// Talks to the OpenClaw gateway on 127.0.0.1 through ClawClient; nothing here is reachable from
// outside except through Orbit's signed-in API.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './files.js';
import { ClawClient, loadIdentity } from './claw-client.js';

const now = () => Date.now();
const id = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const MAX_PROMPT = 100_000;
const DECISIONS = new Set(['allow-once', 'deny']);

export const CLAW_CAPABILITIES = {
  newConversation: { status: 'supported', note: 'Each Orbit session is its own OpenClaw session.' },
  continueConversation: { status: 'supported', note: 'OpenClaw keeps the whole conversation.' },
  streamOutput: { status: 'supported', note: 'Replies and tool steps stream as they happen.' },
  stop: { status: 'supported', note: 'Stops the turn (chat.abort).' },
  pauseResume: { status: 'unsupported', note: 'OpenClaw has no pause; stop and send again.' },
  approvals: { status: 'supported', note: 'Every command waits for you: allow once, or deny.' },
  modes: { status: 'unsupported', note: 'OpenClaw has no plan / accept-edits modes.' },
  models: { status: 'supported', note: 'Your AI machine, or cloud AI when it is off.' },
};

const notice = (text, tone) => ({ kind: 'notice', id: id('itm'), at: now(), text, tone });
const textOf = (message) =>
  typeof message?.content === 'string'
    ? message.content
    : (message?.content ?? [])
        .filter((p) => p?.type === 'text')
        .map((p) => p.text)
        .join('');
const brief = (v, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export class ClawService {
  /**
   * @param url          the OpenClaw gateway (ws://127.0.0.1:18789)
   * @param tokenFile    its token (kept 0600; never sent anywhere else)
   * @param identityFile this client's device key
   * @param dataFile     Orbit's sessions and transcripts for OpenClaw
   * @param projectsDir  the folder the agent works in
   */
  constructor({ url, tokenFile, identityFile, dataFile, projectsDir, models = [], log = console, clientFactory }) {
    this.url = url;
    this.tokenFile = tokenFile;
    this.identityFile = identityFile;
    this.dataFile = dataFile;
    this.projectsDir = path.resolve(projectsDir);
    this.models = models;
    this.log = log;
    this.clientFactory = clientFactory;
    this.client = null;
    this.data = { version: 1, sessions: {}, transcripts: {} };
    this.running = new Map(); // sessionId -> { runId, listeners, assistant, tools: Map, done }
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
    for (const s of Object.values(this.data.sessions)) {
      if (s.status === 'running') {
        s.status = 'error';
        this.push(s.id, notice('The Linux machine restarted during this turn, so it did not finish.', 'warning'));
      }
      // Approvals can't outlive the turn that asked.
      for (const it of this.data.transcripts[s.id] ?? []) if (it.kind === 'approval' && it.status === 'pending') it.status = 'expired';
    }
    await this.save();
  }

  save() {
    this.saving = this.saving.then(async () => {
      const tmp = `${this.dataFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data));
      await fs.rename(tmp, this.dataFile);
    });
    return this.saving;
  }

  // ---- the connection to OpenClaw (made on first use, remade after a drop)
  async connection() {
    if (!this.client) {
      const token = (await fs.readFile(this.tokenFile, 'utf8').catch(() => '')).trim();
      if (!token) throw new HttpError(424, 'OpenClaw is not set up on the Linux machine yet.', 'claw-missing');
      const identity = await loadIdentity(this.identityFile);
      this.client = this.clientFactory ? this.clientFactory({ token, identity }) : new ClawClient({ url: this.url, token, identity, log: this.log });
      this.client.on('event', (event, payload) => this.onEvent(event, payload));
      this.client.on('disconnect', () => this.onDisconnect());
    }
    try {
      this.hello = await this.client.connect();
    } catch (err) {
      throw new HttpError(424, `OpenClaw is not answering on the Linux machine (${err.message}). It may still be starting.`, 'claw-down');
    }
    return this.client;
  }

  async info() {
    try {
      await this.connection();
      return { installed: true, version: this.hello?.server?.version ?? null };
    } catch {
      return { installed: false, version: null };
    }
  }

  // ---- projects: one, the projects folder (OpenClaw's workspace)
  async listProjects() {
    return [{ id: '.', name: path.basename(this.projectsDir) || 'projects', path: this.projectsDir }];
  }

  listModels() {
    return this.models;
  }

  // ---- sessions
  listSessions() {
    return Object.values(this.data.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
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

  async createSession({ title, model } = {}) {
    const t = now();
    const s = {
      id: id('claw'),
      projectId: '.',
      title: (title || '').trim().slice(0, 120) || 'New session',
      createdAt: t,
      updatedAt: t,
      status: 'idle',
      model: model || undefined,
      mode: 'default',
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

  keyOf(sessionId) {
    return `agent:main:orbit-${sessionId}`;
  }

  push(sessionId, item) {
    if (!this.data.sessions[sessionId]) return item;
    (this.data.transcripts[sessionId] ??= []).push(item);
    return item;
  }

  /** Run one turn. `emit(event, payload)` gets 'item' | 'update' | 'done' | 'error', as for Antigravity. */
  async send(sessionId, text, emit) {
    const s = this.getSession(sessionId);
    const message = String(text ?? '').trim();
    if (!message) throw new HttpError(400, 'Message is empty.', 'invalid');
    if (message.length > MAX_PROMPT) throw new HttpError(413, 'This message is too long to send. Save it to a file and ask OpenClaw to read it.', 'too-large');
    if (this.running.has(sessionId)) throw new HttpError(409, 'This session is already running a turn.', 'busy');
    const client = await this.connection();

    const job = { runId: null, listeners: new Set([emit]), assistant: null, tools: new Map(), approvals: new Map(), done: false };
    const broadcast = (event, payload) => job.listeners.forEach((l) => l(event, payload));
    job.broadcast = broadcast;
    this.running.set(sessionId, job);
    broadcast('item', this.push(sessionId, { kind: 'user', id: id('itm'), at: now(), text: message }));
    s.status = 'running';
    s.updatedAt = now();
    s.messageCount += 1;
    if (s.title === 'New session') s.title = message.split('\n')[0].slice(0, 80);
    await this.save();

    try {
      const key = this.keyOf(sessionId);
      // The session's model (if one was picked): set on the OpenClaw session before the turn.
      if (s.model) {
        await client.request('sessions.patch', { key, model: s.model }).catch(() => client.request('sessions.create', { key, model: s.model }));
      }
      const params = { sessionKey: key, message, idempotencyKey: id('run') };
      const res = await client.request('chat.send', params);
      job.runId = res?.runId ?? params.idempotencyKey;
    } catch (err) {
      await this.finish(sessionId, 'error', notice(`OpenClaw did not start: ${err.message}`, 'error'));
    }
  }

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
    this.client?.request('chat.abort', { sessionKey: this.keyOf(sessionId), runId: job.runId ?? undefined }).catch(() => {});
    // If OpenClaw never confirms, end it here anyway.
    setTimeout(() => this.running.get(sessionId) === job && this.finish(sessionId, 'stopped', notice('Stopped.', 'info')), 8000).unref?.();
    return true;
  }

  /** The owner's answer to a command OpenClaw wants to run. */
  async decide(sessionId, approvalId, decision) {
    if (!DECISIONS.has(decision)) throw new HttpError(400, 'Decision must be allow-once or deny.', 'invalid');
    const item = (this.data.transcripts[sessionId] ?? []).find((it) => it.kind === 'approval' && it.approvalId === approvalId);
    if (!item) throw new HttpError(404, 'Unknown approval.', 'not-found');
    if (item.status !== 'pending') return item;
    const client = await this.connection();
    await client.request('exec.approval.resolve', { id: approvalId, decision });
    item.status = decision === 'deny' ? 'denied' : 'allowed';
    this.running.get(sessionId)?.broadcast('update', { ...item });
    await this.save();
    return item;
  }

  // ---- OpenClaw's events, matched to the session they belong to
  sessionFor(sessionKey) {
    const m = /^agent:main:orbit-(.+)$/.exec(String(sessionKey ?? ''));
    return m && this.data.sessions[m[1]] ? m[1] : null;
  }

  onEvent(event, p) {
    if (event === 'exec.approval.requested') return this.onApproval(p);
    if (event === 'exec.approval.resolved') return this.onResolved(p);
    const sid = this.sessionFor(p?.sessionKey);
    const job = sid && this.running.get(sid);
    if (!job) return;
    if (event === 'chat') return this.onChat(sid, job, p);
    if (event === 'agent' && p.stream === 'tool') return this.onTool(sid, job, p.data ?? {});
  }

  onChat(sid, job, p) {
    if (p.state === 'delta' || p.state === 'final') {
      const full = p.message ? textOf(p.message) : null;
      if (!job.assistant) {
        job.assistant = this.push(sid, { kind: 'assistant', id: id('itm'), at: now(), text: '', streaming: true });
        job.broadcast('item', { ...job.assistant });
      }
      const a = job.assistant;
      if (full !== null && full !== undefined && (p.state === 'final' || full.length >= a.text.length)) a.text = full;
      else if (p.deltaText) a.text = p.replace ? p.deltaText : a.text + p.deltaText;
      a.streaming = p.state !== 'final';
      job.broadcast('update', { ...a });
      if (p.state === 'final') {
        if (!a.text) a.text = '(OpenClaw finished without a reply.)';
        return this.finish(sid, 'idle');
      }
      return;
    }
    if (p.state === 'aborted') return this.finish(sid, 'stopped', notice('Stopped.', 'info'));
    if (p.state === 'error') return this.finish(sid, 'error', notice(`OpenClaw stopped with an error: ${p.errorMessage || p.errorKind || 'unknown'}`, 'error'));
  }

  onTool(sid, job, d) {
    const key = d.toolCallId || d.name;
    if (d.phase === 'start') {
      // A reply that came before a tool step is finished; the next text starts a new one.
      if (job.assistant) {
        job.assistant.streaming = false;
        job.broadcast('update', { ...job.assistant });
        job.assistant = null;
      }
      const args = d.args ?? {};
      const what = args.command ?? args.path ?? args.file ?? args.pattern ?? '';
      const item = this.push(sid, { kind: 'activity', id: id('itm'), at: now(), title: `${d.name}${what ? `: ${brief(what, 120)}` : ''}`, status: 'running' });
      job.tools.set(key, item);
      job.broadcast('item', { ...item });
    } else if (d.phase === 'result') {
      const item = job.tools.get(key);
      if (!item) return;
      const out = (d.result?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
      item.status = d.isError ? 'failed' : 'done';
      if (out) item.detail = brief(out, 2000);
      job.broadcast('update', { ...item });
    }
  }

  onApproval(p) {
    const req = p?.request ?? {};
    const sid = this.sessionFor(req.sessionKey);
    if (!sid) {
      // Not one of Orbit's sessions: nobody here asked for it, so it is refused.
      this.client?.request('exec.approval.resolve', { id: p.id, decision: 'deny' }).catch(() => {});
      return;
    }
    const item = this.push(sid, {
      kind: 'approval',
      id: id('itm'),
      at: now(),
      approvalId: p.id,
      command: brief(req.command ?? req.systemRunPlan?.commandText ?? '', 4000),
      cwd: req.cwd ?? undefined,
      warning: req.warningText ?? undefined,
      expiresAt: p.expiresAtMs ?? undefined,
      status: 'pending',
    });
    this.running.get(sid)?.broadcast('item', { ...item });
    void this.save();
  }

  onResolved(p) {
    for (const [sid, items] of Object.entries(this.data.transcripts)) {
      const item = items.find((it) => it.kind === 'approval' && it.approvalId === p?.id);
      if (!item || item.status !== 'pending') continue;
      item.status = p.decision === 'deny' ? 'denied' : p.decision ? 'allowed' : 'expired';
      this.running.get(sid)?.broadcast('update', { ...item });
      void this.save();
    }
  }

  onDisconnect() {
    for (const sid of [...this.running.keys()]) void this.finish(sid, 'error', notice('Lost the connection to OpenClaw during this turn.', 'error'));
  }

  async finish(sessionId, status, item) {
    const job = this.running.get(sessionId);
    if (!job || job.done) return;
    job.done = true;
    this.running.delete(sessionId);
    if (job.assistant?.streaming) {
      job.assistant.streaming = false;
      job.broadcast('update', { ...job.assistant });
    }
    for (const t of job.tools.values()) {
      if (t.status === 'running') {
        t.status = status === 'idle' ? 'done' : 'failed';
        job.broadcast('update', { ...t });
      }
    }
    for (const it of this.data.transcripts[sessionId] ?? []) {
      if (it.kind === 'approval' && it.status === 'pending') {
        it.status = 'expired';
        job.broadcast('update', { ...it });
      }
    }
    if (item) job.broadcast('item', this.push(sessionId, item));
    const s = this.data.sessions[sessionId];
    if (s) {
      s.status = status === 'stopped' ? 'stopped' : status;
      s.updatedAt = now();
    }
    await this.save();
    job.broadcast('done', s ? { ...s } : null);
  }
}
