'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isWorkspace, PREF_COOKIE, WORKSPACES } from '@/lib/workspaces';

/** Open the chosen workspace; remember it for next sign-in when asked to. */
export async function chooseWorkspace(form: FormData) {
  const target = form.get('target');
  if (!isWorkspace(target)) redirect('/');
  const store = await cookies();
  if (form.get('remember') === 'on') {
    store.set(PREF_COOKIE, target, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    store.delete(PREF_COOKIE);
  }
  redirect(WORKSPACES[target]);
}

/** Forget the remembered workspace so the chooser shows on every sign-in. */
export async function forgetWorkspace() {
  (await cookies()).delete(PREF_COOKIE);
  redirect('/?choose=1');
}
