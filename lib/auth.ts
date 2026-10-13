import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { TOTP, Secret } from 'otpauth';
import { cookies } from 'next/headers';
import { config } from './config';
import { SESSION_COOKIE, verifySessionToken } from './session';

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function totpEnabled() {
  return Boolean(config.totpSecret);
}

export async function checkCredentials(username: string, password: string, code: string) {
  // Always run bcrypt so a wrong username takes as long as a wrong password.
  const passwordOk = await bcrypt.compare(password, config.passwordHash);
  const userOk = safeEqual(username.trim().toLowerCase(), config.username.toLowerCase());
  if (!passwordOk || !userOk) return false;

  if (totpEnabled()) {
    const totp = new TOTP({ secret: Secret.fromBase32(config.totpSecret), digits: 6, period: 30 });
    if (totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) === null) return false;
  }
  return true;
}

/** Username of the logged-in user, or null. Use in server components and route handlers. */
export async function currentUser() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
