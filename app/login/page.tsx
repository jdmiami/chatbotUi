import { redirect } from 'next/navigation';
import { currentUser, totpEnabled } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/desktop');
  return (
    <main className="center">
      <LoginForm needsCode={totpEnabled()} />
    </main>
  );
}
