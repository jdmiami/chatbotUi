import 'server-only';

/** CSRF defence for state-changing routes, on top of the SameSite=Strict session cookie. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older Safari may omit it; cookie is SameSite=Strict
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}
