import { SignJWT, jwtVerify } from 'jose';

/**
 * Studio members: people who bought one studio (After Dark…). Their sign-in is a different cookie
 * from the owner's, with its own audience, so every owner page and API keeps refusing them; only
 * the studio's own routes (/api/studio/*) and Orbit's static files accept it.
 */
export const MEMBER_COOKIE = 'studio_session';
const AUDIENCE = 'studio-member-session';

export interface Member {
  user: string;
  studio: string;
}

function key() {
  const value = process.env.SESSION_SECRET || '';
  if (value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(value);
}

export function memberMaxAgeSeconds() {
  return 30 * 24 * 3600;
}

export async function createMemberToken(m: Member) {
  return new SignJWT({ studio: m.studio })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(m.user)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${memberMaxAgeSeconds()}s`)
    .sign(key());
}

export async function verifyMemberToken(token: string | undefined): Promise<Member | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], audience: AUDIENCE });
    const studio = typeof payload.studio === 'string' ? payload.studio : '';
    return payload.sub && /^[a-z0-9-]{2,40}$/.test(studio) ? { user: payload.sub, studio } : null;
  } catch {
    return null;
  }
}
