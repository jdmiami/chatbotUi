// A small client for the OpenClaw gateway on this machine (ws://127.0.0.1:18789), used by Orbit's
// agent screen. It signs in as an operator with the gateway's token and a device key kept on disk,
// sends requests ({type:"req"}) and passes events ({type:"event"}) on to listeners.
//
// Protocol (OpenClaw 2026.10): the gateway sends `connect.challenge` {nonce, ts}; the client answers
// with `connect`, signing "v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily"
// with its Ed25519 key (deviceId = sha256 hex of the raw public key). Loopback devices are paired
// automatically.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const PROTOCOL = 4;
const CLIENT = { id: 'cli', version: '1.0.0', platform: 'linux', mode: 'cli' };
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write', 'operator.approvals'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** The device key: made once, kept (0600) next to the agent's state. */
export async function loadIdentity(file) {
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    const privateKey = crypto.createPrivateKey(saved.privateKeyPem);
    return identityFrom(privateKey);
  } catch {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
    return identityFrom(privateKey);
  }
}

function identityFrom(privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const raw = spki.subarray(spki.length - 32); // Ed25519 SPKI ends with the 32-byte key
  return { privateKey, publicKey: b64url(raw), deviceId: crypto.createHash('sha256').update(raw).digest('hex') };
}

export function signConnect(identity, { token, nonce, signedAt }) {
  const payload = ['v3', identity.deviceId, CLIENT.id, CLIENT.mode, ROLE, SCOPES.join(','), String(signedAt), token ?? '', nonce, CLIENT.platform, ''].join('|');
  return b64url(crypto.sign(null, Buffer.from(payload, 'utf8'), identity.privateKey));
}

export class ClawClient extends EventEmitter {
  /**
   * @param url       ws://127.0.0.1:18789
   * @param token     the gateway's token
   * @param identity  from loadIdentity()
   */
  constructor({ url, token, identity, log = console, WebSocketImpl = WebSocket }) {
    super();
    this.url = url;
    this.token = token;
    this.identity = identity;
    this.log = log;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.ready = null;
    this.pending = new Map();
    this.seq = 0;
    this.closed = false;
  }

  /** Connects (once; reconnects on the next call after a drop). Resolves with hello-ok. */
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url);
      this.ws = ws;
      let hello = false;
      const fail = (err) => {
        this.ready = null;
        if (!hello) reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error('The agent did not answer (is it running?).'));
        ws.terminate?.();
      }, 15_000);
      ws.on('error', (err) => {
        clearTimeout(timer);
        fail(new Error(`The agent can't be reached: ${err.message}`));
      });
      ws.on('close', () => {
        clearTimeout(timer);
        this.ready = null;
        for (const p of this.pending.values()) p.reject(new Error('The agent connection closed.'));
        this.pending.clear();
        if (hello) this.emit('disconnect');
        else fail(new Error('The agent closed the connection while signing in.'));
      });
      ws.on('message', async (data) => {
        let frame;
        try {
          frame = JSON.parse(String(data));
        } catch {
          return;
        }
        if (frame.type === 'event' && frame.event === 'connect.challenge' && !hello) {
          const { nonce, ts } = frame.payload || {};
          const signedAt = Number(ts) || Date.now();
          try {
            const res = await this.request('connect', {
              minProtocol: PROTOCOL,
              maxProtocol: PROTOCOL,
              client: CLIENT,
              role: ROLE,
              scopes: SCOPES,
              caps: ['tool-events', 'exec-approvals', 'chat-only-assistant-text'],
              auth: { token: this.token },
              device: { id: this.identity.deviceId, publicKey: this.identity.publicKey, signature: signConnect(this.identity, { token: this.token, nonce, signedAt }), signedAt, nonce },
            });
            hello = true;
            clearTimeout(timer);
            resolve(res);
          } catch (err) {
            clearTimeout(timer);
            fail(err);
            ws.close();
          }
          return;
        }
        if (frame.type === 'res') {
          const p = this.pending.get(frame.id);
          if (!p) return;
          this.pending.delete(frame.id);
          if (frame.ok) p.resolve(frame.payload);
          else p.reject(Object.assign(new Error(frame.error?.message || 'The agent refused.'), { code: frame.error?.code }));
          return;
        }
        if (frame.type === 'event') this.emit('event', frame.event, frame.payload);
      });
    });
    return this.ready;
  }

  /** One request; resolves with its payload. (connect itself goes through here before hello.) */
  request(method, params = {}, timeoutMs = 30_000) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('The agent is not connected.'));
    const id = `o${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The agent did not answer ${method} in time.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  /** Connect if needed, then request. */
  async call(method, params, timeoutMs) {
    await this.connect();
    return this.request(method, params, timeoutMs);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
