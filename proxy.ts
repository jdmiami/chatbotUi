import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

// Everything except the login page and static assets requires a session. The home-screen icons
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
    '/((?!login|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|orbit/manifest.webmanifest|orbit/icon.svg|orbit/apple-touch-icon.png).*)',
  ],
};
