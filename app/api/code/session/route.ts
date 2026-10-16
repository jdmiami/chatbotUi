import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { machineStatus, podHttpBase } from '@/lib/runpod';

export const dynamic = 'force-dynamic';

/**
 * Sign-in link for the coding workspace (VS Code in the browser on the Linux machine, served by its
 * gateway at /code/): a 90-second, single-use token the gateway swaps for its own cookie.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const machine = await machineStatus();
  const base = podHttpBase();
  const secret = process.env.LINUX_GATEWAY_SECRET;
  if (!base || !secret || machine.state !== 'on') {
    return Response.json({ machine, url: null }, { headers: { 'cache-control': 'no-store' } });
  }
  const token = await new SignJWT({ scope: 'code' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience('orbit-code-login')
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('90s')
    .sign(new TextEncoder().encode(secret));
  return Response.json({ machine, url: `${base}/code/_login?token=${token}` }, { headers: { 'cache-control': 'no-store' } });
}
