import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { canvasConfigured, canvasStatus, startCanvas, stopCanvas } from '@/lib/canvas';

export const dynamic = 'force-dynamic';
// Finding a free GPU can take a couple of tries (see lib/canvas.ts).
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };
const publicStatus = async (user: string) => {
  const { podId: _podId, ...status } = await canvasStatus(user);
  return status;
};

/** The drawing machine (Live Draw): off / starting / downloading / on, its price and auto-off. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await publicStatus(user), { headers: noStore });
}

/** Turn the drawing machine on or off: { "action": "start" | "stop" }. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== 'start' && action !== 'stop') return Response.json({ error: 'action must be "start" or "stop"' }, { status: 400 });
  if (!canvasConfigured()) return Response.json({ error: 'The drawing machine is not set up in Vercel yet.' }, { status: 501 });
  try {
    await (action === 'start' ? startCanvas() : stopCanvas());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  return Response.json(await publicStatus(user), { headers: noStore });
}
