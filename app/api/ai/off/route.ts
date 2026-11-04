import { islandUser } from '@/lib/status';
import { aiProvider } from '@/lib/ai';
import { findMachine, terminateMachine } from '@/lib/gpuaiMachine';

export const dynamic = 'force-dynamic';

/**
 * The AI machine on GPU.ai asking to be turned off (ai/gate/src/announce.js): its auto-off rule
 * fired and it holds no key of its own. Signed with the shared secret (audience site-island, subject
 * ai-machine). Only ever terminates the machine named like the AI machine; nothing else.
 */
export async function POST(request: Request) {
  const who = await islandUser(request);
  if (who !== 'ai-machine') return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (aiProvider() !== 'gpuai') return Response.json({ error: 'The AI machine is not on GPU.ai' }, { status: 400 });
  try {
    const m = await findMachine();
    if (m) await terminateMachine(m.id);
    return Response.json({ ok: true, terminated: Boolean(m) }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
