import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import AiLauncher from '../ai/AiLauncher';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coding · My Workspace' };

export default async function CodePage() {
  if (!(await currentUser())) redirect('/login');
  return <AiLauncher target="code" />;
}
