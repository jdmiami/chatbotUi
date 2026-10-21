import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createGate, COOKIE, originMatcher } from '../src/gate.js';
import { signJwt, verifyJwt } from '../src/jwt.js';
import { createPush } from '../src/push.js';
import { createModelKeeper, parseModelSpec } from '../src/machine.js';
import { createAutoOff as createIdleWatch, runpodStopSelf } from '../../../shared/autooff.js';

const SECRET = 'x'.repeat(40);
const SITE = 'https://site.example';
let webui, ollama, gate, base, seen, activity;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  seen = [];
  activity = 0;
  webui = http.createServer((req, res) => {
    seen.push({ to: 'webui', url: req.url, headers: req.headers });
    if (req.url.startsWith('/page')) {
      const html = '<html><body><h1>hi</h1></body></html>\n';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)) });
      return res.end(html);
    }
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
      stats: async () => ({ cpu: { percent: 12 }, gpus: [{ name: 'A40' }] }),
      storage: { get: async ({ fresh }) => ({ fresh, cloud: { bytes: 1 } }), forget() {} },
      keepAwake: (m) => Date.UTC(2030, 0, 1) + m * 60_000,
      idleState: () => ({ limitMinutes: 20, idleMinutes: 3 }),
      push: createPush({ secret: SECRET, subject: 'mailto:o@x', log: {} }),
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
  assert.equal(h['x-orbit-name'], 'Owner');
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
  // Starts at once with a keep-alive comment (big models can take a while to load), then the reply.
  assert.equal(await res.text(), ': loading\n\ndata: one\n\ndata: two\n\n');
  const h = seen.find((s) => s.to === 'ollama').headers;
  assert.equal(h.authorization, undefined);
  assert.equal(h.origin, undefined, 'Ollama would refuse a browser origin');
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
  w.activity();
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

test('model specs: plain names, and friendly names for outside models with their settings', () => {
  assert.deepEqual(parseModelSpec('qwen3.8:27b'), { name: 'qwen3.8:27b', source: 'qwen3.8:27b', parameters: {} });
  assert.deepEqual(parseModelSpec('free:27b=hf.co/Org/Repo:Q6_K|temperature=0|repeat_penalty=1.15|stop=END'), {
    name: 'free:27b',
    source: 'hf.co/Org/Repo:Q6_K',
    parameters: { temperature: 0, repeat_penalty: 1.15, stop: 'END' },
  });
  assert.deepEqual(parseModelSpec('free:27b=hf.co/Org/Repo:Q6_K|like=qwen3.8:27b|temperature=0'), {
    name: 'free:27b',
    source: 'hf.co/Org/Repo:Q6_K',
    parameters: { temperature: 0 },
    like: 'qwen3.8:27b',
  });
});

test('model keeper: an outside model is pulled, given its friendly name and settings, and its long name removed', async () => {
  const have = new Set(['qwen:latest']);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ path: new URL(url).pathname, body });
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [...have].map((name) => ({ name })) }));
    if (url.endsWith('/api/pull')) {
      have.add(body.model);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"status":"success"}\n')); c.close(); } }));
    }
    if (url.endsWith('/api/create')) {
      have.add(body.model);
      return new Response('{"status":"success"}');
    }
    if (url.endsWith('/api/delete')) {
      have.delete(body.model);
      return new Response('');
    }
    return new Response('', { status: 404 });
  };
  const k = createModelKeeper({ ollama: 'http://o', wanted: ['qwen', 'free:27b=hf.co/Org/Repo:Q6_K|temperature=0'], fetchImpl });
  assert.deepEqual(k.wanted, ['qwen', 'free:27b']);
  k.start();
  for (let i = 0; i < 100 && !have.has('free:27b'); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  const create = calls.find((c) => c.path === '/api/create');
  assert.deepEqual(create.body, { model: 'free:27b', from: 'hf.co/Org/Repo:Q6_K', parameters: { temperature: 0 }, stream: false });
  assert.ok(calls.some((c) => c.path === '/api/delete' && c.body.model === 'hf.co/Org/Repo:Q6_K'));
  assert.ok(have.has('free:27b') && !have.has('hf.co/Org/Repo:Q6_K'));
});

