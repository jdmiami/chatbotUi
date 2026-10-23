import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiBase, aiToken } from '@/lib/ai';
import { canvasStatus } from '@/lib/canvas';

export const dynamic = 'force-dynamic';

/**
 * For Live Draw: the drawing machine's address (only when it is on), a 1-hour token for it (the same
 * owner token as the AI machine's) and the engine set to use. The owner gets the fast engines. Studio
 * members never reach this route (proxy.ts); theirs is /api/studio/canvas, always the licensed engines.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { podId, ...status } = await canvasStatus(user);
  const url = podId && status.state === 'on' ? aiBase(podId) : null;
  return Response.json(
    { status, url, token: url ? await aiToken(user, 'orbit-ai') : null, expiresIn: 3600, engine: 'fast' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
