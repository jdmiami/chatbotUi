import { useMemo, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, IconButton, Segmented } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { Censor } from '../../ui/Censor';
import { getLocalAi, type AiMachine, type Movie, type MovieDraft, type MovieShot, type StudioItem } from '../../services/ai/LocalAi';
import { TEMPLATES, aboutTime, phaseLine, stages } from './plan';

const withParam = (url: string, param: string) => url + (url.includes('?') ? '&' : '?') + param;
const TRIMS = ['0', '0.5', '1', '2'].map((v) => ({ value: v, label: v === '0' ? 'None' : `${v} s` }));
const STATUS: Record<MovieShot['status'], string> = { todo: 'To make', making: 'Making…', done: 'Made', error: 'Problem' };

/**
 * One movie: what the machine is doing and how long is left, the storyboard (to check and redo
 * pictures when you asked to), the finished movie to watch and save, and a simple timeline of shots
 * to redo one, reorder, trim or cut.
 */
export function MovieView({
  movie: m,
  itemById,
  ready,
  helperOn,
  makeOn,
  setMakeOn,
  onMovie,
  onItems,
  onItem,
  onEdit,
  onDeleted,
}: {
  movie: Movie;
  itemById: Map<string, StudioItem>;
  ready: boolean;
  helperOn: boolean;
  makeOn: AiMachine;
  setMakeOn: (v: AiMachine) => void;
  onMovie: (m: Movie) => void;
  onItems: () => void;
  onItem: (it: StudioItem) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const [trimming, setTrimming] = useState<string | null>(null);
  const [redoFrame, setRedoFrame] = useState<{ id: string; prompt: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const auto = m.flow === 'auto';
  const running = m.running;
  const frames = m.frames ?? [];
  const final = m.render && !m.render.stale ? itemById.get(m.render.itemId) : null;
  const template = TEMPLATES.find((t) => t.id === m.template);
  const review = auto && m.phase === 'review' && !running;
  const left = !running && (m.phase === 'stopped' || m.phase === 'error' || (auto && m.phase !== 'done' && m.phase !== 'review' && m.phase !== 'draft') || (!auto && m.shots.some((s) => s.status !== 'done')));

  const act = async (what: string, fn: () => Promise<Movie | void>) => {
    setBusy(what);
    try {
      const out = await fn();
      if (out) onMovie(out);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const run = (opts: { approve?: boolean } = {}) => act('run', () => ai.runMovie(m.id, makeOn, opts));
  const stop = () => act('stop', () => ai.stopMovie(m.id, m.runningOn ?? 'main'));
  const update = (draft: MovieDraft) => ai.updateMovie(m.id, draft);
  const cut = () =>
    act('render', async () => {
      const r = await ai.renderMovie(m.id);
      onItem(r.item);
      return r.movie;
    });
  const shotsDraft = (shots: MovieShot[]) => shots.map((s) => ({ id: s.id, prompt: s.prompt, says: s.says, end: s.end, trimStart: s.trimStart ?? 0, trimEnd: s.trimEnd ?? 0 }));
  /** Make one shot again (only that one: it sits between its own two storyboard pictures). */
  const redoShot = (id: string) =>
    act(`redo-${id}`, async () => {
      onMovie(await update({ shots: m.shots.map((s) => ({ ...shotsDraft([s])[0], redo: s.id === id })) }));
      return ai.runMovie(m.id, makeOn);
    });
  const move = (i: number, by: number) => {
    const shots = [...m.shots];
    const [s] = shots.splice(i, 1);
    shots.splice(i + by, 0, s);
    return act(`move-${s.id}`, () => update({ shots: shotsDraft(shots) }));
  };
  const trim = (id: string, key: 'trimStart' | 'trimEnd', v: number) => act(`trim-${id}`, () => update({ shots: shotsDraft(m.shots.map((s) => (s.id === id ? { ...s, [key]: v } : s))) }));
  const drop = (id: string) => act(`drop-${id}`, () => update({ shots: shotsDraft(m.shots.filter((s) => s.id !== id)) }));
  const redoPicture = () => {
    if (!redoFrame) return;
    const f = redoFrame;
    setRedoFrame(null);
    return act(`frame-${f.id}`, async () => {
      onMovie(await update({ frames: [{ id: f.id, prompt: f.prompt, redo: true }] }));
      return ai.runMovie(m.id, makeOn);
    });
  };
  const remove = async () => {
    setConfirmDelete(false);
    try {
      await ai.deleteMovie(m.id);
      onDeleted();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const doneShots = m.shots.filter((s) => s.status === 'done' && s.itemId);
  const canEdit = auto && !running;
  return (
    <div className="sr-page sr-movie">
      <header className="sr-cover">
        <p className="o5-kicker">{template ? template.name : 'soReal'}</p>
        <h2 className="sr-display sr-title">{m.title}</h2>
        {m.idea && <p className="sr-dek">{m.idea}</p>}
      </header>

      <section className="sr-progress" aria-label="Progress">
        <p className="sr-phase" role="status" aria-live="polite">
          {running && <span className="sr-spin" aria-hidden />}
          <span>
            {phaseLine(m)}
            {running && m.etaSeconds ? <span className="sr-left"> · {aboutTime(m.etaSeconds)} left</span> : null}
          </span>
        </p>
        {running && <p className="ai-muted sr-small">It keeps going on your AI machine even if your phone sleeps. Come back any time.</p>}
        {auto && (
          <ol className="sr-stages">
            {stages(m).map((s) => (
              <li key={s.name} data-state={s.state}>
                <span className="sr-stage-mark" aria-hidden>
                  {s.state === 'done' ? <Icon name="check" size={14} /> : null}
                </span>
                {s.name}
                <span className="sr-vh">{{ done: ' (done)', now: ' (now)', todo: '', skip: ' (none)' }[s.state]}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="sr-actions">
          {running && (
            <button type="button" className="btn" disabled={busy === 'stop'} onClick={() => void stop()}>
              <Icon name="stop" size={16} /> Stop
            </button>
          )}
          {left && (
            <>
              {helperOn && (
                <Segmented
                  label="Make on"
                  value={makeOn}
                  onChange={setMakeOn}
                  options={[
                    { value: 'main', label: 'Main machine' },
                    { value: 'helper', label: 'Helper' },
                  ]}
                />
              )}
              <button type="button" className="btn primary" disabled={!ready || busy === 'run'} onClick={() => void run()}>
                <Icon name="play" size={16} /> {m.phase === 'error' ? 'Try again' : auto ? 'Carry on' : m.shots.some((s) => s.status === 'done') ? 'Make the rest' : 'Make the movie'}
              </button>
            </>
          )}
          {auto && !running && m.phase === 'draft' && (
            <button type="button" className="btn primary" onClick={onEdit}>
              Set it up
            </button>
          )}
        </div>
      </section>

      {(final || (m.render?.stale && !running) || (!auto && doneShots.length > 0 && !running)) && (
        <section className="sr-final" aria-labelledby="sr-final-t">
          <h3 className="sr-section-title" id="sr-final-t">
            {final ? 'Your movie' : 'The final cut'}
          </h3>
          {final && (
            <Censor as="div">
              <video className={`sr-final-video${m.size === 'portrait' ? ' is-tall' : ''}`} src={final.url} controls playsInline preload="metadata" aria-label={`${m.title}, the movie`} />
            </Censor>
          )}
          <div className="sr-actions">
            {final && (
              <a className="btn primary" href={withParam(final.url, 'download=1')} download>
                <Icon name="download" size={16} /> Save
              </a>
            )}
            {(!final || m.render?.stale) && (
              <button type="button" className={final ? 'btn' : 'btn primary'} disabled={busy === 'render' || running || !doneShots.length} onClick={() => void cut()}>
                <Icon name="film" size={16} /> {busy === 'render' ? 'Putting it together…' : m.render ? 'Update the movie' : 'Join the shots'}
              </button>
            )}
          </div>
          {m.render?.stale && <p className="ai-muted sr-small">You changed shots since the last cut.</p>}
        </section>
      )}

      {auto && frames.length > 0 && (
        <section className="sr-board" aria-labelledby="sr-board-t">
          <h3 className="sr-section-title" id="sr-board-t">
            Storyboard
          </h3>
          {review && <p className="sr-guide" data-orb-focus>
            <span className="sr-guide-orb" aria-hidden />
            Check the pictures. Redo any you don’t like, then make the video.
          </p>}
          <ol className={`sr-frames${m.size === 'portrait' ? ' is-tall' : ''}`}>
            {frames.map((f, k) => {
              const it = f.itemId ? itemById.get(f.itemId) : null;
              return (
                <li key={f.id} className="sr-frame" data-status={f.status}>
                  <Censor className="sr-frame-pic">
                    {it ? <img src={it.url} alt={`Picture ${k + 1}: ${f.prompt}`} /> : f.status === 'making' ? <span className="sr-spin" aria-hidden /> : <span className="sr-frame-n" aria-hidden>{k + 1}</span>}
                  </Censor>
                  <span className="sr-frame-cap">{k === 0 ? 'Start' : `End of shot ${k}`}</span>
                  {f.error && <span className="ai-error sr-small">{f.error}</span>}
                  {canEdit && f.status !== 'making' && (review || m.phase === 'error' || m.phase === 'stopped') && (
                    <button type="button" className="btn ghost sr-small-btn" onClick={() => setRedoFrame({ id: f.id, prompt: f.prompt })}>
                      <Icon name="refresh" size={14} /> Redo picture {k + 1}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {redoFrame && (
            <div className="sr-redo">
              <TextArea className="input" rows={3} value={redoFrame.prompt} maxLength={1000} aria-label="What the picture shows" onChange={(e) => setRedoFrame({ ...redoFrame, prompt: e.target.value })} />
              <div className="sr-actions">
                <button type="button" className="btn ghost" onClick={() => setRedoFrame(null)}>
                  Cancel
                </button>
                <button type="button" className="btn primary" disabled={!redoFrame.prompt.trim()} onClick={() => void redoPicture()}>
                  <Icon name="refresh" size={16} /> Redo this picture
                </button>
              </div>
            </div>
          )}
          {review && !redoFrame && (
            <button type="button" className="btn primary sr-make" disabled={!ready || busy === 'run'} onClick={() => void run({ approve: true })}>
              <Icon name="play" size={18} /> Looks good, make the video
            </button>
          )}
        </section>
      )}

      {m.shots.length > 0 && (
        <section className="sr-timeline" aria-labelledby="sr-shots-t">
          <h3 className="sr-section-title" id="sr-shots-t">
            Shots
          </h3>
          <ol className="sr-shots">
            {m.shots.map((s, i) => {
              const it = s.itemId ? itemById.get(s.itemId) : null;
              const trimmed = (s.trimStart ?? 0) + (s.trimEnd ?? 0);
              const editable = canEdit && s.status !== 'making' && (m.continuity === 'keyframes' || s.status === 'done' || s.status === 'error');
              return (
                <li key={s.id} className="sr-shot" data-status={s.status}>
                  <Censor as="div" className={`sr-shot-media${m.size === 'portrait' ? ' is-tall' : ''}`}>
                    {it ? <video src={it.url} controls playsInline preload="metadata" aria-label={`Shot ${i + 1}`} /> : <span className="sr-shot-num" aria-hidden>{s.status === 'making' ? <span className="sr-spin" /> : i + 1}</span>}
                  </Censor>
                  <div className="sr-shot-body">
                    <p className="sr-shot-top">
                      <span className="sr-shot-label">Shot {i + 1}</span>
                      <span className={`sr-badge sr-badge-${s.status}`}>{STATUS[s.status]}</span>
                      {trimmed > 0 && <span className="ai-muted sr-small">trimmed {trimmed} s</span>}
                    </p>
                    <p className="sr-shot-text">{s.prompt}</p>
                    {s.says?.trim() && (
                      <p className="sr-shot-says" aria-label={`Said or sung in shot ${i + 1}`}>
                        {s.says.split('\n').map((l) => (
                          <span key={l}>{l}</span>
                        ))}
                      </p>
                    )}
                    {s.error && <p className="ai-error">{s.error}</p>}
                    {editable && (
                      <div className="sr-shot-tools">
                        {(s.status === 'done' || s.status === 'error') && (
                          <button type="button" className="btn ghost sr-small-btn" disabled={busy !== null || !ready} onClick={() => void redoShot(s.id)}>
                            <Icon name="refresh" size={14} /> Redo
                          </button>
                        )}
                        <button type="button" className="btn ghost sr-small-btn" disabled={i === 0 || busy !== null} aria-label={`Move shot ${i + 1} earlier`} onClick={() => void move(i, -1)}>
                          Earlier
                        </button>
                        <button type="button" className="btn ghost sr-small-btn" disabled={i === m.shots.length - 1 || busy !== null} aria-label={`Move shot ${i + 1} later`} onClick={() => void move(i, 1)}>
                          Later
                        </button>
                        {s.status === 'done' && (
                          <button type="button" className="btn ghost sr-small-btn" aria-expanded={trimming === s.id} aria-label={`Trim shot ${i + 1}`} onClick={() => setTrimming(trimming === s.id ? null : s.id)}>
                            Trim
                          </button>
                        )}
                        {m.shots.length > 1 && (
                          <IconButton icon="trash" label={`Cut shot ${i + 1}`} disabled={busy !== null} onClick={() => void drop(s.id)} />
                        )}
                      </div>
                    )}
                    {trimming === s.id && (
                      <div className="sr-trim">
                        <div className="sr-field">
                          <span>Cut from the start</span>
                          <Segmented label={`Cut from the start of shot ${i + 1}`} value={String(s.trimStart ?? 0)} onChange={(v) => void trim(s.id, 'trimStart', Number(v))} options={TRIMS} />
                        </div>
                        <div className="sr-field">
                          <span>Cut from the end</span>
                          <Segmented label={`Cut from the end of shot ${i + 1}`} value={String(s.trimEnd ?? 0)} onChange={(v) => void trim(s.id, 'trimEnd', Number(v))} options={TRIMS} />
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="sr-actions sr-end">
        {!running && auto && (m.phase === 'draft' || m.phase === 'stopped' || m.phase === 'error') && (
          <button type="button" className="btn ghost" onClick={onEdit}>
            <Icon name="pencil" size={16} /> Change the plan
          </button>
        )}
        <button
          type="button"
          className="btn ghost"
          disabled={busy === 'refresh'}
          onClick={() =>
            void act('refresh', async () => {
              onItems();
              return ai.movie(m.id);
            })
          }
        >
          <Icon name="refresh" size={16} /> Refresh
        </button>
        <IconButton icon="trash" label="Delete movie" onClick={() => setConfirmDelete(true)} />
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title="Delete this movie?"
          message="The plan is deleted. Shots, pictures and the finished movie stay in your gallery."
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
