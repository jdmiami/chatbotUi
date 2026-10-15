import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TranscriptItem } from '../../services/runner/types';
import { Icon } from '../../ui/Icon';
import { relativeTime } from '../../ui/format';
import { isSignInError, parseBlocks, parseInline, parseMessage, type Block } from './model';

type CopyFn = (text: string, what: string) => void;

/** Inline text: `code`, **bold**, *italic* and https links. Built from elements, never from HTML. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        switch (part.kind) {
          case 'code':
            return (
              <code key={i} className="ag-inline-code">
                {part.text}
              </code>
            );
          case 'strong':
            return <strong key={i}>{part.text}</strong>;
          case 'em':
            return <em key={i}>{part.text}</em>;
          case 'link':
            return (
              <a key={i} className="ag-link" href={part.href} target="_blank" rel="noopener noreferrer nofollow" title={part.href}>
                {part.text}
              </a>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

function ProseBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'h':
      return (
        <p className={`ag-h ag-h${Math.min(block.level, 3)}`}>
          <InlineText text={block.text} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <InlineText text={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="ag-list" start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className="ag-list">{items}</ul>
      );
    }
    case 'quote':
      return (
        <blockquote className="ag-quote">
          <InlineText text={block.text} />
        </blockquote>
      );
    case 'hr':
      return <hr className="ag-hr" />;
    default:
      return (
        <p className="ag-p">
          <InlineText text={block.text} />
        </p>
      );
  }
}

function CodeBlock({ lang, code, onCopy }: { lang: string; code: string; onCopy: CopyFn }) {
  const name = lang || 'code';
  return (
    <div className="ag-code">
      <div className="ag-code-head">
        <span className="ag-code-lang">{name}</span>
        <button type="button" className="ag-textbtn" onClick={() => onCopy(code, 'Code')} aria-label={`Copy ${name} code`}>
          <Icon name="copy" size={16} />
          <span>Copy</span>
        </button>
      </div>
      {/* Focusable so keyboard users can scroll long lines sideways. */}
      <pre className="ag-code-body" tabIndex={0} aria-label={`${name} code`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A message body: fenced code blocks plus a safe Markdown subset for prose. No markdown library. */
export function MessageBody({ text, onCopy }: { text: string; onCopy: CopyFn }) {
  const segments = useMemo(() => parseMessage(text), [text]);
  return (
    <div className="ag-body-text">
      {segments.map((seg, i) =>
        seg.kind === 'code' ? (
          <CodeBlock key={i} lang={seg.lang} code={seg.code} onCopy={onCopy} />
        ) : (
          parseBlocks(seg.text).map((block, j) => <ProseBlock key={`${i}-${j}`} block={block} />)
        ),
      )}
    </div>
  );
}

/** "Open Terminal and run `agy` once to sign in" (host mode only). */
export function SignInHint({ onOpenTerminal }: { onOpenTerminal: () => void }) {
  return (
    <div className="ag-signin">
      <p className="ag-signin-text">
        <InlineText text="Open Terminal and run `agy` once to sign in." />
      </p>
      <button type="button" className="btn ghost ag-signin-btn" onClick={onOpenTerminal}>
        <Icon name="terminal" size={18} />
        Open Terminal
      </button>
    </div>
  );
}

function ActivityRow({ item }: { item: Extract<TranscriptItem, { kind: 'activity' }> }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const statusWord = item.status === 'running' ? 'In progress' : item.status === 'done' ? 'Finished' : 'Did not finish';
  return (
    <div className="ag-activity" data-status={item.status}>
      <div className="ag-activity-row">
        <span className="ag-activity-icon" aria-hidden>
          {item.status === 'running' ? (
            <span className="ag-spinner" />
          ) : (
            <Icon name={item.status === 'done' ? 'check' : 'alert'} size={16} />
          )}
        </span>
        <span className="ag-activity-title">
          {item.title}
          <span className="visually-hidden">. {statusWord}.</span>
        </span>
        {item.detail && (
          <button
            type="button"
            className="ag-textbtn ag-activity-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide details' : 'Details'}
            <Icon name="down" size={16} className="ag-chevron" />
          </button>
        )}
      </div>
      {item.detail && (
        <pre id={detailId} className="ag-activity-detail" hidden={!open}>
          {item.detail}
        </pre>
      )}
    </div>
  );
}

interface ItemProps {
  item: TranscriptItem;
  demo: boolean;
  hostMode: boolean;
  now: number;
  onCopy: CopyFn;
  onOpenTerminal: () => void;
}

const ItemView = memo(function ItemView({ item, demo, hostMode, now, onCopy, onOpenTerminal }: ItemProps) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ag-msg ag-msg-user">
          <span className="visually-hidden">You said: </span>
          <MessageBody text={item.text} onCopy={onCopy} />
        </div>
      );
    case 'assistant':
      return (
        <article className="ag-msg ag-msg-assistant" aria-label="Antigravity reply">
          <div className="ag-msg-head">
            <span className="ag-msg-who">Antigravity</span>
            {demo && <span className="ag-tag">Simulated reply</span>}
            <span className="ag-msg-time">{relativeTime(item.at, now)}</span>
          </div>
          {item.text ? <MessageBody text={item.text} onCopy={onCopy} /> : null}
          {item.streaming && (
            <span className="ag-typing" aria-label="Reply still arriving">
              <span />
              <span />
              <span />
            </span>
          )}
          {!item.streaming && item.text && (
            <div className="ag-msg-actions">
              <button type="button" className="ag-textbtn" onClick={() => onCopy(item.text, 'Reply')} aria-label="Copy reply">
                <Icon name="copy" size={16} />
                <span>Copy</span>
              </button>
            </div>
          )}
        </article>
      );
    case 'activity':
      return <ActivityRow item={item} />;
    case 'notice': {
      const signIn = hostMode && item.tone === 'error' && isSignInError(item.text);
      return (
        <div className="ag-notice" data-tone={item.tone}>
          <Icon name={item.tone === 'info' ? 'info' : 'alert'} size={18} />
          <div className="ag-notice-body">
            <p className="ag-p">
              <InlineText text={item.text} />
            </p>
            {signIn && <SignInHint onOpenTerminal={onOpenTerminal} />}
          </div>
        </div>
      );
    }
  }
});

