import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'rdp_session';

function key() {
  const value = process.env.SESSION_SECRET || '';
  if (value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(value);
}

export function sessionMaxAgeSeconds() {
  return Math.round(Number(process.env.SESSION_HOURS || 12) * 3600);
}

export async function createSessionToken(username: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(username)
    .setAudience('rdp-web-session')
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSeconds()}s`)
    .sign(key());
}

/** Returns the username for a valid session token, or null. */
export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ['HS256'],
      audience: 'rdp-web-session',
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
