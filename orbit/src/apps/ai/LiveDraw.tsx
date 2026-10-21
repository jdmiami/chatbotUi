import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon, type IconName } from '../../ui/Icon';
import type { LocalAi, StudioJob, StudioMakerInfo } from '../../services/ai/LocalAi';
import { LiveDrawLink, type LiveDrawState } from '../../services/ai/liveDraw';
import { COLORS, Sketch, TOOL_SIZE, drawAll, drawStroke, fillGap, pressureOf, sketchLines, smoothPoint, tiltOf, type Pt, type Stroke, type Tool } from './sketch';
import { PENDING_TEXT } from './makerCatalog';
import './liveDraw.css';

/** How often a drawing goes to the machine while you draw (only one is ever on its way). */
const SEND_EVERY_MS = 150;
/** A two-finger tap shorter than this, that barely moves, is Undo. */
const TAP_MS = 350;

const TOOLS: { value: Tool; label: string; icon: IconName }[] = [
  { value: 'pen', label: 'Pen', icon: 'pencil' },
  { value: 'brush', label: 'Brush', icon: 'brush' },
  { value: 'eraser', label: 'Eraser', icon: 'eraser' },
];

/**
 * Live draw (Make): draw with the Apple Pencil or a finger on the left (or on top), and see the AI
 * machine turn it into a picture on the right (or below) while you draw. Finish makes a full-quality
 * version (Sketch finish) that lands in the gallery like any picture.
 */
