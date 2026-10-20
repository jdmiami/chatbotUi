import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiPush, pushPublicKey } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * Orbit's notifications: GET gives the key a browser signs up with; POST {subscription} signs it up
 * on the AI machine (which must be on: Orbit tries again when it is); DELETE {endpoint} stops it.
 */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const publicKey = pushPublicKey();
  if (!publicKey) return Response.json({ error: 'The AI machine is not set up yet.' }, { status: 503 });
  return Response.json({ publicKey }, { headers: { 'cache-control': 'no-store' } });
}

async function change(request: Request, method: 'POST' | 'DELETE') {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { subscription?: { endpoint?: unknown }; endpoint?: unknown };
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : typeof b.subscription?.endpoint === 'string' ? b.subscription.endpoint : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024) return Response.json({ error: 'That is not a push subscription.' }, { status: 400 });
  try {
    const out = await aiPush(user, method, method === 'POST' ? { subscription: { endpoint } } : { endpoint });
    return Response.json({ saved: true, devices: out.devices ?? null });
  } catch (err) {
    // Usually: the machine is off. Not an error for Orbit, which signs up again once it is on.
    return Response.json({ saved: false, reason: (err as Error).message }, { status: 202 });
  }
}

export const POST = (request: Request) => change(request, 'POST');
export const DELETE = (request: Request) => change(request, 'DELETE');
