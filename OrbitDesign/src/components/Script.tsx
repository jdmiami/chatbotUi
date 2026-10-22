import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SPRING, transitionFor, useMotionLevel } from '../motion';
import type { Answers, Scene, StudioDef } from '../walkthrough/defs';
import type { Project } from '../walkthrough/projects';
import { anotherTake, castOf, rewriteScene, writeScript } from '../walkthrough/writer';
import { orbThink } from '../walkthrough/orbGuide';
import { OrbSpot } from './Sheets';
import { SqIcon } from './icons';

type Script = NonNullable<Project['script']>;

const BY: Record<Script['by'], string> = { draft: 'First draft', writer: 'Written with the writer', you: 'Your edit' };

/** A rewrite the writer can be asked for on one scene: the button's label and how to rewrite it. */
export interface Rewrite {
  label: string;
  how: string;
}

/** The two rewrites the source studio offered; pass your own through `rewrites`. */
export const DEFAULT_REWRITES: Rewrite[] = [
  { label: 'More heat', how: 'more intense and sensual, still tasteful and consenting' },
  { label: 'Softer', how: 'softer, more tender' },
];

/**
 * The script desk: the film scene by scene, each one a five-second shot. Another take, a rewrite by
 * the writer (while it is awake), or your own words; then "This is the script".
 * Copied from Orbit Studios (src/studio/Script.tsx); the writer comes through the adapter, and the
 * per-scene rewrite buttons are a prop (`rewrites`) with the source's two as the default.
 */
export function ScriptDesk({
  studio,
  answers,
  script,
  awake,
  onChange,
  onApprove,
  rewrites = DEFAULT_REWRITES,
}: {
  studio: StudioDef;
  answers: Answers;
  script: Script | undefined;
  /** Whether the writer can rewrite right now (shows the writer buttons). */
  awake: boolean;
  onChange: (scenes: Scene[], by: Script['by']) => void;
  onApprove: () => void;
  rewrites?: Rewrite[];
}) {
  const level = useMotionLevel();
  const full = level === 'full';
  const [editing, setEditing] = useState<number | null>(null);
  const [working, setWorking] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    orbThink(working !== null ? 0.7 : null);
    return () => orbThink(null);
  }, [working]);

  if (!script) return <p className="st-predicting">Drafting the script…</p>;
  const scenes = script.scenes;
  const cast = castOf(answers);

  const withWriter = async (which: number | 'all', how = '') => {
    if (working !== null) return;
    setError(null);
    setWorking(which);
    ctrl.current = new AbortController();
    try {
      const next = which === 'all' ? await writeScript(studio, answers, ctrl.current.signal) : await rewriteScene(studio, answers, scenes, which, how, ctrl.current.signal);
      if (which === 'all' && !next.length) throw new Error('The writer came back empty. Your draft is still here.');
      onChange(next.length ? next : scenes, 'writer');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'The writer could not answer. Your draft is still here.');
    } finally {
      setWorking(null);
    }
  };

  const take = (i: number) => (awake ? void withWriter(i, 'a fresh take on the same moment') : onChange(anotherTake(answers, scenes, i), script.by));

  return (
    <div className="st-script">
      <p className="st-script-meta">
        <span>{answers.premise || 'Untitled'}</span>
        <span>
          {scenes.length} scenes · about {scenes.length * 5} seconds
        </span>
        <span>{cast.map((p) => p.name).join(' & ')}</span>
        <span>{BY[script.by]}</span>
      </p>
      <ol className="st-scenes">
        {scenes.map((s, i) => (
          <motion.li
            key={s.id}
            className="st-scene"
            aria-busy={working === i || working === 'all'}
            initial={full ? { opacity: 0, y: 22, filter: 'blur(8px)' } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay: 0.15 + i * 0.07 } : transitionFor(level) }}
          >
            <p className="o5-kicker st-scene-head">
              <span>Scene {String(i + 1).padStart(2, '0')}</span>
              <span>{s.heading}</span>
            </p>
            {editing === i ? (
              <SceneForm
                scene={s}
                onDone={(next) => {
                  setEditing(null);
                  if (next.action !== s.action || next.end !== s.end || next.says !== s.says) onChange(scenes.map((x, j) => (j === i ? next : x)), 'you');
                }}
              />
            ) : (
              <>
                <p className="st-action">{s.action}</p>
                <p className="st-ends">
                  <span>Ends on</span> {s.end}
                </p>
                {s.says && <p className="st-says">{s.says}</p>}
                <p className="st-scene-tools">
                  <button type="button" onClick={() => take(i)} disabled={working !== null}>
                    <SqIcon name="shuffle" /> {working === i ? 'Writing…' : 'Another take'}
                  </button>
                  {awake &&
                    rewrites.map((r) => (
                      <button key={r.label} type="button" onClick={() => void withWriter(i, r.how)} disabled={working !== null}>
                        {r.label}
                      </button>
                    ))}
                  <button type="button" onClick={() => setEditing(i)} disabled={working !== null}>
                    Edit
                  </button>
                </p>
              </>
            )}
          </motion.li>
        ))}
      </ol>
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
      <div className="st-script-go">
        <button type="button" className="st-go" onClick={onApprove} disabled={working !== null || editing !== null}>
          This is the script
          <OrbSpot size={40} className="st-choice-spot" />
        </button>
        {awake ? (
          <button type="button" className="st-ghost" onClick={() => void withWriter('all')} disabled={working !== null}>
            {working === 'all' ? 'The writer is writing…' : 'Rewrite it all with the writer'}
          </button>
        ) : (
          <p className="st-ht">The studio’s writer can rewrite scenes once the studio is awake. This draft is ready to film as it is.</p>
        )}
      </div>
    </div>
  );
}

/** Your own words for one scene: what we see, what it ends on, what is said. */
export function SceneForm({ scene, onDone }: { scene: Scene; onDone: (s: Scene) => void }) {
  const [v, setV] = useState(scene);
  const set = (k: 'action' | 'end' | 'says') => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="st-scene-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone({ ...v, action: v.action.trim() || scene.action, end: v.end.trim(), says: v.says.trim() });
      }}
    >
      <label className="o5-kicker" htmlFor={`act-${scene.id}`}>
        What we see
      </label>
      <textarea id={`act-${scene.id}`} value={v.action} onChange={set('action')} rows={3} />
      <label className="o5-kicker" htmlFor={`end-${scene.id}`}>
        It ends on
      </label>
      <input id={`end-${scene.id}`} value={v.end} onChange={set('end')} autoComplete="off" />
      <label className="o5-kicker" htmlFor={`says-${scene.id}`}>
        What is said
      </label>
      <input id={`says-${scene.id}`} value={v.says} onChange={set('says')} placeholder='Mara, softly: "Stay."' autoComplete="off" />
      <button type="submit">Done</button>
    </form>
  );
}
