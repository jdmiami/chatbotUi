import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getMachine, listMachines } from '@/lib/machines';
import { logout } from '../../login/actions';
import RemoteDesktop from './RemoteDesktop';

export const dynamic = 'force-dynamic';

export default async function DesktopPage({ params }: { params: Promise<{ machine: string }> }) {
  if (!(await currentUser())) redirect('/login');
  const machine = getMachine((await params).machine);
  if (!machine) notFound();
  return <RemoteDesktop machine={machine} canSwitch logout={logout} />;
}
