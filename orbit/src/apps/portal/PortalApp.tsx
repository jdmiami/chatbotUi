import { useCallback, useEffect, useState, type ComponentType } from 'react';
import type { AppProps } from '../types';
import { AppArt, type ArtId } from '../../ui/AppArt';
import { Icon } from '../../ui/Icon';
import './portal.css';

/**
 * The apps that live on their own full screen (the AI playground, VS Code, the Linux desktop, the
 * Windows PC). Each opens on its own page in Orbit: what it is, which machine it needs and how
 * that machine is, and one button that goes there (and turns the machine on when needed).
 */
type Needs = 'ai' | 'linux' | 'windows';

interface Portal {
  id: ArtId;
  name: string;
  kicker: string;
  dek: string;
  href: string;
  needs: Needs;
  /** What happens when you open it, in one line. */
  note: string;
}

const PORTALS: Record<'playground' | 'vscode' | 'desktop' | 'windows', Portal> = {
  playground: {
    id: 'playground',
    name: 'Playground',
    kicker: 'The full AI playground',
    dek: 'Every knob of your own models: documents, web search, voice, tools and long chats, in Open WebUI.',
    href: '/ai',
    needs: 'ai',
    note: 'Turns your AI machine on if it is resting (about 2–4 minutes); it turns itself off when unused.',
  },
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    kicker: 'The full editor',
    dek: 'VS Code in the browser on your Linux machine, with an AI agent working on your own model.',
    href: '/code',
    needs: 'linux',
    note: 'Opens your projects folder. The AI machine wakes when the agent first needs it.',
  },
  desktop: {
    id: 'desktop',
    name: 'Linux desktop',
    kicker: 'The whole machine',
    dek: 'The full Ubuntu desktop of your Linux machine, with Firefox and every app, right in the browser.',
    href: '/desktop/linux',
    needs: 'linux',
    note: 'Your files and sessions are the same ones Orbit uses.',
  },
  windows: {
    id: 'windows',
    name: 'Windows PC',
    kicker: 'Your computer at home',
    dek: 'Your own Windows PC, through the small gateway program running on it.',
    href: '/desktop/windows',
    needs: 'windows',
    note: 'The PC must be on and running the gateway program.',
  },
};

interface Machine {
  id: 'ai' | 'linux';
  state: string;
  costPerHour: number | null;
}
interface Status {
  machines?: Machine[];
  desktops?: string[];
}

const STATE: Record<string, string> = {
  on: 'On',
  off: 'Resting',
  starting: 'Waking up',
  downloading: 'Getting its models',
  error: 'Needs attention',
  unconfigured: 'Not set up',
  unknown: 'Unknown',
};

function PortalPage({ portal, isActive }: { portal: Portal; isActive: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* offline or a preview without the site */
    }
  }, []);
  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [isActive, refresh]);

  const machine = portal.needs === 'windows' ? null : status?.machines?.find((m) => m.id === portal.needs);
  const ready = portal.needs !== 'windows' || !status?.desktops || status.desktops.includes('windows');
  const machineName = portal.needs === 'ai' ? 'AI machine' : portal.needs === 'linux' ? 'Linux machine' : 'Windows PC';
  const state = machine ? `${STATE[machine.state] ?? machine.state}${machine.state === 'on' && machine.costPerHour ? ` · $${machine.costPerHour.toFixed(2)}/h` : ''}` : null;
  const go = () => window.location.assign(portal.href);

  return (
    <div className="portal" data-app={portal.id}>
      <div className="portal-page">
        <AppArt id={portal.id} size={132} className="portal-art" />
        <p className="portal-kicker">{portal.kicker}</p>
        <h1 className="portal-title">{portal.name}</h1>
        <p className="portal-dek">{portal.dek}</p>
        <dl className="portal-facts">
          <div>
            <dt>Runs on</dt>
            <dd>
              {machineName}
              {state && (
                <span className="portal-state" data-state={machine?.state}>
                  <span className="portal-dot" aria-hidden /> {state}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>When you open it</dt>
            <dd>{ready ? portal.note : 'Not set up yet: install the small gateway program on your PC first.'}</dd>
          </div>
        </dl>
        <div className="portal-actions">
          <button type="button" className="btn primary portal-open" onClick={go} disabled={!ready}>
            Open {portal.name} <Icon name="forward" size={18} />
          </button>
          <a className="portal-newtab" href={portal.href} target="_blank" rel="noopener">
            In a new tab
          </a>
        </div>
        <p className="portal-back">It opens full screen. “Back to Orbit” at its top brings you here again.</p>
      </div>
    </div>
  );
}

function make(key: keyof typeof PORTALS): ComponentType<AppProps> {
  const portal = PORTALS[key];
  const C = ({ isActive }: AppProps) => <PortalPage portal={portal} isActive={isActive} />;
  C.displayName = `Portal(${key})`;
  return C;
}

export const PlaygroundApp = make('playground');
export const VsCodeApp = make('vscode');
export const DesktopApp = make('desktop');
export const WindowsApp = make('windows');
