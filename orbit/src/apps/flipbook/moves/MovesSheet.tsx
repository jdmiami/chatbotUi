import { useEffect, useRef, useState } from 'react';
import { Segmented, Sheet } from '../../../ui/components';
import { GROUPS, jointsAt, loadPack, notesFor, seconds, type Pack, type PackMove } from './moves';

/**
 * The Action Pack: every move plays as a little stick figure; pick one, choose how, and it goes onto
 * the notes from the one you are on.
 */
const SEGS: [string, string][] = [
  ['pelvis', 'spine1'],
  ['spine1', 'spine2'],
  ['spine2', 'neckBase'],
  ['neckBase', 'neckTop'],
  ['neckBase', 'shoulderL'],
  ['shoulderL', 'elbowL'],
  ['elbowL', 'wristL'],
  ['wristL', 'handL'],
  ['neckBase', 'shoulderR'],
  ['shoulderR', 'elbowR'],
  ['elbowR', 'wristR'],
  ['wristR', 'handR'],
  ['pelvis', 'hipL'],
  ['hipL', 'kneeL'],
  ['kneeL', 'ankleL'],
  ['ankleL', 'footL'],
  ['pelvis', 'hipR'],
  ['hipR', 'kneeR'],
  ['kneeR', 'ankleR'],
  ['ankleR', 'footR'],
];

export interface MoveChoice {
  move: PackMove;
  pack: Pack;
  speed: number;
  mirror: boolean;
  inPlace: boolean;
}

export function MovesSheet({ fps, from, onClose, onApply }: { fps: number; from: number; onClose: () => void; onApply: (c: MoveChoice) => void }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState(GROUPS[0]);
  const [pick, setPick] = useState<PackMove | null>(null);
  const [speed, setSpeed] = useState<'0.5' | '1' | '1.5'>('1');
  const [mirror, setMirror] = useState(false);
  const [inPlace, setInPlace] = useState(true);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());

  useEffect(() => {
    let alive = true;
    loadPack()
      .then((p) => alive && setPack(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // Every card on show plays its move, looping, kept in the middle of its little note.
  useEffect(() => {
    if (!pack) return;
    let frame = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      for (const [id, cv] of canvases.current) {
        const m = pack.moves.find((x) => x.id === id);
        const ctx = cv.getContext('2d');
        if (!m || !ctx) continue;
        const len = seconds(m) + 0.6;
        const tt = Math.min(seconds(m), (t * (pick?.id === id ? Number(speed) : 1)) % len);
        const j = jointsAt(pack, m, tt);
        const dx = 0.5 - j.pelvis.x;
        const w = cv.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, w);
        ctx.strokeStyle = 'rgba(60,50,20,0.25)';
        ctx.lineWidth = w * 0.01;
        ctx.beginPath();
        ctx.moveTo(0, 0.885 * w);
        ctx.lineTo(w, 0.885 * w);
        ctx.stroke();
        ctx.save();
        if (pick?.id === id && mirror) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.strokeStyle = '#1d1b22';
        ctx.lineCap = 'round';
        ctx.lineWidth = w * 0.022;
        ctx.beginPath();
        for (const [a, b] of SEGS) {
          ctx.moveTo((j[a].x + dx) * w, j[a].y * w);
          ctx.lineTo((j[b].x + dx) * w, j[b].y * w);
        }
        ctx.stroke();
        const hx = ((j.neckTop.x + j.headTop.x) / 2 + dx) * w;
        const hy = ((j.neckTop.y + j.headTop.y) / 2) * w;
        ctx.beginPath();
        ctx.arc(hx, hy, w * 0.05, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [pack, pick, speed, mirror]);

  const shown = pack ? pack.moves.filter((m) => m.group === group) : [];
  const n = pick ? notesFor(pick, fps, Number(speed)) : 0;

  return (
    <Sheet title="Action moves" onClose={onClose}>
      <section className="fb-more fb-moves">
        <p className="fb-hint">Real recorded acrobats, fighters and runners. Pick a move and your character does it, one pose per note, starting on note {from + 1}.</p>
        {failed && <p className="fb-hint">The moves would not load. Check the connection and open this again.</p>}
        {!pack && !failed && <p className="fb-hint">Loading the moves…</p>}
        {pack && (
          <>
            <div className="fb-chips" role="tablist" aria-label="Kinds of move">
              {GROUPS.map((g) => (
                <button key={g} type="button" role="tab" className="fb-chip" aria-selected={g === group} aria-pressed={g === group} onClick={() => setGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
            <ul className="fb-move-grid" aria-label={group}>
              {shown.map((m) => (
                <li key={m.id}>
                  <button type="button" className="fb-move" aria-pressed={pick?.id === m.id} onClick={() => setPick(m)}>
                    <canvas
                      width={180}
                      height={180}
                      ref={(el) => {
                        if (el) canvases.current.set(m.id, el);
                        else canvases.current.delete(m.id);
                      }}
                      aria-hidden
                    />
                    <span className="fb-move-name">{m.name}</span>
                    <small>{seconds(m).toFixed(1)} s</small>
                  </button>
                </li>
              ))}
            </ul>
            {pick && (
              <div className="fb-move-opts">
                <h3>{pick.name}</h3>
                <Segmented
                  label="Speed"
                  value={speed}
                  options={[
                    { value: '0.5', label: 'Slow motion' },
                    { value: '1', label: 'Real speed' },
                    { value: '1.5', label: 'Fast' },
                  ]}
                  onChange={setSpeed}
                />
                <label className="fb-switch">
                  <input type="checkbox" role="switch" className="switch" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                  <span>
                    Face the other way
                    <small>Flips the move left to right.</small>
                  </span>
                </label>
                <label className="fb-switch">
                  <input type="checkbox" role="switch" className="switch" checked={inPlace} onChange={(e) => setInPlace(e.target.checked)} />
                  <span>
                    Stay in the middle
                    <small>{inPlace ? 'The figure moves on the spot, so it never leaves the paper.' : 'The figure travels across the paper as it moves.'}</small>
                  </span>
                </label>
                <button type="button" className="btn primary" onClick={() => onApply({ move: pick, pack: pack!, speed: Number(speed), mirror, inPlace })}>
                  Put it on notes {from + 1} to {from + n}
                </button>
              </div>
            )}
            <p className="fb-hint fb-credit">Motion from the CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), free for any project.</p>
          </>
        )}
      </section>
    </Sheet>
  );
}
