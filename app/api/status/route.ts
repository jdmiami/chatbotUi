import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { startAi, stopAi } from '@/lib/ai';
import { setMachinePower } from '@/lib/runpod';
import { aiMachineAction, fullStatus, islandCors, islandUser } from '@/lib/status';

export const dynamic = 'force-dynamic';

/**
 * Money, timers and machine stats for the status pill (Orbit, the chooser, and the pill the
 * machines add to the playground and VS Code). Signed-in browsers use their session; the
 * machines' pages use a short "island" token they were given, which can only read and do the
 * two harmless actions (keep the AI machine on longer, take a model out of GPU memory).
 */
async function who(request: Request) {
  const user = await currentUser();
  if (user) return { user, full: true };
  const island = await islandUser(request);
  return island ? { user: island, full: false } : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: islandCors(request) });
}

export async function GET(request: Request) {
  const cors = islandCors(request);
  const caller = await who(request);
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  const detail = new URL(request.url).searchParams.get('detail') === '1';
  const body = await fullStatus(caller.user, detail);
  return Response.json({ ...body, canPower: caller.full }, { headers: { ...cors, 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const cors = islandCors(request);
  const caller = await who(request);
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  if (caller.full && !sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors });
  const b = (await request.json().catch(() => ({}))) as { machine?: string; action?: string; minutes?: number; model?: string; tier?: string };
  try {
    if (b.machine === 'ai' && (b.action === 'extend' || b.action === 'unload')) {
      await aiMachineAction(caller.user, b.action, b);
    } else if (!caller.full) {
      return Response.json({ error: 'Open your workspace site to turn machines on or off.' }, { status: 403, headers: cors });
    } else if (b.machine === 'ai' && b.action === 'start') {
      await startAi(typeof b.tier === 'string' ? b.tier : undefined);
    } else if (b.machine === 'ai' && b.action === 'stop') {
      await stopAi();
    } else if (b.machine === 'linux' && (b.action === 'start' || b.action === 'stop')) {
      if (!process.env.RUNPOD_API_KEY) throw new Error('RUNPOD_API_KEY is not set in Vercel.');
      await setMachinePower(b.action);
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400, headers: cors });
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502, headers: cors });
  }
  return Response.json({ ...(await fullStatus(caller.user, true)), canPower: caller.full }, { headers: { ...cors, 'cache-control': 'no-store' } });
}
