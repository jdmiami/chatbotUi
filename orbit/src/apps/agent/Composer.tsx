import { useId, useLayoutEffect, type KeyboardEvent, type Ref, type RefObject } from 'react';
import type { ModelOption, RunnerCapabilities, RunnerMode, SessionSummary } from '../../services/runner/types';
import { Icon } from '../../ui/Icon';
import { InlineText } from './Transcript';
import { MODES, MODE_LABELS, enterAction, isSignInError } from './model';

export type ModelsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; list: ModelOption[] }
  | { status: 'error'; message: string };

function finePointer(): boolean {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** Native select with a visible label: big enough to tap, and iOS shows its own picker. */
export function Picker({
  label,
  value,
  onChange,
  disabled,
  describedBy,
  children,
  className = '',
  selectRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
  children: React.ReactNode;
  className?: string;
  selectRef?: Ref<HTMLSelectElement>;
}) {
  const id = useId();
  return (
    <div className={`ag-pick ${className}`} data-disabled={disabled || undefined}>
      <label className="ag-pick-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        ref={selectRef}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <Icon name="down" size={16} className="ag-pick-chevron" />
    </div>
  );
}

/** Options for a model <select>: "Default" (agy decides) plus the list, keeping the current choice. */
export function ModelOptions({ models, current, note }: { models: ModelsState; current?: string; note?: string }) {
  const list = models.status === 'ready' ? models.list : [];
  const extra = current && !list.some((m) => m.id === current) ? [{ id: current, label: current }] : [];
  const options = [...list, ...extra].map((m) => (
    <option key={m.id} value={m.id}>
      {m.label}
    </option>
  ));
  return (
    <>
      <option value="">Default (agy decides)</option>
      {models.status === 'loading' && (
        <option value="__loading" disabled>
          Loading models…
        </option>
      )}
      {note && options.length > 0 ? <optgroup label={note}>{options}</optgroup> : options}
    </>
  );
}

/** Gentle inline message when the model list can't be loaded (e.g. agy not signed in). */
export function ModelsProblem({
  message,
  hostMode,
  onRetry,
  onOpenTerminal,
}: {
  message: string;
  hostMode: boolean;
  onRetry: () => void;
  onOpenTerminal: () => void;
}) {
  const signIn = hostMode && isSignInError(message);
  return (
    <div className="ag-inline-note" role="status">
      <Icon name="info" size={16} />
      <span className="ag-inline-note-text">
        {signIn ? (
          <InlineText text="Models need a signed-in agy. Open Terminal and run `agy` once to sign in." />
        ) : (
          <>Couldn’t load the model list ({message}). The default model still works.</>
        )}
      </span>
      {signIn && (
        <button type="button" className="ag-textbtn" onClick={onOpenTerminal}>
          Open Terminal
        </button>
      )}
      <button type="button" className="ag-textbtn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export interface ComposerProps {
  session: SessionSummary;
  caps: RunnerCapabilities;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** The session has a turn in flight (here, on another device, or before a reload). */
  running: boolean;
  /** Stop is possible for this turn (we hold its handle, or the runner can stop by session). */
  canStop: boolean;
  stopping: boolean;
  models: ModelsState;
  modelsNote?: string;
  onMode: (mode: RunnerMode) => void;
  onModel: (model: string) => void;
  onRetryModels: () => void;
  hostMode: boolean;
  demo: boolean;
  onOpenTerminal: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  visible: boolean;
}

/**
 * Pinned to the bottom of the conversation (so it sits right above the on-screen keyboard).
 * Controls follow the runner's capabilities: supported → enabled, unsupported → disabled with the
 * reason, unverified → not offered.
 */
export function Composer({
  session,
  caps,
  draft,
  onDraft,
  onSend,
  onStop,
  running,
  canStop,
  stopping,
  models,
  modelsNote,
  onMode,
  onModel,
  onRetryModels,
  hostMode,
  demo,
  onOpenTerminal,
  textareaRef,
  visible,
}: ComposerProps) {
  const pauseNoteId = useId();
  const stopNoteId = useId();
  const modeNoteId = useId();
  const modelNoteId = useId();
  const blockedId = useId();

  // Follow-ups need `continueConversation`; without it a started session can't take more messages.
  const followUpBlocked = !!session.conversationId && caps.continueConversation.status !== 'supported';
  const newBlocked = !session.conversationId && caps.newConversation.status !== 'supported';
  const blockedNote = followUpBlocked
    ? `Follow-ups aren’t available: ${caps.continueConversation.note}`
    : newBlocked
      ? `Starting a conversation isn’t available: ${caps.newConversation.note}`
      : null;

  const canSend = !running && !blockedNote && draft.trim().length > 0;

  // Autosize the textarea to its content (CSS caps the height, then it scrolls).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !visible) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, visible, textareaRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = enterAction(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        isComposing: e.nativeEvent.isComposing || e.keyCode === 229,
      },
      finePointer(),
    );
    if (action !== 'send') return;
    e.preventDefault();
    if (canSend) onSend();
  };

  const stopCap = caps.stop.status;
  const pauseCap = caps.pauseResume.status;
  const showModes = caps.modes.status !== 'unverified';
  const showModels = caps.models.status !== 'unverified';

  return (
    <div className="ag-composer" data-running={running || undefined}>
      {running && (
        <div className="ag-runbar">
          <span className="ag-runbar-text" role="status">
            <span className="ag-spinner" aria-hidden />
            {stopping ? 'Stopping…' : demo ? 'Working… (simulated)' : 'Antigravity is working…'}
          </span>
          {pauseCap === 'unsupported' && (
            <button type="button" className="btn ghost ag-runbtn" disabled aria-describedby={pauseNoteId}>
              <Icon name="pause" size={16} />
              Pause
            </button>
          )}
          {stopCap !== 'unverified' && (
            <button
              type="button"
              className="btn danger ag-runbtn"
              onClick={onStop}
              disabled={stopCap !== 'supported' || !canStop || stopping}
              aria-describedby={stopCap !== 'supported' || !canStop ? stopNoteId : undefined}
            >
              <Icon name="stop" size={16} />
              {stopping ? 'Stopping' : 'Stop'}
            </button>
          )}
        </div>
      )}
      {running && pauseCap === 'unsupported' && (
        <p className="ag-capnote" id={pauseNoteId}>
          <InlineText text={`Pause isn’t available: ${caps.pauseResume.note}`} />
        </p>
      )}
      {running && stopCap === 'unsupported' && (
        <p className="ag-capnote" id={stopNoteId}>
          <InlineText text={`Stop isn’t available: ${caps.stop.note}`} />
        </p>
      )}
      {running && stopCap === 'supported' && !canStop && (
        <p className="ag-capnote" id={stopNoteId}>
          This turn was started elsewhere (another device, or before this page reloaded). Stop it from there, or
          wait for it to finish.
        </p>
      )}

      <div className="ag-composer-main">
        {(showModes || showModels) && (
          <div className="ag-opts">
            {showModes && (
              <Picker
                label="Mode"
                value={session.mode}
                onChange={(v) => onMode(v as RunnerMode)}
                disabled={caps.modes.status !== 'supported'}
                describedBy={caps.modes.status !== 'supported' ? modeNoteId : undefined}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </Picker>
            )}
            {showModels && (
              <Picker
                label="Model"
                value={session.model ?? ''}
                onChange={onModel}
                disabled={caps.models.status !== 'supported'}
                describedBy={caps.models.status !== 'supported' ? modelNoteId : undefined}
              >
                <ModelOptions models={models} current={session.model} note={modelsNote} />
              </Picker>
            )}
          </div>
        )}

        <div className="ag-input-row">
          <textarea
            ref={textareaRef}
            className="ag-input"
            rows={1}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={demo ? 'Message (simulated reply)' : 'Message Antigravity'}
            aria-label="Message"
            aria-describedby={blockedNote ? blockedId : undefined}
            disabled={!!blockedNote}
            enterKeyHint="enter"
            autoComplete="off"
          />
          <button
            type="button"
            className="ag-send"
            aria-label="Send"
            title="Send"
            disabled={!canSend}
            // Keep the keyboard up on touch devices: don't move focus away from the textarea.
            onPointerDown={(e) => e.preventDefault()}
            onClick={onSend}
          >
            <Icon name="send" size={20} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {caps.modes.status === 'unsupported' && (
        <p className="ag-capnote" id={modeNoteId}>
          <InlineText text={`Modes aren’t available: ${caps.modes.note}`} />
        </p>
      )}
      {caps.models.status === 'unsupported' && (
        <p className="ag-capnote" id={modelNoteId}>
          <InlineText text={`Choosing a model isn’t available: ${caps.models.note}`} />
        </p>
      )}
      {caps.models.status === 'supported' && models.status === 'error' && (
        <ModelsProblem
          message={models.message}
          hostMode={hostMode}
          onRetry={onRetryModels}
          onOpenTerminal={onOpenTerminal}
        />
      )}
      {blockedNote && (
        <p className="ag-capnote" id={blockedId}>
          <InlineText text={blockedNote} />
        </p>
      )}
    </div>
  );
}
