import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import AiLauncher from './AiLauncher';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI playground · My Workspace' };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await currentUser())) redirect('/login');
  const { next } = await searchParams;
  return <AiLauncher target="chat" next={typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : undefined} />;
}
