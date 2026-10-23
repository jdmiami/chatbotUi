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
import { PictureHistory } from './canvas/history';
import { defaultPose, poseImage } from './canvas/pose';
import { REFERENCE_ALPHA, flattenOnto, joinPrompt, type XY } from './canvas/raster';
import { drawCover, fileToDataUrl, layerPng, loadImage, makeCanvas, maskPng, regionPng } from './canvas/render';
import { canvasBlob, download, layeredPsd, stamp, timelapse, type PsdLayer } from './canvas/exporters';
import { Stage, type Guides, type Region, type StageHandle, type StageTool } from './canvas/Stage';
import { MachineCard, autoOffNote, price } from './MachineCard';
import { EnginePicker, Guesses, HistoryPanel, LookPanel, ProPanel, Section, SizePicker, Slider, styleWords } from './panels';
import { BrushMaker } from './brushes/BrushMaker';
import { BrushPanel } from './brushes/BrushPanel';
import { allBrushes, brushFromJson, brushToJson, duplicateBrush, loadMine, loadRecent, pushRecent, saveMine, saveRecent, upsert } from './brushes/library';
import { DEFAULT_BRUSH, presetById } from './brushes/presets';
import type { Brush } from './brushes/types';
import { PSD_BLEND } from './engine/blend';
import { GuidesPanel } from './guides/GuidesPanel';
import { NO_PERSPECTIVE } from './guides/perspective';
import { NO_SYMMETRY } from './guides/symmetry';
import { LayersPanel } from './layers/LayersPanel';
import { hasRoleInk, machineLines, strokeCount } from './layers/machine';
import { StudioDoc, activeLayer, addLayer, clearLayer, duplicateLayer, layerById, layerCap, mergeDown, moveLayer, patchLayer, removeLayer, type DocState, type Layer } from './layers/model';
import { ColorPanel } from './ui/ColorPanel';
import { loadMyPalette, loadRecentColours, pushRecentColour, saveMyPalette, saveRecentColours } from './ui/color';
import { RadialMenu } from './ui/RadialMenu';
import { SIcon, type StudioIconName } from './ui/StudioIcon';
import { QuickBar, QuickSliders, Rail, TOOLS, ToolPicker } from './ui/Toolbars';
import './livedraw.css';
import './ui/studio.css';

/** At most this often while you draw (only one frame is ever on its way; the newest waits). */
export const SEND_EVERY_MS = 120;
/** The sketch reader looks after this long without drawing, when there are no words yet. */
const READ_AFTER_MS = 2000;
const SIZE_KEY = 'orbit:livedraw:size';
const TOOL_BRUSH_KEY = 'orbit:livedraw:tool-brushes';

type Mode = 'live' | 'paint';
type Tab = 'brushes' | 'colour' | 'layers' | 'guides' | 'picture' | 'history';
type BrushTool = 'brush' | 'eraser' | 'smudge';

const TABS: { id: Tab; label: string; icon: StudioIconName }[] = [
  { id: 'brushes', label: 'Brushes', icon: 'brushTip' },
  { id: 'colour', label: 'Colour', icon: 'palette' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'guides', label: 'Guides', icon: 'guides' },
  { id: 'picture', label: 'Picture', icon: 'sparkle' },
  { id: 'history', label: 'History', icon: 'history' },
];

const newSeed = () => Math.floor(Math.random() * 1e9);

function loadSize(): CanvasSize {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return v === 768 || v === 1024 ? v : 512;
  } catch {
    return 512;
  }
}

function loadToolBrushes(): Record<BrushTool, string> {
  try {
    const v = JSON.parse(localStorage.getItem(TOOL_BRUSH_KEY) ?? '{}');
    return { ...DEFAULT_BRUSH, ...(v && typeof v === 'object' ? v : {}) };
  } catch {
    return { ...DEFAULT_BRUSH };
  }
}

const NOTES: Record<Mode, string> = {
  live: 'Live: draw, and the picture underneath follows your lines. Ink fades your strokes; Keep holds a picture you like.',
  paint: 'Paint over: brush over the part of the picture that should change. Everything else stays as it is.',
};

