import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiBase, aiStatus, aiToken } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/**
 * Sign-in link for the AI playground (Open WebUI on the AI machine): a 90-second, single-use token
 * the machine's gate swaps for its own cookie. Only issued while the machine is ready.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { next } = (await request.json().catch(() => ({}))) as { next?: string };
  const { podId, ...status } = await aiStatus(user);
  if (!podId || (status.state !== 'on' && status.state !== 'downloading')) {
    return Response.json({ status, url: null }, { headers: { 'cache-control': 'no-store' } });
  }
  const url = new URL(`${aiBase(podId)}/_orbit/login`);
  url.searchParams.set('token', await aiToken(user, 'orbit-ai-login'));
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) url.searchParams.set('next', next);
  return Response.json({ status, url: url.toString() }, { headers: { 'cache-control': 'no-store' } });
}
