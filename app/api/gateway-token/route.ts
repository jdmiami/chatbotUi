import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { currentUser } from '@/lib/auth';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Mints a 60-second, single-use ticket the browser presents to the gateway.
// The RDP password never leaves your home network: the gateway holds it.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // CSRF defence on top of the SameSite=Strict cookie.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience('rdp-gateway')
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(config.gatewaySecret);

  return Response.json(
    { gatewayUrl: config.gatewayUrl, token },
    { headers: { 'cache-control': 'no-store' } },
  );
}
