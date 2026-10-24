import { currentUser } from '@/lib/auth';
import { createR2, r2Config } from '@/lib/r2';
import { listCharacters } from '@/lib/characters';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };
/** Said plainly when the site has no storage keys yet (nothing else about them is ever said). */
const NOT_SET_UP = 'Your characters show here with the machine off once storage keys are added.';

/**
 * Every character kept in cloud storage, with short-lived links to their sheet pictures:
 * { configured, characters }. Read only: making and changing characters needs the AI machine.
 */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const conf = r2Config();
  if (!conf) return Response.json({ configured: false, characters: [], message: NOT_SET_UP }, { headers: noStore });
  try {
    return Response.json({ configured: true, characters: await listCharacters(createR2(conf)) }, { headers: noStore });
  } catch {
    return Response.json({ error: 'Could not reach your stored characters. Try again in a moment.' }, { status: 502, headers: noStore });
  }
}
