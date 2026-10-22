import 'server-only';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { MEMBER_COOKIE, verifyMemberToken, type Member } from './memberSession';

interface Account {
  user: string;
  hash: string;
  studio: string;
}

/** Member accounts, from STUDIO_MEMBERS: [{ "user", "hash" (bcrypt), "studio" }]. Free test users for now. */
function accounts(): Account[] {
  try {
    const list = JSON.parse(process.env.STUDIO_MEMBERS || '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (a): a is Account => !!a && typeof a.user === 'string' && typeof a.hash === 'string' && typeof a.studio === 'string',
    );
  } catch {
    return [];
  }
}

// A real hash of a random string: a wrong username takes as long as a wrong password.
const DUMMY = '$2b$10$wjVRQJLbSkqjlL0JrZP4Ju3NA9U6rnMIRe3AcTsYxIt7qWSpcR6Tq';

export async function checkMember(user: string, password: string, studio: string): Promise<Member | null> {
  const name = user.trim().toLowerCase();
  const account = accounts().find((a) => a.user.toLowerCase() === name && a.studio === studio);
  const ok = await bcrypt.compare(password, account?.hash ?? DUMMY);
  return account && ok ? { user: account.user, studio: account.studio } : null;
}

/** The signed-in member, or null. */
export async function currentMember(): Promise<Member | null> {
  const store = await cookies();
  return verifyMemberToken(store.get(MEMBER_COOKIE)?.value);
}
