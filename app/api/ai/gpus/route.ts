import { currentUser } from '@/lib/auth';
import { aiProvider, aiProviders, providerInfos } from '@/lib/ai';
import { machineGpuOptions } from '@/lib/gpuaiMachine';

export const dynamic = 'force-dynamic';

/**
 * Every GPU GPU.ai offers right now for a machine (?machine=ai, the default, or canvas for Live Draw),
 * cheapest first, with what each can do and the one to suggest. Orbit shows the list before every start.
 * For the AI machine with both Runpod and GPU.ai set up, `providers` also lists the two (and Runpod's
 * speeds) so Orbit can ask where to turn it on first; `default` is the one to suggest.
 */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const kind = new URL(request.url).searchParams.get('machine') === 'canvas' ? 'canvas' : 'ai';
  const noStore = { 'cache-control': 'no-store' };
  // The drawing machine goes where AI_PROVIDER says; the AI machine to either provider that is set up.
  const providers = kind === 'ai' ? aiProviders() : [];
  const gpuai = kind === 'ai' ? providers.includes('gpuai') : aiProvider() === 'gpuai';
  const both = providers.length > 1;
  const extra = both ? { providers: providerInfos(), default: providers[0] } : {};
  if (!gpuai) return Response.json({ options: [], recommended: null, ...extra }, { headers: noStore });
  try {
    return Response.json({ ...(await machineGpuOptions(kind)), ...extra }, { headers: noStore });
  } catch (err) {
    // The GPU list can't be read, but Runpod still can be chosen.
    if (both) return Response.json({ options: [], recommended: null, ...extra, problem: (err as Error).message }, { headers: noStore });
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
