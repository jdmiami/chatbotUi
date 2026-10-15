import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { machineStatus, setMachinePower } from '@/lib/runpod';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/** Linux machine status: off / starting / on, cost per hour, and whether we can control it. */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await machineStatus(), { headers: noStore });
}

/** Turn the Linux machine on or off: { "action": "start" | "stop" }. */
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== 'start' && action !== 'stop') {
    return Response.json({ error: 'action must be "start" or "stop"' }, { status: 400 });
  }
  if (!process.env.RUNPOD_API_KEY) {
    return Response.json({ error: 'RUNPOD_API_KEY is not set in Vercel.' }, { status: 501 });
  }
  try {
    await setMachinePower(action);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  return Response.json(await machineStatus(), { headers: noStore });
}
