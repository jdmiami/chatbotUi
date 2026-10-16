import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { createGateway, loadConfig } from '../src/server.js';
import { createCodeProxy, CODE_COOKIE } from '../src/code.js';
import { createLocalAiProxy } from '../src/ai-local.js';

const SECRET = 'g'.repeat(40);
const key = new TextEncoder().encode(SECRET);
const SITE = 'https://site.example';
let codeServer, gateway, base, seen;
const upgraded = new Set();

const listen = (srv, host = '127.0.0.1') => new Promise((r) => srv.listen(0, host, () => r(srv.address().port)));
const loginToken = (extra = {}) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('jd')
    .setIssuer('rdp-web')
    .setAudience('orbit-code-login')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime('90s')
    .sign(key);

before(async () => {
  seen = [];
  codeServer = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === '/login') {
      res.writeHead(302, { location: '/?folder=/home' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('vscode ' + req.url);
  });
  codeServer.on('upgrade', (req, socket) => {
    seen.push({ ws: true, url: req.url, headers: req.headers });
    upgraded.add(socket);
    socket.on('end', () => socket.destroy());
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write('echo:' + d));
  });
  const cp = await listen(codeServer);
  const config = loadConfig({ GATEWAY_SECRET: SECRET, RDP_HOST: '127.0.0.1', ALLOWED_ORIGINS: SITE });
  const code = createCodeProxy({ secret: config.secret, upstream: `http://127.0.0.1:${cp}`, siteUrl: SITE, log: {} });
  gateway = createGateway(config, { info() {}, warn() {}, error() {} }, null, code);
  base = `http://127.0.0.1:${await listen(gateway)}`;
});
after(() => {
  gateway.close();
  codeServer.close();
});

async function signIn() {
  const res = await fetch(`${base}/code/_login?token=${await loginToken()}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/code/');
  const c = res.headers.get('set-cookie');
  assert.ok(c.startsWith(CODE_COOKIE + '='));
  assert.match(c, /HttpOnly/);
  return c.split(';')[0];
}

test('code: sign-in token is single-use; bad tokens go back to the site', async () => {
  const t = await loginToken();
  assert.equal((await fetch(`${base}/code/_login?token=${t}`, { redirect: 'manual' })).status, 302);
  const again = await fetch(`${base}/code/_login?token=${t}`, { redirect: 'manual' });
  assert.equal(again.headers.get('location'), `${SITE}/code`);
  const bad = await fetch(`${base}/code/_login?token=nope`, { redirect: 'manual' });
  assert.equal(bad.headers.get('location'), `${SITE}/code`);
});

test('code: without the cookie pages bounce to the site and nothing reaches VS Code', async () => {
  seen.length = 0;
  const page = await fetch(`${base}/code/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `${SITE}/code`);
  assert.equal((await fetch(`${base}/code/static/x.js`)).status, 401);
  assert.equal(seen.length, 0);
});

test('code: signed in, /code redirects to /code/, requests are proxied with the prefix stripped', async () => {
  const cookie = await signIn();
  const bare = await fetch(`${base}/code?folder=/x`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(bare.headers.get('location'), '/code/?folder=/x');
  seen.length = 0;
  const res = await fetch(`${base}/code/static/app.js?v=1`, { headers: { cookie: `${cookie}; vscode-tkn=abc`, host: 'pod.example' } });
  assert.equal(await res.text(), 'vscode /static/app.js?v=1');
  assert.equal(seen[0].headers.cookie, 'vscode-tkn=abc', 'our cookie is not passed on');
  const redirect = await fetch(`${base}/code/login`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), '/code/?folder=/home', 'absolute redirects stay under /code');
});

function rawUpgrade(path, headers) {
  return new Promise((resolve) => {
    const s = net.connect(Number(new URL(base).port), '127.0.0.1', () =>
      s.write(`GET ${path} HTTP/1.1\r\nHost: pod.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: https://pod.example\r\n${headers}\r\n`),
    );
    let data = '';
    s.on('data', (d) => {
      data += d;
      if (data.includes('101') && !data.includes('echo:')) s.write('hi');
      if (data.includes('echo:hi') || (data.includes('\r\n\r\n') && !data.includes('101'))) {
        s.destroy();
        resolve(data);
      }
    });
    s.on('close', () => resolve(data));
  });
}

test('code: websockets need the cookie (not the site origin) and keep the public host', async () => {
  assert.match(await rawUpgrade('/code/?reconnectionToken=1', ''), /401/);
  const cookie = await signIn();
  seen.length = 0;
  const out = await rawUpgrade('/code/?reconnectionToken=1', `Cookie: ${cookie}\r\n`);
  assert.match(out, /echo:hi/);
  assert.equal(seen[0].url, '/?reconnectionToken=1');
  assert.equal(seen[0].headers.host, 'pod.example');
  // Other gateway sockets still require an allowed origin.
  assert.match(await rawUpgrade('/orbit/pty', ''), /403/);
});

test('local AI endpoint: finds the AI machine through the site, forwards with a token, explains when it is off', async () => {
  const calls = [];
  let state = 'starting';
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    return new Response(JSON.stringify({ state, url: state === 'on' ? 'https://ai.example' : null }));
  };
  const local = createLocalAiProxy({ secret: key, siteUrl: SITE, log: {}, fetchImpl });
  const port = await listen(local);
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /starting/);
  assert.ok(calls.some((c) => c.url.endsWith('/api/ai/endpoint?wake=1')), 'it asks the site to wake the machine');
  assert.match(calls[0].auth, /^Bearer /);
  assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
  local.close();
});
