import type { Capability, Project, SessionSummary } from '../../services/runner/types';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/components';
import { relativeTime } from '../../ui/format';
import { Picker } from './Composer';
import { InlineText } from './Transcript';
import { statusLabel, statusTone } from './model';

export type Loadable<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export function ErrorBanner({
  title,
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="ag-error" role="alert">
      <Icon name="alert" size={18} />
      <div className="ag-error-body">
        <strong>{title}</strong>
        <span className="ag-error-msg">{message}</span>
      </div>
      {onRetry && (
        <button type="button" className="btn ghost ag-error-btn" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="ag-skel-list" aria-busy="true" aria-label="Loading sessions">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ag-skel-row">
          <span className="ag-skel" style={{ width: `${70 - i * 9}%` }} />
          <span className="ag-skel ag-skel-sm" style={{ width: `${40 + i * 6}%` }} />
        </div>
      ))}
    </div>
  );
}

export function SessionRow({
  session,
  selected,
  hasDraft,
  now,
  onOpen,
  onOptions,
}: {
  session: SessionSummary;
  selected: boolean;
  hasDraft: boolean;
  now: number;
  onOpen: () => void;
  onOptions: () => void;
}) {
  const tone = statusTone(session);
  return (
    <li className="ag-session" data-selected={selected || undefined}>
      <button type="button" className="ag-session-open" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <span className="ag-session-title">{session.title}</span>
        <span className="ag-session-meta">
          <span className="ag-badge" data-tone={tone}>
            {tone === 'running' && <span className="ag-pulse" aria-hidden />}
            {statusLabel(session)}
          </span>
          {session.conversationId && (
            <span className="ag-badge" data-tone="resumable">
              Resumable
            </span>
          )}
          {hasDraft && (
            <span className="ag-badge" data-tone="draft">
              Draft
            </span>
          )}
          <span className="ag-session-time">{relativeTime(session.updatedAt, now)}</span>
        </span>
      </button>
      <button
        type="button"
        className="icon-btn ag-session-more"
        aria-label={`Session info and actions for ${session.title}`}
        title="Session info"
        onClick={onOptions}
      >
        <Icon name="more" />
      </button>
    </li>
  );
}

export interface SidebarProps {
  projects: Loadable<Project[]>;
  projectId: string | null;
  onProject: (id: string) => void;
  onRetryProjects: () => void;
  sessions: Loadable<SessionSummary[]>;
  onRetrySessions: () => void;
  selectedId: string | null;
  onOpen: (s: SessionSummary) => void;
  onOptions: (s: SessionSummary) => void;
  onNew: () => void;
  newCap: Capability;
  drafts: Record<string, string>;
  now: number;
  demo: boolean;
}

/** Project picker and the project's sessions (stacked "list" screen on phones, sidebar on wide panes). */
export function Sidebar({
  projects,
  projectId,
  onProject,
  onRetryProjects,
  sessions,
  onRetrySessions,
  selectedId,
  onOpen,
  onOptions,
  onNew,
  newCap,
  drafts,
  now,
  demo,
}: SidebarProps) {
  const o5 = useShell((s) => s.settings.skin === 'o5');
  const projectName =
    projects.status === 'ready' ? (projects.data.find((p) => p.id === projectId)?.name ?? '') : '';
  const newButton =
    newCap.status === 'unverified' ? null : (
      <button
        type="button"
        className="btn primary ag-new"
        onClick={onNew}
        disabled={newCap.status !== 'supported' || projects.status !== 'ready' || !projectId}
        aria-label="New session"
      >
        <Icon name="plus" size={18} strokeWidth={2.4} />
        <span className="ag-new-text">New</span>
      </button>
    );

  return (
    <aside className="ag-sidebar" aria-label="Projects and sessions">
      {o5 && (
        <header className="o5-gallery-head ag-o5-head">
          <p className="o5-kicker">Antigravity</p>
          <h2 className="o5-chapter-title">Your sessions</h2>
        </header>
      )}
      <div className="ag-side-head">
        {projects.status === 'ready' && projects.data.length > 0 ? (
          <Picker label="Project" value={projectId ?? ''} onChange={onProject} className="ag-project ag-pick-stacked">
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Picker>
        ) : (
          <div className="ag-pick ag-project ag-pick-stacked ag-pick-placeholder" aria-hidden>
            <span className="ag-pick-label">Project</span>
            {projects.status === 'loading' && <span className="ag-skel ag-skel-sm" style={{ width: '50%' }} />}
          </div>
        )}
        {newButton}
      </div>
      {newCap.status === 'unsupported' && (
        <p className="ag-capnote ag-side-note">
          <InlineText text={`New sessions aren’t available: ${newCap.note}`} />
        </p>
      )}

      <div className="ag-side-list">
        {projects.status === 'error' ? (
          <ErrorBanner title="Couldn’t load projects" message={projects.message} onRetry={onRetryProjects} />
        ) : projects.status === 'ready' && projects.data.length === 0 ? (
          <EmptyState icon="folder" title="No projects">
            Antigravity sessions belong to a project folder. None were found.
          </EmptyState>
        ) : projects.status === 'loading' || sessions.status === 'loading' ? (
          <ListSkeleton />
        ) : sessions.status === 'error' ? (
          <ErrorBanner title="Couldn’t load sessions" message={sessions.message} onRetry={onRetrySessions} />
        ) : sessions.data.length === 0 ? (
          <EmptyState
            icon="sparkle"
            title="Start a session"
            action={
              newCap.status === 'supported' ? (
                <button type="button" className="btn primary" onClick={onNew}>
                  <Icon name="plus" size={18} />
                  New session
                </button>
              ) : undefined
            }
          >
            {`No sessions in ${projectName || 'this project'} yet. A session is one Antigravity conversation.`}
          </EmptyState>
        ) : (
          <ul className="ag-sessions" aria-label={`Sessions in ${projectName}`}>
            {sessions.data.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selected={s.id === selectedId}
                hasDraft={!!drafts[s.id]?.trim()}
                now={now}
                onOpen={() => onOpen(s)}
                onOptions={() => onOptions(s)}
              />
            ))}
          </ul>
        )}
      </div>
      {demo && <p className="ag-side-foot">Sample sessions, kept in this browser.</p>}
    </aside>
  );
}
