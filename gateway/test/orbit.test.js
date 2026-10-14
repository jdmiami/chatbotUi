import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SignJWT } from 'jose';
import { createGateway, loadConfig } from '../src/server.js';
import { FileService } from '../src/orbit/files.js';
import { AgentService } from '../src/orbit/agent.js';
import { createOrbitApi } from '../src/orbit/http.js';
import { hasTmux, killTerminalSession } from '../src/orbit/pty.js';

const run = promisify(execFile);
const SECRET = 'o'.repeat(40);
const ORIGIN = 'https://site.example';
let tmp, server, base, files, agent;

// A stand-in for the agy binary: prints agy's --output-format json result shape.
// "slow" in the prompt makes it hang (to test Stop); "fail" makes it exit 1.
const FAKE_AGY = `#!/usr/bin/env bash
prompt=""; conv=""
while [ $# -gt 0 ]; do
  case "$1" in
    --print) prompt="$2"; shift ;;
    --conversation) conv="$2"; shift ;;
    models)
      if [ -e "$(dirname "$0")/signed-out" ]; then echo "Fetching available models..."; echo "Error: Please sign in to view available models. Launch the CLI without arguments to sign in." >&2; exit 1; fi
      printf 'model-a\\tModel A\\nmodel-b\\tModel B\\n'; exit 0 ;;
    --version) echo "1.3.4"; exit 0 ;;
  esac
  shift
done
if [ -e "$(dirname "$0")/signed-out" ]; then
  echo "Authentication required. Please visit the URL to log in:"; echo "  https://accounts.example/auth"; echo "Waiting for authentication (timeout 60s)..."; sleep 60; exit 1
fi
case "$prompt" in *slow*) sleep 30 ;; esac
case "$prompt" in *denied*) printf '{"conversation_id":"conv-d","status":"SUCCESS","response":"","denied_actions":[{"action":"command","display_name":"RunCommand"},{"action":"command","display_name":"RunCommand"}]}\n'; exit 0 ;; esac
case "$prompt" in *signin-talk*) printf '{"conversation_id":"conv-t","status":"SUCCESS","response":"To use the API, Please sign in first. Authentication required. Please visit the URL to log in: https://example.com"}\n'; exit 0 ;; esac
case "$prompt" in *silent*) printf '{"conversation_id":"conv-s","status":"SUCCESS","response":""}\n'; exit 0 ;; esac
case "$prompt" in *fail*) echo "boom: not signed in" >&2; exit 1 ;; esac
id="\${conv:-conv-123}"
printf '{"conversation_id":"%s","status":"SUCCESS","response":"echo: %s (conv %s)\\\\n","duration_seconds":0.1,"num_turns":1}\\n' "$id" "$prompt" "\${conv:-new}"
`;

const token = (opts = {}) =>
  new SignJWT({ scope: 'orbit' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin')
    .setIssuer('rdp-web')
    .setAudience(opts.aud ?? 'orbit-host')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));

