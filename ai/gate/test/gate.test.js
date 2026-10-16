import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createGate, COOKIE, originMatcher } from '../src/gate.js';
import { signJwt, verifyJwt } from '../src/jwt.js';
import { createIdleWatch, createModelKeeper, runpodStopSelf } from '../src/machine.js';

const SECRET = 'x'.repeat(40);
const SITE = 'https://site.example';
let webui, ollama, gate, base, seen, activity;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  seen = [];
  activity = 0;
  webui = http.createServer((req, res) => {
    seen.push({ to: 'webui', url: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive' });
    res.end('webui ' + req.url);
  });
  webui.on('upgrade', (req, socket) => {
    seen.push({ to: 'webui-ws', url: req.url, headers: req.headers });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write('echo:' + d));
  });
  ollama = http.createServer((req, res) => {
    seen.push({ to: 'ollama', url: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: one\n\n');
    setTimeout(() => res.end('data: two\n\n'), 20);
  });
  const wp = await listen(webui);
  const op = await listen(ollama);
  gate = createGate(
    {
      secret: SECRET,
      webui: `http://127.0.0.1:${wp}`,
      ollama: `http://127.0.0.1:${op}`,
      allowedOrigins: 'https://site.example,https://site-*-me.example',
      siteUrl: SITE,
      userEmail: 'owner@orbit.local',
      activity: () => activity++,
      status: async () => ({ ready: true }),
    },
    { warn() {}, info() {} },
  );
  base = `http://127.0.0.1:${await listen(gate)}`;
});
after(() => {
  gate.close();
  webui.close();
  ollama.close();
});

const loginToken = (extra = {}) =>
  signJwt({ sub: 'jd', aud: 'orbit-ai-login', iss: 'rdp-web', jti: crypto.randomUUID(), ...extra }, SECRET, { expiresIn: 60 });
const apiToken = () => signJwt({ sub: 'jd', aud: 'orbit-ai', iss: 'rdp-web' }, SECRET, { expiresIn: 3600 });

async function signIn() {
  const res = await fetch(`${base}/_orbit/login?token=${loginToken()}&next=/c/123`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/c/123');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${COOKIE.replace(/[-]/g, '\\-')}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  return cookie.split(';')[0];
}

test('jwt: verifies good tokens and rejects tampering, wrong audience, expiry and alg none', () => {
  const t = signJwt({ aud: 'a', iss: 'i' }, SECRET);
  assert.equal(verifyJwt(t, SECRET, { audience: 'a', issuer: 'i' }).aud, 'a');
  assert.throws(() => verifyJwt(t, SECRET, { audience: 'b' }), /audience/);
  assert.throws(() => verifyJwt(t, 'y'.repeat(40)), /signature/);
  assert.throws(() => verifyJwt(signJwt({}, SECRET, { expiresIn: -5 }), SECRET), /expired/);
  const [, body] = t.split('.');
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`;
  assert.throws(() => verifyJwt(none, SECRET), /alg|malformed/);
});

test('origin matcher: exact origins and one-label wildcards only', () => {
  const ok = originMatcher('https://site.example,https://site-*-me.example');
  assert.ok(ok('https://site.example'));
  assert.ok(ok('https://site-abc123-me.example'));
  assert.ok(!ok('https://site-a.b-me.example'));
  assert.ok(!ok('https://evil.example'));
  assert.ok(!ok(''));
});

test('sign-in: a one-use token sets the cookie; reuse, bad tokens and open redirects are refused', async () => {
  const tok = loginToken();
  const first = await fetch(`${base}/_orbit/login?token=${tok}`, { redirect: 'manual' });
  assert.equal(first.status, 302);
  const again = await fetch(`${base}/_orbit/login?token=${tok}`, { redirect: 'manual' });
  assert.equal(again.status, 401);
  const wrongAud = await fetch(`${base}/_orbit/login?token=${apiToken()}`, { redirect: 'manual' });
  assert.equal(wrongAud.status, 401);
  const evil = await fetch(`${base}/_orbit/login?token=${loginToken()}&next=//evil.example`, { redirect: 'manual' });
  assert.equal(evil.headers.get('location'), '/');
});

test('not signed in: pages bounce to the site, API calls get 401', async () => {
  const page = await fetch(`${base}/c/9`, { headers: { accept: 'text/html' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `${SITE}/ai?next=%2Fc%2F9`);
  const api = await fetch(`${base}/api/models`);
  assert.equal(api.status, 401);
  // An API token is not a browser session.
  const tokenOnly = await fetch(`${base}/api/models`, { headers: { authorization: `Bearer ${apiToken()}` } });
  assert.equal(tokenOnly.status, 401);
});

test('signed in: proxied to Open WebUI with the trusted identity; forged headers and our cookie are stripped', async () => {
  const cookie = await signIn();
  seen.length = 0;
  const res = await fetch(`${base}/api/models?x=1`, {
    headers: { cookie: `${cookie}; token=webui-own`, 'x-orbit-email': 'attacker@evil.example' },
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'webui /api/models?x=1');
  const h = seen.find((s) => s.to === 'webui').headers;
  assert.equal(h['x-orbit-email'], 'owner@orbit.local');
  assert.equal(h['x-orbit-name'], 'jd');
  assert.equal(h.cookie, 'token=webui-own');
  assert.equal(h['x-forwarded-proto'], 'https');
});

test('model API: needs a bearer token, checks the origin, streams through without the token', async () => {
  assert.equal((await fetch(`${base}/v1/models`)).status, 401);
  const bad = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${apiToken()}`, origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  const pre = await fetch(`${base}/v1/chat/completions`, { method: 'OPTIONS', headers: { origin: SITE } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  seen.length = 0;
  const before = activity;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken()}`, origin: SITE, 'content-type': 'application/json' },
    body: '{"stream":true}',
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'data: one\n\ndata: two\n\n');
  const h = seen.find((s) => s.to === 'ollama').headers;
  assert.equal(h.authorization, undefined);
  assert.ok(activity > before, 'API use counts as activity');
});

test('status: token or session required', async () => {
  assert.equal((await fetch(`${base}/_orbit/status`)).status, 401);
  const res = await fetch(`${base}/_orbit/status`, { headers: { authorization: `Bearer ${apiToken()}` } });
  assert.deepEqual(await res.json(), { ready: true });
});

function rawUpgrade(headers) {
  return new Promise((resolve) => {
    const port = new URL(base).port;
    const s = net.connect(Number(port), '127.0.0.1', () => {
      s.write(`GET /ws/socket.io/?EIO=4 HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${headers}\r\n`);
    });
    let data = '';
    s.on('data', (d) => {
      data += d;
      if (data.includes('\r\n\r\n') && !data.includes('101')) {
        s.destroy();
        resolve(data);
      }
      if (data.includes('101') && !data.includes('echo:')) s.write('hello');
      if (data.includes('echo:hello')) {
        s.destroy();
        resolve(data);
      }
    });
    s.on('close', () => resolve(data));
  });
}

test('websockets: piped for signed-in browsers only, with the trusted identity', async () => {
  assert.match(await rawUpgrade(''), /401/);
  const cookie = await signIn();
  seen.length = 0;
  const out = await rawUpgrade(`Cookie: ${cookie}\r\nX-Orbit-Email: evil@x\r\n`);
  assert.match(out, /101/);
  assert.match(out, /echo:hello/);
  const h = seen.find((s) => s.to === 'webui-ws').headers;
  assert.equal(h['x-orbit-email'], 'owner@orbit.local');
  assert.equal(h.cookie, undefined);
});

test('idle watch: stops after the limit, activity and busy() postpone it, failures are reported', async () => {
  let t = 0;
  let stops = 0;
  let isBusy = false;
  const w = createIdleWatch({ limitMinutes: 30, busy: async () => isBusy, stop: async () => void stops++, now: () => t, log: {} });
  t = 29 * 60_000;
  await w.check();
  assert.equal(stops, 0);
  w.touch();
  t = 58 * 60_000;
  await w.check();
  assert.equal(stops, 0);
  isBusy = true;
  t = 200 * 60_000;
  await w.check();
  assert.equal(stops, 0, 'a loaded model keeps it on');
  isBusy = false;
  t = 231 * 60_000;
  await w.check();
  assert.equal(stops, 1);
  const f = createIdleWatch({ limitMinutes: 1, busy: async () => false, stop: async () => { throw new Error('nope'); }, now: () => t, log: {} });
  t += 120_000;
  await f.check();
  assert.equal(f.state().lastStop.ok, false);
  assert.match(f.state().lastStop.error, /nope/);
});

test('model keeper: pulls missing default models one by one and reports progress', async () => {
  const have = new Set(['qwen:latest']);
  const pulled = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [...have].map((name) => ({ name })) }));
    const { model } = JSON.parse(init.body);
    pulled.push(model);
    have.add(model);
    const lines = [{ status: 'pulling', total: 100, completed: 50 }, { status: 'success' }].map((l) => JSON.stringify(l) + '\n');
    return new Response(new ReadableStream({ start(c) { lines.forEach((l) => c.enqueue(new TextEncoder().encode(l))); c.close(); } }));
  };
  const k = createModelKeeper({ ollama: 'http://o', wanted: ['qwen', 'coder:30b', 'gpt:20b'], fetchImpl });
  k.start();
  for (let i = 0; i < 50 && pulled.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pulled, ['coder:30b', 'gpt:20b']);
  assert.equal(k.pulling(), false);
});

test('stop self: REST first, GraphQL fallback, clear error when neither works', async () => {
  const calls = [];
  await runpodStopSelf({ podId: 'p1', apiKey: 'k', fetchImpl: async (url) => (calls.push(url), new Response('{}', { status: 200 })) });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v2\/pods\/p1\/action$/);
  const calls2 = [];
  await runpodStopSelf({
    podId: 'p1',
    apiKey: 'k',
    fetchImpl: async (url) => (calls2.push(url), url.includes('graphql') ? new Response('{"data":{}}') : new Response('no', { status: 403 })),
  });
  assert.equal(calls2.length, 2);
  await assert.rejects(
    runpodStopSelf({ podId: 'p1', apiKey: 'k', fetchImpl: async (url) => (url.includes('graphql') ? new Response('{"errors":[1]}') : new Response('no', { status: 403 })) }),
    /REST 403/,
  );
  await assert.rejects(runpodStopSelf({ podId: '', apiKey: '' }), /not available/);
});
