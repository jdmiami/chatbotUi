import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SPRING, transitionFor, useMotionLevel } from '../motion';
import type { Choice, Guide, Run } from '../flow/defs';
import { whenOf } from '../flow/runs';
import { Choices } from './Choices';
import { SqIcon, type IconName } from './icons';

/**
 * The sheets: the small pieces every page is set from (a place for the orb, the italic headline,
 * rows that arrive one by one) and the whole pages that need no network: the contents page, an
 * agreement gate and a plain page with a running head.
 */

/**
 * A place kept for the orb: it sits centred on it (see src/orb). Not aria-hidden, since the orb
 * skips anything hidden; it is an empty span, so there is nothing to read.
 */
export function OrbSpot({ size = 52, className = 'st-orb-spot' }: { size?: number; className?: string }) {
  return <span className={className} data-orb-spot="" data-orb-size={size} role="presentation" />;
}

/** "Where *to?*": words between asterisks are set in italics, the magazine way. The orb waits beside it. */
export function Headline({ text, id, orb = true }: { text: string; id?: string; orb?: boolean }) {
  const parts = text.split('*');
  return (
    <div className="st-qwrap">
      <h2 className="st-q" id={id}>
        {parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
      </h2>
      {orb && <OrbSpot />}
    </div>
  );
}

/** A list whose rows come in one after another on a spring, out of a blur. */
export function Rows({ children, label, delay = 0.12 }: { children: ReactNode[]; label?: string; delay?: number }) {
  const level = useMotionLevel();
  const full = level === 'full';
  return (
    <ol className="st-contents" aria-label={label}>
      {children.map((child, i) => (
        <motion.li
          key={i}
          initial={full ? { opacity: 0, y: 22, filter: 'blur(10px)' } : { opacity: 0 }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay: delay + i * 0.055 } : transitionFor(level) }}
        >
          {child}
        </motion.li>
      ))}
    </ol>
  );
}

/** One row of a contents list: an icon or a folio number, a title and a line of meta. A button when it has onClick. */
export function Row({ icon, n, title, meta, onClick }: { icon?: IconName; n?: number; title: string; meta: string; onClick?: () => void }) {
  const inner = (
    <>
      {icon ? (
        <SqIcon name={icon} framed />
      ) : n != null ? (
        <span className="st-row-n" aria-hidden>
          {String(n).padStart(2, '0')}
        </span>
      ) : null}
      <span className="st-row-t">{title}</span>
      <span className="st-row-m">{meta}</span>
    </>
  );
  return onClick ? (
    <motion.button type="button" className="st-row" onClick={onClick} whileTap={{ scale: 0.98 }}>
      {inner}
    </motion.button>
  ) : (
    <div className="st-row st-row-static">{inner}</div>
  );
}

/** How a run's status reads on screen. */
export const statusLabel: Record<Run['status'], string> = { draft: 'Draft', done: 'Finished' };

/**
 * The contents page: the guide's welcome, a row to start something new, an optional row to talk it
 * through, then every run as a numbered row. The meta of a run is its flow's label, its status and
 * when it was last touched.
 */
export function Contents({
  guide,
  runs,
  onOpen,
  onNew,
  newLabel = 'Start something new',
  newHint,
  onTalk,
  talkLabel = 'Talk it through',
  talkHint = 'Plan it in conversation',
}: {
  guide: Guide;
  runs: Run[];
  onOpen: (r: Run) => void;
  onNew: () => void;
  /** The first row's title. */
  newLabel?: string;
  /** The first row's meta (default: the flows' labels, "A trip or An evening"). */
  newHint?: string;
  /** With it, a second row opens a conversation. */
  onTalk?: () => void;
  talkLabel?: string;
  talkHint?: string;
}) {
  const flows = Object.values(guide.flows);
  const count = runs.length;
  return (
    <article className="st-sheet st-home" aria-labelledby="st-home-t">
      <p className="o5-kicker st-kick">
        <span>Contents</span>
        <span className="st-num">{count ? `${count} draft${count === 1 ? '' : 's'}` : 'New here'}</span>
      </p>
      <Headline text={count ? 'Your *drafts*' : `Welcome to ${guide.mark[0]} *${guide.mark[1]}*`} id="st-home-t" />
      <p className="st-dek">{count ? 'Pick one up where you left it, or start something new.' : 'Everything you make lives here. Start your first one.'}</p>
      <Rows label="Contents">
        {[
          <Row key="new" icon="plus" title={newLabel} meta={newHint ?? flows.map((f) => f.label).join(' or ')} onClick={onNew} />,
          ...(onTalk ? [<Row key="talk" icon="talk" title={talkLabel} meta={talkHint} onClick={onTalk} />] : []),
          ...runs.map((r, i) => {
            const flow = guide.flows[r.flowId];
            return (
              <Row
                key={r.id}
                n={i + 1}
                title={r.title || `Untitled ${(flow?.label ?? 'run').toLowerCase().replace(/^(a|an|the) /, '')}`}
                meta={`${flow?.label ?? r.flowId} · ${statusLabel[r.status]} · ${whenOf(r.updatedAt)}`}
                onClick={() => onOpen(r)}
              />
            );
          }),
        ]}
      </Rows>
    </article>
  );
}

/**
 * An agreement gate: a page that asks one yes/no before anything else (house rules, an age check,
 * terms). The orb waits beside the headline until a choice is made. The app decides when to show it
 * and what to remember.
 */
export function Gate({
  title,
  dek,
  rules,
  yes,
  no,
  picked,
  onPick,
  kick = 'Before we begin',
  num,
}: {
  /** The headline; *words between asterisks* are italic. */
  title: string;
  dek?: string;
  /** Shown as a list under the dek. */
  rules?: string[];
  /** The agreeing answer. */
  yes: Choice;
  /** The declining answer. */
  no: Choice;
  /** The label just picked (lifts while the other leaves), or null. */
  picked: string | null;
  onPick: (agreed: boolean) => void;
  kick?: string;
  /** The right-hand part of the running head ("Step 1", "v2"). */
  num?: string;
}) {
  return (
    <article className="st-sheet" aria-labelledby="st-gate-t">
      <p className="o5-kicker st-kick">
        <span>{kick}</span>
        {num && <span className="st-num">{num}</span>}
      </p>
      <Headline text={title} id="st-gate-t" orb={picked === null} />
      {dek && <p className="st-dek">{dek}</p>}
      {rules && rules.length > 0 && (
        <ul className="st-rules">
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <Choices items={[yes, no]} picked={picked} onPick={(l) => onPick(l === yes.label)} delay={0.3} />
    </article>
  );
}

/**
 * A plain page in the guide's shape: the running head, the headline and whatever follows. The
 * start, summary and conversation screens are all set this way.
 */
export function Page({
  id,
  kick,
  num,
  title,
  orb = true,
  dek,
  className = '',
  children,
}: {
  /** The headline's id (the article is labelled by it). */
  id: string;
  /** The running head ("Opening", "The summary"). */
  kick: string;
  /** The right-hand part of the running head ("Ready", "3 of 8"). */
  num?: string;
  /** The headline; *words between asterisks* are italic. */
  title: string;
  /** Keep a place for the orb beside the headline. */
  orb?: boolean;
  dek?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`st-sheet ${className}`.trim()} aria-labelledby={id}>
      <p className="o5-kicker st-kick">
        <span>{kick}</span>
        {num && <span className="st-num">{num}</span>}
      </p>
      <Headline text={title} id={id} orb={orb} />
      {dek && <p className="st-dek">{dek}</p>}
      {children}
    </article>
  );
}
