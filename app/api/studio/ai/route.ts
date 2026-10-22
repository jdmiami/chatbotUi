import { currentUser } from '@/lib/auth';
import { currentMember } from '@/lib/members';
import { sameOrigin } from '@/lib/request';
import { aiBase, aiStatus, startAi, studioToken } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Who is asking: a studio member, or the owner trying a studio (?studio=…). */
async function caller(request: Request): Promise<{ user: string; studio: string } | null> {
  const member = await currentMember();
  if (member) return member;
  const owner = await currentUser();
  const studio = new URL(request.url).searchParams.get('studio') ?? '';
  return owner && /^[a-z0-9-]{2,40}$/.test(studio) ? { user: 'owner', studio } : null;
}

/**
 * The studio's way to its AI: whether it is ready, its address and a member key (GET), and waking it
 * up (POST { action: "start" }). Members never see costs, machines or anything of the owner's.
 */
export async function GET(request: Request) {
  const who = await caller(request);
  if (!who) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { podId, state } = await aiStatus('studio');
  const ready = podId && (state === 'on' || state === 'downloading');
  return Response.json(
    {
      state,
      member: who.user === 'owner' ? null : who.user,
      url: ready ? aiBase(podId) : null,
      token: ready ? await studioToken(who.studio, who.user) : null,
      expiresIn: 3600,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const who = await caller(request);
  if (!who) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== 'start') return Response.json({ error: 'action must be start' }, { status: 400 });
  try {
    await startAi();
  } catch {
    return Response.json({ error: 'The studio could not start right now. Try again in a minute.' }, { status: 503 });
  }
  const { state } = await aiStatus('studio');
  return Response.json({ state }, { headers: { 'cache-control': 'no-store' } });
}
