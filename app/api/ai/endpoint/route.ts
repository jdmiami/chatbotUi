import { fromMachine } from '@/lib/request';
import { aiBase, aiConfigured, aiStatus, startAi } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/**
 * Machine-to-site: the Linux machine's coding agent asks where the AI machine is (and, with ?wake=1,
 * to turn it on). Authenticated with a short-lived token the Linux machine signs with the shared
 * LINUX_GATEWAY_SECRET (audience "site-machine"), not with a browser session.
 */
export async function GET(request: Request) {
  if (!(await fromMachine(request))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!aiConfigured()) return Response.json({ state: 'unconfigured', url: null });
  let status = await aiStatus('linux-machine');
  if (new URL(request.url).searchParams.get('wake') === '1' && (status.state === 'off' || status.state === 'error')) {
    try {
      await startAi();
      status = await aiStatus('linux-machine');
    } catch (err) {
      return Response.json({ state: 'error', url: null, detail: (err as Error).message }, { status: 502 });
    }
  }
  return Response.json(
    { state: status.state, url: status.podId ? aiBase(status.podId) : null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
