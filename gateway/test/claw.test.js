import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClawService } from '../src/orbit/claw.js';
import { loadIdentity, signConnect } from '../src/orbit/claw-client.js';
import crypto from 'node:crypto';

/** A stand-in for the OpenClaw gateway: records requests, lets the test push events. */
class FakeClaw extends EventEmitter {
  constructor() {
    super();
    this.requests = [];
  }
  async connect() {
    return { server: { version: 'test' } };
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'chat.send') return { runId: 'run-1', status: 'started' };
    return { ok: true };
  }
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-'));
  await fs.writeFile(path.join(dir, 'token'), 'secret-token');
  const fake = new FakeClaw();
  const svc = new ClawService({
    url: 'ws://127.0.0.1:1',
    tokenFile: path.join(dir, 'token'),
    identityFile: path.join(dir, 'device.json'),
    dataFile: path.join(dir, 'claw.json'),
    projectsDir: dir,
    log: { warn() {}, info() {} },
    clientFactory: () => fake,
  });
  await svc.init();
  return { svc, fake, dir };
}

test('a turn: tool step, approval card, the owner allows once, reply, done', async () => {
  const { svc, fake } = await setup();
  const s = await svc.createSession({});
  const events = [];
  await svc.send(s.id, 'run the tests', (ev, p) => events.push([ev, p]));
  const key = `agent:main:orbit-${s.id}`;
  assert.equal(fake.requests.find((r) => r.method === 'chat.send').params.sessionKey, key);

  fake.emit('event', 'agent', { sessionKey: key, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 't1', args: { command: 'npm test' } } });
  fake.emit('event', 'exec.approval.requested', { id: 'ap1', request: { sessionKey: key, command: 'npm test', cwd: '/p' } });
  const card = events.find(([ev, p]) => ev === 'item' && p.kind === 'approval')[1];
  assert.equal(card.command, 'npm test');
  assert.equal(card.status, 'pending');

  const decided = await svc.decide(s.id, 'ap1', 'allow-once');
  assert.equal(decided.status, 'allowed');
  assert.deepEqual(fake.requests.at(-1), { method: 'exec.approval.resolve', params: { id: 'ap1', decision: 'allow-once' } });

  fake.emit('event', 'agent', { sessionKey: key, stream: 'tool', data: { phase: 'result', toolCallId: 't1', isError: false, result: { content: [{ type: 'text', text: 'all passed' }] } } });
  fake.emit('event', 'chat', { sessionKey: key, state: 'delta', deltaText: 'Tests ' });
  fake.emit('event', 'chat', { sessionKey: key, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Tests pass.' }] } });
  await new Promise((r) => setTimeout(r, 20));

  const kinds = svc.transcript(s.id).map((i) => [i.kind, i.status ?? '', i.text ?? i.title ?? i.command]);
  assert.deepEqual(kinds, [
    ['user', '', 'run the tests'],
    ['activity', 'done', 'exec: npm test'],
    ['approval', 'allowed', 'npm test'],
    ['assistant', '', 'Tests pass.'],
  ]);
  assert.equal(events.at(-1)[0], 'done');
  assert.equal(svc.getSession(s.id).status, 'idle');
});

test('only allow-once and deny are accepted; requests from anywhere else are refused', async () => {
  const { svc, fake } = await setup();
  const s = await svc.createSession({});
  await svc.send(s.id, 'hi', () => {});
  fake.emit('event', 'exec.approval.requested', { id: 'ap2', request: { sessionKey: `agent:main:orbit-${s.id}`, command: 'ls' } });
  await assert.rejects(svc.decide(s.id, 'ap2', 'allow-always'), /allow-once or deny/);
  // Not one of Orbit's sessions: denied straight away.
  fake.emit('event', 'exec.approval.requested', { id: 'ap3', request: { sessionKey: 'agent:main:main', command: 'curl evil' } });
  assert.deepEqual(fake.requests.at(-1), { method: 'exec.approval.resolve', params: { id: 'ap3', decision: 'deny' } });
  // The turn ends: anything still waiting stops waiting.
  fake.emit('event', 'chat', { sessionKey: `agent:main:orbit-${s.id}`, state: 'error', errorMessage: 'model down' });
  await new Promise((r) => setTimeout(r, 20));
  const items = svc.transcript(s.id);
  assert.equal(items.find((i) => i.kind === 'approval').status, 'expired');
  assert.match(items.at(-1).text, /model down/);
  assert.equal(svc.getSession(s.id).status, 'error');
});

test('without OpenClaw set up, it says so instead of failing', async () => {
  const { svc, dir } = await setup();
  await fs.writeFile(path.join(dir, 'token'), '');
  svc.client = null;
  assert.deepEqual(await svc.info(), { installed: false, version: null });
});

test('the device signature is a valid Ed25519 signature over the v3 payload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-id-'));
  const id = await loadIdentity(path.join(dir, 'd.json'));
  const again = await loadIdentity(path.join(dir, 'd.json'));
  assert.equal(id.deviceId, again.deviceId);
  assert.equal(id.deviceId, crypto.createHash('sha256').update(Buffer.from(id.publicKey, 'base64url')).digest('hex'));
  const sig = signConnect(id, { token: 't', nonce: 'n', signedAt: 5 });
  const payload = ['v3', id.deviceId, 'cli', 'cli', 'operator', 'operator.read,operator.write,operator.approvals', '5', 't', 'n', 'linux', ''].join('|');
  const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(id.publicKey, 'base64url')]), format: 'der', type: 'spki' });
  assert.ok(crypto.verify(null, Buffer.from(payload), pub, Buffer.from(sig, 'base64url')));
  assert.equal((await fs.stat(path.join(dir, 'd.json'))).mode & 0o777, 0o600);
});
