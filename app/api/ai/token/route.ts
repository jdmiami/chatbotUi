import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiBase, aiStatus, aiToken } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/**
 * For Orbit's chat: the AI machine's address and a 1-hour token for its model API (/v1, OpenAI
 * compatible). The token stays in memory in the browser and is refreshed by calling this again.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { podId, ...status } = await aiStatus(user);
  const ready = podId && (status.state === 'on' || status.state === 'downloading');
  return Response.json(
    {
      status,
      url: ready ? aiBase(podId) : null,
      token: ready ? await aiToken(user, 'orbit-ai') : null,
      expiresIn: 3600,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