test('model keeper: like= gives an outside model the chat format of a library model, so it can use tools', async () => {
  const have = new Set(['qwen3.8:27b']);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ path: new URL(url).pathname, body });
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [...have].map((name) => ({ name })) }));
    if (url.endsWith('/api/pull')) {
      have.add(body.model);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"status":"success"}\n')); c.close(); } }));
    }
    if (url.endsWith('/api/show')) {
      return new Response(JSON.stringify({ template: '{{ .Prompt }}', modelfile: 'FROM /x\nTEMPLATE {{ .Prompt }}\nRENDERER qwen3.8\nPARSER qwen3.5\nPARAMETER top_k 20\n' }));
    }
    if (url.endsWith('/api/create')) {
      have.add(body.model);
      return new Response('{"status":"success"}');
    }
    if (url.endsWith('/api/delete')) {
      have.delete(body.model);
      return new Response('');
    }
    return new Response('', { status: 404 });
  };
  const k = createModelKeeper({ ollama: 'http://o', wanted: ['qwen3.8:27b', 'free:27b=hf.co/Org/Repo:Q6_K|like=qwen3.8:27b|temperature=0'], fetchImpl });
  k.start();
  for (let i = 0; i < 100 && !have.has('free:27b'); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  const create = calls.find((c) => c.path === '/api/create');
  assert.deepEqual(create.body, {
    model: 'free:27b',
    from: 'hf.co/Org/Repo:Q6_K',
    template: '{{ .Prompt }}',
    renderer: 'qwen3.8',
    parser: 'qwen3.5',
    parameters: { temperature: 0 },
    stream: false,
  });
  assert.ok(have.has('qwen3.8:27b'), 'the library model is kept');
});

test('model API: an error from the model arrives as a stream error event', async () => {
  const fake = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'model "nope" not found' } }));
  });
  const port = await listen(fake);
  const g = createGate(
    { secret: SECRET, webui: 'http://127.0.0.1:9', ollama: `http://127.0.0.1:${port}`, allowedOrigins: SITE, siteUrl: SITE, status: async () => ({}) },
    { warn() {}, info() {} },
  );
  const gb = `http://127.0.0.1:${await listen(g)}`;
  const res = await fetch(`${gb}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken()}`, 'content-type': 'application/json' },
    body: '{"model":"nope","stream":true}',
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /data: \{"error":\{"message":"model \\"nope\\" not found"\}\}/);
  g.close();
  fake.close();
});

test('stats: token or session required, and reading them does not keep the machine on', async () => {
  assert.equal((await fetch(`${base}/_orbit/stats`)).status, 401);
  const before = activity;
  const res = await fetch(`${base}/_orbit/stats`, { headers: { authorization: `Bearer ${apiToken()}` } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { cpu: { percent: 12 }, gpus: [{ name: 'A40' }] });
  assert.equal(activity, before, 'polling stats is not activity');
});

test('storage: token or session required; ?fresh=1 lists again; not activity', async () => {
  assert.equal((await fetch(`${base}/_orbit/storage`)).status, 401);
  const before = activity;
  const auth = { headers: { authorization: `Bearer ${apiToken()}` } };
  assert.deepEqual(await (await fetch(`${base}/_orbit/storage`, auth)).json(), { fresh: false, cloud: { bytes: 1 } });
  assert.deepEqual(await (await fetch(`${base}/_orbit/storage?fresh=1`, auth)).json(), { fresh: true, cloud: { bytes: 1 } });
  assert.equal(activity, before, 'looking at storage is not activity');
});

test('keep awake: pushes the turn-off time back and counts as activity', async () => {
  const before = activity;
  const res = await fetch(`${base}/_orbit/keepawake`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ minutes: 30 }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).offAt, new Date(Date.UTC(2030, 0, 1) + 30 * 60_000).toISOString());
  assert.equal(activity, before + 1);
});

