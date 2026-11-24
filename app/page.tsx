import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { UI_COOKIE, uiChoice, uiHome } from '@/lib/uiChoice';
import styles from './choose.module.css';

export const dynamic = 'force-dynamic';

/**
 * The front door: pick Orbit (everything, the full look) or Simple (the light one: Make, Lab, AI
 * Center, Gallery). The choice is remembered on this browser; either one has a way back here.
 */
export default async function Home() {
  if (!(await currentUser())) redirect('/login');
  const chosen = uiChoice((await cookies()).get(UI_COOKIE)?.value);
  if (chosen) redirect(uiHome(chosen));
  return (
    <main className={styles.page}>
      <p className={styles.kick}>Welcome back</p>
      <h1 className={styles.title}>How do you want to work?</h1>
      <div className={styles.choices}>
        <a className={styles.choice} href="/choose?ui=simple">
          <span className={styles.name}>Simple</span>
          <span className={styles.what}>Make, Lab, AI Center and Gallery. Light and quick on a phone.</span>
        </a>
        <a className={styles.choice} href="/choose?ui=orbit">
          <span className={styles.name}>Orbit</span>
          <span className={styles.what}>Everything: every app, the orb, desktops and code.</span>
        </a>
      </div>
      <p className={styles.note}>Remembered on this device. Switch any time from the top of either one.</p>
    </main>
  );
}
