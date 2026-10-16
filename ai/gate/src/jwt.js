// Minimal HS256 JWTs (no dependencies, so the AI machine only needs Node itself).
// Tokens come from the web app (and the Linux machine), signed with the shared GATEWAY_SECRET.
import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const json64 = (obj) => b64url(JSON.stringify(obj));

export function signJwt(payload, secret, { expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + expiresIn, ...payload };
  const head = json64({ alg: 'HS256', typ: 'JWT' });
  const data = `${head}.${json64(body)}`;
  return `${data}.${b64url(crypto.createHmac('sha256', secret).update(data).digest())}`;
}

/**
 * Verify an HS256 token. Throws on any problem. Checks: algorithm, signature, exp, iat (required),
 * maximum age, audience and issuer (when given).
 */
export function verifyJwt(token, secret, { audience, issuer, maxAgeSec } = {}) {
  if (typeof token !== 'string') throw new Error('no token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [head, body, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('malformed');
  }
  if (header.alg !== 'HS256') throw new Error('bad alg');
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('bad iat');
  if (maxAgeSec && now - payload.iat > maxAgeSec) throw new Error('too old');
  if (audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) throw new Error('bad audience');
  }
  if (issuer && payload.iss !== issuer) throw new Error('bad issuer');
  return payload;
}
