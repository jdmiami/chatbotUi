import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import { createGateway, loadConfig } from '../src/server.js';
import { FileService } from '../src/orbit/files.js';
import { AgentService } from '../src/orbit/agent.js';
import { createOrbitApi } from '../src/orbit/http.js';
import { hasTmux, killTerminalSession } from '../src/orbit/pty.js';

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
    models) printf 'model-a\\tModel A\\nmodel-b\\tModel B\\n'; exit 0 ;;
    --version) echo "1.3.4"; exit 0 ;;
  esac
  shift
done
case "$prompt" in *slow*) sleep 30 ;; esac
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
  b.ws.close();
});
