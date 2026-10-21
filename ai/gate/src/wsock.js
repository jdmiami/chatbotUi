// A small WebSocket server side (RFC 6455) for the gate's own live connections (Live draw, Live
// video). The gate has no packages, so this is the minimum: the handshake, masked client frames,
// fragmented messages, ping/pong, close, and a size limit. Open WebUI's sockets are not handled here:
// they are piped through to Open WebUI untouched (gate.js).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The Sec-WebSocket-Accept answer for a client's key. */
export const acceptKey = (key) => crypto.createHash('sha1').update(String(key) + GUID).digest('base64');

/** The sub-protocols a browser asked for ("a, b" -> ["a", "b"]). */
export const askedProtocols = (req) =>
  String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** One frame (server frames are never masked). */
export function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([head, data]);
}

/** A masked client frame, as a browser sends it (tests). */
export function encodeClientFrame(opcode, payload, { fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
  const plain = encodeFrame(opcode, data);
  const headLen = plain.length - data.length;
  const head = Buffer.from(plain.subarray(0, headLen));
  if (!fin) head[0] &= 0x7f;
  head[1] |= 0x80;
  const mask = crypto.randomBytes(4);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/**
 * Parse as many complete frames as `buf` holds. Returns { frames: [{ fin, opcode, payload }], rest }
 * or throws (code 1002 protocol error / 1009 too big).
 */
export function decodeFrames(buf, { maxPayload = 16 * 1024 * 1024, requireMask = true } = {}) {
  const frames = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const fin = Boolean(b0 & 0x80);
    if (b0 & 0x70) throw Object.assign(new Error('reserved bits set'), { code: 1002 });
    const opcode = b0 & 0x0f;
    const masked = Boolean(b1 & 0x80);
    if (requireMask && !masked) throw Object.assign(new Error('client frames must be masked'), { code: 1002 });
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(maxPayload)) throw Object.assign(new Error('message too big'), { code: 1009 });
      len = Number(big);
      p += 8;
    }
    if (len > maxPayload) throw Object.assign(new Error('message too big'), { code: 1009 });
    if (opcode >= 8 && (len > 125 || !fin)) throw Object.assign(new Error('bad control frame'), { code: 1002 });
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    let payload = buf.subarray(p + maskLen, p + maskLen + len);
    if (masked) {
      const mask = buf.subarray(p, p + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    } else payload = Buffer.from(payload);
    frames.push({ fin, opcode, payload });
    off = p + maskLen + len;
  }
  return { frames, rest: buf.subarray(off) };
}

/**
 * Finish the handshake on an upgraded socket and return a connection:
 *   ws.on('message', (data: Buffer, binary: boolean) => …), ws.on('close', (code) => …)
 *   ws.send(text | Buffer), ws.close(code, reason), ws.open
 * `protocol` is the sub-protocol to answer with (it must be one the browser asked for).
 * Returns null (and ends the socket with 400) when the request isn't a WebSocket upgrade.
 */
export function acceptWebSocket(req, socket, head, { protocol = null, maxPayload = 16 * 1024 * 1024, pingMs = 25_000 } = {}) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || String(req.headers['sec-websocket-version'] || '') !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`];
  if (protocol) lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  socket.write(lines.join('\r\n') + '\r\n\r\n');
  socket.setNoDelay?.(true);

  const ws = new EventEmitter();
  ws.open = true;
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let parts = null; // { opcode, chunks, size } while a fragmented message arrives
  let closed = false;

  const finish = (code) => {
    if (closed) return;
    closed = true;
    ws.open = false;
    clearInterval(ping);
    ws.emit('close', code ?? 1006);
  };
  ws.send = (data) => {
    if (!ws.open) return false;
    const binary = Buffer.isBuffer(data);
    return socket.write(encodeFrame(binary ? 0x2 : 0x1, data));
  };
  ws.close = (code = 1000, reason = '') => {
    if (!ws.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    socket.write(encodeFrame(0x8, body.subarray(0, 125)));
    ws.open = false;
    socket.end();
    finish(code);
  };
  // Keep the connection alive through proxies that drop quiet ones (Runpod's waits about 100 s).
  const ping = setInterval(() => ws.open && socket.write(encodeFrame(0x9, Buffer.alloc(0))), pingMs);
  ping.unref?.();

  const onData = (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    let parsed;
    try {
      parsed = decodeFrames(buf, { maxPayload });
    } catch (err) {
      ws.close(err.code || 1002, err.message);
      return;
    }
    buf = Buffer.from(parsed.rest);
    for (const f of parsed.frames) {
      if (!ws.open) return;
      if (f.opcode === 0x8) {
        const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000;
        ws.close(code);
        return;
      }
      if (f.opcode === 0x9) {
        socket.write(encodeFrame(0xa, f.payload));
        continue;
      }
      if (f.opcode === 0xa) continue;
      if (f.opcode === 0x1 || f.opcode === 0x2) {
        if (parts) return ws.close(1002, 'expected a continuation');
        if (f.fin) ws.emit('message', f.payload, f.opcode === 0x2);
        else parts = { opcode: f.opcode, chunks: [f.payload], size: f.payload.length };
        continue;
      }
      if (f.opcode === 0x0) {
        if (!parts) return ws.close(1002, 'unexpected continuation');
        parts.chunks.push(f.payload);
        parts.size += f.payload.length;
        if (parts.size > maxPayload) return ws.close(1009, 'message too big');
        if (f.fin) {
          const { opcode, chunks } = parts;
          parts = null;
          ws.emit('message', Buffer.concat(chunks), opcode === 0x2);
        }
        continue;
      }
      return ws.close(1002, 'unknown opcode');
    }
  };
  socket.on('data', onData);
  socket.on('error', () => finish(1006));
  socket.on('close', () => finish(1006));
  if (buf.length) setImmediate(() => onData(Buffer.alloc(0)));
  return ws;
}
