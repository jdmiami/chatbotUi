import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stabilizer } from '../livedraw/ink/stabilizer';
import { drawVectors, hitStroke, toVector, type VStroke } from '../livedraw/ink/vector';
import type { Pt } from '../livedraw/canvas/sketch';
import { IconButton } from '../../ui/components';
import {
  boneToNote,
  isDone,
  progress,
  setLook,
  setPart,
  STANDING,
  steps as stepsOf,
  STICK,
  stick as stickOf,
  strokesToBone,
  type Character,
  type Step,
} from './character';
import { place, skeleton, type Placed } from './rig';
import { paintNote, type View } from './ink';
import { COLORS, WIDTHS } from './palette';

/**
 * Drawing a character, one part at a time. The figure stands on a big note, zoomed in on the part
 * to draw, which glows orange. Whatever you draw over it becomes that part and moves with its bone.
 * Skip any part (it stays a stick), stop any time, and come back to finish later.
 */

const GLOW = '#e0873a';
const SLEEP = '#bdb187';

export function Walkthrough({ character, onChange, onClose }: { character: Character; onChange: (c: Character) => void; onClose: () => void }) {
  const all = useMemo(() => stepsOf(character.level), [character.level]);
  const [at, setAt] = useState(() => Math.max(0, all.findIndex((s) => !isDone(character, s))));
  const [look, setLookIndex] = useState(0);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [width, setWidth] = useState(WIDTHS[1].value);
  const [past, setPast] = useState<Character[]>([]);
  const step: Step = all[Math.min(at, all.length - 1)];

  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [side, setSide] = useState(0);
  const penSeen = useRef(false);
  const live = useRef<{ id: number; stab: Stabilizer; pts: Pt[] } | { id: number; erase: true; hit: Set<number> } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSide(Math.max(160, Math.floor(Math.min(r.width, r.height))));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const placed = useMemo(() => place(skeleton(character.level), STANDING), [character.level]);
  const head = placed.get('head')!;
  const focus: Placed = step.kind === 'part' ? placed.get(step.bone)! : head;

  // Zoomed in on the part: small parts (fingers) close up, the head and body from further back.
  const view = useMemo<View>(() => {
    const z = Math.min(7, Math.max(1, 1 / (focus.bone.len * 2.6 + 0.14)));
    const cx = (focus.o.x + focus.e.x) / 2;
    const cy = (focus.o.y + focus.e.y) / 2;
    const clamp = (o: number) => Math.min(0, Math.max(1 - z, o));
    return { z, ox: clamp(0.5 - cx * z), oy: clamp(0.5 - cy * z) };
  }, [focus]);

  const looksOf = (kind: 'eyes' | 'mouth') => (kind === 'eyes' ? character.eyes : character.mouths);
  /** What is being drawn now: the part's strokes, or the face look's, out on the note. */
  const current = useMemo<VStroke[]>(() => {
    if (step.kind === 'part') return boneToNote(character.parts[step.bone] ?? [], focus);
    return boneToNote(looksOf(step.kind)[look] ?? [], head);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, step, look, focus, head]);

  const px = Math.round(side * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));

  /** The figure: drawn parts in their colours, undrawn ones as pale sticks, this part glowing. */
  const scenery = useMemo<VStroke[]>(() => {
    const out: VStroke[] = [];
    for (const p of placed.values()) {
      const isFocus = step.kind === 'part' && p.bone.id === step.bone;
      if (isFocus) continue;
      const art = character.parts[p.bone.id];
      if (art?.length) out.push(...boneToNote(art, p));
      else out.push(stickOf(p, SLEEP, STICK / Math.max(1, view.z / 2)));
    }
    if (step.kind !== 'eyes' && character.eyes.find((l) => l.length)) out.push(...boneToNote(character.eyes.find((l) => l.length)!, head));
    if (step.kind !== 'mouth' && character.mouths.find((l) => l.length)) out.push(...boneToNote(character.mouths.find((l) => l.length)!, head));
    return out;
  }, [placed, character, step, head, view]);

  const paint = useCallback(
    (extra?: VStroke[], skip?: ReadonlySet<number>) => {
      const ctx = cv.current?.getContext('2d');
      if (!ctx || !px) return;
      paintNote(ctx, skip?.size ? current.filter((s) => !skip.has(s.id)) : current, px, {
        paper: true,
        view,
        figures: scenery,
        after: (c) => {
          // The part to draw, glowing under the pen (drawn last so it shows through the ink, faintly).
          if (step.kind === 'part' && !current.length) {
            c.globalAlpha = 0.55;
            drawVectors(c, [stickOf(focus, GLOW, (STICK * 2.2) / Math.max(1, view.z / 2))], px, px);
            c.globalAlpha = 1;
          }
          if (extra?.length) drawVectors(c, extra, px, px);
        },
      });
    },
    [current, px, view, scenery, step, focus],
  );
  useLayoutEffect(() => paint(), [paint]);

  // ---- drawing
  const toNoteXY = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width;
    const my = (e.clientY - r.top) / r.height;
    return { x: (mx - view.ox) / view.z, y: (my - view.oy) / view.z };
  };
  const sample = (e: PointerEvent): Pt => ({ ...toNoteXY(e), p: e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.6, tilt: 0, t: e.timeStamp });

  const change = (next: Character) => {
    setPast((p) => [...p.slice(-60), character]);
    onChange(next);
  };
  const save = (strokesOnNote: VStroke[]) => {
    if (step.kind === 'part') change(setPart(character, step.bone, strokesToBone(strokesOnNote, focus)));
    else change(setLook(character, step.kind, look, strokesToBone(strokesOnNote, head)));
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = true;
    // Once a pen has been used, a resting palm never draws.
    if (e.pointerType === 'touch' && penSeen.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (live.current) return;
    try {
      cv.current?.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    if (tool === 'eraser') {
      live.current = { id: e.pointerId, erase: true, hit: new Set() };
      erase(e.nativeEvent);
      return;
    }
    const stab = new Stabilizer(0, 0.3);
    live.current = { id: e.pointerId, stab, pts: stab.push(sample(e.nativeEvent)) };
  };
  const erase = (e: PointerEvent) => {
    const g = live.current;
    if (!g || !('erase' in g)) return;
    const hit = hitStroke(current.filter((s) => !g.hit.has(s.id)), toNoteXY(e), 0.012 / view.z);
    if (hit) {
      g.hit.add(hit.id);
      paint(undefined, g.hit);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const g = live.current;
    if (!g || g.id !== e.pointerId) return;
    if ('erase' in g) return erase(e.nativeEvent);
    const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e.nativeEvent]) g.pts.push(...g.stab.push(sample(ev)));
    paint([toVector(0, g.pts, width / view.z, color)]);
  };
  const onUp = (e: React.PointerEvent) => {
    const g = live.current;
    if (!g || g.id !== e.pointerId) return;
    live.current = null;
    if ('erase' in g) {
      if (g.hit.size) save(current.filter((s) => !g.hit.has(s.id)));
      return;
    }
    const pts = [...g.pts, ...g.stab.finish(sample(e.nativeEvent))];
    if (!pts.length || e.type === 'pointercancel') return paint();
    const id = current.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    save([...current, toVector(id, pts, width / view.z, color)]);
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    onChange(prev);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const go = (k: number) => {
    setAt(Math.max(0, Math.min(all.length - 1, k)));
    setLookIndex(0);
  };
  const isLast = at >= all.length - 1;
  const { drawn, total } = progress(character);
  const looks = step.kind === 'part' ? [] : looksOf(step.kind);
  const hint =
    step.kind === 'part'
      ? current.length
        ? `This is the ${step.name.toLowerCase()}. Draw more, or go on to the next part.`
        : `Draw the ${step.name.toLowerCase()} over the orange ${focus.bone.kind === 'head' ? 'circle' : 'line'}. It will move with that bone. Or skip it: it stays a stick.`
      : step.kind === 'eyes'
        ? 'Draw a pair of eyes on the head. Add more looks (open, shut, surprised) to pick from on each note.'
        : 'Draw a mouth on the head. Add more looks (smile, shout) to pick from on each note.';

  return (
    <div className="fb-walk" role="dialog" aria-label={`Drawing ${character.name}`}>
      <header className="fb-walk-top">
        <div className="fb-walk-title">
          <h2>{step.name}</h2>
          <p className="fb-hint">
            {character.name} · part {at + 1} of {all.length} · {drawn} of {total} body parts drawn
          </p>
        </div>
        <button type="button" className="btn primary" onClick={onClose}>
          Done for now
        </button>
      </header>

      <nav className="fb-walk-steps" aria-label="Parts">
        {all.map((s, k) => (
          <button key={s.kind === 'part' ? s.bone : s.kind} type="button" className="fb-chip" aria-current={k === at ? 'step' : undefined} data-done={isDone(character, s) || undefined} onClick={() => go(k)}>
            {s.name}
          </button>
        ))}
      </nav>

      <div className="fb-walk-tools" role="toolbar" aria-label="Drawing tools">
        <IconButton icon="pencil" label="Pen" pressed={tool === 'pen'} onClick={() => setTool('pen')} />
        <IconButton icon="eraser" label="Eraser" pressed={tool === 'eraser'} onClick={() => setTool('eraser')} />
        <span className="fb-sep" aria-hidden />
        {WIDTHS.map((w) => (
          <button key={w.value} type="button" className="fb-width" aria-label={w.label} title={w.label} aria-pressed={tool === 'pen' && width === w.value} onClick={() => (setWidth(w.value), setTool('pen'))}>
            <span style={{ width: 4 + w.value * 500, height: 4 + w.value * 500 }} />
          </button>
        ))}
        <span className="fb-sep" aria-hidden />
        {COLORS.map((c) => (
          <button key={c.value} type="button" className="fb-swatch" aria-label={c.label} title={c.label} aria-pressed={tool === 'pen' && color === c.value} onClick={() => (setColor(c.value), setTool('pen'))}>
            <span style={{ background: c.value }} />
          </button>
        ))}
        <span className="fb-sep" aria-hidden />
        <IconButton icon="undo" label="Undo" onClick={undo} disabled={!past.length} />
        <button type="button" className="btn small" disabled={!current.length} onClick={() => save([])}>
          Clear this part
        </button>
      </div>

      {step.kind !== 'part' && (
        <div className="fb-walk-looks" role="group" aria-label={step.kind === 'eyes' ? 'Eye looks' : 'Mouth looks'}>
          {Array.from({ length: Math.max(1, looks.length, look + 1) }, (_, k) => (
            <button key={k} type="button" className="fb-chip" aria-pressed={k === look} data-done={(looks[k]?.length ?? 0) > 0 || undefined} onClick={() => setLookIndex(k)}>
              Look {k + 1}
            </button>
          ))}
          <button type="button" className="fb-chip" disabled={look >= looks.length || !looks[looks.length - 1]?.length} onClick={() => setLookIndex(looks.length)}>
            + Another look
          </button>
        </div>
      )}

      <div className="fb-walk-pad" ref={box}>
        <canvas
          ref={cv}
          className="fb-walk-note"
          width={px}
          height={px}
          style={{ width: side, height: side }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          role="img"
          aria-label={`${character.name}: draw the ${step.name.toLowerCase()} here`}
        />
      </div>

      <p className="fb-walk-hint">{hint}</p>
      <footer className="fb-walk-bottom">
        <button type="button" className="btn" disabled={at === 0} onClick={() => go(at - 1)}>
          Back
        </button>
        <button type="button" className="btn" onClick={() => (isLast ? onClose() : go(at + 1))}>
          {current.length ? (isLast ? 'Finish' : 'Next part') : isLast ? 'Finish' : 'Skip, keep a stick'}
        </button>
      </footer>
    </div>
  );
}
