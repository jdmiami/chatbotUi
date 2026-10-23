import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { useMotionLevel } from '../../motion/MotionProvider';
import { transitionFor } from '../../motion/springs';
import { orbHome, orbNote } from '../../studio/orbGuide';
import { OrbSpot } from '../../studio/Sheets';
import {
  allowedEngine,
  followJob,
  getLiveCanvas,
  otherEngineLine,
  type CanvasEngine,
  type CanvasFrameInput,
  type CanvasLink,
  type CanvasSize,
  type CanvasStatus,
  type EngineState,
  type LiveCanvasApi,
  type LivingLink,
  type LivingState,
  type SketchGuess,
} from '../../services/ai/liveCanvas';
import type { StudioItem, StudioJob } from '../../services/ai/LocalAi';
import { CanvasDoc, type DrawLayer, type Op } from './canvas/doc';
import { PictureHistory } from './canvas/history';
import { defaultPose, poseImage } from './canvas/pose';
import { joinPrompt, stackOf, flattenOnto, type LayerId, type XY } from './canvas/raster';
import { drawCover, fileToDataUrl, layerPng, loadImage, makeCanvas, maskPng, regionPng, renderOps } from './canvas/render';
import { canvasBlob, download, layeredPsd, stamp, timelapse } from './canvas/exporters';
import { Stage, type Region, type StageHandle, type StageTool } from './canvas/Stage';
import { COLORS } from './canvas/sketch';
import { MachineCard, autoOffNote, price } from './MachineCard';
import { EnginePicker, Guesses, HistoryPanel, LayersPanel, LookPanel, ProPanel, Section, SizePicker, Slider, ToolsPanel, styleWords } from './panels';
import './livedraw.css';

/** At most this often while you draw (only one frame is ever on its way; the newest waits). */
export const SEND_EVERY_MS = 120;
/** The sketch reader looks after this long without drawing, when there are no words yet. */
const READ_AFTER_MS = 2000;
const SIZE_KEY = 'orbit:livedraw:size';

type Mode = 'live' | 'paint';
type Tab = 'tools' | 'look' | 'layers' | 'pro' | 'history';

const hasInk = (ops: Op[]) => ops.some((o) => o.kind === 'fill' || o.stroke.tool !== 'eraser');
const newSeed = () => Math.floor(Math.random() * 1e9);

function loadSize(): CanvasSize {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return v === 768 || v === 1024 ? v : 512;
  } catch {
    return 512;
  }
}

const NOTES: Record<Mode, string> = {
  live: 'Live: draw, and the picture underneath follows your lines. Ink fades your strokes; Keep holds a picture you like.',
  paint: 'Paint over: brush over the part of the picture that should change. Everything else stays as it is.',
};

/**
 * Live Draw: one canvas, the AI picture drawn under your strokes by the drawing machine while you
 * draw. Live, Paint over, Keep and Bring to life on the same canvas; tools on the left (iPad held
 * sideways) or in a sheet (iPhone, iPad upright); layers, the look, the pro tools and every picture
 * so far on the right.
 */
