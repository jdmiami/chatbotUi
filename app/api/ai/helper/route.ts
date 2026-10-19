import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiConfigured, helperStatus, startHelper, stopHelper } from '@/lib/ai';

export const dynamic = 'force-dynamic';
// Finding a free GPU can take several tries (see lib/ai.ts).
export const maxDuration = 120;

const noStore = { 'cache-control': 'no-store' };
const publicStatus = async (user: string) => {
  const { podId: _podId, ...status } = await helperStatus(user);
  return status;
};

/** The helper AI machine (makes images and videos only): off / starting / on, and its price. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await publicStatus(user), { headers: noStore });
}

/** Turn the helper on or off: { "action": "start" | "stop" }. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== 'start' && action !== 'stop') return Response.json({ error: 'action must be "start" or "stop"' }, { status: 400 });
  if (!aiConfigured()) return Response.json({ error: 'The AI machine is not set up in Vercel yet.' }, { status: 501 });
  try {
    await (action === 'start' ? startHelper() : stopHelper());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  return Response.json(await publicStatus(user), { headers: noStore });
}
