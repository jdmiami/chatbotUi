import { currentUser } from '@/lib/auth';
import { spendHistory } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** Runpod spend per day (?days=1–90, default 30) and the saved-storage drives' size and monthly cost. */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 30, 1), 90);
  return Response.json(await spendHistory(days), { headers: { 'cache-control': 'no-store' } });
}
