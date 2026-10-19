import 'server-only';
import { jwtVerify } from 'jose';

/** CSRF defence for state-changing routes, on top of the SameSite=Strict session cookie. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older Safari may omit it; cookie is SameSite=Strict
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

/**
 * Machine-to-site calls: the Linux machine signs a short-lived token with the shared
 * LINUX_GATEWAY_SECRET (audience "site-machine"), instead of a browser session.
 */
export async function fromMachine(request: Request): Promise<boolean> {
  const secret = process.env.LINUX_GATEWAY_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (!secret || !auth.startsWith('Bearer ')) return false;
  try {
    await jwtVerify(auth.slice(7), new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      audience: 'site-machine',
      issuer: 'orbit-host',
      requiredClaims: ['exp', 'iat'],
      maxTokenAge: '3m',
    });
    return true;
  } catch {
    return false;
  }
}
