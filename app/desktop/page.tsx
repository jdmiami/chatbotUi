import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { logout } from '../login/actions';
import RemoteDesktop from './RemoteDesktop';

export const dynamic = 'force-dynamic';

export default async function DesktopPage() {
  if (!(await currentUser())) redirect('/login');
  return <RemoteDesktop logout={logout} />;
}
