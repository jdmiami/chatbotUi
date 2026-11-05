import { redirect } from 'next/navigation';
import { currentUser, totpEnabled } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

/** Where to go after signing in: a page of this site only (the fast Make page asks for /lite). */
function safeNext(v: string | string[] | undefined): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/[a-z0-9/_-]*$/i.test(s) && !s.startsWith('//') ? s : '/';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <main className="center">
      <LoginForm needsCode={totpEnabled()} next={next} />
    </main>
  );
}
