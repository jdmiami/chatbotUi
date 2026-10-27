import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { ServerlessError, serverlessCancel, serverlessInfo, serverlessStart, serverlessStatus } from '@/lib/serverlessMake';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

const failed = (err: unknown) => {
  const e = err as ServerlessError;
  return Response.json({ error: e.message }, { status: e.status ?? 502, headers: noStore });
};

/** The serverless AI machine: is it set up and ready, its price, which makers it has; with ?id= where a job is. */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  try {
    return Response.json(id ? await serverlessStatus(id) : await serverlessInfo(), { headers: noStore });
  } catch (err) {
    return failed(err);
  }
}

/** Start one: { job: { kind, maker, prompt, ... } }, the same body Make sends the AI machine. */
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const input = (await request.json().catch(() => null)) as { job?: unknown } | null;
  const job = input?.job;
  if (!job || typeof job !== 'object' || Array.isArray(job)) return Response.json({ error: 'Send the job to make.' }, { status: 400 });
  const kind = (job as Record<string, unknown>).kind;
  if (kind !== 'image' && kind !== 'video') return Response.json({ error: 'kind must be image or video' }, { status: 400 });
  try {
    return Response.json(await serverlessStart(job as Record<string, unknown>), { headers: noStore });
  } catch (err) {
    return failed(err);
  }
}

/** Stop one: ?id= */
export async function DELETE(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const id = new URL(request.url).searchParams.get('id') ?? '';
  try {
    await serverlessCancel(id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    return failed(err);
  }
}
