import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { machineStatus, setMachinePower } from '@/lib/runpod';
import { linuxMachineExtend, linuxSaveBeforeStop } from '@/lib/status';

export const dynamic = 'force-dynamic';
// Turning off waits for the machine to save its home to R2 first.
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

/** Linux machine status: off / starting / on, cost per hour, and whether we can control it. */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await machineStatus(), { headers: noStore });
}

/**
 * Turn the Linux machine on or off, or keep it on longer (the same "Keep on" as the AI machine):
 * { "action": "start" | "stop" | "extend", "minutes"?: number }.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action, minutes } = (await request.json().catch(() => ({}))) as { action?: string; minutes?: number };
  if (action === 'extend') {
    try {
      return Response.json({ ...(await machineStatus()), ...(await linuxMachineExtend(user, minutes)) }, { headers: noStore });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
  }
  if (action !== 'start' && action !== 'stop') {
    return Response.json({ error: 'action must be "start", "stop" or "extend"' }, { status: 400 });
  }
  if (!process.env.RUNPOD_API_KEY) {
    return Response.json({ error: 'RUNPOD_API_KEY is not set in Vercel.' }, { status: 501 });
  }
  try {
    if (action === 'stop') await linuxSaveBeforeStop(user);
    await setMachinePower(action);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  return Response.json(await machineStatus(), { headers: noStore });
}
