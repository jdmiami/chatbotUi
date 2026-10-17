import { useEffect, useRef, useState } from 'react';
import { APPS } from '../../apps/registry';
import { connection } from '../../services';
import { getLocalAi, type AiMachineStatus } from '../../services/ai/LocalAi';
import { useShell, type AppId } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { useScrollDepth } from './depth';

const greeting = (h: number) => (h < 5 ? 'Good night.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.');
const AI_STATE: Record<AiMachineStatus['state'], string> = {
  unconfigured: 'not set up yet',
  off: 'resting',
  starting: 'waking up',
  downloading: 'getting its models',
  on: 'awake',
  error: 'in trouble',
};

/** One line of the path: a big quiet link. */
function Go({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="o5-go" onClick={onClick}>
        <span className="o5-go-label">{label}</span>
        {hint && <span className="o5-go-hint">{hint}</span>}
        <Icon name="forward" size={20} />
      </button>
    </li>
  );
}

function Chapter({ n, id, title, dek, children }: { n: string; id: string; title: string; dek: string; children: React.ReactNode }) {
  return (
    <section className="o5-spread" id={id} data-depth aria-labelledby={`${id}-t`}>
      <span className="o5-numeral" aria-hidden>
        {n}
      </span>
      <div className="o5-page">
        <p className="o5-kicker">
          {n} <span aria-hidden>—</span> {title}
        </p>
        <h2 className="o5-display" id={`${id}-t`}>
          {title}
        </h2>
        <p className="o5-dek">{dek}</p>
        <ul className="o5-links">{children}</ul>
      </div>
    </section>
  );
}

/**
 * Orbit 0.5's home: one walk through everything, page by page, like a magazine. Each chapter is
 * a single idea with a few big links; pages sink back as they scroll away.
 */
export function Path({ hidden }: { hidden: boolean }) {
  const { launch, openApps, updateSettings } = useShell();
  const { recentFiles, recentSessions, summaries, sendIntent } = useWorkspace();
  const [ai, setAi] = useState<AiMachineStatus | null>(null);
  const scroller = useRef<HTMLElement>(null);
  useScrollDepth(scroller, !hidden);

  useEffect(() => {
    if (hidden) return;
    let live = true;
    getLocalAi()
      .status()
      .then((s) => live && setAi(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hidden]);

  const now = new Date();
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const linux = connection.mode === 'host' ? 'Your Linux machine is connected' : 'You are in the demo workspace';
  const aiLine = ai && ai.state !== 'unconfigured' ? `; your AI machine is ${AI_STATE[ai.state]}${ai.state === 'on' && ai.costPerHour ? ` ($${ai.costPerHour.toFixed(2)}/h)` : ''}.` : '.';
  const last: AppId | undefined = openApps[0];
  const file = recentFiles[0];
  const session = recentSessions[0];
  const toChapter = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main ref={scroller} className="o5-path" data-hidden={hidden} aria-hidden={hidden} inert={hidden || undefined} aria-label="Home">
      <section className="o5-spread o5-cover" data-depth aria-labelledby="o5-hello">
        <div className="o5-page">
          <p className="o5-kicker">Orbit 0.5 · {date}</p>
          <h1 className="o5-display o5-hero" id="o5-hello">
            {greeting(now.getHours())}
          </h1>
          <p className="o5-dek">
            {linux}
            {aiLine}
          </p>
          <button type="button" className="o5-cue" onClick={() => toChapter('o5-continue')}>
            Begin <Icon name="down" size={18} />
          </button>
        </div>
      </section>

      <Chapter n="01" id="o5-continue" title="Continue" dek={last || file || session ? 'Pick up exactly where you left off.' : 'Nothing open yet. Your path starts with the next page.'}>
        {last && <Go label={APPS[last].name} hint={summaries[last] || 'Still open'} onClick={() => launch(last)} />}
        {file && (
          <Go
            label={file.path.split('/').pop() ?? file.path}
            hint="Last file in Code"
            onClick={() => {
              sendIntent({ app: 'editor', type: 'open-file', path: file.path });
              launch('editor');
            }}
          />
        )}
        {session && (
          <Go
            label={session.title}
            hint={`Antigravity · ${session.projectName}`}
            onClick={() => {
              sendIntent({ app: 'agent', type: 'open-session', sessionId: session.id });
              launch('agent');
            }}
          />
        )}
        {!last && !file && !session && <Go label="Start talking" hint="Chapter 02" onClick={() => toChapter('o5-talk')} />}
      </Chapter>

      <Chapter n="02" id="o5-talk" title="Talk" dek="Your own open models, on your own GPU. Ask, think out loud, search the web, speak.">
        <Go label="Open a conversation" hint={ai ? `AI machine ${AI_STATE[ai.state]}` : undefined} onClick={() => launch('ai')} />
        <Go label="Antigravity" hint="The coding agent on your Linux machine" onClick={() => launch('agent')} />
      </Chapter>

      <Chapter n="03" id="o5-make" title="Make" dek="Pictures, videos, and whole films shot by shot, each one picking up from the last frame.">
        <Go label="soReal" hint="Movies, shot by shot" onClick={() => launch('soreal')} />
        <Go label="Images & video" hint="In the AI app, under Create" onClick={() => launch('ai')} />
      </Chapter>

      <Chapter n="04" id="o5-build" title="Build" dek="Code and a real shell on your Linux machine. Everything keeps running while you're away.">
        <Go label="Code" hint="Your projects" onClick={() => launch('editor')} />
        <Go label="Terminal" hint="A shell that stays open" onClick={() => launch('terminal')} />
      </Chapter>

      <Chapter n="05" id="o5-tune" title="Tune" dek="Make it yours, or go back to the classic look at any time.">
        <Go label="Settings" hint="Theme, motion, text size" onClick={() => launch('settings')} />
        <Go label="Classic look" hint="Icons, dock and tiles" onClick={() => updateSettings({ skin: 'classic' })} />
      </Chapter>

      <footer className="o5-colophon">
        <p>That's everything. The line at the bottom of the screen opens the index from anywhere.</p>
      </footer>
    </main>
  );
}