export default function LiveDrawApp({ isActive }: AppProps) {
  const api = useMemo(() => getLiveCanvas(), []);
  const toast = useShell((s) => s.toast);
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [powering, setPowering] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
      setStatusError(null);
    } catch (err) {
      setStatusError((err as Error).message);
    }
  }, [api]);
  const waking = status?.state === 'starting' || status?.state === 'downloading';
  // Every 3 s while it starts; otherwise now and then (it may turn itself off).
  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const t = setInterval(() => void refresh(), waking || powering ? 3000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refresh, waking, powering]);

  // Once on, the canvas stays live until the machine is really off (one odd answer must not drop it).
  const wasOn = useRef(false);
  if (status?.state === 'on') wasOn.current = true;
  else if (status && status.state !== 'error') wasOn.current = false;
  const machineOn = status?.state === 'on' || wasOn.current;

  const power = async (action: 'start' | 'stop') => {
    setPowering(true);
    try {
      setStatus(await api.power(action));
      if (action === 'start') toast('Starting your drawing machine. Keep drawing: the picture appears the moment it is on.', 'info');
      else {
        wasOn.current = false;
        setCardOpen(true);
        toast('Your drawing machine is off.', 'info');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  // The orb: what this screen is, while it is showing.
  useEffect(() => {
    if (!isActive) return;
    const root = document.documentElement;
    root.dataset.orbContext =
      'Live Draw: one square canvas. Strokes are drawn with the tools on the left (or in the Tools sheet); the drawing machine paints a picture under them. Ink fades the strokes. Modes at the bottom: Live, Paint over (brush where it may change), Keep (hold this picture) and Bring to life (the picture moves while you draw). Layers, look, pro tools and history are on the right (or in the sheet).';
    if (!machineOn) orbNote('Start the drawing machine to see your sketch become a picture. You can draw while it starts.');
    return () => {
      delete root.dataset.orbContext;
      orbNote(null);
    };
  }, [isActive, machineOn]);

  const showCard = !machineOn && cardOpen && status !== null;
  return (
    <div className="ldx-root">
      <Studio api={api} status={status} machineOn={machineOn} isActive={isActive} powering={powering} onPower={(a) => void power(a)} onShowCard={() => setCardOpen(true)} cardShown={showCard} />
      <AnimatePresence>
        {showCard && (
          <div className="ldx-card-wrap" key="card">
            <MachineCard status={status} error={statusError} powering={powering} onStart={() => void power('start')} onLater={() => setCardOpen(false)} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Studio({
  api,
  status,
  machineOn,
  isActive,
  powering,
  onPower,
  onShowCard,
  cardShown,
}: {
  api: LiveCanvasApi;
  status: CanvasStatus | null;
  machineOn: boolean;
  isActive: boolean;
  powering: boolean;
  onPower: (a: 'start' | 'stop') => void;
  onShowCard: () => void;
  /** The machine card is up (its Start is where the orb sits). */
  cardShown: boolean;
}) {
  const toast = useShell((s) => s.toast);
  const level = useMotionLevel();
  const doc = useMemo(() => new CanvasDoc(), []);
  const history = useMemo(() => new PictureHistory(), []);
  const stage = useRef<StageHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---- layout: iPad held sideways gets rails; everything else a full canvas and a sheet
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => setWide(el.clientWidth >= 900 && el.clientWidth > el.clientHeight * 1.05);
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // ---- drawing
  const [tool, setTool] = useState<StageTool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [sizeScale, setSizeScale] = useState(1);
  const [layer, setLayer] = useState<DrawLayer>('sketch');
  const [visible, setVisible] = useState<Record<LayerId, boolean>>({ sketch: true, colour: true, picture: true, reference: true });
  const [ink, setInk] = useState(100);
  const [penOnly, setPenOnly] = useState(false);
  const [counts, setCounts] = useState({ undo: false, redo: false, empty: true, version: 0, strokes: 0 });
  const sync = () => setCounts({ undo: doc.canUndo, redo: doc.canRedo, empty: doc.empty, version: doc.version, strokes: doc.count('sketch') + doc.count('colour') });

  // ---- what to make
  const [mode, setMode] = useState<Mode>('live');
  const [prompt, setPrompt] = useState('');
  const [styles, setStyles] = useState<string[]>([]);
  const [follow, setFollow] = useState(0.7);
  const [strength, setStrength] = useState(0.65);
  const [seed, setSeed] = useState(newSeed);
  const [seedLocked, setSeedLocked] = useState(false);
  const [size, setSizeState] = useState<CanvasSize>(loadSize);
  const setSize = (s: CanvasSize) => {
    setSizeState(s);
    try {
      localStorage.setItem(SIZE_KEY, String(s));
    } catch {
      /* private mode */
    }
  };
  const [siteEngine, setSiteEngine] = useState<CanvasEngine | null>(api.access.engine);
  const [engineChoice, setEngineChoice] = useState<CanvasEngine | null>(null);
  const engine: CanvasEngine = allowedEngine(engineChoice ?? siteEngine ?? 'licensed', siteEngine);
  const canSwitch = api.paths.door === 'owner' && siteEngine === 'fast';

  // ---- the picture
  const [still, setStill] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [, setHistTick] = useState(0);
  const bumpHistory = () => setHistTick((n) => n + 1);

  // ---- pro
  const [regions, setRegions] = useState<Region[]>([]);
  const [lasso, setLasso] = useState(false);
  const [poseOn, setPoseOn] = useState(false);
  const [poseShown, setPoseShown] = useState(true);
  const [pose, setPose] = useState<XY[]>(defaultPose);
  const [styleRef, setStyleRef] = useState<{ image: string; weight: number } | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<SketchGuess[]>([]);
  const [reading, setReading] = useState(false);
  const [finishJob, setFinishJob] = useState<StudioJob | null>(null);
  const [finished, setFinished] = useState<StudioItem | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  // ---- the machine
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [via, setVia] = useState<'socket' | 'post'>('socket');
  const [problem, setProblem] = useState<string | null>(null);
  const [engineLine, setEngineLine] = useState<string | null>(null);
  const [engines, setEngines] = useState<Record<CanvasEngine, EngineState> | null>(null);
  const [loadingText, setLoadingText] = useState<string | null>(null);

  // ---- Bring to life
  const [living, setLiving] = useState<LivingState | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [motionAmount, setMotionAmount] = useState(0.6);
  const [saving, setSaving] = useState(false);
  const livingRef = useRef<LivingLink | null>(null);
  const lifeOn = living !== null && living !== 'stopped';
  const picture = lifeOn && liveFrame ? liveFrame : still;

  // The newest settings, for the senders (read without re-binding anything).
  const now = useRef({ engine, mode, prompt, styles, seed, follow, strength, size, base, still, regions, poseOn, pose, styleRef, lifeOn });
  now.current = { engine, mode, prompt, styles, seed, follow, strength, size, base, still, regions, poseOn, pose, styleRef, lifeOn };
  const words = joinPrompt(prompt, styleWords(styles));

  // ---- the link
  const link = useRef<CanvasLink | null>(null);
  const sentPrompt = useRef('');
  const lastSent = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionCache = useRef(new Map<string, string>());

  useEffect(() => {
    // Learn the site's engine (also while the machine is off: the token answer says it).
    void api.access.get().then(
      () => setSiteEngine(api.access.engine),
      () => {},
    );
  }, [api, machineOn]);

  useEffect(() => {
    if (!machineOn) return;
    const l = api.link({
      onFrame: (image, ms) => {
        if (now.current.lifeOn) return;
        setStill(image);
        history.add(image, sentPrompt.current);
        bumpHistory();
        setLastMs(ms);
        setProblem(null);
        setEngineLine(null);
      },
      onError: (message, info) => {
        setProblem(message);
        setEngineLine(otherEngineLine(message, now.current.engine, api.paths.door === 'owner' && api.access.engine === 'fast'));
        if (info.blocked) toast(message, 'error');
      },
      onState: (e, loading) => {
        setEngines(e);
        setLoadingText(loading ?? null);
      },
      onMode: setVia,
    });
    link.current = l;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      api
        .info()
        .then((i) => {
          if (stop) return;
          setEngines(i.engines);
          if (Object.values(i.engines ?? {}).some((s) => s === 'loading')) t = setTimeout(poll, 4000);
        })
        .catch(() => {});
    };
    void api.warm(engine).catch(() => {});
    poll();
    return () => {
      stop = true;
      if (t) clearTimeout(t);
      l.close();
      link.current = null;
    };
  }, [machineOn, api, engine, history, toast]);

  const buildFrame = useCallback((): CanvasFrameInput | null => {
    const st = stage.current;
    if (!st) return null;
    const s = now.current;
    const sketchOps = st.live('sketch');
    const colourOps = st.live('colour');
    if (!hasInk(sketchOps) && !hasInk(colourOps) && !s.base) return null;
    const side = s.size;
    const frame: CanvasFrameInput = {
      engine: s.engine,
      mode: s.mode,
      prompt: joinPrompt(s.prompt, styleWords(s.styles)),
      seed: s.seed,
      follow: s.follow,
      strength: s.strength,
      size: side,
      sketch: layerPng(sketchOps, side, { lines: true, skipFills: true }),
    };
    if (hasInk(colourOps)) {
      const lines = makeCanvas(side);
      renderOps(lines, sketchOps);
      frame.color = layerPng(colourOps, side, { boundary: lines });
    }
    const kept = s.mode === 'paint' ? (s.base ?? s.still) : s.base;
    if (kept?.startsWith('data:')) frame.base = kept;
    if (s.mode === 'paint') {
      const mask = maskPng(st.live('mask'), side);
      if (!mask || !frame.base) return null;
      frame.mask = mask;
    }
    const named = s.regions.filter((r) => r.prompt.trim());
    if (named.length) {
      frame.regions = named.map((r) => {
        const key = `${r.id}:${side}:${r.points.length}`;
        let m = regionCache.current.get(key);
        if (!m) regionCache.current.set(key, (m = regionPng(r.points, side)));
        return { mask: m, prompt: r.prompt.trim() };
      });
    }
    if (s.poseOn) frame.pose = poseImage(s.pose, side);
    if (s.styleRef && api.paths.styleRef) frame.ref = s.styleRef;
    return frame;
  }, [api]);

  const sendNow = useCallback(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    const l = link.current;
    if (!l || now.current.lifeOn) return;
    const f = buildFrame();
    if (!f) return;
    lastSent.current = Date.now();
    sentPrompt.current = f.prompt;
    l.send(f);
  }, [buildFrame]);

  /** While drawing: at most every SEND_EVERY_MS; `delay` for settings (sent once you stop changing them). */
  const schedule = useCallback(
    (delay = SEND_EVERY_MS) => {
      if (!link.current || sendTimer.current) return;
      const wait = Math.max(0, lastSent.current + delay - Date.now());
      if (!wait && delay === SEND_EVERY_MS) return sendNow();
      sendTimer.current = setTimeout(sendNow, wait || delay);
    },
    [sendNow],
  );
  useEffect(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    if (!counts.empty || base) schedule(400);
  }, [words, follow, strength, seed, mode, regions, pose, poseOn, styleRef, base, size, engine, machineOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (sendTimer.current && clearTimeout(sendTimer.current)), []);

  // ---- the orb's note for the mode
  useEffect(() => {
    if (!isActive || !machineOn || guesses.length) return;
    orbNote(lifeOn ? 'Bring to life: the picture moves while you draw. Motion sets how much; Save last 10 s keeps it in your gallery.' : NOTES[mode]);
  }, [isActive, machineOn, mode, lifeOn, guesses.length]);

  // ---- drawing events
  const onStroke = (phase: 'move' | 'end') => {
    if (phase === 'move') return schedule();
    sync();
    sendNow();
  };
  const undo = () => {
    const t = doc.undo();
    if (!t) return;
    stage.current?.redraw(t);
    sync();
    sendNow();
  };
  const redo = () => {
    const t = doc.redo();
    if (!t) return;
    stage.current?.redraw(t);
    sync();
    sendNow();
  };
  const clearAll = () => {
    if (mode === 'paint') doc.clear('mask');
    else {
      doc.clear('sketch');
      doc.clear('colour');
    }
    stage.current?.redraw();
    sync();
    if (mode !== 'paint') {
      setGuesses([]);
      if (!base) setStill(null);
    }
  };

  // ---- the sketch reader: on demand, and after a pause when there are no words yet
  const readSketch = useCallback(async () => {
    const st = stage.current;
    if (!st || doc.empty) return;
    setReading(true);
    try {
      const c = makeCanvas(512);
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 512);
      for (const id of ['colour', 'sketch'] as const) {
        const src = st.canvas(id);
        if (src) g.drawImage(src, 0, 0, 512, 512);
      }
      const found = await api.read(c.toDataURL('image/jpeg', 0.85));
      setGuesses(found);
      if (found.length) orbNote(`It looks like ${found[0].label}. Tap a guess to use its words, or keep drawing.`);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setReading(false);
    }
  }, [api, doc]);
  const lastRead = useRef(-1);
  useEffect(() => {
    // Not while you are circling a region, painting over or the picture is alive: it would get in the way.
    if (!machineOn || prompt.trim() || counts.empty || counts.strokes === lastRead.current || lasso || mode !== 'live' || lifeOn) return;
    const t = setTimeout(() => {
      lastRead.current = counts.strokes;
      void readSketch();
    }, READ_AFTER_MS);
    return () => clearTimeout(t);
  }, [counts.strokes, counts.empty, prompt, machineOn, readSketch, lasso, mode, lifeOn]);
  const pickGuess = (g: SketchGuess) => {
    setPrompt(g.prompt || g.label);
    setGuesses([]);
    orbNote(`Using “${g.label}”. Change the words any time.`);
    orbHome();
  };

  // ---- modes
  const keep = () => {
    if (!still) return toast('Draw first: Keep holds the picture under your lines.', 'info');
    setBase(still);
    history.add(still, words, 'keep');
    bumpHistory();
    if (!seedLocked) setSeed(newSeed());
    toast('Kept. Keep drawing on top of it.', 'success');
    orbHome();
  };
  const choose = (m: Mode) => {
    setMode(m);
    if (m === 'paint' && !still && !base) toast('Paint over changes a picture: draw first, so there is one.', 'info');
    orbHome();
  };

  /** The picture with your strokes on it (Bring to life sends this a few times a second). */
  const stillImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const src = base ?? still;
    if (!src) return void (stillImg.current = null);
    loadImage(src).then(
      (img) => (stillImg.current = img),
      () => {},
    );
  }, [base, still]);
  const lifeCanvas = useRef<HTMLCanvasElement | null>(null);
  const lifeSource = useCallback(() => {
    const st = stage.current;
    if (!st) return null;
    const c = (lifeCanvas.current ??= makeCanvas(512));
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 512);
    if (stillImg.current) drawCover(g, stillImg.current, 512);
    for (const id of ['colour', 'sketch'] as const) {
      const src = st.canvas(id);
      if (src) g.drawImage(src, 0, 0, 512, 512);
    }
    return c.toDataURL('image/jpeg', 0.72);
  }, []);

  const startLife = async () => {
    if (!machineOn) return toast('Start the drawing machine first.', 'info');
    if (!still && !base && doc.empty) return toast('Draw something first: it comes to life from your picture.', 'info');
    setLiveFrame(null);
    setSaving(false);
    const l = api.living({
      source: lifeSource,
      onFrame: (img) => setLiveFrame(img),
      onState: (s) => setLiving(s),
      onError: (m, info) => {
        setProblem(m);
        if (info?.blocked || info?.status === 409) toast(m, 'error');
        setSaving(false);
      },
      onSaved: () => {
        setSaving(false);
        toast('Saved the last 10 seconds to your gallery.', 'success');
      },
    });
    livingRef.current = l;
    try {
      await l.start(words || 'gentle motion', motionAmount);
    } catch (err) {
      setProblem((err as Error).message);
      setLiving(null);
    }
  };
  const stopLife = () => {
    livingRef.current?.stop();
    livingRef.current = null;
    setLiving(null);
    setLiveFrame(null);
    setTimeout(sendNow, 0);
  };
  useEffect(() => () => livingRef.current?.stop(), []);
  useEffect(() => {
    if (!machineOn && livingRef.current) stopLife();
  }, [machineOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // New words and Motion mid-stream.
  useEffect(() => {
    if (living !== 'live') return;
    const t = setTimeout(() => livingRef.current?.setPrompt(words || 'gentle motion'), 500);
    return () => clearTimeout(t);
  }, [words, living]);
  useEffect(() => {
    if (living === 'live') livingRef.current?.setStrength(motionAmount);
  }, [motionAmount, living]);

  // ---- Finish
  const finishAbort = useRef<AbortController | null>(null);
  const finish = async () => {
    const st = stage.current;
    if (!st || !machineOn) return;
    const image = base ?? still;
    if (!image && doc.empty) return toast('Draw something first.', 'info');
    if (!words) return toast('Say what it is first (or let the orb guess).', 'info');
    try {
      const sketch = layerPng(st.live('sketch'), size, { lines: true, skipFills: true });
      const job = await api.finish({ image: image ?? sketch, sketch, prompt: words, engine, size });
      if (job.status === 'error') return toast(job.error || 'That did not start.', 'error');
      toast('Finishing it at full quality: it goes to your gallery too.', 'info');
      finishAbort.current?.abort();
      const ctrl = new AbortController();
      finishAbort.current = ctrl;
      const done = await followJob(api, job, setFinishJob, ctrl.signal);
      if (done.status === 'done' && done.item) setFinished(done.item);
      else if (done.status === 'error') {
        setProblem(done.error || 'Finish stopped.');
        setEngineLine(otherEngineLine(done.error || '', engine, canSwitch));
      }
      setFinishJob(null);
    } catch (err) {
      setProblem((err as Error).message);
      setEngineLine(otherEngineLine((err as Error).message, engine, canSwitch));
      setFinishJob(null);
    }
  };
  useEffect(() => () => finishAbort.current?.abort(), []);

  // ---- files
  const pickStyleRef = async (file: File | null) => {
    if (!file) return setStyleRef(null);
    try {
      setStyleRef({ image: await fileToDataUrl(file, 768), weight: styleRef?.weight ?? 0.6 });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const pickReference = async (file: File | null) => {
    if (!file) return setReference(null);
    try {
      setReference(await fileToDataUrl(file, 1024));
      setVisible((v) => ({ ...v, reference: true }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  // ---- export
  /** Every layer at the working size (for the PNG, the PSD and the time-lapse's last frame). */
  const layersAt = async (side: number) => {
    const st = stage.current!;
    const sketch = makeCanvas(side);
    renderOps(sketch, st.live('sketch'));
    const colour = makeCanvas(side);
    renderOps(colour, st.live('colour'), { boundary: sketch });
    const fromImage = async (src: string | null) => {
      if (!src) return null;
      const c = makeCanvas(side);
      try {
        drawCover(c.getContext('2d')!, await loadImage(src), side);
        return c;
      } catch {
        return null;
      }
    };
    return { sketch, colour, picture: await fromImage(picture), reference: await fromImage(reference) };
  };
  const flatAt = async (side: number) => {
    const l = await layersAt(side);
    const out = makeCanvas(side);
    const stack = stackOf(visible, { picture: Boolean(l.picture), reference: Boolean(l.reference) }, ink);
    flattenOnto(out.getContext('2d')!, side, stack.map((s) => ({ source: l[s.id], alpha: s.alpha })));
    return { out, l };
  };
  const exportPng = async () => {
    setExporting('png');
    try {
      const { out } = await flatAt(Math.max(size, 1024));
      download(await canvasBlob(out), `live-draw-${stamp()}.png`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setExporting(null);
    }
  };
  const exportPsd = async () => {
    setExporting('psd');
    try {
      const side = Math.max(size, 1024);
      const { out, l } = await flatAt(side);
      const paper = makeCanvas(side);
      const pg = paper.getContext('2d')!;
      pg.fillStyle = '#ffffff';
      pg.fillRect(0, 0, side, side);
      const layers = [
        { name: 'Paper', canvas: paper },
        ...(l.picture ? [{ name: 'Picture', canvas: l.picture, hidden: !visible.picture }] : []),
        ...(l.reference ? [{ name: 'Reference', canvas: l.reference, opacity: 0.45, hidden: !visible.reference }] : []),
        { name: 'Colour', canvas: l.colour, opacity: ink / 100, hidden: !visible.colour },
        { name: 'Sketch', canvas: l.sketch, opacity: ink / 100, hidden: !visible.sketch },
      ];
      download(await layeredPsd(side, layers, out), `live-draw-${stamp()}.psd`);
    } catch (err) {
      toast((err as Error).message || 'The layered file could not be made.', 'error');
    } finally {
      setExporting(null);
    }
  };
  const exportTimelapse = async () => {
    setExporting('timelapse');
    try {
      const { out } = await flatAt(768);
      const r = await timelapse(
        history.frames().map((s) => s.image),
        out,
      );
      download(r.blob, r.name);
      toast(r.name.endsWith('.zip') ? 'This browser can’t record video: the time-lapse frames are in a zip.' : 'Time-lapse saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setExporting(null);
    }
  };
  const restore = (i: number) => {
    const s = history.restore(i);
    if (!s) return;
    setStill(s.image);
    bumpHistory();
  };

  // ---- words for the status line
  const statusLine = (() => {
    if (!machineOn) return status?.state === 'starting' || status?.state === 'downloading' ? 'The drawing machine is starting: keep drawing.' : 'Drawing machine off: draw away, then start it to see the picture.';
    if (lifeOn) return living === 'connecting' ? 'Bringing it to life…' : living === 'loading' ? 'Getting the moving picture ready (the first time takes a minute)…' : 'Alive: it moves while you draw.';
    if (problem) return problem;
    if (engines && engines[engine] === 'loading' && !still) return `${loadingText ?? 'Getting the picture maker ready'}…`;
    if (mode === 'paint') return still || base ? 'Brush over what may change.' : 'Paint over needs a picture: draw first.';
    if (counts.empty && !base) return 'Start drawing: the picture appears under your lines.';
    return lastMs ? `Live · ${lastMs} ms a picture${via === 'post' ? ' (one at a time: the live connection isn’t available)' : ''}` : 'Live';
  })();

  const kept = Boolean(base);
  const tools = (
    <ToolsPanel
      tool={tool}
      onTool={(t) => {
        setTool(t);
        setLasso(false);
      }}
      color={color}
      onColor={(c) => {
        setColor(c);
        if (tool === 'picker' || tool === 'eraser') setTool('pen');
      }}
      sizeScale={sizeScale}
      onSize={setSizeScale}
      painting={mode === 'paint'}
      canUndo={counts.undo}
      canRedo={counts.redo}
      onUndo={undo}
      onRedo={redo}
      onClear={clearAll}
      onFit={() => stage.current?.fit()}
    />
  );
  const layersPanel = (
    <LayersPanel
      visible={visible}
      onVisible={(id, on) => setVisible((v) => ({ ...v, [id]: on }))}
      layer={layer}
      onLayer={setLayer}
      ink={ink}
      onInk={setInk}
      reference={reference}
      onReference={(f) => void pickReference(f)}
      kept={kept}
      onLetGo={() => setBase(null)}
    />
  );
  const lookPanel = (
    <LookPanel
      styles={styles}
      onStyles={setStyles}
      follow={follow}
      onFollow={setFollow}
      strength={strength}
      onStrength={setStrength}
      seedLocked={seedLocked}
      onLock={setSeedLocked}
      onShuffle={() => setSeed(newSeed())}
    />
  );
  const proPanel = (
    <ProPanel
      regions={regions}
      lasso={lasso}
      onLasso={(on) => {
        setLasso(on);
        if (on && !wide) setSheet(null);
      }}
      onRegionWords={(id, w) => setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, prompt: w } : r)))}
      onRegionRemove={(id) => setRegions((rs) => rs.filter((r) => r.id !== id))}
      poseOn={poseOn}
      onPoseOn={(on) => {
        setPoseOn(on);
        if (on) setPoseShown(true);
      }}
      poseShown={poseShown}
      onPoseShown={setPoseShown}
      onPoseReset={() => setPose(defaultPose())}
      styleRefAllowed={api.paths.styleRef}
      styleRef={styleRef}
      onStyleRef={(f) => void pickStyleRef(f)}
      onStyleWeight={(w) => setStyleRef((r) => (r ? { ...r, weight: w } : r))}
      reading={reading}
      canRead={machineOn && !counts.empty}
      onRead={() => void readSketch()}
      canFinish={machineOn && (!counts.empty || kept)}
      onFinish={() => void finish()}
      finishing={Boolean(finishJob)}
    />
  );
  const historyPanel = (
    <HistoryPanel items={history.items} index={history.index} onRestore={restore} onPng={() => void exportPng()} onPsd={() => void exportPsd()} onTimelapse={() => void exportTimelapse()} busy={exporting} />
  );
  const tabs: { id: Tab; label: string; body: React.ReactNode }[] = [
    { id: 'tools', label: 'Tools', body: tools },
    { id: 'look', label: 'Look', body: lookPanel },
    { id: 'layers', label: 'Layers', body: layersPanel },
    { id: 'pro', label: 'Pro', body: proPanel },
    { id: 'history', label: 'History', body: historyPanel },
  ];

  const machineLine = !status ? null : machineOn ? `Drawing machine on${price(status.pricePerHour ?? status.costPerHour) ? ` · ${price(status.pricePerHour ?? status.costPerHour)}` : ''}` : status.state === 'starting' || status.state === 'downloading' ? 'Drawing machine starting…' : 'Drawing machine off';

  return (
    <div className="ldx-studio" ref={rootRef} data-wide={wide} data-mode={mode} data-living={lifeOn || undefined}>
      <header className="ldx-top">
        <button type="button" className="ldx-pill" data-on={machineOn} onClick={() => (machineOn ? setOptionsOpen(true) : onShowCard())} aria-label={machineLine ?? 'Drawing machine'}>
          <span className="ldx-dot" aria-hidden />
          <span className="ldx-pill-t">{machineLine ?? 'Drawing machine'}</span>
        </button>
        <input
          className="ldx-input ldx-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="What is it?"
          placeholder="What is it? e.g. a fox in the snow"
          maxLength={300}
          enterKeyHint="done"
        />
        {/* While you draw, the orb waits up here: off the canvas and off the tools. */}
        {!cardShown && !guesses.length && !finished && !optionsOpen && <OrbSpot size={40} className="ldx-top-spot" />}
        <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(true)}>
          <Icon name="more" size={20} />
        </button>
      </header>

      {wide && <aside className="ldx-rail">{tools}</aside>}

      <main className="ldx-centre">
        <Stage
          ref={stage}
          doc={doc}
          tool={tool}
          color={color}
          sizeScale={sizeScale}
          layer={layer}
          painting={mode === 'paint'}
          lasso={lasso}
          visible={visible}
          ink={ink}
          picture={picture}
          living={lifeOn && Boolean(liveFrame)}
          reference={reference}
          regions={regions}
          pose={poseOn && poseShown ? pose : null}
          penOnly={penOnly}
          onPenOnly={setPenOnly}
          onStroke={onStroke}
          onPick={(c) => {
            setColor(c);
            setTool('pen');
          }}
          onLasso={(pts) => {
            const id = Date.now();
            setRegions((rs) => [...rs, { id, points: pts, prompt: '' }]);
            setLasso(false);
            if (!wide) setSheet('pro');
            setTimeout(() => (document.querySelector(`[data-region="${id}"]`) as HTMLInputElement | null)?.focus(), 80);
          }}
          onPose={setPose}
          onUndo={undo}
          onRedo={redo}
        />
        <AnimatePresence>{guesses.length > 0 && !lasso && <Guesses key="g" guesses={guesses} onPick={pickGuess} onDismiss={() => setGuesses([])} />}</AnimatePresence>
        {penOnly && (
          <p className="ldx-pen-note">
            Pencil mode: fingers move the canvas.{' '}
            <button type="button" className="ldx-link" onClick={() => setPenOnly(false)}>
              Draw with a finger
            </button>
          </p>
        )}
        {lasso && <p className="ldx-pen-note">Circle the part that gets its own words.</p>}
      </main>

      {wide && (
        <aside className="ldx-side" aria-label="Layers, look and more">
          <Section title="Layers" id="ldx-layers">
            {layersPanel}
          </Section>
          <Section title="Look" id="ldx-look">
            {lookPanel}
          </Section>
          {proPanel}
          <Section title="History" id="ldx-history">
            {historyPanel}
          </Section>
        </aside>
      )}

      <footer className="ldx-bottom">
        {!wide && <Slider label="Ink" value={ink} min={0} max={100} step={1} onChange={setInk} text={`${Math.round(ink)}%`} />}
        {lifeOn && (
          <div className="ldx-life" role="group" aria-label="Bring to life">
            <Slider label="Motion" value={motionAmount} onChange={setMotionAmount} text={motionAmount < 0.34 ? 'Gentle' : motionAmount < 0.67 ? 'Lively' : 'Wild'} />
            <button type="button" className="ldx-link" disabled={living !== 'live' || saving} onClick={() => {
              setSaving(true);
              livingRef.current?.save();
            }}>
              <Icon name="save" size={16} /> {saving ? 'Saving…' : 'Save last 10 s'}
            </button>
          </div>
        )}
        <div className="ldx-modes" role="toolbar" aria-label="Modes">
          <div className="ldx-mode-group" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" className="ldx-mode" aria-checked={mode === 'live'} onClick={() => choose('live')}>
              <Icon name="bolt" size={18} /> Live
            </button>
            <button type="button" role="radio" className="ldx-mode" aria-checked={mode === 'paint'} onClick={() => choose('paint')}>
              <Icon name="brush" size={18} /> Paint over
            </button>
          </div>
          <button type="button" className="ldx-mode" onClick={keep} disabled={!still || lifeOn}>
            <Icon name="lock" size={18} /> Keep
          </button>
          <button type="button" className="ldx-mode" aria-pressed={lifeOn} onClick={() => (lifeOn ? stopLife() : void startLife())} disabled={!machineOn}>
            <Icon name={lifeOn ? 'stop' : 'film'} size={18} /> {lifeOn ? 'Stop' : 'Bring to life'}
          </button>
          {!wide && (
            <button type="button" className="ldx-mode" aria-expanded={sheet !== null} onClick={() => setSheet(sheet ? null : 'tools')}>
              <Icon name="sliders" size={18} /> Tools
            </button>
          )}
        </div>
        <p className="ldx-status" role="status" aria-live="polite">
          {statusLine}
          {engineLine && <span className="ldx-engine-line"> {engineLine}</span>}
          {finishJob && (
            <span className="ldx-job">
              {' '}
              · Finishing {Math.max(1, Math.round(finishJob.progress))}%{' '}
              <button type="button" className="ldx-link" onClick={() => void api.cancelJob(finishJob.id).then(() => finishAbort.current?.abort(), () => {})}>
                Stop
              </button>
            </span>
          )}
        </p>
      </footer>

      <AnimatePresence>
        {!wide && sheet && (
          <motion.div
            key="sheet"
            className="ldx-sheet"
            role="dialog"
            aria-label="Tools and more"
            initial={level === 'off' ? { opacity: 0 } : { y: '100%' }}
            animate={{ y: 0, opacity: 1, transition: transitionFor(level, 'bouncy') }}
            exit={level === 'off' ? { opacity: 0, transition: transitionFor(level) } : { y: '100%', transition: transitionFor(level, 'smooth') }}
          >
            <div className="ldx-tabs" role="tablist" aria-label="Sheet">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" className="ldx-tab" aria-selected={sheet === t.id} onClick={() => setSheet(t.id)}>
                  {t.label}
                </button>
              ))}
              <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Close" onClick={() => setSheet(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="ldx-sheet-body" role="tabpanel">
              {tabs.find((t) => t.id === sheet)?.body}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {optionsOpen && (
          <motion.div key="opts" className="ldx-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitionFor(level, 'smooth') }} exit={{ opacity: 0, transition: transitionFor(level, 'smooth') }} onClick={() => setOptionsOpen(false)}>
            <motion.div
              className="ldx-options"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ldx-opt-t"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === 'Escape' && setOptionsOpen(false)}
              initial={level === 'full' ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: transitionFor(level, 'bouncy') }}
            >
              <div className="ldx-guesses-head">
                <h2 className="ldx-card-t ldx-options-t" id="ldx-opt-t">
                  <em>Options</em>
                </h2>
                <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Close" onClick={() => setOptionsOpen(false)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              <Section title="Working size" id="ldx-size">
                <SizePicker value={size} onChange={setSize} />
                <p className="ldx-note">Bigger is sharper; smaller answers faster.</p>
              </Section>
              {canSwitch && (
                <Section title="Engine" id="ldx-engine">
                  <EnginePicker value={engine} onChange={setEngineChoice} />
                  <p className="ldx-note">Fast is for you only. Licensed is fine for anything you sell.</p>
                </Section>
              )}
              <Section title="The drawing machine" id="ldx-machine">
                <p className="ldx-note">{machineLine}. {autoOffNote(status)}</p>
                {machineOn ? (
                  <button type="button" className="ldx-link ldx-danger" disabled={powering} onClick={() => {
                    setOptionsOpen(false);
                    onPower('stop');
                  }}>
                    <Icon name="stop" size={16} /> {powering ? 'Stopping…' : 'Stop the drawing machine'}
                  </button>
                ) : (
                  status?.state !== 'unconfigured' && (
                    <button type="button" className="ldx-link" disabled={powering || status?.state === 'starting' || status?.state === 'downloading'} onClick={() => {
                      setOptionsOpen(false);
                      onPower('start');
                    }}>
                      <Icon name="play" size={16} /> Start the drawing machine
                    </button>
                  )
                )}
              </Section>
              <Section title="Start over" id="ldx-over">
                <button type="button" className="ldx-link ldx-danger" onClick={() => {
                  setOptionsOpen(false);
                  stopLife();
                  doc.clear('sketch');
                  doc.clear('colour');
                  doc.clear('mask');
                  stage.current?.redraw();
                  sync();
                  setStill(null);
                  setBase(null);
                  setRegions([]);
                  setGuesses([]);
                  history.clear();
                  bumpHistory();
                }}>
                  <Icon name="trash" size={16} /> A clean canvas
                </button>
              </Section>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {finished && (
          <motion.div key="done" className="ldx-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitionFor(level, 'smooth') }} exit={{ opacity: 0, transition: transitionFor(level, 'smooth') }} onClick={() => setFinished(null)}>
            <motion.div className="ldx-options ldx-finished" role="dialog" aria-modal="true" aria-labelledby="ldx-done-t" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0, transition: transitionFor(level, 'bouncy') }}>
              <p className="o5-kicker">Finished · in your gallery</p>
              <h2 className="ldx-card-t" id="ldx-done-t">
                Here it is, <em>at full quality.</em>
              </h2>
              <img src={finished.url} alt={finished.prompt || 'Your finished picture'} />
              <div className="ldx-card-go">
                <span className="ldx-go-wrap">
                  <a className="btn primary ldx-go" href={finished.url + (finished.url.includes('?') ? '&' : '?') + 'download=1'} download>
                    <Icon name="download" size={16} /> Save
                  </a>
                  <OrbSpot size={44} className="ldx-go-spot" />
                </span>
                <button type="button" className="ldx-link" onClick={() => setFinished(null)}>
                  Back to the canvas
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