async function api(p, init = {}, tok) {
  const t = tok === undefined ? await token() : tok;
  return fetch(`${base}/orbit/api${p}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}), Origin: ORIGIN },
  });
}

async function sse(p, body) {
  const res = await api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-host-'));
  const projects = path.join(tmp, 'projects');
  await fs.mkdir(path.join(projects, 'app'), { recursive: true });
  await fs.writeFile(path.join(projects, 'app', 'main.py'), 'print("hi")\n');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'outside');
  await fs.symlink(path.join(tmp, 'secret.txt'), path.join(projects, 'escape.txt'));
  const agyPath = path.join(tmp, 'agy');
  await fs.writeFile(agyPath, FAKE_AGY, { mode: 0o755 });

  files = new FileService(projects);
  await files.init();
  agent = new AgentService({ dataFile: path.join(tmp, 'data', 'agent.json'), projectsDir: projects, agyPath });
  await agent.init();
  const config = loadConfig({ GATEWAY_SECRET: SECRET, RDP_HOST: 'x', ALLOWED_ORIGINS: ORIGIN });
  const quiet = { info() {}, warn() {}, error() {} };
  server = createGateway(config, quiet, {
    api: createOrbitApi({ secret: config.secret, allowedOrigins: config.allowedOrigins, files, agent, log: quiet }),
    pty: { cwd: projects },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await killTerminalSession('t1');
  await fs.rm(tmp, { recursive: true, force: true });
});

test('every API route needs a valid orbit-host token', async () => {
  assert.equal((await api('/info', {}, null)).status, 401);
  assert.equal((await api('/info', {}, await token({ secret: 'z'.repeat(40) }))).status, 401);
  assert.equal((await api('/info', {}, await token({ aud: 'rdp-gateway' }))).status, 401);
  assert.equal((await api('/info', {}, await token({ exp: Math.floor(Date.now() / 1000) - 5 }))).status, 401);
  const ok = await api('/info');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  // a foreign origin is refused
  const bad = await fetch(`${base}/orbit/api/info`, { headers: { Authorization: `Bearer ${await token()}`, Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
});

test('files: list, read, write, rename, delete', async () => {
  const list = await (await api('/files')).json();
  assert.equal(list.root, 'projects');
  assert.ok(list.files.some((f) => f.path === 'app/main.py'));

  const read = await (await api('/files/content?path=app/main.py')).json();
  assert.equal(read.content, 'print("hi")\n');

  const put = await api('/files/content?path=app/new/util.py', { method: 'PUT', body: 'x = 1\n' });
  assert.equal(put.status, 200);
  assert.equal(await fs.readFile(path.join(files.root, 'app/new/util.py'), 'utf8'), 'x = 1\n');

  const mv = await api('/files/rename', { method: 'POST', body: JSON.stringify({ from: 'app/new/util.py', to: 'app/util.py' }) });
  assert.equal(mv.status, 200);
  assert.equal((await api('/files/rename', { method: 'POST', body: JSON.stringify({ from: 'app/util.py', to: 'app/main.py' }) })).status, 409);

  assert.equal((await api('/files/content?path=app/util.py', { method: 'DELETE' })).status, 200);
  assert.equal((await api('/files/content?path=app/util.py')).status, 404);
});

test('files: a cheap fingerprint tells clients whether anything changed', async () => {
  const fp = async () => (await (await api('/files?fingerprint=1')).json()).fingerprint;
  const full = await (await api('/files')).json();
  const first = await fp();
  assert.match(first, /^[0-9a-f]{40}$/);
  assert.equal(full.fingerprint, first, 'the full listing carries the same fingerprint');
  assert.equal(await fp(), first, 'stable while nothing changes');
  await fs.mkdir(path.join(files.root, 'build'), { recursive: true });
  await fs.writeFile(path.join(files.root, 'build', 'notes.md'), 'hand-written\n');
  assert.notEqual(await fp(), first, 'changes when a file is added');
  const listed = await (await api('/files')).json();
  assert.ok(listed.files.some((f) => f.path === 'build/notes.md'), 'build/ is listed');
  await fs.rm(path.join(files.root, 'build'), { recursive: true });
});

test('files: a save based on an older version does not overwrite a newer one', async () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  await fs.writeFile(path.join(files.root, 'race.txt'), 'v1\n');
  // Someone else changes the file after the editor read v1.
  await fs.writeFile(path.join(files.root, 'race.txt'), 'v2 from agy\n');
  const stale = await api(`/files/content?path=race.txt&base=${sha('v1\n')}`, { method: 'PUT', body: 'my edit\n' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'changed');
  assert.equal(await fs.readFile(path.join(files.root, 'race.txt'), 'utf8'), 'v2 from agy\n');
  // Based on the current version: saved.
  const ok = await api(`/files/content?path=race.txt&base=${sha('v2 from agy\n')}`, { method: 'PUT', body: 'my edit\n' });
  assert.equal(ok.status, 200);
  assert.equal(await fs.readFile(path.join(files.root, 'race.txt'), 'utf8'), 'my edit\n');
  // A file deleted meanwhile is simply written again ("Save again").
  await fs.rm(path.join(files.root, 'race.txt'));
  assert.equal((await api(`/files/content?path=race.txt&base=${sha('x')}`, { method: 'PUT', body: 'back\n' })).status, 200);
  await fs.rm(path.join(files.root, 'race.txt'));
});

test('files: paths cannot escape the projects folder', async () => {
  for (const p of ['../secret.txt', '/etc/passwd', 'app/../../secret.txt']) {
    const res = await api(`/files/content?path=${encodeURIComponent(p)}`);
    assert.equal(res.status, 400, p);
  }
  const viaLink = await api('/files/content?path=escape.txt');
  assert.equal(viaLink.status, 403);
  const writeViaLink = await api('/files/content?path=escape.txt', { method: 'PUT', body: 'pwned' });
  assert.equal(writeViaLink.status, 403);
  assert.equal(await fs.readFile(path.join(tmp, 'secret.txt'), 'utf8'), 'outside');
});

test('agent: create session, turn, follow-up continues the conversation, models', async () => {
  const projects = await (await api('/agent/projects')).json();
  assert.deepEqual(
    projects.map((p) => p.id),
    ['.', 'app'],
  );
  const created = await api('/agent/sessions', { method: 'POST', body: JSON.stringify({ projectId: 'app', title: 'T', mode: 'plan' }) });
  assert.equal(created.status, 201);
  const s = await created.json();

  const events = await sse(`/agent/sessions/${s.id}/send`, { text: 'hello' });
  assert.deepEqual(
    events.map((e) => e.event),
    ['item', 'item', 'update', 'item', 'done'],
  );
  const reply = events.find((e) => e.event === "item" && e.data.kind === "assistant");
  assert.equal(reply.data.text, 'echo: hello (conv new)');
  assert.equal(events.at(-1).data.conversationId, 'conv-123');

  const again = await sse(`/agent/sessions/${s.id}/send`, { text: 'more' });
  assert.equal(again.find((e) => e.data.kind === 'assistant').data.text, 'echo: more (conv conv-123)');

  const transcript = await (await api(`/agent/sessions/${s.id}/transcript`)).json();
  assert.equal(transcript.filter((i) => i.kind === 'user').length, 2);

  const models = await (await api('/agent/models')).json();
  assert.deepEqual(models, [
    { id: 'model-a', label: 'Model A' },
    { id: 'model-b', label: 'Model B' },
  ]);
});

test('agent: failures and Stop end the turn with a notice', async () => {
  const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({}) })).json();
  const failed = await sse(`/agent/sessions/${s.id}/send`, { text: 'please fail' });
  const n = failed.find((e) => e.data.kind === 'notice');
  assert.match(n.data.text, /not signed in/);
  assert.equal(failed.at(-1).data.status, 'error');

  const pending = sse(`/agent/sessions/${s.id}/send`, { text: 'be slow' });
  await new Promise((r) => setTimeout(r, 400));
  // a second turn on the same session is refused while one runs
  const busy = await sse(`/agent/sessions/${s.id}/send`, { text: 'again' });
  assert.equal(busy[0].event, 'error');
  assert.equal((await (await api(`/agent/sessions/${s.id}/stop`, { method: 'POST' })).json()).stopped, true);
  const stopped = await pending;
  assert.match(stopped.find((e) => e.data.kind === 'notice').data.text, /Stopped/);
  assert.equal(stopped.at(-1).data.status, 'stopped');
});

test('agent: a signed-out agy ends the turn at once with sign-in help', async () => {
  const flag = path.join(tmp, 'signed-out');
  await fs.writeFile(flag, '');
  try {
    const models = await api('/agent/models');
    assert.equal(models.status, 424);
    assert.equal((await models.json()).code, 'agy-signed-out');

    const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({}) })).json();
    const t0 = Date.now();
    const events = await sse(`/agent/sessions/${s.id}/send`, { text: 'hello' });
    assert.ok(Date.now() - t0 < 10_000, 'turn should end quickly, not wait for the sign-in timeout');
    assert.match(events.find((e) => e.data.kind === 'notice').data.text, /not signed in.*run `agy`/);
    assert.equal(events.at(-1).data.status, 'error');
  } finally {
    await fs.rm(flag, { force: true });
  }
});

test('agent: skipped tools are explained instead of a blank reply', async () => {
  const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({}) })).json();
  const denied = await sse(`/agent/sessions/${s.id}/send`, { text: 'list files (denied)' });
  assert.equal(denied.filter((e) => e.data.kind === 'assistant').length, 0, 'no blank assistant reply');
  const n = denied.find((e) => e.data.kind === 'notice');
  assert.match(n.data.text, /wanted to use RunCommand, but it can't ask for your approval/);
  assert.equal(n.data.tone, 'warning');
  assert.equal(denied.at(-1).data.status, 'idle');
  assert.equal(denied.at(-1).data.conversationId, 'conv-d', 'the conversation can still be continued');

  const silent = await sse(`/agent/sessions/${s.id}/send`, { text: 'say nothing (silent)' });
  assert.match(silent.find((e) => e.data.kind === 'notice').data.text, /finished without a reply/);
});

test('agent: a reply that talks about signing in is delivered, not mistaken for a signed-out agy', async () => {
  const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({}) })).json();
  const events = await sse(`/agent/sessions/${s.id}/send`, { text: 'how do I log in? (signin-talk)' });
  const reply = events.find((e) => e.data.kind === 'assistant');
  assert.ok(reply, 'the reply is shown');
  assert.match(reply.data.text, /Please sign in first/);
  assert.equal(events.at(-1).data.status, 'idle');
  assert.equal(events.at(-1).data.conversationId, 'conv-t');
});

test('agent: finished turns say so; a session deleted mid-turn leaves nothing behind', async () => {
  const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({}) })).json();
  const done = await sse(`/agent/sessions/${s.id}/send`, { text: 'hello' });
  const finished = done.filter((e) => e.event === 'update').at(-1);
  assert.match(finished.data.title, /^Antigravity worked for \d+ s$/);

  const pending = sse(`/agent/sessions/${s.id}/send`, { text: 'be slow' });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await api(`/agent/sessions/${s.id}`, { method: 'DELETE' })).status, 200);
  const events = await pending;
  assert.equal(events.at(-1).event, 'done', 'watchers are told the turn ended');
  await new Promise((r) => setTimeout(r, 100));
  const stored = JSON.parse(await fs.readFile(agent.dataFile, 'utf8'));
  assert.equal(stored.sessions[s.id], undefined);
  assert.equal(stored.transcripts[s.id], undefined, 'no orphan transcript');
});

test('agent: sessions of a renamed or deleted folder stay reachable, with a clear error on send', async () => {
  const dir = path.join(files.root, 'gone');
  await fs.mkdir(dir, { recursive: true });
  const s = await (await api('/agent/sessions', { method: 'POST', body: JSON.stringify({ projectId: 'gone' }) })).json();
  await fs.rm(dir, { recursive: true });
  const projects = await (await api('/agent/projects')).json();
  const gone = projects.find((p) => p.id === 'gone');
  assert.ok(gone && gone.missing, 'listed as missing');
  assert.match(gone.name, /folder missing/);
  const events = await sse(`/agent/sessions/${s.id}/send`, { text: 'hi' });
  assert.equal(events[0].event, 'error');
  assert.match(events[0].data.message, /no longer in your projects folder/);
  assert.equal((await api(`/agent/sessions/${s.id}`, { method: 'DELETE' })).status, 200);
});

test('agent: sessions persist across a service restart', async () => {
  const again = new AgentService({ dataFile: agent.dataFile, projectsDir: agent.projectsDir, agyPath: agent.agy });
  await again.init();
  assert.ok(again.listSessions().length >= 2);
});

function openPty(params = '') {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/orbit/pty?session=t1&cols=80&rows=24${params}`, { origin: ORIGIN });
  const out = [];
  ws.on('message', (d) => out.push(JSON.parse(d.toString())));
  return { ws, out, text: () => out.filter((m) => m.type === 'output').map((m) => m.data).join('') };
}

