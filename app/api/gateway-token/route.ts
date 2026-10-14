import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { currentUser } from '@/lib/auth';
import { gatewayFor } from '@/lib/machines';

export const dynamic = 'force-dynamic';

// Mints a 60-second, single-use ticket the browser presents to a machine's gateway.
// The RDP password never leaves the gateway: only the ticket reaches the browser.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // CSRF defence on top of the SameSite=Strict cookie.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  return Response.json(
    { gatewayUrl: gateway.url, token },
    { headers: { 'cache-control': 'no-store' } },
  );
}
