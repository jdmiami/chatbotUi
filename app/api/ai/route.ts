import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiConfigured, aiStatus, startAi, stopAi } from '@/lib/ai';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/** AI machine status: off / starting / downloading / on, cost per hour, model download progress. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { podId: _podId, ...status } = await aiStatus(user);
  return Response.json(status, { headers: noStore });
}

/** Turn the AI machine on or off: { "action": "start" | "stop" }. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== 'start' && action !== 'stop') {
    return Response.json({ error: 'action must be "start" or "stop"' }, { status: 400 });
  }
  if (!aiConfigured()) return Response.json({ error: 'The AI machine is not set up in Vercel yet.' }, { status: 501 });
  try {
    await (action === 'start' ? startAi() : stopAi());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  const { podId: _podId, ...status } = await aiStatus(user);
  return Response.json(status, { headers: noStore });
}
