// Auth for the Orbit host API. Every request must carry a short-lived token minted by the
// signed-in web app (POST /api/orbit/session), signed with the same secret as the gateway.
import { jwtVerify } from 'jose';

export async function verifyOrbitToken(token, secret) {
  if (!token) throw Object.assign(new Error('Missing token'), { status: 401 });
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      audience: 'orbit-host',
      issuer: 'rdp-web',
      // The site issues 1-hour tokens; refuse tokens without an expiry or older than that.
      requiredClaims: ['exp', 'iat'],
      maxTokenAge: '65m',
    });
    return payload;
  } catch {
    throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
  }
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** CORS for the web app's origins only. Returns false when the origin is not allowed. */
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, health checks)
  if (allowedOrigins.length && !allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}
