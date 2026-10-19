import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import AiLauncher from '../ai/AiLauncher';
import Island from '@/app/Island';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Code · Orbit' };

export default async function CodePage() {
  if (!(await currentUser())) redirect('/login');
  return (
    <>
      <Island />
      <AiLauncher target="code" />
    </>
  );
}
