import { motion } from 'motion/react';
import { useMotionLevel } from '../motion/MotionProvider';
import { SPRING, transitionFor } from '../motion/springs';
import type { StudioDef } from './defs';
import type { Character, Project } from './projects';
import { whenOf } from './projects';
import { Choices } from './Choices';
import { SqIcon, type IconName } from './icons';

/**
 * A place kept for the orb: it sits centred on it (see shell/orb/attention.ts). Not aria-hidden,
 * since the orb skips anything hidden; it is an empty span, so there is nothing to read.
 */
export function OrbSpot({ size = 52, className = 'st-orb-spot' }: { size?: number; className?: string }) {
  return <span className={className} data-orb-spot="" data-orb-size={size} role="presentation" />;
}

/** "Where are *we?*": words between asterisks are set in italics, the magazine way. The orb waits beside it. */
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
export function Rows({ children, label, delay = 0.12 }: { children: React.ReactNode[]; label?: string; delay?: number }) {
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

function Row({ icon, n, title, meta, onClick }: { icon?: IconName; n?: number; title: string; meta: string; onClick?: () => void }) {
  const inner = (
    <>
      {icon ? (
        <SqIcon name={icon} framed />
      ) : (
        <span className="st-row-n" aria-hidden>
          {String(n).padStart(2, '0')}
        </span>
      )}
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

const KIND_NAME: Record<Project['kind'], string> = { image: 'Picture', video: 'Video', movie: 'Movie' };
const STATUS: Record<Project['status'], string> = { draft: 'Draft', making: 'Being made', done: 'Finished', error: 'Stopped' };

/** Home: the member's projects, as a magazine contents page. */
export function Home({ studio, projects, onOpen, onNew, onTalk }: { studio: StudioDef; projects: Project[]; onOpen: (p: Project) => void; onNew: () => void; onTalk: () => void }) {
  return (
    <article className="st-sheet st-home" aria-labelledby="st-home-t">
      <p className="o5-kicker st-kick">
        <span>Contents</span>
        <span className="st-num">{projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'New here'}</span>
      </p>
      <Headline text={projects.length ? 'Your *projects*' : `Welcome to ${studio.mark[0]} *${studio.mark[1]}*`} id="st-home-t" />
      <p className="st-dek">{projects.length ? 'Pick one up where you left it, or start something new.' : 'Everything you make lives here, sorted by project. Start your first one.'}</p>
      <Rows label="Contents">
        {[
          <Row key="new" icon="plus" title="Start something new" meta="Picture, video or movie" onClick={onNew} />,
          <Row key="talk" icon="talk" title="Talk with the writer" meta="Plan it in conversation" onClick={onTalk} />,
          ...projects.map((p, i) => (
            <Row
              key={p.id}
              n={i + 1}
              title={p.title || `Untitled ${KIND_NAME[p.kind].toLowerCase()}`}
              meta={`${KIND_NAME[p.kind]} · ${STATUS[p.status]} · ${whenOf(p.updatedAt)}`}
              onClick={() => onOpen(p)}
            />
          )),
        ]}
      </Rows>
    </article>
  );
}

/** 18+: the first page of an adult studio. */
export function Gate({ studio, picked, onPick }: { studio: StudioDef; picked: string | null; onPick: (yes: boolean) => void }) {
  return (
    <article className="st-sheet" aria-labelledby="st-gate-t">
      <p className="o5-kicker st-kick">
        <span>Before we begin</span>
        <span className="st-num">18+</span>
      </p>
      <Headline text="Adults *only.*" id="st-gate-t" orb={picked === null} />
      <p className="st-dek">{studio.name} makes adult pictures, videos and films. Confirm you are 18 or older, and that you agree to the house rules.</p>
      <ul className="st-rules">
        {studio.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <Choices
        items={[
          { label: 'I am 18 or older', hint: 'And I agree to the rules' },
          { label: 'Take me back', hint: `Leave ${studio.name}` },
        ]}
        picked={picked}
        onPick={(l) => onPick(l === 'I am 18 or older')}
        delay={0.3}
      />
    </article>
  );
}

export function CharacterList({ list }: { list: Character[] }) {
  if (!list.length) return <p className="st-empty">Characters you describe in a walkthrough are kept here, to cast again.</p>;
  return <Rows label="Characters">{list.map((c) => <Row key={c.id} icon="character" title={c.name} meta={c.description} />)}</Rows>;
}