test('push: a browser signs up for notifications and can stop', async () => {
  const call = (method, body) =>
    fetch(`${base}/_orbit/push`, { method, headers: { authorization: `Bearer ${apiToken()}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  assert.equal((await fetch(`${base}/_orbit/push`)).status, 401);
  const info = await (await call('GET')).json();
  assert.equal(Buffer.from(info.publicKey, 'base64url').length, 65);
  assert.equal(info.devices, 0);
  assert.equal((await call('POST', { subscription: { endpoint: 'http://evil.local/' } })).status, 400);
  assert.equal((await (await call('POST', { subscription: { endpoint: 'https://web.push.apple.com/x' } })).json()).devices, 1);
  assert.equal((await call('DELETE', { endpoint: 'https://web.push.apple.com/x' })).status, 200);
  assert.equal((await (await call('GET')).json()).devices, 0);
});

test('playground pages get the status pill, with a token for the site; other responses are untouched', async () => {
  const cookie = await signIn();
  const page = await fetch(`${base}/page`, { headers: { cookie, accept: 'text/html' } });
  const html = await page.text();
  assert.match(html, /<script type="module" src="\/_orbit\/island\.js"><\/script><orbit-island api="https:\/\/site\.example\/api\/status" token="[\w.-]+" place="playground"/);
  assert.ok(html.indexOf('<orbit-island') < html.indexOf('</body>'), 'inside the body');
  const token = /token="([\w.-]+)"/.exec(html)[1];
  assert.equal(verifyJwt(token, SECRET, { audience: 'site-island' }).sub, 'jd');
  assert.equal(page.headers.get('content-length'), null, 'length recomputed');
  assert.equal(seen.filter((x) => x.url === '/page').pop().headers['accept-encoding'], 'identity');
  // Not a page request: passed through as is.
  const raw = await fetch(`${base}/page`, { headers: { cookie, accept: 'application/json' } });
  assert.doesNotMatch(await raw.text(), /orbit-island/);
});

test('idle watch: keep awake pushes the turn-off time and offAt reports it', async () => {
  let t = 0;
  let stops = 0;
  const w = createIdleWatch({ limitMinutes: 30, busy: async () => false, stop: async () => stops++, now: () => t });
  assert.equal(w.state().offAt, new Date(30 * 60_000).toISOString());
  w.extend(30);
  assert.equal(w.state().offAt, new Date(60 * 60_000).toISOString());
  t = 45 * 60_000;
  await w.check();
  assert.equal(stops, 0, 'held');
  t = 61 * 60_000;
  await w.check();
  assert.equal(stops, 1);
});

test('idle watch fail-safes: a job that never ends stops counting, failed stops retry in minutes, keep awake is capped', async () => {
  let t = 0;
  let stops = 0;
  const w = createIdleWatch({ limitMinutes: 20, busy: async () => true, stop: async () => void stops++, now: () => t, log: {} });
  t = 170 * 60_000;
  await w.check();
  assert.equal(stops, 0, 'a running job keeps it on');
  t = 185 * 60_000;
  await w.check();
  assert.equal(stops, 1, 'a job busy for three hours with no new request no longer holds the machine on');

  let tries = 0;
  t = 0;
  const f = createIdleWatch({ limitMinutes: 20, busy: async () => false, stop: async () => { tries++; throw new Error('api down'); }, now: () => t, log: {} });
  t = 21 * 60_000;
  await f.check();
  t = 22 * 60_000;
  await f.check();
  assert.equal(tries, 1, 'waits before retrying');
  t = 24 * 60_000;
  await f.check();
  assert.equal(tries, 2, 'retries within minutes, not another idle period');

  t = 0;
  const k = createIdleWatch({ limitMinutes: 20, busy: async () => false, stop: async () => {}, now: () => t, log: {} });
  k.extend(240);
  assert.equal(k.state().offAt, new Date(120 * 60_000).toISOString(), 'keep awake is capped at two hours');
});

test('only real work keeps the machine on: polling, browsing and open pages do not', async () => {
  const before = activity;
  await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${apiToken()}`, origin: SITE } });
  assert.equal(activity, before, 'listing models is not a job');
  const idle = await fetch(`${base}/_orbit/idle`);
  assert.equal(idle.status, 200, 'the watchdog can read idle time without signing in');
});
