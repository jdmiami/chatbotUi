import { runWatchdog, type WatchdogResult } from '@/lib/watchdog';
import { ensureEndpoint } from '@/lib/serverlessMake';

export const dynamic = 'force-dynamic';

// Called on a schedule (GitHub Actions every 10 minutes, Vercel cron daily). It only turns off
// machines that should already be off, so it is open; repeated calls within a minute reuse the
// last result instead of asking Runpod again.
let last: { at: number; result: WatchdogResult } | null = null;

export async function GET() {
  if (!process.env.RUNPOD_API_KEY) return Response.json({ error: 'RUNPOD_API_KEY is not set' }, { status: 501 });
  if (last && Date.now() - last.at < 60_000) return Response.json(last.result, { headers: { 'cache-control': 'no-store' } });
  try {
    const result = await runWatchdog();
    // The serverless AI machine's endpoint is made (or moved to this deployment's image) here too, so it
    // is ready before anyone opens Make with the machine off. Nothing about it is reported.
    await ensureEndpoint().catch(() => null);
    last = { at: Date.now(), result };
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
