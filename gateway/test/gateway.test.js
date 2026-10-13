import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import { createGateway, loadConfig } from '../src/server.js';
import { encodeInstruction, InstructionParser } from '../src/protocol.js';

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://rdp.example.com';
let fakeGuacd;
let gateway;
let gatewayPort;
const received = []; // instructions guacd got

before(async () => {
  // A fake guacd that performs the real handshake, then echoes "sync" instructions.
  fakeGuacd = net.createServer((sock) => {
    const parser = new InstructionParser();
    sock.on('data', (buf) => {
      for (const ins of parser.push(buf.toString()).instructions) {
        received.push(ins);
        if (ins[0] === 'select') {
          sock.write(encodeInstruction('args', 'VERSION_1_5_0', 'hostname', 'port', 'username', 'password'));
        } else if (ins[0] === 'connect') {
          // "ready" and the first frame arrive in one chunk, the second frame is split.
          const frame = encodeInstruction('size', '0', '800', '600');
          sock.write(encodeInstruction('ready', '$abc') + frame + frame.slice(0, 5));
          setTimeout(() => sock.write(frame.slice(5)), 20);
        } else if (ins[0] === 'sync') {
          sock.write(encodeInstruction('sync', ins[1]));
        }
      }
    });
  });
  await new Promise((r) => fakeGuacd.listen(0, '127.0.0.1', r));

  const config = loadConfig({
    GATEWAY_SECRET: SECRET,
    RDP_HOST: 'my-pc',
    RDP_USERNAME: 'me',
    RDP_PASSWORD: 'p@ss,word;',
    GUACD_HOST: '127.0.0.1',
    GUACD_PORT: String(fakeGuacd.address().port),
    ALLOWED_ORIGINS: ORIGIN,
  });
  const quiet = { info() {}, warn() {}, error() {} };
  gateway = createGateway(config, quiet);
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  gatewayPort = gateway.address().port;
});

after(() => {
  gateway.close();
  fakeGuacd.close();
});

function mintToken(overrides = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin')
    .setIssuer(overrides.iss ?? 'rdp-web')
    .setAudience('rdp-gateway')
    .setJti(overrides.jti ?? crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '60s')
    .sign(new TextEncoder().encode(overrides.secret ?? SECRET));
}

function open(token, origin = ORIGIN) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${gatewayPort}/?token=${token}&width=800&height=600&dpi=96`,
    'guacamole',
    { origin },
  );
  const messages = [];
  ws.on('message', (d) => messages.push(d.toString()));
  return { ws, messages };
}

function waitFor(cond, ms = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function expectRejected(ws) {
  return new Promise((resolve) => {
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
}

test('parser handles split and unicode instructions', () => {
  const p = new InstructionParser();
  const full = encodeInstruction('clipboard', 'héllo 😀;,') + encodeInstruction('sync', '1');
  const a = p.push(full.slice(0, 9));
  assert.equal(a.instructions.length, 0);
  const b = p.push(full.slice(9));
  assert.deepEqual(b.instructions, [['clipboard', 'héllo 😀;,'], ['sync', '1']]);
  assert.equal(b.raw, full);
});

test('valid token: handshake, credentials stay server-side, data flows, pings echoed', async () => {
  const { ws, messages } = open(await mintToken());
  await waitFor(() => messages.join('').includes('4.size'));

  // First message tells the client the tunnel UUID.
  assert.ok(messages[0].startsWith('0.,4.$abc;'));

  // guacd got the right connect args, in the order it asked for them.
  const connect = received.find((i) => i[0] === 'connect');
  assert.deepEqual(connect, ['connect', 'VERSION_1_5_0', 'my-pc', '3389', 'me', 'p@ss,word;']);
  const size = received.find((i) => i[0] === 'size');
  assert.deepEqual(size, ['size', '800', '600', '96']);

  // Split frame got reassembled: every message contains only whole instructions.
  await waitFor(() => messages.join('').split('4.size').length === 3);
  for (const m of messages) assert.ok(m.endsWith(';'));

  // Ping is answered by the gateway and not forwarded to guacd.
  const ping = encodeInstruction('', 'ping', '123');
  ws.send(ping);
  await waitFor(() => messages.includes(ping));
  assert.ok(!received.some((i) => i[0] === ''));

  // Regular instructions go through to guacd.
  ws.send(encodeInstruction('sync', '42'));
  await waitFor(() => messages.includes(encodeInstruction('sync', '42')));
  ws.close();
});

test('token cannot be reused', async () => {
  const token = await mintToken();
  const first = open(token);
  await waitFor(() => first.messages.length > 0);
  first.ws.close();
  assert.equal(await expectRejected(open(token).ws), 401);
});

test('rejects bad signature, expired token, wrong issuer, missing token', async () => {
  assert.equal(await expectRejected(open(await mintToken({ secret: 'y'.repeat(40) })).ws), 401);
  assert.equal(await expectRejected(open(await mintToken({ exp: Math.floor(Date.now() / 1000) - 10 })).ws), 401);
  assert.equal(await expectRejected(open(await mintToken({ iss: 'someone-else' })).ws), 401);
  assert.equal(await expectRejected(open('').ws), 401);
});

test('rejects other origins', async () => {
  assert.equal(await expectRejected(open(await mintToken(), 'https://evil.example').ws), 403);
});
