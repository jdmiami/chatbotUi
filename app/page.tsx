import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * After sign-in everything is in Orbit: the playground, VS Code and the desktops are apps inside it,
 * so the site's front door goes straight there.
 */
export default async function Home() {
  redirect((await currentUser()) ? '/orbit' : '/login');
}