const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('terminal: the device that reports its size last sets the shared window size', async (t) => {
  if (!(await hasTmux())) return t.skip('tmux not installed');
  const open = async (cols, rows) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/orbit/pty?session=t2&cols=${cols}&rows=${rows}`, { origin: ORIGIN });
    const out = [];
    ws.on('message', (d) => out.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: await token() }));
    await until(() => out.some((m) => m.type === 'ready'));
    return ws;
  };
  const width = async () =>
    Number((await run('tmux', ['-L', 'orbit', 'display', '-p', '-t', 'orbit-t2', '#{window_width}'])).stdout.trim());
  const waitWidth = async (want) => {
    let w = 0;
    for (let i = 0; i < 60 && w !== want; i++) {
      await new Promise((r) => setTimeout(r, 50));
      w = await width();
    }
    return w;
  };
  const phone = await open(47, 20);
  const ipad = await open(120, 30);
  phone.send(JSON.stringify({ type: 'input', data: 'echo typed-on-phone\n' }));
  phone.send(JSON.stringify({ type: 'resize', cols: 47, rows: 20 }));
  assert.equal(await waitWidth(47), 47, 'the phone took over while it was being used');
  // The iPad comes back into view and re-sends its size.
  ipad.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
  assert.equal(await waitWidth(120), 120, 'the iPad takes over when it reports its size');
  phone.close();
  ipad.close();
  await killTerminalSession('t2');
});

test('terminal: auth required, real shell, survives reconnect via tmux', async (t) => {
  // without auth the socket is closed
  const noAuth = openPty();
  await new Promise((r) => noAuth.ws.on('open', r));
  noAuth.ws.send(JSON.stringify({ type: 'input', data: 'ls\n' }));
  const code = await new Promise((r) => noAuth.ws.on('close', (c) => r(c)));
  assert.equal(code, 4401);

  if (!(await hasTmux())) return t.skip('tmux not installed');
  const a = openPty();
  await new Promise((r) => a.ws.on('open', r));
  a.ws.send(JSON.stringify({ type: 'auth', token: await token() }));
  await until(() => a.out.some((m) => m.type === 'ready'));
  a.ws.send(JSON.stringify({ type: 'input', data: 'export ORBIT_MARK=kept-42; echo "marker-$((40+2))"\n' }));
  await until(() => a.text().includes('marker-42'));
  a.ws.close();

  // reconnect: same tmux session, the shell variable is still set
  const b = openPty();
  await new Promise((r) => b.ws.on('open', r));
  b.ws.send(JSON.stringify({ type: 'auth', token: await token() }));
  await until(() => b.out.some((m) => m.type === 'ready'));
  b.ws.send(JSON.stringify({ type: 'input', data: 'echo "again-$ORBIT_MARK"\n' }));
  await until(() => b.text().includes('again-kept-42'));
  // Orbit's tmux config keeps tmux out of the alternate screen, so the browser terminal keeps scrollback.
  assert.ok(!b.text().includes('\x1b[?1049h'), 'tmux must not switch to the alternate screen');
  b.ws.close();
});
