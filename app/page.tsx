import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { listMachines } from '@/lib/machines';
import { machineStatus } from '@/lib/runpod';
import { logout } from './login/actions';
import { chooseWorkspace, forgetWorkspace } from './choose/actions';
import { isWorkspace, PREF_COOKIE, WORKSPACES, type WorkspaceId } from '@/lib/workspaces';
import MachinePanel from './MachinePanel';
import AiPanel from './AiPanel';
import Island from '@/app/Island';

export const dynamic = 'force-dynamic';

const OPTIONS: { id: WorkspaceId; name: string; detail: string; needs: 'linux' | 'windows' | 'ai' }[] = [
  { id: 'orbit', name: 'Orbit', detail: 'iPhone & iPad workspace: Terminal, Code and Antigravity', needs: 'linux' },
  { id: 'ai', name: 'AI playground', detail: 'Chat with your own open models: documents, web search, voice, code', needs: 'ai' },
  { id: 'code', name: 'Code with AI', detail: 'VS Code in the browser with an AI agent on your own model', needs: 'linux' },
  { id: 'linux', name: 'Linux desktop', detail: 'The full Ubuntu desktop', needs: 'linux' },
  { id: 'windows', name: 'Windows PC', detail: 'Your own computer at home', needs: 'windows' },
];

function Icon({ id }: { id: WorkspaceId }) {
  if (id === 'ai')
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3l2.2 5.3L20 10.5l-5.8 2.2L12 18l-2.2-5.3L4 10.5l5.8-2.2z" fill="currentColor" />
        <circle cx="19" cy="19" r="2" fill="currentColor" />
      </svg>
    );
  if (id === 'code')
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.5 4.5l-3 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  if (id === 'windows')
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
      </svg>
    );
  if (id === 'linux')
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10" stroke="currentColor" strokeWidth="2" />
        <path d="M2 19h20M8 9l3 3-3 3M13 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
      <ellipse cx="32" cy="32" rx="24" ry="10" fill="none" stroke="currentColor" strokeWidth="4" transform="rotate(-25 32 32)" />
      <circle cx="32" cy="32" r="9" fill="currentColor" />
      <circle cx="52" cy="20" r="4" fill="currentColor" />
    </svg>
  );
}

/** After sign-in: pick a workspace (or go straight to the remembered one). */
export default async function Home({ searchParams }: { searchParams: Promise<{ choose?: string }> }) {
  if (!(await currentUser())) redirect('/login');
  const { choose } = await searchParams;
  const pref = (await cookies()).get(PREF_COOKIE)?.value;
  const machines = listMachines().map((m) => m.id);
  const ready = (o: (typeof OPTIONS)[number]) => o.needs !== 'windows' || machines.includes('windows');
  const remembered = OPTIONS.find((o) => o.id === pref);
  if (isWorkspace(pref) && remembered && ready(remembered) && !choose) redirect(WORKSPACES[pref]);

  const status = await machineStatus();

  return (
    <main className="center">
      <Island />
      <div className="card chooser">
        <h1>Choose your workspace</h1>
        <form action={chooseWorkspace} className="stack-form">
          <div className="choices" role="group" aria-label="Workspaces">
            {OPTIONS.map((o) =>
              ready(o) ? (
                <button key={o.id} type="submit" name="target" value={o.id} className={`choice choice-${o.id}`}>
                  <span className="choice-icon">
                    <Icon id={o.id} />
                  </span>
                  <span className="choice-text">
                    <span className="choice-name">{o.name}</span>
                    <span className="choice-detail">{o.detail}</span>
                    {o.needs === 'linux' && <span className="choice-needs">Needs the Linux machine on</span>}
                    {o.needs === 'ai' && <span className="choice-ai-note">Turns on its own GPU machine ($0.59/hour, off when unused)</span>}
                  </span>
                  <span className="chevron" aria-hidden>
                    ›
                  </span>
                </button>
              ) : (
                <div key={o.id} className={`choice choice-${o.id} choice-off`} aria-disabled="true">
                  <span className="choice-icon">
                    <Icon id={o.id} />
                  </span>
                  <span className="choice-text">
                    <span className="choice-name">{o.name}</span>
                    <span className="choice-detail">Not set up yet: needs the small gateway program on your PC.</span>
                  </span>
                </div>
              ),
            )}
          </div>
          <label className="remember">
            <input key={pref ?? 'none'} type="checkbox" name="remember" defaultChecked={Boolean(pref)} />
            Remember my choice and open it when I sign in
          </label>
        </form>

        <MachinePanel initial={status} />
        <AiPanel />

        <div className="row footer-row">
          {pref && (
            <form action={forgetWorkspace}>
              <button type="submit" className="secondary">
                Always ask
              </button>
            </form>
          )}
          <form action={logout}>
            <button type="submit" className="secondary">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
