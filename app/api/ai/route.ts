import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { aiBase, aiConfigured, aiConsole, aiProvider, aiStatus, startAi, stopAi } from '@/lib/ai';
import { setFirstPicks } from '@/lib/gpuaiMachine';

export const dynamic = 'force-dynamic';
// Finding a free GPU can take several tries (see lib/ai.ts).
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

/** Status plus the machine's direct address and its Runpod page (the pod id isn't a secret: the
 * address still needs a sign-in from this site). */
async function statusWithLinks(user: string) {
  const { podId, ...status } = await aiStatus(user);
  return podId ? { ...status, url: aiBase(podId), consoleUrl: aiConsole(podId) } : status;
}

/** AI machine status: off / starting / downloading / on, cost per hour, model download progress. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await statusWithLinks(user), { headers: noStore });
}

/**
 * Turn the AI machine on or off: { "action": "start" | "stop", "tier"?: "standard" | "turbo" }.
 * On GPU.ai, { "action": "first", "makers": [ids] } saves what to load first while it starts.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action, tier, makers } = (await request.json().catch(() => ({}))) as { action?: string; tier?: string; makers?: unknown };
  if (action !== 'start' && action !== 'stop' && action !== 'first') {
    return Response.json({ error: 'action must be "start", "stop" or "first"' }, { status: 400 });
  }
  if (!aiConfigured()) return Response.json({ error: 'The AI machine is not set up in Vercel yet.' }, { status: 501 });
  if (action === 'first') {
    if (aiProvider() !== 'gpuai') return Response.json({ error: 'Only the AI machine on GPU.ai loads makers when you pick them.' }, { status: 409 });
    try {
      await setFirstPicks(makers);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
    return Response.json(await statusWithLinks(user), { headers: noStore });
  }
  try {
    await (action === 'start' ? startAi(typeof tier === 'string' ? tier : undefined) : stopAi());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
  return Response.json(await statusWithLinks(user), { headers: noStore });
}