export interface TranscriptProps {
  sessionId: string;
  items: TranscriptItem[];
  demo: boolean;
  hostMode: boolean;
  /** placement !== 'hidden': re-measure when the app becomes visible again. */
  visible: boolean;
  now: number;
  onCopy: CopyFn;
  onOpenTerminal: () => void;
  /** Bump to jump to the bottom (e.g. after sending). */
  scrollSignal: number;
  /** Shown above the items (e.g. loading or error state). */
  header?: ReactNode;
  /** Shown when there are no items. */
  empty?: ReactNode;
}

const NEAR_BOTTOM = 48;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.getComputedStyle) return true;
  return getComputedStyle(document.documentElement).getPropertyValue('--dur-med').trim() === '0ms';
}

/**
 * The conversation. Follows new content while the reader is at the bottom; once they scroll up it
 * stays put and offers "Jump to latest".
 */
export function Transcript({
  sessionId,
  items,
  demo,
  hostMode,
  visible,
  now,
  onCopy,
  onOpenTerminal,
  scrollSignal,
  header,
  empty,
}: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const toBottom = (smooth = false) => {
    const el = ref.current;
    if (!el) return;
    stuck.current = true;
    setShowJump(false);
    if (smooth && typeof el.scrollTo === 'function' && !prefersReducedMotion()) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  };

  // Opening another session, or an explicit request (sending): go to the latest message.
  useLayoutEffect(() => {
    toBottom();
  }, [sessionId, scrollSignal]);

  // New or changed content: follow it only if the reader is at the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stuck.current) el.scrollTop = el.scrollHeight;
    else setShowJump(true);
  }, [items]);

  // Back from being hidden (app switching): layout may have changed while away.
  useLayoutEffect(() => {
    if (visible && stuck.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [visible]);

  // The keyboard opening (or rotation) shrinks the pane: keep the latest message in view.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
    stuck.current = atBottom;
    setShowJump(!atBottom);
  };

  return (
    <div className="ag-convo">
      <div
        className="ag-transcript"
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        tabIndex={-1}
      >
        <div className="ag-transcript-inner">
          {header}
          {items.length === 0
            ? empty
            : items.map((item) => (
                <ItemView
                  key={item.id}
                  item={item}
                  demo={demo}
                  hostMode={hostMode}
                  now={now}
                  onCopy={onCopy}
                  onOpenTerminal={onOpenTerminal}
                />
              ))}
        </div>
      </div>
      {showJump && (
        <button type="button" className="ag-jump" onClick={() => toBottom(true)}>
          <Icon name="down" size={18} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
