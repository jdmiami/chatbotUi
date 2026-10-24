import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/request';
import { createR2, r2Config } from '@/lib/r2';
import { GalleryError, deleteItem, importCloudItem, keepLabItem, listGallery, markNsfw } from '@/lib/gallery';

export const dynamic = 'force-dynamic';
// Saving a cloud video means fetching it first.
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };
/** Said plainly when the site has no storage keys yet (nothing else about them is ever said). */
const NOT_SET_UP = 'Your gallery shows here with the machine off once storage keys are added.';

function storage() {
  const conf = r2Config();
  return conf ? createR2(conf) : null;
}

function failed(err: unknown) {
  const status = err instanceof GalleryError ? err.status : 502;
  const message = err instanceof GalleryError ? err.message : 'Could not reach your stored gallery. Try again in a moment.';
  return Response.json({ error: message }, { status, headers: noStore });
}

/** Every creation kept in cloud storage, with short-lived links: { configured, items }. */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const r2 = storage();
  if (!r2) return Response.json({ configured: false, items: [], message: NOT_SET_UP }, { headers: noStore });
  try {
    return Response.json({ configured: true, items: await listGallery(r2) }, { headers: noStore });
  } catch (err) {
    return failed(err);
  }
}

/**
 * Change one creation without the AI machine:
 *   { action: 'nsfw', id, nsfw: true | false | null }  your own NSFW say
 *   { action: 'keep', id }                               a Lab picture or clip into the main gallery
 *   { action: 'delete', id }                             gone, file and all
 *   { action: 'import', url, kind, prompt, maker }       a cloud creation saved into the gallery
 */
export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const r2 = storage();
  if (!r2) return Response.json({ configured: false, error: NOT_SET_UP }, { status: 503, headers: noStore });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  try {
    switch (body?.action) {
      case 'nsfw':
        return Response.json(await markNsfw(r2, id, typeof body.nsfw === 'boolean' ? body.nsfw : null), { headers: noStore });
      case 'keep':
        return Response.json(await keepLabItem(r2, id), { headers: noStore });
      case 'delete':
        return Response.json(await deleteItem(r2, id), { headers: noStore });
      case 'import': {
        const note = await importCloudItem(r2, body);
        return Response.json({ ok: true, id: note.id }, { headers: noStore });
      }
      default:
        return Response.json({ error: 'action must be nsfw, keep, delete or import' }, { status: 400, headers: noStore });
    }
  } catch (err) {
    return failed(err);
  }
}
