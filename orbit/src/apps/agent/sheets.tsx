import { useEffect, useId, useState } from 'react';
import type {
  CapabilityStatus,
  Project,
  RunnerCapabilities,
  RunnerMode,
  SessionSummary,
} from '../../services/runner/types';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/components';
import { relativeTime } from '../../ui/format';
import { ModelOptions, ModelsProblem, Picker, type ModelsState } from './Composer';
import { InlineText } from './Transcript';
import {
  CAPABILITY_LABELS,
  CAPABILITY_ORDER,
  MODES,
  MODE_LABELS,
  STATUS_HEADINGS,
  errorMessage,
  formatDateTime,
  groupCapabilities,
  statusLabel,
  statusTone,
} from './model';

const STATUS_CHIP: Record<CapabilityStatus, { cls: string; text: string; icon: 'check' | 'close' | 'info' }> = {
  supported: { cls: 'ok', text: 'Supported', icon: 'check' },
  unsupported: { cls: 'error', text: 'Not supported', icon: 'close' },
  unverified: { cls: '', text: 'Not verified', icon: 'info' },
};

function CapChip({ status }: { status: CapabilityStatus }) {
  const c = STATUS_CHIP[status];
  return (
    <span className={`chip ${c.cls} ag-capchip`}>
      <Icon name={c.icon} size={14} />
      {c.text}
    </span>
  );
}

