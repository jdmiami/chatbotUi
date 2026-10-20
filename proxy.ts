import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

// Everything except the login page, static assets, the machine-to-site AI endpoint, cloud AI and the status
// endpoint (they check their own tokens) and the watchdog (it can only turn idle machines off) requires a session. The status pill's script is public. The home-screen icons
// and Orbit's web manifest stay public: iOS and browsers fetch them without the session cookie.
export async function proxy(request: NextRequest) {
  const user = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/((?!login|api/ai/endpoint|api/orb/ai|api/status|api/watchdog|orbit/island.js|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|orbit/manifest.webmanifest|orbit/icon.svg|orbit/apple-touch-icon.png|orbit/sw.js).*)',
  ],
};
