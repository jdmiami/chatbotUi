import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { currentUser } from '@/lib/auth';
import { gatewayFor } from '@/lib/machines';
import { sameOrigin } from '@/lib/request';
import { activePodId } from '@/lib/runpod';

export const dynamic = 'force-dynamic';

// Mints a 60-second, single-use ticket the browser presents to a machine's gateway.
// The RDP password never leaves the gateway: only the ticket reaches the browser.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // CSRF defence on top of the SameSite=Strict cookie.
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const machine = new URL(request.url).searchParams.get('machine') ?? '';
  const gateway = gatewayFor(machine);
  if (!gateway) return Response.json({ error: 'Unknown machine' }, { status: 404 });

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience('rdp-gateway')
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(gateway.key);

  // The Linux desktop may be running on its stand-in machine (see lib/runpod.ts).
  let gatewayUrl = gateway.url;
  if (machine === 'linux' && !process.env.LINUX_GATEWAY_URL) {
    const id = await activePodId().catch(() => null);
    if (id) gatewayUrl = `wss://${id}-8080.proxy.runpod.net`;
  }

  return Response.json(
    { gatewayUrl, token },
    { headers: { 'cache-control': 'no-store' } },
  );
}