/**
 * Live Draw: one canvas, the AI picture drawn under your strokes by the drawing machine while you
 * draw. Live, Paint over, Keep and Bring to life on the same canvas; the drawing itself is a full
 * studio (GPU brushes, layers, guides, steady ink): tools on the left and panels on the right on an
 * iPad held sideways, a tool row and a sheet on a phone.
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
      'Live Draw: a drawing studio on one square canvas. Brushes, eraser and smudge, layers with blend modes and masks, perspective and symmetry guides and steady ink are on the left and right (or in the Tools sheet on a phone); the drawing machine paints a picture under the strokes. Ink fades the strokes. Modes at the bottom: Live, Paint over (brush where it may change), Keep (hold this picture) and Bring to life (the picture moves while you draw).';
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
  const doc = useMemo(() => new StudioDoc(), []);
  const history = useMemo(() => new PictureHistory(), []);
  const stage = useRef<StageHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---- layout: iPad held sideways (and desktop) gets rails; everything else a full canvas and a sheet
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
  const [side, setSide] = useState<Tab>('layers');
  const [sideOpen, setSideOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [bare, setBare] = useState(false);
  const openPanel = (t: Tab) => {
    if (wide) {
      setSide(t);
      setSideOpen(true);
    } else setSheet(t);
  };

  // ---- the drawing
  const [, setDocVersion] = useState(0);
  const [engineKind, setEngineKind] = useState<'webgl2' | 'canvas2d' | null>(null);
  const [tool, setToolState] = useState<StageTool>('brush');
  const [mine, setMine] = useState<Brush[]>(loadMine);
  const brushes = useMemo(() => allBrushes(mine), [mine]);
  const [toolBrush, setToolBrush] = useState<Record<BrushTool, string>>(loadToolBrushes);
  const [trial, setTrial] = useState<Brush | null>(null);
  const [recentBrushes, setRecentBrushes] = useState<string[]>(loadRecent);
  const brushTool: BrushTool = tool === 'eraser' || tool === 'smudge' ? tool : 'brush';
  const brushById = (id: string) => brushes.find((b) => b.id === id) ?? presetById(DEFAULT_BRUSH[brushTool])!;
  const brush = trial && toolBrush[brushTool] === trial.id ? trial : brushById(toolBrush[brushTool]);
  const [color, setColorState] = useState('#1b1b1f');
  const [recentColours, setRecentColours] = useState<string[]>(loadRecentColours);
  const [myPalette, setMyPalette] = useState<string[]>(loadMyPalette);
  const [sizeScale, setSizeScale] = useState(1);
  const [opacityScale, setOpacityScale] = useState(1);
  const [guides, setGuidesState] = useState<Guides>({ perspective: NO_PERSPECTIVE, symmetry: NO_SYMMETRY, rope: 0, quickShape: true, edit: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [maskEdit, setMaskEdit] = useState(false);
  const [radial, setRadial] = useState<XY | null>(null);
  const [maker, setMaker] = useState<Brush | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [visible, setVisible] = useState({ picture: true, reference: true });
  const [ink, setInk] = useState(100);
  const [penOnly, setPenOnly] = useState(false);
  const counts = { undo: doc.canUndo, redo: doc.canRedo, strokes: strokeCount(doc.state), empty: !hasRoleInk(doc.state, 'sketch') && !hasRoleInk(doc.state, 'colour') };
  const sync = () => setDocVersion(doc.version);

  const setTool = (t: StageTool) => {
    setToolState(t);
    setLasso(false);
    if (t !== 'select') setSelected(null);
  };
  const setColor = (c: string) => {
    setColorState(c);
    setRecentColours((l) => {
      const next = pushRecentColour(l, c);
      saveRecentColours(next);
      return next;
    });
  };
  const pickBrush = (b: Brush, forTool: BrushTool = brushTool) => {
    setToolBrush((m) => {
      const next = { ...m, [forTool]: b.id };
      try {
        localStorage.setItem(TOOL_BRUSH_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
    if (trial && trial.id !== b.id) setTrial(null);
    setRecentBrushes((l) => {
      const next = pushRecent(l, b.id);
      saveRecent(next);
      return next;
    });
    if (tool !== forTool && (forTool !== 'brush' || !['brush', 'eraser', 'smudge'].includes(tool))) setTool(forTool);
  };
  const setGuides = (g: Guides) => {
    if (g.perspective.kind !== guides.perspective.kind && g.perspective.kind !== 'off')
      orbNote(`Perspective: lines run toward the ${g.perspective.kind === 'one' ? 'vanishing point' : 'vanishing points'}${g.perspective.snap ? ' and strokes snap to them' : ''}. Drag the points to move the grid.`);
    if (g.symmetry.kind !== guides.symmetry.kind && g.symmetry.kind !== 'off') orbNote('Symmetry: every stroke is drawn again across the guide. Drag the centre to move it.');
    setGuidesState(g);
  };

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

  /**
   * The frame for the machine (the contract is unchanged): `sketch` is the layers marked "lines" as
   * black lines, `color` the layers marked "colour" as they look.
   */
  const buildFrame = useCallback((): CanvasFrameInput | null => {
    const st = stage.current;
    if (!st) return null;
    const s = now.current;
    const state = doc.state;
    const live = st.live();
    const lines = hasRoleInk(state, 'sketch', live);
    const colour = hasRoleInk(state, 'colour', live);
    if (!lines && !colour && !s.base) return null;
    const side = s.size;
    const frame: CanvasFrameInput = {
      engine: s.engine,
      mode: s.mode,
      prompt: joinPrompt(s.prompt, styleWords(s.styles)),
      seed: s.seed,
      follow: s.follow,
      strength: s.strength,
      size: side,
      sketch: layerPng(machineLines(state, 'sketch', live), side, { lines: true, skipFills: true }),
    };
    const r = st.renderer();
    if (colour && r) frame.color = r.snapshot(side, (l) => l.role === 'colour', 'colour').toDataURL('image/png');
    const kept = s.mode === 'paint' ? (s.base ?? s.still) : s.base;
    if (kept?.startsWith('data:')) frame.base = kept;
    if (s.mode === 'paint') {
      const mask = maskPng(st.maskOps(), side);
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
  }, [api, doc]);

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

  // ---- drawing changes
  /** The drawing changed: the canvas, the panels and (soon) the machine follow. */
  const changed = () => {
    stage.current?.redraw();
    sync();
  };
  const change = (next: DocState, merge?: string) => {
    doc.commit(next, merge);
    changed();
    schedule(250);
  };
  const onStroke = (phase: 'move' | 'end') => {
    if (phase === 'move') return schedule();
    sync();
    sendNow();
  };
  const undo = () => {
    if (!doc.undo()) return;
    changed();
    sendNow();
  };
  const redo = () => {
    if (!doc.redo()) return;
    changed();
    sendNow();
  };
  const clearAll = () => {
    if (mode === 'paint') change({ ...doc.state, paintMask: [] });
    else {
      const l = activeLayer(doc.state);
      if (l) change(clearLayer(doc.state, l.id));
      setGuesses([]);
    }
  };

  // ---- layers
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cap = layerCap(stage.current?.renderer()?.px || 1536, deviceMemory);
  const roomForLayer = () => {
    if (doc.state.layers.length < cap) return true;
    toast(`This device can hold ${cap} layers at this size. Merge or delete one to make room for another.`, 'info');
    return false;
  };
  const layerOps = {
    onActive: (id: number) => {
      doc.setActive(id);
      setSelected(null);
      const l = layerById(doc.state, id);
      if (l && !l.hasMask) setMaskEdit(false);
      sync();
    },
    onPatch: (id: number, patch: Partial<Layer>, merge?: string) => change(patchLayer(doc.state, id, patch), merge),
    onAdd: (kind: Layer['kind']) => {
      if (!roomForLayer()) return;
      change(addLayer(doc.state, kind));
      if (kind === 'vector') orbNote('Ink layer: strokes stay editable. Use Edit ink to move their points or change their width and colour.');
    },
    onDuplicate: (id: number) => roomForLayer() && change(duplicateLayer(doc.state, id)),
    onMerge: (id: number) => {
      const st = doc.state;
      const at = st.layers.findIndex((l) => l.id === id);
      const r = stage.current?.renderer();
      if (at <= 0 || !r) return;
      change(mergeDown(st, id, r.mergedImage(st.layers[at - 1].id, id)));
    },
    onRemove: (id: number) => change(removeLayer(doc.state, id)),
    onClear: (id: number) => change(clearLayer(doc.state, id)),
    onMove: (id: number, to: number) => change(moveLayer(doc.state, id, to)),
    onMask: (id: number, on: boolean) => {
      change(patchLayer(doc.state, id, on ? { hasMask: true } : { hasMask: false, maskOps: [] }));
      setMaskEdit(on);
      if (on) orbNote('Mask: paint on it to hide parts of the layer, erase to show them again. Nothing is lost.');
    },
  };

  // Thumbnails: the layers that changed, a moment after they did (only while the list shows).
  const thumbSig = useRef(new Map<number, unknown[]>());
  const layersShown = wide ? sideOpen && side === 'layers' && !bare : sheet === 'layers';
  useEffect(() => {
    if (!layersShown) return;
    const t = setTimeout(() => {
      const r = stage.current?.renderer();
      if (!r) return;
      const next: Record<number, string> = {};
      let any = false;
      for (const l of doc.state.layers) {
        const sig = [l.ops, l.vectors, l.maskOps];
        const old = thumbSig.current.get(l.id);
        if (old && old.every((v, i) => v === sig[i]) && thumbs[l.id]) {
          next[l.id] = thumbs[l.id];
          continue;
        }
        thumbSig.current.set(l.id, sig);
        next[l.id] = r.layerCanvas(l.id, 88).toDataURL('image/png');
        any = true;
      }
      if (any || Object.keys(next).length !== Object.keys(thumbs).length) setThumbs(next);
    }, 300);
    return () => clearTimeout(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keys (a keyboard on an iPad, or a desktop)
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod || e.altKey) return;
      const tl = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tl) return setTool(tl.value);
      if (e.key === '[') setSizeScale((v) => Math.max(0.25, v / 1.15));
      else if (e.key === ']') setSizeScale((v) => Math.min(4, v * 1.15));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- the sketch reader: on demand, and after a pause when there are no words yet
  const readSketch = useCallback(async () => {
    const r = stage.current?.renderer();
    if (!r || (!hasRoleInk(doc.state, 'sketch') && !hasRoleInk(doc.state, 'colour'))) return;
    setReading(true);
    try {
      const c = makeCanvas(512);
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 512, 512);
      g.drawImage(r.snapshot(512, (l) => l.role !== 'none', 'read'), 0, 0);
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
    if (m === 'paint') {
      if (!['brush', 'eraser'].includes(tool)) setTool('brush');
      if (!still && !base) toast('Paint over changes a picture: draw first, so there is one.', 'info');
    }
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
    const r = stage.current?.renderer();
    if (!r) return null;
    const c = (lifeCanvas.current ??= makeCanvas(512));
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 512);
    if (stillImg.current) drawCover(g, stillImg.current, 512);
    g.drawImage(r.snapshot(512, (l) => l.role !== 'none', 'read'), 0, 0);
    return c.toDataURL('image/jpeg', 0.72);
  }, []);

  const startLife = async () => {
    if (!machineOn) return toast('Start the drawing machine first.', 'info');
    if (!still && !base && counts.empty) return toast('Draw something first: it comes to life from your picture.', 'info');
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
    if (!image && counts.empty) return toast('Draw something first.', 'info');
    if (!words) return toast('Say what it is first (or let the orb guess).', 'info');
    try {
      const sketch = layerPng(machineLines(doc.state, 'sketch'), size, { lines: true, skipFills: true });
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

  // ---- brushes: your own library
  const saveBrush = (b: Brush) => {
    const own = b.builtin ? duplicateBrush(b, b.name === presetById(b.id)?.name ? `${b.name} (mine)` : b.name) : { ...b, group: 'Mine' };
    const next = upsert(mine, own);
    setMine(next);
    if (!saveMine(next)) toast('This browser would not keep the brush (private browsing?). Take it away as a file instead.', 'error');
    pickBrush(own);
    setMaker(null);
    toast(`Saved “${own.name}” to your brushes.`, 'success');
  };
  const exportBrush = (b: Brush) => {
    download(new Blob([brushToJson(b)], { type: 'application/json' }), `${b.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'brush'}.brush.json`);
  };
  const importBrush = async (f: File) => {
    const res = brushFromJson(await f.text());
    if ('error' in res) return toast(res.error, 'error');
    const next = upsert(mine, res.brush);
    setMine(next);
    saveMine(next);
    pickBrush(res.brush);
    toast(`Brought in “${res.brush.name}”.`, 'success');
  };
  const duplicate = (b: Brush) => {
    const copy = duplicateBrush(b);
    const next = upsert(mine, copy);
    setMine(next);
    saveMine(next);
    pickBrush(copy);
    setMaker(copy);
  };
  const deleteBrush = (b: Brush) => {
    const next = mine.filter((x) => x.id !== b.id);
    setMine(next);
    saveMine(next);
    for (const t of ['brush', 'eraser', 'smudge'] as BrushTool[]) if (toolBrush[t] === b.id) pickBrush(presetById(DEFAULT_BRUSH[t])!, t);
  };

  // ---- export
  const flatAt = async (side: number) => {
    const out = makeCanvas(side);
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
    const pic = visible.picture ? await fromImage(picture) : null;
    const ref = visible.reference ? await fromImage(reference) : null;
    const art = stage.current?.renderer()?.snapshot(side) ?? null;
    flattenOnto(out.getContext('2d')!, side, [
      { source: pic, alpha: 1 },
      { source: ref, alpha: REFERENCE_ALPHA },
      { source: art, alpha: ink / 100 },
    ]);
    return { out, pic, ref };
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
      const { out } = await flatAt(side);
      const r = stage.current?.renderer();
      const paper = makeCanvas(side);
      const pg = paper.getContext('2d')!;
      pg.fillStyle = '#ffffff';
      pg.fillRect(0, 0, side, side);
      const img = async (src: string | null) => {
        if (!src) return null;
        const c = makeCanvas(side);
        try {
          drawCover(c.getContext('2d')!, await loadImage(src), side);
          return c;
        } catch {
          return null;
        }
      };
      const pic = await img(picture);
      const ref = await img(reference);
      const layers: PsdLayer[] = [
        { name: 'Paper', canvas: paper },
        ...(pic ? [{ name: 'Picture', canvas: pic, hidden: !visible.picture }] : []),
        ...(ref ? [{ name: 'Reference', canvas: ref, opacity: REFERENCE_ALPHA, hidden: !visible.reference }] : []),
        ...(r
          ? doc.state.layers.map((l) => ({
              name: l.name,
              canvas: r.layerCanvas(l.id, side),
              opacity: l.opacity * (ink / 100),
              hidden: !l.visible,
              blendMode: PSD_BLEND[l.blend],
              clipping: l.clip,
              transparencyProtected: l.alphaLock,
              mask: l.hasMask ? r.maskCanvas(l.id, side) : null,
            }))
          : []),
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
  const active = activeLayer(doc.state);
  const selStroke = selected !== null ? (active?.vectors.find((v) => v.id === selected) ?? null) : null;
  const toolLabel = brushTool === 'eraser' ? 'Erasing' : brushTool === 'smudge' ? 'Smudging' : 'Drawing';
  const brushPanel = (
    <BrushPanel
      brushes={brushes}
      current={toolBrush[brushTool]}
      toolLabel={toolLabel}
      onPick={(b) => pickBrush(b)}
      onEdit={setMaker}
      onDuplicate={duplicate}
      onImport={(f) => void importBrush(f)}
      onDelete={deleteBrush}
    />
  );
  const colourPanel = <ColorPanel color={color} onColor={setColor} recent={recentColours} mine={myPalette} onMine={(l) => (setMyPalette(l), saveMyPalette(l))} />;
  const layersPanel = (
    <LayersPanel
      state={doc.state}
      thumbs={thumbs}
      cap={cap}
      maskEdit={maskEdit}
      onMaskEdit={setMaskEdit}
      {...layerOps}
      ink={ink}
      onInk={setInk}
      visible={visible}
      onVisible={(id, on) => setVisible((v) => ({ ...v, [id]: on }))}
      reference={reference}
      onReference={(f) => void pickReference(f)}
      kept={kept}
      onLetGo={() => setBase(null)}
    />
  );
  const guidesPanel = <GuidesPanel guides={guides} onGuides={setGuides} />;
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
  const picturePanel = (
    <>
      <Section title="Look" id="ldx-look">
        {lookPanel}
      </Section>
      {proPanel}
    </>
  );
  const historyPanel = (
    <HistoryPanel items={history.items} index={history.index} onRestore={restore} onPng={() => void exportPng()} onPsd={() => void exportPsd()} onTimelapse={() => void exportTimelapse()} busy={exporting} />
  );
  const bodies: Record<Tab, React.ReactNode> = {
    brushes: (
      <>
        {!wide && <ToolPicker tool={tool} onTool={setTool} painting={mode === 'paint'} />}
        {brushPanel}
      </>
    ),
    colour: colourPanel,
    layers: layersPanel,
    guides: guidesPanel,
    picture: picturePanel,
    history: historyPanel,
  };

  const machineLine = !status ? null : machineOn ? `Drawing machine on${price(status.pricePerHour ?? status.costPerHour) ? ` · ${price(status.pricePerHour ?? status.costPerHour)}` : ''}` : status.state === 'starting' || status.state === 'downloading' ? 'Drawing machine starting…' : 'Drawing machine off';
  const common = {
    tool,
    onTool: setTool,
    color,
    onColour: () => openPanel('colour'),
    size: sizeScale,
    onSize: setSizeScale,
    opacity: opacityScale,
    onOpacity: setOpacityScale,
    canUndo: counts.undo,
    canRedo: counts.redo,
    onUndo: undo,
    onRedo: redo,
    painting: mode === 'paint',
  };
  const openRadial = (x: number, y: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    setRadial({ x: x - (r?.left ?? 0), y: y - (r?.top ?? 0) });
  };
  const rootBox = rootRef.current?.getBoundingClientRect();

  return (
    <div className="ldx-studio" ref={rootRef} data-wide={wide} data-mode={mode} data-living={lifeOn || undefined} data-bare={bare || undefined} data-side={wide && sideOpen ? 'open' : 'closed'} data-engine={engineKind ?? undefined}>
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
        {!cardShown && !guesses.length && !finished && !optionsOpen && !maker && <OrbSpot size={40} className="ldx-top-spot" />}
        {wide && (
          <button type="button" className="ldx-tool ldx-tool-flat" aria-label={sideOpen ? 'Hide the panels' : 'Show the panels'} aria-pressed={sideOpen} title={sideOpen ? 'Hide the panels' : 'Show the panels'} onClick={() => setSideOpen(!sideOpen)}>
            <SIcon name="sidebar" size={20} />
          </button>
        )}
        <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(true)}>
          <Icon name="more" size={20} />
        </button>
      </header>

      {wide && (
        <aside className="ldx-rail">
          <Rail {...common} brushName={tool === 'fill' || tool === 'picker' || tool === 'select' ? (TOOLS.find((t) => t.value === tool)?.label ?? '') : brush.name} onFit={() => stage.current?.fit()} onRadial={() => openRadial((rootBox?.left ?? 0) + (rootBox?.width ?? 0) / 2, (rootBox?.top ?? 0) + (rootBox?.height ?? 0) / 2)} onHide={() => setBare(true)} />
        </aside>
      )}

      <main className="ldx-centre">
        {!wide && <QuickBar {...common} onBrushes={() => setSheet('brushes')} />}
        <div className="ldx-stage-box">
          <Stage
            ref={stage}
            doc={doc}
            tool={tool}
            brush={brush}
            color={color}
            sizeScale={sizeScale}
            opacityScale={opacityScale}
            painting={mode === 'paint'}
            lasso={lasso}
            maskEdit={maskEdit}
            visible={visible}
            ink={ink}
            picture={picture}
            living={lifeOn && Boolean(liveFrame)}
            reference={reference}
            regions={regions}
            pose={poseOn && poseShown ? pose : null}
            guides={guides}
            selected={selected}
            penOnly={penOnly}
            onPenOnly={setPenOnly}
            onStroke={onStroke}
            onChange={sync}
            onPick={(c) => {
              setColor(c);
              if (tool === 'picker') setTool('brush');
            }}
            onLasso={(pts) => {
              const id = Date.now();
              setRegions((rs) => [...rs, { id, points: pts, prompt: '' }]);
              setLasso(false);
              openPanel('picture');
              setTimeout(() => (document.querySelector(`[data-region="${id}"]`) as HTMLInputElement | null)?.focus(), 80);
            }}
            onPose={setPose}
            onUndo={undo}
            onRedo={redo}
            onRadial={openRadial}
            onToggleUi={() => setBare((b) => !b)}
            onGuides={(g) => setGuidesState((cur) => ({ ...cur, ...g }))}
            onSelect={setSelected}
            onNote={(t) => toast(t, 'info')}
            onEngine={setEngineKind}
          />
          <AnimatePresence>{guesses.length > 0 && !lasso && <Guesses key="g" guesses={guesses} onPick={pickGuess} onDismiss={() => setGuesses([])} />}</AnimatePresence>
          {penOnly && !bare && (
            <p className="ldx-pen-note">
              <span className="ldx-pen-long">Pencil mode: fingers move the canvas.</span>
              <span className="ldx-pen-short">Pencil mode</span>
              <button type="button" className="ldx-link" onClick={() => setPenOnly(false)}>
                Draw with a finger
              </button>
            </p>
          )}
          {lasso && <p className="ldx-pen-note">Circle the part that gets its own words.</p>}
          {maskEdit && active?.hasMask && !lasso && <p className="ldx-pen-note ldx-note-mask">Painting on the mask of “{active.name}”</p>}
          {selStroke && tool === 'select' && (
            <div className="ldx-selbar" role="group" aria-label="Selected ink stroke">
              <Slider label="Width" value={selStroke.width} min={0.001} max={0.06} step={0.0005} onChange={(w) => active && change(patchLayer(doc.state, active.id, { vectors: active.vectors.map((v) => (v.id === selStroke.id ? { ...v, width: w } : v)) }), `vw${selStroke.id}`)} text={`${(selStroke.width * 100).toFixed(1)}%`} />
              <div className="ldx-actions">
                <button type="button" className="ldx-link" onClick={() => active && change(patchLayer(doc.state, active.id, { vectors: active.vectors.map((v) => (v.id === selStroke.id ? { ...v, color } : v)) }))}>
                  <span className="ldx-dot-c" style={{ background: color }} /> Use this colour
                </button>
                <button
                  type="button"
                  className="ldx-link ldx-danger"
                  onClick={() => {
                    if (!active) return;
                    change(patchLayer(doc.state, active.id, { vectors: active.vectors.filter((v) => v.id !== selStroke.id) }));
                    setSelected(null);
                  }}
                >
                  <SIcon name="trash" size={16} /> Delete
                </button>
                <button type="button" className="ldx-link" onClick={() => setSelected(null)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        {!wide && <QuickSliders {...common} />}
      </main>

      {wide && (
        <AnimatePresence initial={false}>
          {sideOpen && (
            <motion.aside
              key="side"
              className="ldx-side"
              aria-label="Panels"
              initial={level === 'off' ? { opacity: 0 } : { x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: transitionFor(level, 'smooth') }}
              exit={{ x: 40, opacity: 0, transition: transitionFor(level, 'smooth') }}
            >
              <div className="ldx-side-tabs" role="tablist" aria-label="Panels">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" className="ldx-side-tab" aria-selected={side === t.id} onClick={() => setSide(t.id)}>
                    <SIcon name={t.icon} size={20} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={side}
                  className="ldx-side-body"
                  role="tabpanel"
                  aria-label={TABS.find((t) => t.id === side)?.label}
                  initial={level === 'full' ? { opacity: 0, x: 18 } : { opacity: 0 }}
                  animate={{ opacity: 1, x: 0, transition: transitionFor(level, 'snappy') }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                >
                  {bodies[side]}
                </motion.div>
              </AnimatePresence>
            </motion.aside>
          )}
        </AnimatePresence>
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
            <button type="button" className="ldx-mode" aria-expanded={sheet !== null} onClick={() => setSheet(sheet ? null : 'brushes')}>
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

      {bare && (
        <button type="button" className="ldx-unbare" aria-label="Show the tools" title="Show the tools (or tap with four fingers)" onClick={() => setBare(false)}>
          <SIcon name="sliders" size={20} />
        </button>
      )}

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
            <div className="ldx-side-tabs ldx-sheet-tabs" role="tablist" aria-label="Sheet">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" className="ldx-side-tab" aria-selected={sheet === t.id} onClick={() => setSheet(t.id)}>
                  <SIcon name={t.icon} size={20} />
                  <span>{t.label}</span>
                </button>
              ))}
              <button type="button" className="ldx-tool ldx-tool-flat ldx-sheet-close" aria-label="Close" onClick={() => setSheet(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="ldx-sheet-body" role="tabpanel">
              {bodies[sheet]}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {radial && (
          <RadialMenu
            key="radial"
            x={radial.x}
            y={radial.y}
            bounds={{ width: rootBox?.width ?? 400, height: rootBox?.height ?? 600 }}
            brushes={recentBrushes.map((id) => brushes.find((b) => b.id === id)).filter((b): b is Brush => Boolean(b))}
            currentBrush={brush.id}
            colors={recentColours.length ? recentColours : ['#1b1b1f', '#d6452b', '#2f6fdb']}
            color={color}
            size={sizeScale}
            opacity={opacityScale}
            onBrush={(b) => pickBrush(b, b.mode === 'erase' ? 'eraser' : b.mode === 'smudge' ? 'smudge' : 'brush')}
            onColor={setColor}
            onSize={setSizeScale}
            onOpacity={setOpacityScale}
            onUndo={undo}
            onRedo={redo}
            onClose={() => setRadial(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {maker && (
          <BrushMaker
            key={maker.id}
            brush={maker}
            color={color}
            onSave={saveBrush}
            onUse={(b) => {
              setTrial(b);
              pickBrush(b);
              setMaker(null);
            }}
            onExport={exportBrush}
            onClose={() => setMaker(null)}
          />
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
              <Section title="Drawing" id="ldx-drawing">
                <p className="ldx-note">
                  Brushes run on {engineKind === 'webgl2' ? 'the graphics chip (WebGL 2)' : engineKind === 'canvas2d' ? 'the plain canvas (this browser has no WebGL 2)' : '…'}.
                </p>
                <button type="button" className="ldx-link" onClick={clearAll}>
                  <SIcon name="eraser" size={16} /> {mode === 'paint' ? 'Clear the Paint over mask' : `Clear “${active?.name ?? 'this layer'}”`}
                </button>
              </Section>
              <Section title="Start over" id="ldx-over">
                <button type="button" className="ldx-link ldx-danger" onClick={() => {
                  setOptionsOpen(false);
                  stopLife();
                  doc.reset();
                  setSelected(null);
                  setMaskEdit(false);
                  changed();
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
