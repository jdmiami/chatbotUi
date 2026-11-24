import { currentUser } from '@/lib/auth';
import { UI_COOKIE, uiHome, type UiChoice } from '@/lib/uiChoice';

export const dynamic = 'force-dynamic';

/**
 * The first page's choice: ?ui=orbit or ?ui=simple remembers it (a year, this browser) and opens it;
 * ?ui=ask forgets it and shows the choice again.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await currentUser())) return Response.redirect(new URL('/login', url), 303);
  const ui = url.searchParams.get('ui');
  const headers = new Headers({ 'cache-control': 'private, no-store' });
  if (ui === 'orbit' || ui === 'simple') {
    headers.append('set-cookie', `${UI_COOKIE}=${ui}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
    headers.set('location', new URL(uiHome(ui as UiChoice), url).toString());
  } else {
    headers.append('set-cookie', `${UI_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
    headers.set('location', new URL('/', url).toString());
  }
  return new Response(null, { status: 303, headers });
}
