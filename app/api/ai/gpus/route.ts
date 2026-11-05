import { currentUser } from '@/lib/auth';
import { aiProvider } from '@/lib/ai';
import { machineGpuOptions } from '@/lib/gpuaiMachine';

export const dynamic = 'force-dynamic';

/**
 * Every GPU GPU.ai offers right now for a machine (?machine=ai, the default, or canvas for Live Draw),
 * cheapest first, with what each can do and the one to suggest. Orbit shows the list before every start.
 */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (aiProvider() !== 'gpuai') return Response.json({ options: [], recommended: null }, { headers: { 'cache-control': 'no-store' } });
  const kind = new URL(request.url).searchParams.get('machine') === 'canvas' ? 'canvas' : 'ai';
  try {
    return Response.json(await machineGpuOptions(kind), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
