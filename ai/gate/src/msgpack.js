// A small MessagePack encoder and decoder (the gate has no packages): enough for the Krea Realtime
// server's WebSocket messages — maps, arrays, strings, bytes, numbers, booleans and nil.

/** Encode a value as MessagePack bytes. */
export function packb(value) {
  const parts = [];
  let size = 0;
  const push = (buf) => {
    parts.push(buf);
    size += buf.length;
  };
  const head = (bytes) => push(Buffer.from(bytes));
  const u16 = (b, n) => {
    const x = Buffer.alloc(3);
    x[0] = b;
    x.writeUInt16BE(n, 1);
    push(x);
  };
  const u32 = (b, n) => {
    const x = Buffer.alloc(5);
    x[0] = b;
    x.writeUInt32BE(n, 1);
    push(x);
  };
  const enc = (v) => {
    if (v === null || v === undefined) return head([0xc0]);
    if (v === false) return head([0xc2]);
    if (v === true) return head([0xc3]);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v < 2 ** 32) {
        if (v < 128) return head([v]);
        if (v < 256) return head([0xcc, v]);
        if (v < 65536) return u16(0xcd, v);
        return u32(0xce, v);
      }
      if (Number.isInteger(v) && v < 0 && v >= -(2 ** 31)) {
        if (v >= -32) return head([v & 0xff]);
        const x = Buffer.alloc(5);
        x[0] = 0xd2;
        x.writeInt32BE(v, 1);
        return push(x);
      }
      const x = Buffer.alloc(9);
      x[0] = 0xcb;
      x.writeDoubleBE(v, 1);
      return push(x);
    }
    if (typeof v === 'string') {
      const s = Buffer.from(v, 'utf8');
      if (s.length < 32) head([0xa0 | s.length]);
      else if (s.length < 256) head([0xd9, s.length]);
      else if (s.length < 65536) u16(0xda, s.length);
      else u32(0xdb, s.length);
      return push(s);
    }
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      const b = Buffer.from(v);
      if (b.length < 256) head([0xc4, b.length]);
      else if (b.length < 65536) u16(0xc5, b.length);
      else u32(0xc6, b.length);
      return push(b);
    }
    if (Array.isArray(v)) {
      if (v.length < 16) head([0x90 | v.length]);
      else if (v.length < 65536) u16(0xdc, v.length);
      else u32(0xdd, v.length);
      for (const x of v) enc(x);
      return undefined;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      if (keys.length < 16) head([0x80 | keys.length]);
      else if (keys.length < 65536) u16(0xde, keys.length);
      else u32(0xdf, keys.length);
      for (const k of keys) {
        enc(k);
        enc(v[k]);
      }
      return undefined;
    }
    throw new TypeError(`msgpack: cannot encode ${typeof v}`);
  };
  enc(value);
  return Buffer.concat(parts, size);
}

/** Decode MessagePack bytes (bin → Buffer). Throws on anything it doesn't know. */
export function unpackb(input) {
  const buf = Buffer.from(input);
  let off = 0;
  const need = (n) => {
    if (off + n > buf.length) throw new RangeError('msgpack: truncated');
  };
  const str = (n) => {
    need(n);
    const s = buf.toString('utf8', off, off + n);
    off += n;
    return s;
  };
  const bin = (n) => {
    need(n);
    const b = Buffer.from(buf.subarray(off, off + n));
    off += n;
    return b;
  };
  const arr = (n) => Array.from({ length: n }, () => dec());
  const map = (n) => {
    const o = {};
    for (let i = 0; i < n; i++) {
      const k = dec();
      o[String(k)] = dec();
    }
    return o;
  };
  const rd = (fn, n) => {
    need(n);
    const v = buf[fn](off);
    off += n;
    return v;
  };
  const dec = () => {
    need(1);
    const b = buf[off++];
    if (b < 0x80) return b;
    if (b >= 0xe0) return b - 256;
    if ((b & 0xf0) === 0x80) return map(b & 0x0f);
    if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(rd('readUInt8', 1));
      case 0xc5: return bin(rd('readUInt16BE', 2));
      case 0xc6: return bin(rd('readUInt32BE', 4));
      case 0xca: return rd('readFloatBE', 4);
      case 0xcb: return rd('readDoubleBE', 8);
      case 0xcc: return rd('readUInt8', 1);
      case 0xcd: return rd('readUInt16BE', 2);
      case 0xce: return rd('readUInt32BE', 4);
      case 0xcf: return Number(rd('readBigUInt64BE', 8));
      case 0xd0: return rd('readInt8', 1);
      case 0xd1: return rd('readInt16BE', 2);
      case 0xd2: return rd('readInt32BE', 4);
      case 0xd3: return Number(rd('readBigInt64BE', 8));
      case 0xd9: return str(rd('readUInt8', 1));
      case 0xda: return str(rd('readUInt16BE', 2));
      case 0xdb: return str(rd('readUInt32BE', 4));
      case 0xdc: return arr(rd('readUInt16BE', 2));
      case 0xdd: return arr(rd('readUInt32BE', 4));
      case 0xde: return map(rd('readUInt16BE', 2));
      case 0xdf: return map(rd('readUInt32BE', 4));
      default: throw new TypeError(`msgpack: unknown type 0x${b.toString(16)}`);
    }
  };
  const v = dec();
  return v;
}
