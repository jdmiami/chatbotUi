'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkMember } from '@/lib/members';
import { MEMBER_COOKIE, createMemberToken, memberMaxAgeSeconds } from '@/lib/memberSession';
import { studioName } from './studios';

export type MemberLoginState = { error?: string; username?: string };

// Best-effort throttle per address (serverless instances don't share memory; see README for the
// Vercel Firewall rule that does this for real).
const failures = new Map<string, { count: number; until: number }>();

export async function memberLogin(_prev: MemberLoginState, form: FormData): Promise<MemberLoginState> {
  const studio = String(form.get('studio') ?? '');
  const username = String(form.get('username') ?? '');
  if (!studioName(studio)) return { error: 'This studio does not exist.', username };
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const record = failures.get(ip);
  if (record && record.count >= 5 && record.until > now) return { error: 'Too many attempts. Try again in a few minutes.', username };

  const member = await checkMember(username, String(form.get('password') ?? ''), studio);
  if (!member) {
    failures.set(ip, { count: record && record.until > now ? record.count + 1 : 1, until: now + 15 * 60_000 });
    await new Promise((r) => setTimeout(r, 750));
    return { error: 'Wrong username or password.', username };
  }
  failures.delete(ip);
  (await cookies()).set(MEMBER_COOKIE, await createMemberToken(member), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: memberMaxAgeSeconds(),
  });
  redirect(`/orbit/?studio=${encodeURIComponent(member.studio)}`);
}

export async function memberLogout(form: FormData) {
  (await cookies()).delete(MEMBER_COOKIE);
  redirect(`/studio/login?studio=${encodeURIComponent(String(form.get('studio') ?? ''))}`);
}
