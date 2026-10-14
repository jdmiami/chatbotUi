'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const WORKSPACES = {
  orbit: '/orbit/',
  linux: '/desktop/linux',
  windows: '/desktop/windows',
} as const;
export type WorkspaceId = keyof typeof WORKSPACES;
export const PREF_COOKIE = 'ws_pref';

/** Open the chosen workspace; remember it for next sign-in when asked to. */
export async function chooseWorkspace(form: FormData) {
  const target = String(form.get('target') ?? '') as WorkspaceId;
  if (!(target in WORKSPACES)) redirect('/');
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