export function LiveDraw({
  ai,
  machineOn,
  makers,
  onOpenMakers,
  onStarted,
}: {
  ai: LocalAi;
  machineOn: boolean;
  /** Every maker Orbit knows (CreateView's list): Live draw's and Sketch finish's state. */
  makers: StudioMakerInfo[];
  onOpenMakers?: () => void;
  /** A Sketch finish job started (shown with the other jobs). */
  onStarted: (job: StudioJob) => void;
}) {
  const toast = useShell((s) => s.toast);
  const live = makers.find((m) => m.id === 'live-draw') ?? null;
  const finisher = makers.find((m) => m.id === 'sketch-finish') ?? null;
  const liveReady = machineOn && Boolean(live?.installed);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [prompt, setPrompt] = useState('');
  const [follow, setFollow] = useState(0.6);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [counts, setCounts] = useState({ undo: false, redo: false, empty: true });
  const [preview, setPreview] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [via, setVia] = useState<'socket' | 'post'>('socket');
  const [machine, setMachine] = useState<LiveDrawState | null>(null);
  /** A Pencil has been used: fingers no longer draw (palm rejection) until you say so. */
  const [penMode, setPenMode] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const paperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sketch = useRef(new Sketch());
  const side = useRef(0); // canvas pixels
  const drawing = useRef(new Map<number, { stroke: Stroke; last: Pt; raw: Pt }>());
  const touches = useRef(new Map<number, { x: number; y: number; at: number }>());
  const gesture = useRef<{ at: number; moved: boolean } | null>(null);
  const penSeen = useRef(false);
  const link = useRef<LiveDrawLink | null>(null);
  const lastSent = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest words and settings, read by the pointer handlers without re-binding them.
  const settings = useRef({ tool, color, prompt, follow, seed });
  settings.current = { tool, color, prompt, follow, seed };

  const ctx = () => canvasRef.current?.getContext('2d') ?? null;
  const redraw = useCallback(() => {
    const c = ctx();
    if (!c) return;
    drawAll(c, [...sketch.current.strokes, ...[...drawing.current.values()].map((d) => d.stroke)], side.current);
  }, []);
  const syncCounts = () => setCounts({ undo: sketch.current.canUndo, redo: sketch.current.canRedo, empty: sketch.current.empty });

  // The canvas fills its square box, at the screen's own pixel density.
  useEffect(() => {
    const box = paperRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const fit = () => {
      const css = Math.max(1, Math.floor(box.clientWidth));
      const px = Math.round(css * Math.min(3, window.devicePixelRatio || 1));
      if (px === side.current) return;
      side.current = px;
      canvas.width = px;
      canvas.height = px;
      redraw();
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(box);
    window.addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [redraw]);

  // ---- the line to the machine
  useEffect(() => {
    if (!liveReady) return;
    const l = new LiveDrawLink({
      access: () => ai.liveAccess(),
      onFrame: (image, ms) => {
        setPreview(image);
        setLastMs(ms);
        setProblem(null);
      },
      onError: (message, info) => {
        setProblem(message);
        if (info.blocked) toast(message, 'error');
      },
      onMode: setVia,
    });
    link.current = l;
    // Start loading the model now, and say how it is going until it's ready.
    let stop = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const poll = (warm: boolean) => {
      (warm ? ai.warmLiveDraw() : ai.liveDrawState())
        .then((s) => {
          if (stop) return;
          setMachine(s);
          if (s.worker !== 'ready' && !s.error) t = setTimeout(() => poll(false), 3000);
        })
        .catch(() => {});
    };
    poll(true);
    return () => {
      stop = true;
      if (t) clearTimeout(t);
      l.close();
      link.current = null;
    };
  }, [liveReady, ai, toast]);

  const sendNow = useCallback(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    const l = link.current;
    if (!l) return;
    const strokes = [...sketch.current.strokes, ...[...drawing.current.values()].map((d) => d.stroke)];
    if (!strokes.some((s) => s.tool !== 'eraser')) {
      setPreview(null);
      return;
    }
    lastSent.current = Date.now();
    const { prompt: words, follow: f, seed: s } = settings.current;
    l.send({ prompt: words.trim(), follow: f, seed: s, image: sketchLines(strokes, 512) });
  }, []);
  /** While drawing: at most every SEND_EVERY_MS. */
  const schedule = useCallback(
    (delay = SEND_EVERY_MS) => {
      if (!link.current || sendTimer.current) return;
      const wait = Math.max(0, lastSent.current + delay - Date.now());
      if (!wait && delay === SEND_EVERY_MS) return sendNow();
      sendTimer.current = setTimeout(sendNow, wait || delay);
    },
    [sendNow],
  );
  // New words, a new "follow" or a new look: send again once you stop changing them.
  useEffect(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    if (!counts.empty) schedule(400);
  }, [prompt, follow, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (sendTimer.current && clearTimeout(sendTimer.current)), []);

  // ---- drawing
  const pointOf = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string; tiltX?: number; tiltY?: number; altitudeAngle?: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
      p: pressureOf(e),
      tilt: tiltOf(e),
    };
  };

  const cancelTouchStrokes = () => {
    let any = false;
    for (const [id, d] of drawing.current) {
      if (d.stroke && touches.current.has(id)) {
        drawing.current.delete(id);
        any = true;
      }
    }
    if (any) redraw();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: Date.now() });
      if (touches.current.size >= 2) {
        // Two fingers: a gesture (a quick tap is Undo), never a line.
        cancelTouchStrokes();
        gesture.current ??= { at: Date.now(), moved: false };
        return;
      }
      // A Pencil is in use: a resting palm or finger doesn't draw.
      if (penSeen.current) return;
    }
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true;
      setPenMode(true);
      cancelTouchStrokes();
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    const { tool: t, color: c } = settings.current;
    const raw = pointOf(e.nativeEvent);
    const stroke: Stroke = { tool: t, color: c, size: TOOL_SIZE[t], points: [raw] };
    drawing.current.set(e.pointerId, { stroke, last: raw, raw });
    const g = ctx();
    if (g) drawStroke(g, stroke, side.current);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch' && gesture.current) {
      const start = touches.current.get(e.pointerId);
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 24) gesture.current.moved = true;
      return;
    }
    const d = drawing.current.get(e.pointerId);
    if (!d) return;
    e.preventDefault();
    // Every sample since the last event (Pencil events come faster than the screen draws).
    const native = e.nativeEvent as PointerEvent;
    let samples: PointerEvent[] = [];
    try {
      samples = native.getCoalescedEvents?.() ?? [];
    } catch {
      samples = [];
    }
    if (!samples.length) samples = [native];
    const from = d.stroke.points.length;
    for (const s of samples) {
      const raw = pointOf(s);
      const next = smoothPoint(d.last, raw);
      // Sparse events: fill the gap so a fast line has no corners.
      d.stroke.points.push(...fillGap(d.last, next), next);
      d.last = next;
      d.raw = raw;
    }
    const g = ctx();
    if (g) drawStroke(g, d.stroke, side.current, from);
    schedule();
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (gesture.current && touches.current.size === 0) {
        const g = gesture.current;
        gesture.current = null;
        if (!g.moved && Date.now() - g.at < TAP_MS && !penDown()) undo();
        return;
      }
    }
    const d = drawing.current.get(e.pointerId);
    if (!d) return;
    drawing.current.delete(e.pointerId);
    if (cancelled) {
      redraw();
      return;
    }
    // The pen lifts where it really is (the smoothing lags a little behind).
    if (d.raw !== d.last) d.stroke.points.push(d.raw);
    sketch.current.add(d.stroke);
    syncCounts();
    redraw();
    sendNow();
  };
  const penDown = () => [...drawing.current.values()].length > 0;

  const undo = () => {
    if (sketch.current.undo()) {
      redraw();
      syncCounts();
      sendNow();
    }
  };
  const redo = () => {
    if (sketch.current.redo()) {
      redraw();
      syncCounts();
      sendNow();
    }
  };
  const clear = () => {
    sketch.current.clear();
    redraw();
    syncCounts();
    setPreview(null);
  };

  const finish = async () => {
    if (counts.empty || !prompt.trim() || !finisher?.installed || finishing) return;
    setFinishing(true);
    try {
      const job = await ai.createStudioJob({ kind: 'image', maker: 'sketch-finish', prompt: prompt.trim(), image: sketchLines(sketch.current.strokes, 1024), follow, size: 'square' });
      if (job.status === 'error') toast(job.error || 'That did not start.', 'error');
      else {
        onStarted(job);
        toast('Finishing your drawing: it goes to your gallery when it is done.', 'info');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setFinishing(false);
    }
  };

  const liveStatus = (() => {
    if (!machineOn) return 'Draw away: turn on your AI machine to see it come alive.';
    if (!live) return 'Checking your AI machine…';
    if (live.pending) return `Live draw: ${PENDING_TEXT.toLowerCase()}.`;
    if (!live.installed) return live.wanted ? `Live draw is downloading: ${live.percent}%.` : 'Add Live draw in the Store to see a picture while you draw.';
    if (problem) return problem;
    if (machine?.paused) return machine.paused;
    if (machine?.error && machine.worker !== 'ready') return machine.error;
    if (machine && machine.worker !== 'ready' && !preview) return `${machine.loading ?? 'Loading Live draw'} on your AI machine…`;
    if (counts.empty) return 'Start drawing: the picture appears here.';
    return lastMs ? `Live · ${lastMs} ms a picture${via === 'post' ? ' (one by one: the live connection is not available)' : ''}` : 'Live';
  })();
  const finishNote = !finisher ? null : finisher.pending ? `Sketch finish: ${PENDING_TEXT.toLowerCase()}.` : !finisher.installed ? (finisher.wanted ? `Sketch finish is downloading: ${finisher.percent}%.` : 'Add Sketch finish in the Store to finish drawings at full quality.') : !prompt.trim() ? 'Say what it is, then Finish.' : null;

  return (
    <section className="ld" aria-label="Live draw">
      <div className="ld-tools" role="toolbar" aria-label="Drawing tools">
        <div className="ld-group" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={tool === t.value} aria-label={t.label} title={t.label} className="ld-tool" onClick={() => setTool(t.value)}>
              <Icon name={t.icon} size={20} />
            </button>
          ))}
        </div>
        <div className="ld-group" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={color === c.value} aria-label={c.label} title={c.label} className="ld-swatch" onClick={() => setColor(c.value)}>
              <span style={{ background: c.value }} />
            </button>
          ))}
        </div>
        <div className="ld-group">
          <button type="button" className="ld-tool" aria-label="Undo" title="Undo (or tap with two fingers)" disabled={!counts.undo} onClick={undo}>
            <Icon name="undo" size={20} />
          </button>
          <button type="button" className="ld-tool" aria-label="Redo" title="Redo" disabled={!counts.redo} onClick={redo}>
            <Icon name="redo" size={20} />
          </button>
          <button type="button" className="ld-tool" aria-label="Clear" title="Clear (Undo brings it back)" disabled={!counts.undo && counts.empty} onClick={clear}>
            <Icon name="trash" size={20} />
          </button>
        </div>
      </div>

      <div className="ld-panes">
        <div className="ld-pane">
          <div className="ld-paper" ref={paperRef}>
            <canvas
              ref={canvasRef}
              className="ld-canvas"
              role="img"
              aria-label="Your drawing"
              data-strokes={sketch.current.strokes.length}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endPointer(e, false)}
              onPointerCancel={(e) => endPointer(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
          {penMode && (
            <p className="ld-hint">
              Pencil mode: your hand can rest on the screen.{' '}
              <button
                type="button"
                className="ld-link"
                onClick={() => {
                  penSeen.current = false;
                  setPenMode(false);
                }}
              >
                Draw with a finger
              </button>
            </p>
          )}
        </div>
        <div className="ld-pane">
          <div className="ld-preview" data-live={Boolean(preview)}>
            {preview ? <img src={preview} alt="Live picture of your drawing" /> : <Icon name="sparkle" size={40} />}
          </div>
          <p className="ai-muted ld-status" role="status">
            {liveStatus}
          </p>
          {machineOn && live && !live.installed && !live.wanted && !live.pending && (
            <button type="button" className="btn ghost" onClick={() => onOpenMakers?.()}>
              <Icon name="plus" size={16} /> Get Live draw
            </button>
          )}
        </div>
      </div>

      <div className="ld-words">
        <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="What is it?" placeholder="What is it? e.g. a cat on a windowsill, oil painting" maxLength={300} enterKeyHint="done" />
        <label className="ld-follow">
          <span>Follow my lines</span>
          <input type="range" min={0} max={1} step={0.05} value={follow} onChange={(e) => setFollow(Number(e.target.value))} aria-valuetext={follow < 0.34 ? 'Loosely' : follow < 0.67 ? 'Somewhat' : 'Closely'} />
          <span className="ai-muted">{follow < 0.34 ? 'Loosely' : follow < 0.67 ? 'Somewhat' : 'Closely'}</span>
        </label>
        <div className="ld-actions">
          <button type="button" className="btn" onClick={() => setSeed(Math.floor(Math.random() * 1e6))} disabled={counts.empty || !liveReady}>
            <Icon name="refresh" size={16} /> New look
          </button>
          <button type="button" className="btn primary" onClick={() => void finish()} disabled={counts.empty || !prompt.trim() || !machineOn || !finisher?.installed || finishing}>
            <Icon name="sparkle" size={16} /> {finishing ? 'Starting…' : 'Finish'}
          </button>
        </div>
        {finishNote && <p className="ai-muted">{finishNote}</p>}
      </div>
    </section>
  );
}
