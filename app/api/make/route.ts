import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { CloudMakeError, cloudMakeInfo, cloudMakeStart, cloudMakeStatus, cloudRefusal, type CloudKind, type CloudSize } from '@/lib/cloudMake';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

/** Which cloud makers are set up; with ?id= where that job is (and its file once done). */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json(cloudMakeInfo(), { headers: noStore });
  try {
    return Response.json(await cloudMakeStatus(id), { headers: noStore });
  } catch (err) {
    const e = err as CloudMakeError;
    return Response.json({ error: e.message }, { status: e.status ?? 502, headers: noStore });
  }
}

/** Start one: { kind: 'image' | 'video', prompt, size?: 'square' | 'landscape' | 'portrait', seconds?, provider? }. */
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = input?.kind as CloudKind;
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim().slice(0, 2000) : '';
  if (kind !== 'image' && kind !== 'video') return Response.json({ error: 'kind must be image or video' }, { status: 400 });
  if (!prompt) return Response.json({ error: 'Describe what to make.' }, { status: 400 });
  const refused = cloudRefusal(prompt);
  if (refused) return Response.json({ error: refused }, { status: 422 });
  const size = (['square', 'landscape', 'portrait'] as const).includes(input?.size as CloudSize) ? (input!.size as CloudSize) : kind === 'video' ? 'landscape' : 'square';
  const seconds = Math.min(Math.max(Number(input?.seconds) || 0, 0), 10) || undefined;
  try {
    const job = await cloudMakeStart({ kind, prompt, size, seconds, provider: input?.provider === 'fal' || input?.provider === 'cloudflare' ? input.provider : undefined });
    return Response.json(job, { headers: noStore });
  } catch (err) {
    const e = err as CloudMakeError;
    return Response.json({ error: e.message }, { status: e.status ?? 502, headers: noStore });
  }
}
