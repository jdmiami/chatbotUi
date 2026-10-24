import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { createR2, r2Config } from '@/lib/r2';
import { HeldError, approveHeld, listHeld, noteHeld } from '@/lib/held';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'private, no-store' };
const NOT_SET_UP = 'Held results show here with the machine off once storage keys are added.';

function storage() {
  const conf = r2Config();
  return conf ? createR2(conf) : null;
}

function failed(err: unknown) {
  const status = err instanceof HeldError ? err.status : 502;
  const message = err instanceof HeldError ? err.message : 'Could not reach your stored results. Try again in a moment.';
  return Response.json({ error: message }, { status, headers: noStore });
}

/**
 * Results held for review, for the owner only (the one login: studio members have their own door and
 * never reach this). { configured, items }.
 */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  const r2 = storage();
  if (!r2) return Response.json({ configured: false, items: [], message: NOT_SET_UP }, { headers: noStore });
  try {
    return Response.json({ configured: true, items: await listHeld(r2) }, { headers: noStore });
  } catch (err) {
    return failed(err);
  }
}

/**
 * Review one held result without the AI machine:
 *   { action: 'approve', id }       back into that person's gallery, NSFW mark intact, with an audit line
 *   { action: 'note', id, text }    a note on why it stays held
 * There is no delete here.
 */
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403, headers: noStore });
  const r2 = storage();
  if (!r2) return Response.json({ configured: false, error: NOT_SET_UP }, { status: 503, headers: noStore });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  try {
    switch (body?.action) {
      case 'approve':
        return Response.json(await approveHeld(r2, id), { headers: noStore });
      case 'note':
        return Response.json(await noteHeld(r2, id, body.text), { headers: noStore });
      default:
        return Response.json({ error: 'action must be approve or note' }, { status: 400, headers: noStore });
    }
  } catch (err) {
    return failed(err);
  }
}
