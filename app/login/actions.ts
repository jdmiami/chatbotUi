'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkCredentials } from '@/lib/auth';
import { SESSION_COOKIE, createSessionToken, sessionMaxAgeSeconds } from '@/lib/session';
import { config } from '@/lib/config';

export type LoginState = { error?: string; username?: string };

// Best-effort brute-force throttle. Serverless instances don't share memory, so also add a
// Vercel Firewall rate-limit rule on /login for real protection (see README).
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const record = failures.get(ip);
  if (record && record.count >= MAX_FAILURES && record.until > now) {
    return { error: 'Too many attempts. Try again in a few minutes.', username: String(form.get('username') ?? '') };
  }

  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');
  const code = String(form.get('code') ?? '');

  if (!(await checkCredentials(username, password, code))) {
    const next = record && record.until > now ? record.count + 1 : 1;
    failures.set(ip, { count: next, until: now + LOCKOUT_MS });
    await new Promise((r) => setTimeout(r, 750));
    return { error: 'Invalid username, password or code.', username };
  }

  failures.delete(ip);
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(config.username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: sessionMaxAgeSeconds(),
  });
  redirect('/desktop');
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
