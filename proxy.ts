import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';
import { MEMBER_COOKIE, verifyMemberToken } from './lib/memberSession';

// Everything except the login page, static assets, the machine-to-site AI endpoint, cloud AI and the status
// endpoint (they check their own tokens) and the watchdog (it can only turn idle machines off) requires a session. The status pill's script is public. The home-screen icons
// and Orbit's web manifest stay public: iOS and browsers fetch them without the session cookie.
export async function proxy(request: NextRequest) {
  const user = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  const path = request.nextUrl.pathname;
  // A studio member reaches only their studio: Orbit's files (the studio is its member edition) and
  // the studio's own API, which checks the member again. Everything else is the owner's.
  const member = await verifyMemberToken(request.cookies.get(MEMBER_COOKIE)?.value);
  if (member) {
    if (path === '/orbit' || path.startsWith('/orbit/') || path.startsWith('/api/studio/')) return NextResponse.next();
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL(`/orbit/?studio=${encodeURIComponent(member.studio)}`, request.url));
  }

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Signed out on a studio's address: that studio's own sign-in page.
  const studio = request.nextUrl.searchParams.get('studio');
  if ((path === '/orbit' || path.startsWith('/orbit/')) && studio && /^[a-z0-9-]{2,40}$/.test(studio)) {
    return NextResponse.redirect(new URL(`/studio/login?studio=${studio}`, request.url));
  }
  const login = new URL('/login', request.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/((?!login|studio/login|api/ai/endpoint|api/orb/ai|api/status|api/watchdog|orbit/island.js|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|orbit/manifest.webmanifest|orbit/icon.svg|orbit/apple-touch-icon.png|orbit/sw.js).*)',
  ],
};