/** "What's supported": the runner's capability matrix, grouped by status. */
export function CapabilitiesSheet({
  caps,
  runnerLabel,
  demo,
  onClose,
}: {
  caps: RunnerCapabilities;
  runnerLabel: string;
  demo: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet title="What's supported" onClose={onClose}>
      <div className="stack">
        <p className="ag-sheet-lead">
          <strong>{runnerLabel}</strong>
          <br />
          {demo
            ? 'Demo mode shows the same controls as the real Antigravity CLI, but replies are canned and nothing runs.'
            : 'These are the Antigravity CLI (agy) features Orbit has verified on your Linux machine.'}
        </p>
        {groupCapabilities(caps).map((group) => (
          <section key={group.status} aria-labelledby={`cap-${group.status}`}>
            <h3 className="list-title ag-cap-heading" id={`cap-${group.status}`}>
              {STATUS_HEADINGS[group.status].title}
            </h3>
            <p className="list-caption ag-cap-caption">{STATUS_HEADINGS[group.status].caption}</p>
            <ul className="list ag-caplist">
              {group.items.map(({ key, label, cap }) => (
                <li key={key} className="ag-caprow">
                  <div className="ag-caprow-top">
                    <span className="ag-caprow-label">{label}</span>
                    <CapChip status={cap.status} />
                  </div>
                  <p className="ag-caprow-note">
                    <InlineText text={cap.note} />
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** Status, timestamps, conversation id and how follow-ups continue, plus Rename / Delete. */
export function SessionInfoSheet({
  session,
  projectName,
  caps,
  demo,
  now,
  onRename,
  onDelete,
  onClose,
}: {
  session: SessionSummary;
  projectName: string;
  caps: RunnerCapabilities;
  demo: boolean;
  now: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const followUps = !session.conversationId
    ? caps.continueConversation.status === 'supported'
      ? 'After the first reply, follow-ups continue the same conversation with `--conversation <id>`.'
      : `Follow-ups can’t continue a conversation: ${caps.continueConversation.note}`
    : caps.continueConversation.status === 'supported'
      ? `Yes. Follow-ups continue it with \`--conversation ${session.conversationId}\`.`
      : `No. ${caps.continueConversation.note}`;
  return (
    <Sheet title="Session info" onClose={onClose}>
      <div className="stack">
        <div>
          <h3 className="ag-info-title">{session.title}</h3>
          <p className="muted ag-info-sub">
            {projectName}
            {demo ? ' · sample data in this browser' : ' · stored on your Linux machine'}
          </p>
        </div>
        <div className="ag-sheet-actions ag-sheet-actions-start">
          <button type="button" className="btn ghost" onClick={onRename}>
            <Icon name="pencil" size={18} />
            Rename
          </button>
          <button type="button" className="btn danger" onClick={onDelete}>
            <Icon name="trash" size={18} />
            Delete
          </button>
        </div>
        <dl className="ag-dl">
          <div>
            <dt>Status</dt>
            <dd>
              <span className="ag-badge" data-tone={statusTone(session)}>
                {statusLabel(session)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              {formatDateTime(session.createdAt)} <span className="muted">({relativeTime(session.createdAt, now)})</span>
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              {formatDateTime(session.updatedAt)} <span className="muted">({relativeTime(session.updatedAt, now)})</span>
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{session.messageCount}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{MODE_LABELS[session.mode] ?? session.mode}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{session.model ?? 'Default (agy decides)'}</dd>
          </div>
          <div>
            <dt>Conversation</dt>
            <dd>
              {session.conversationId ? (
                <code className="ag-inline-code ag-wrap">{session.conversationId}</code>
              ) : (
                'Not started — the first message starts a new conversation'
              )}
            </dd>
          </div>
          <div>
            <dt>Follow-ups</dt>
            <dd>
              <InlineText text={followUps} />
            </dd>
          </div>
        </dl>

        <section aria-labelledby="ag-info-caps">
          <h3 className="list-title ag-cap-heading" id="ag-info-caps">
            Runner capabilities
          </h3>
          <ul className="list ag-caplist">
            {CAPABILITY_ORDER.map((key) => (
              <li key={key} className="ag-caprow ag-caprow-compact">
                <div className="ag-caprow-top">
                  <span className="ag-caprow-label">{CAPABILITY_LABELS[key]}</span>
                  <CapChip status={caps[key].status} />
                </div>
              </li>
            ))}
          </ul>
        </section>

      </div>
    </Sheet>
  );
}

export interface NewSessionValues {
  title: string;
  projectId: string;
  mode: RunnerMode;
  model: string;
}

/** New session: title, project, mode, model. "Starts a new Antigravity conversation." */
export function NewSessionSheet({
  projects,
  initialProjectId,
  caps,
  models,
  modelsNote,
  hostMode,
  onLoadModels,
  onOpenTerminal,
  onCreate,
  onClose,
}: {
  projects: Project[];
  initialProjectId: string | null;
  caps: RunnerCapabilities;
  models: ModelsState;
  modelsNote?: string;
  hostMode: boolean;
  onLoadModels: () => void;
  onOpenTerminal: () => void;
  onCreate: (values: NewSessionValues) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const errId = useId();
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [mode, setMode] = useState<RunnerMode>('default');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (models.status === 'idle' && caps.models.status === 'supported') onLoadModels();
  }, [models.status, caps.models.status, onLoadModels]);

  const submit = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), projectId, mode, model });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title="New session" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="ag-sheet-lead">
          Starts a new Antigravity conversation.{' '}
          <span className="muted">
            <InlineText text={caps.newConversation.note} />
          </span>
        </p>
        <div className="ag-field">
          <label htmlFor={titleId}>Title</label>
          <input
            id={titleId}
            className="ag-text-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New session"
            maxLength={120}
            autoComplete="off"
          />
        </div>
        <Picker label="Project" value={projectId} onChange={setProjectId} className="ag-pick-block">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Picker>
        {caps.modes.status !== 'unverified' && (
          <>
            <Picker
              label="Mode"
              value={mode}
              onChange={(v) => setMode(v as RunnerMode)}
              disabled={caps.modes.status !== 'supported'}
              className="ag-pick-block"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Picker>
            {caps.modes.status === 'unsupported' && (
              <p className="ag-capnote">
                <InlineText text={caps.modes.note} />
              </p>
            )}
          </>
        )}
        {caps.models.status !== 'unverified' && (
          <>
            <Picker
              label="Model"
              value={model}
              onChange={setModel}
              disabled={caps.models.status !== 'supported'}
              className="ag-pick-block"
            >
              <ModelOptions models={models} current={model || undefined} note={modelsNote} />
            </Picker>
            {modelsNote && (
              <p className="ag-capnote">
                <InlineText text={modelsNote} />
              </p>
            )}
            {caps.models.status === 'unsupported' && (
              <p className="ag-capnote">
                <InlineText text={caps.models.note} />
              </p>
            )}
            {models.status === 'error' && (
              <ModelsProblem
                message={models.message}
                hostMode={hostMode}
                onRetry={onLoadModels}
                onOpenTerminal={onOpenTerminal}
              />
            )}
          </>
        )}
        <p id={errId} role="alert" className="ag-form-error">
          {error}
        </p>
        <div className="ag-sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !projectId} aria-describedby={errId}>
            {busy ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
