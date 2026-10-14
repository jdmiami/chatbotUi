import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { listMachines } from '@/lib/machines';
import { logout } from '../login/actions';

export const dynamic = 'force-dynamic';

function OsIcon({ os }: { os: 'windows' | 'linux' }) {
  if (os === 'windows') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
      </svg>
    );
  }
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10" stroke="currentColor" strokeWidth="2" />
      <path d="M2 19h20M8 9l3 3-3 3M13 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function MachinesPage() {
  if (!(await currentUser())) redirect('/login');
  const machines = listMachines();
  if (machines.length === 1) redirect(`/desktop/${machines[0].id}`);

  return (
    <main className="center">
      <div className="card machines">
        <h1>Choose a computer</h1>
        {machines.length === 0 && (
          <p className="muted">No computers are configured yet. Add a gateway in the Vercel environment variables.</p>
        )}
        {machines.map((m) => (
          <Link key={m.id} href={`/desktop/${m.id}`} className="machine">
            <OsIcon os={m.os} />
            <span>{m.name}</span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        ))}
        <form action={logout}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
