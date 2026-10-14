import { SignJWT } from 'jose';
import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { machineStatus, podHttpBase } from '@/lib/runpod';

export const dynamic = 'force-dynamic';

/**
 * Gives Orbit (served at /orbit) what it needs to reach the Linux machine directly:
 * the machine's HTTPS base URL and a short-lived bearer token the Orbit host on the machine
 * verifies with LINUX_GATEWAY_SECRET (audience "orbit-host"). The token lives only in memory
 * in the browser and is refreshed by calling this again.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const machine = await machineStatus();
  const base = podHttpBase();
  const secret = process.env.LINUX_GATEWAY_SECRET;
  if (!base || !secret) return Response.json({ machine, hostUrl: null, token: null }, { headers: { 'cache-control': 'no-store' } });

  const ttlSeconds = 60 * 60;
  const token = await new SignJWT({ scope: 'orbit' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience('orbit-host')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));

  return Response.json(
    { machine, hostUrl: base, token, expiresIn: ttlSeconds },
    { headers: { 'cache-control': 'no-store' } },
  );
}
