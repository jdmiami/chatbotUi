import { currentUser } from '@/lib/auth';
import { liteMakePage } from '@/lib/liteMake';

export const dynamic = 'force-dynamic';

const PAGE = liteMakePage();

/**
 * The fast Make page: plain HTML in one response (lib/liteMake.ts), no Orbit, no orb. Signed in
 * only (it can turn on paid machines): otherwise to the sign-in page, which comes back here.
 */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.redirect(new URL('/login?next=/lite', request.url), 303);
  return new Response(PAGE, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
    },
  });
}
