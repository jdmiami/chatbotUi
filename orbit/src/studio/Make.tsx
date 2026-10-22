import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { StudioItem } from '../services/ai/LocalAi';
import { studioAi, type MemberMovie } from './memberApi';
import type { StudioDef } from './defs';
import { briefOf, jobOf, promptOf } from './engine';
import type { Project } from './projects';
import { Headline, OrbSpot } from './Sheets';
import { orbNote, orbThink } from './orbGuide';

const PHASE: Record<string, string> = {
  draft: 'Getting ready',
  story: 'Writing the story',
  lead: 'Casting the lead',
  storyboard: 'Drawing the storyboard',
  review: 'Storyboard ready for you',
  shots: 'Filming the scenes',
  final: 'Cutting the film',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Stopped',
};

/**
 * The brief, then the making: wakes the studio's machine when it is resting (members never see the
 * word "machine"), starts the job, follows it to the end and shows what came out.
 */
export const Make = forwardRef<HTMLElement, { studio: StudioDef; project: Project; onChange: (p: Project) => void }>(function Make({ studio, project, onChange }, ref) {
  const ai = studioAi;
  const flow = studio.flows[project.kind];
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [movie, setMovie] = useState<MemberMovie | null>(null);
  const [items, setItems] = useState<Map<string, StudioItem>>(new Map());
  const live = useRef(true);
  const current = useRef(project);
  current.current = project;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Project>) => onChange({ ...current.current, ...patch }), [onChange]);

  const loadItems = useCallback(async () => {
    const list = await ai.studioItems().catch(() => [] as StudioItem[]);
    setItems(new Map(list.map((i) => [i.id, i])));
  }, [ai]);

  /** Wake the studio when it rests, and wait until it is ready (a few minutes the first time). */
  const ready = useCallback(async () => {
    let s = await ai.status();
    if (s.state === 'off') {
      setNote('Warming up the studio. The first one of the day takes a few minutes.');
      s = await ai.power('start');
    }
    for (let i = 0; i < 180 && live.current && s.state !== 'on'; i++) {
      if (s.state === 'error' || s.state === 'unconfigured') throw new Error('The studio could not start right now. Try again in a minute.');
      setNote(s.state === 'downloading' ? 'Warming up the studio: loading its tools.' : 'Warming up the studio.');
      await new Promise((r) => setTimeout(r, 5000));
      s = await ai.status();
    }
  }, [ai]);

  // Follow a job that is already running (also after a reload).
  useEffect(() => {
    if (project.status !== 'making') return;
    let stop = false;
    const follow = async () => {
      while (!stop && live.current) {
        try {
          if (project.movieId) {
            const m = await ai.movie(project.movieId);
            setMovie(m);
            setNote(PHASE[m.phase ?? 'draft'] ?? 'Making');
            if (m.phase === 'review') await loadItems();
            if (m.phase === 'done' && m.render) {
              await loadItems();
              update({ status: 'done', items: [m.render.itemId], error: null });
              return;
            }
            if (m.phase === 'error' || m.phase === 'stopped') {
              update({ status: 'error', error: m.error ?? 'The film stopped.' });
              return;
            }
          } else if (project.jobId) {
            const j = await ai.studioJob(project.jobId);
            setProgress(j.progress);
            setNote(j.position ? `In line: ${j.position} ahead of you.` : j.etaSeconds ? `About ${Math.max(1, Math.round(j.etaSeconds / 60))} min left.` : 'Making it now.');
            if (j.status === 'done' && j.item) {
              setItems((m) => new Map(m).set(j.item!.id, j.item!));
              update({ status: 'done', items: [j.item.id], error: null });
              return;
            }
            if (j.status === 'error' || j.status === 'stopped') {
              update({ status: 'error', error: j.error ?? 'It stopped before it was done.' });
              return;
            }
          }
        } catch {
          /* a dropped poll: try again */
        }
        await new Promise((r) => setTimeout(r, project.movieId ? 5000 : 2500));
      }
    };
    void follow();
    return () => {
      stop = true;
    };
  }, [project.status, project.jobId, project.movieId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (project.status === 'done') void loadItems();
  }, [project.status, loadItems]);

  const make = async () => {
    update({ status: 'making', error: null });
    try {
      await ready();
      const makers = await ai.studioMakers().catch(() => []);
      const installed = makers.filter((m) => m.installed).map((m) => m.id);
      const job = jobOf(studio, project.kind, project.answers, installed, project.script?.scenes ?? null);
      if (job.kind === 'movie') {
        const m = await ai.createMovie(job.draft);
        update({ movieId: m.id, status: 'making' });
        await ai.runMovie(m.id);
      } else {
        const j = await ai.createStudioJob(job.req);
        update({ jobId: j.id, status: 'making' });
      }
    } catch (err) {
      setNote(null);
      update({ status: 'error', error: (err as Error).message });
    }
  };

  const approve = async () => {
    if (!project.movieId) return;
    try {
      setMovie(await ai.runMovie(project.movieId, { approve: true }));
    } catch (err) {
      update({ status: 'error', error: (err as Error).message });
    }
  };

  // The storyboard check: tap pictures to have them drawn again.
  const [redo, setRedo] = useState<Set<string>>(new Set());
  const redraw = async () => {
    if (!project.movieId || !redo.size) return;
    try {
      setMovie(await ai.redrawFrames(project.movieId, [...redo].map((id) => ({ id }))));
      setRedo(new Set());
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  const result = project.items.map((id) => items.get(id)).filter(Boolean) as StudioItem[];
  const frames = movie?.phase === 'review' ? movie.frames : [];
  const scenes = project.kind === 'movie' ? (project.script?.scenes ?? []) : [];
  const frameName = (i: number) => (i === 0 ? 'Opening' : `Scene ${i} ends`);
  const what = project.kind === 'image' ? 'picture' : project.kind;

  // The orb glows while the studio works. It keeps its words until you tap it, and sits on the
  // one thing this screen wants from you next.
  useEffect(() => {
    if (project.status !== 'making' || movie?.phase === 'review') return;
    orbThink(0.55);
    return () => orbThink(null);
  }, [project.status, movie?.phase]);
  useEffect(() => {
    if (movie?.phase === 'review') orbNote('Here is the storyboard: where each scene starts and ends. Tap any picture to draw it again, or film it as it is.', { label: 'Film it', id: 'film' });
    else if (project.status === 'making') orbNote(note ?? 'Making it now.');
    else if (project.status === 'done') orbNote(`Your ${what} is ready. It is in your gallery too.`);
    else if (project.status === 'error') orbNote(project.error ?? 'It stopped. Try again.', { label: 'Try again', id: 'make' });
    else orbNote(`Everything you picked, in one place. Tap “Make the ${what}” when it looks right.`, { label: `Make the ${what}`, id: 'make' });
  }, [project.status, movie?.phase, note]); // eslint-disable-line react-hooks/exhaustive-deps
  const acts = useRef<Record<string, () => void>>({});
  acts.current = { film: () => void approve(), make: () => void make() };
  useEffect(() => {
    const on = (e: Event) => acts.current[(e as CustomEvent<string>).detail]?.();
    window.addEventListener('orb:act', on);
    return () => window.removeEventListener('orb:act', on);
  }, []);

  return (
    <article className="st-sheet st-brief" ref={ref} aria-labelledby="st-brief-t">
      <p className="o5-kicker st-kick">
        <span>The brief</span>
        <span className="st-num">{project.status === 'done' ? 'Finished' : project.status === 'making' ? 'Being made' : 'Ready'}</span>
      </p>
      {/* The orb rests on what this screen wants next: the button, or the headline while it works. */}
      {project.status === 'done' ? (
        <Headline text={`Here is your *${what}.*`} id="st-brief-t" />
      ) : project.status === 'making' ? (
        <Headline text={movie?.phase === 'review' ? 'Your *storyboard.*' : `Making your *${what}…*`} id="st-brief-t" orb={movie?.phase !== 'review'} />
      ) : (
        <Headline text="Here is your *brief.*" id="st-brief-t" orb={false} />
      )}

      {result.length > 0 && (
        <figure className="st-result">
          {result[0].kind === 'image' ? <img src={result[0].url} alt={promptOf(studio, flow, project.answers)} /> : <video src={result[0].url} controls playsInline loop />}
        </figure>
      )}

      {frames.length > 0 && (
        <>
          <p className="st-dek">Where each scene starts and ends. Tap a picture to draw it again.</p>
          <ol className="st-frames" aria-label="Storyboard">
            {frames.map((f, i) => (
              <li key={f.id}>
                {f.url ? (
                  <button
                    type="button"
                    aria-pressed={redo.has(f.id)}
                    onClick={() =>
                      setRedo((r) => {
                        const n = new Set(r);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      })
                    }
                  >
                    <img src={f.url} alt={frameName(i)} />
                    <span className="st-num">{frameName(i)}</span>
                  </button>
                ) : (
                  <>
                    <span className="st-frame-wait" aria-hidden />
                    <span className="st-num">{frameName(i)} · drawing</span>
                  </>
                )}
              </li>
            ))}
          </ol>
          <div className="st-review-go st-script-go">
            {redo.size > 0 ? (
              <button type="button" className="st-go" onClick={() => void redraw()}>
                Draw {redo.size === 1 ? 'it' : `these ${redo.size}`} again
                <OrbSpot size={40} className="st-choice-spot" />
              </button>
            ) : (
              <button type="button" className="st-go" onClick={() => void approve()}>
                Looks right, film it
                <OrbSpot size={40} className="st-choice-spot" />
              </button>
            )}
          </div>
        </>
      )}

      {project.status !== 'done' && !frames.length && (
        <dl className="st-brieflist">
          {briefOf(flow, project.answers)
            .filter((b) => b.key !== 'Script')
            .map((b) => (
              <div key={b.key}>
                <dt>{b.key}</dt>
                <dd>{b.value}</dd>
              </div>
            ))}
        </dl>
      )}

      {project.status === 'draft' && scenes.length > 0 && (
        <ol className="st-scenes" aria-label="The script">
          {scenes.map((s, i) => (
            <li key={s.id} className="st-scene">
              <p className="o5-kicker st-scene-head">
                <span>Scene {String(i + 1).padStart(2, '0')}</span>
                <span>{s.heading}</span>
              </p>
              <p className="st-action">{s.action}</p>
              {s.says && <p className="st-says">{s.says}</p>}
            </li>
          ))}
        </ol>
      )}

      {project.status === 'making' && !frames.length && (
        <div className="st-making" role="status">
          <div className="st-bar" aria-hidden>
            <span style={{ width: `${progress ?? (movie ? 20 : 8)}%` }} className={progress == null ? 'st-bar-busy' : undefined} />
          </div>
          <p className="st-dek">{note ?? 'Starting…'}</p>
          <p className="st-ht">You can leave this page. It keeps going, and it will be in your gallery when it is done.</p>
        </div>
      )}

      {project.status === 'error' && <p className="st-error" role="alert">{project.error}</p>}

      {(project.status === 'draft' || project.status === 'error') && (
        <div className="st-script-go">
          <button type="button" className="st-go" onClick={() => void make()}>
            {project.status === 'error' ? 'Try again' : `Make the ${what}`}
            <OrbSpot size={40} className="st-choice-spot" />
          </button>
        </div>
      )}
    </article>
  );
});
