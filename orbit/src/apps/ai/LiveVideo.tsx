import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import type { LocalAi, StudioItem, StudioMakerInfo } from '../../services/ai/LocalAi';
import { LiveDraw } from './LiveDraw';
import { PENDING_TEXT, progressText, progressWhy } from './makerCatalog';
import './liveDraw.css';

export type LiveSource = 'camera' | 'canvas' | 'text';
type Status = 'idle' | 'connecting' | 'loading' | 'live';

/** Frames a second sent up from the camera or the drawing. */
export const SEND_FPS = 8;
/** Side of the square frames sent up. */
export const FRAME_SIDE = 512;
/** Never more than this waiting in the socket: frames are skipped instead (live beats complete). */
const MAX_BUFFERED = 512 * 1024;

const SOURCES: { value: LiveSource; label: string; hint: string }[] = [
  { value: 'camera', label: 'Camera', hint: 'The iPad’s camera, restyled' },
  { value: 'canvas', label: 'Drawing', hint: 'Draw, and watch it move' },
  { value: 'text', label: 'Words only', hint: 'A video from your words (Krea)' },
];

/** The middle square of a picture, drawn into a FRAME_SIDE canvas as a JPEG data URL. */
export function squareFrame(src: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number }, out: HTMLCanvasElement): string | null {
  const w = src.videoWidth || (src.width as number) || 0;
  const h = src.videoHeight || (src.height as number) || 0;
  if (!w || !h) return null;
  const side = Math.min(w, h);
  out.width = FRAME_SIDE;
  out.height = FRAME_SIDE;
  const g = out.getContext('2d');
  if (!g) return null;
  g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, FRAME_SIDE, FRAME_SIDE);
  return out.toDataURL('image/jpeg', 0.72);
}

/**
 * Live video (Make): your camera, your drawing or just your words, turned into video on the AI
 * machine while you watch (StreamDiffusionV2, or Krea Realtime on the Turbo machine). Change the words
 * while it runs; "Save last 10 s" puts the end of it in the gallery.
 */
export function LiveVideo({
  ai,
  machineOn,
  makers,
  onOpenMakers,
  onSaved,
}: {
  ai: LocalAi;
  machineOn: boolean;
  makers: StudioMakerInfo[];
  onOpenMakers?: () => void;
  onSaved?: (item: StudioItem) => void;
}) {
  const toast = useShell((s) => s.toast);
  const [maker, setMaker] = useState<'live-sdv2' | 'live-krea'>('live-sdv2');
  const [source, setSource] = useState<LiveSource>('camera');
  const [prompt, setPrompt] = useState('');
  const [strength, setStrength] = useState(0.7);
  const [status, setStatus] = useState<Status>('idle');
  const [frame, setFrame] = useState<string | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const padCanvas = useRef<HTMLCanvasElement | null>(null);
  const frameCanvas = useRef<HTMLCanvasElement | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivals = useRef<number[]>([]);
  const sentPrompt = useRef('');
  const statusRef = useRef<Status>('idle');
  statusRef.current = status;

  const info = makers.find((m) => m.id === maker) ?? null;
  const sdv2 = makers.find((m) => m.id === 'live-sdv2') ?? null;
  const krea = makers.find((m) => m.id === 'live-krea') ?? null;
  const running = status !== 'idle';
  const effectiveSource: LiveSource = maker === 'live-sdv2' && source === 'text' ? 'camera' : source;

  const stopLocal = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    for (const t of stream.current?.getTracks() ?? []) t.stop();
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const w = ws.current;
    ws.current = null;
    if (w && w.readyState <= 1) w.close();
    setStatus('idle');
  }, []);
  useEffect(() => stopLocal, [stopLocal]);

  const send = (msg: Record<string, unknown>) => {
    const w = ws.current;
    if (w?.readyState === 1) w.send(JSON.stringify(msg));
  };

  /** Camera or drawing frames, SEND_FPS a second, skipped while the line is busy. */
  const startCapture = () => {
    frameCanvas.current ??= document.createElement('canvas');
    timer.current = setInterval(() => {
      const w = ws.current;
      if (!w || w.readyState !== 1 || w.bufferedAmount > MAX_BUFFERED) return;
      const src = effectiveSource === 'camera' ? videoRef.current : padCanvas.current;
      if (!src) return;
      const image = squareFrame(src, frameCanvas.current!);
      if (image) w.send(JSON.stringify({ type: 'frame', image }));
    }, 1000 / SEND_FPS);
  };

  const start = async () => {
    if (running) return;
    const words = prompt.trim();
    if (!words) return toast('Describe the look first, e.g. “a watercolour painting”.', 'info');
    setProblem(null);
    setFrame(null);
    setFps(null);
    arrivals.current = [];
    setStatus('connecting');
    try {
      if (effectiveSource === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera here.');
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream.current;
          await videoRef.current.play().catch(() => {});
        }
      }
      const a = await ai.liveAccess();
      if (!a) throw new Error('Your AI machine is not on yet.');
      const w = new WebSocket(`${a.url.replace(/^http/, 'ws')}/_orbit/live/video`, ['orbit-live', a.token]);
      ws.current = w;
      w.onopen = () => {
        sentPrompt.current = words;
        w.send(JSON.stringify({ type: 'start', maker, source: effectiveSource, prompt: words, strength }));
      };
      w.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.type === 'state') {
          if (m.state === 'loading') setStatus('loading');
          if (m.state === 'live') {
            setStatus('live');
            if (effectiveSource !== 'text' && !timer.current) startCapture();
          }
          if (m.state === 'stopped') stopLocal();
        } else if (m.type === 'frame') {
          setFrame(String(m.image));
          const now = performance.now();
          arrivals.current = [...arrivals.current.filter((t) => now - t < 3000), now];
          if (arrivals.current.length > 2) setFps(Math.round(((arrivals.current.length - 1) / ((now - arrivals.current[0]) / 1000)) * 10) / 10);
        } else if (m.type === 'saved') {
          setSaving(false);
          toast('Saved the last 10 seconds to your gallery.', 'info');
          onSaved?.(m.item as StudioItem);
        } else if (m.type === 'error') {
          setSaving(false);
          const msg = String(m.error || 'Live video hit a problem.');
          setProblem(msg);
          if (m.blocked || m.status === 409 || statusRef.current !== 'live') toast(msg, 'error');
        }
      };
      w.onerror = () => setProblem('Could not reach your AI machine for live video.');
      w.onclose = () => {
        if (ws.current === w) stopLocal();
      };
    } catch (err) {
      setProblem((err as Error).message);
      toast((err as Error).message, 'error');
      stopLocal();
    }
  };

  const stop = () => {
    send({ type: 'stop' });
    stopLocal();
  };

  // New words while it runs: sent once you stop typing.
  useEffect(() => {
    if (status !== 'live') return;
    const words = prompt.trim();
    if (!words || words === sentPrompt.current) return;
    const t = setTimeout(() => {
      sentPrompt.current = words;
      send({ type: 'prompt', prompt: words });
    }, 500);
    return () => clearTimeout(t);
  }, [prompt, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status === 'live') send({ type: 'strength', strength });
  }, [strength]); // eslint-disable-line react-hooks/exhaustive-deps

  const makerNote = (m: StudioMakerInfo | null, name: string) => {
    if (!m) return `${name}: checking your AI machine…`;
    if (m.pending) return `${name}: ${PENDING_TEXT.toLowerCase()}.`;
    if (m.installed) return null;
    if (m.setup) return `${name}: setting up its own Python (${m.setup}).`;
    if (m.problem) return `${name}: ${m.problem}`;
    return m.wanted ? progressWhy(m, machineOn) : `Add ${name} in the Store to use it.`;
  };
  const note = !machineOn ? 'Turn on your AI machine to start live video.' : makerNote(info, maker === 'live-krea' ? 'Krea Realtime' : 'StreamDiffusionV2');
  const statusText =
    problem ??
    (status === 'connecting'
      ? 'Connecting…'
      : status === 'loading'
        ? 'Loading the video model on your AI machine (the first time takes a few minutes)…'
        : status === 'live'
          ? fps
            ? `Live · about ${fps} frames a second`
            : effectiveSource === 'text'
              ? 'Live · the first frames are on their way'
              : 'Live · waiting for the first frames'
          : (note ?? 'Ready when you are.'));
  const canStart = machineOn && Boolean(info?.installed) && Boolean(prompt.trim()) && !running;

  return (
    <section className="ld lv" aria-label="Live video">
      <div className="ai-maker-picks" role="radiogroup" aria-label="Video maker">
        {(
          [
            ['live-sdv2', 'StreamDiffusionV2', sdv2],
            ['live-krea', 'Krea Realtime 14B', krea],
          ] as const
        ).map(([id, name, m]) => (
          <button key={id} type="button" role="radio" aria-checked={maker === id} className="ai-maker-chip" disabled={running} onClick={() => setMaker(id)}>
            {name}
            {m && !m.installed && <span className="ai-muted"> {m.pending ? 'soon' : m.wanted ? progressText(m, machineOn) : 'not added'}</span>}
          </button>
        ))}
        <button type="button" className="ai-maker-chip ai-maker-more" onClick={() => onOpenMakers?.()}>
          <Icon name="plus" size={14} /> Makers
        </button>
      </div>
      {maker === 'live-krea' && (
        <p className="ai-muted lv-note" role="note">
          Turbo machine only (H100, 80 GB). Its code is licensed CC BY-NC-SA 4.0: personal, non-commercial use only.
        </p>
      )}

      <div className="ai-maker-picks" role="radiogroup" aria-label="Source">
        {SOURCES.filter((s) => maker === 'live-krea' || s.value !== 'text').map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={effectiveSource === s.value} title={s.hint} className="ai-maker-chip" disabled={running} onClick={() => setSource(s.value)}>
            <Icon name={s.value === 'camera' ? 'camera' : s.value === 'canvas' ? 'pencil' : 'text'} size={16} /> {s.label}
          </button>
        ))}
      </div>

      <div className="ld-panes">
        {effectiveSource !== 'text' && (
          <div className="ld-pane">
            {effectiveSource === 'camera' ? (
              <div className="ld-preview lv-camera">
                <video ref={videoRef} playsInline muted autoPlay aria-label="Your camera" />
                {!running && <span className="ai-muted lv-camera-hint">The camera starts when you tap Start.</span>}
              </div>
            ) : (
              <LiveDraw ai={ai} machineOn={machineOn} makers={makers} onStarted={() => {}} padOnly onCanvas={(c) => (padCanvas.current = c)} />
            )}
          </div>
        )}
        <div className="ld-pane">
          <div className="ld-preview" data-live={Boolean(frame)}>
            {frame ? <img src={frame} alt="Live video from your AI machine" /> : <Icon name="film" size={40} />}
          </div>
          <p className="ai-muted ld-status" role="status">
            {statusText}
          </p>
        </div>
      </div>

      <div className="ld-words">
        <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Describe the look" placeholder={effectiveSource === 'text' ? 'What happens? e.g. a paper boat drifting down a rainy street' : 'The look, e.g. a watercolour painting'} maxLength={500} enterKeyHint="done" />
        {effectiveSource !== 'text' && (
          <label className="ld-follow">
            <span>How much to change</span>
            <input type="range" min={0.3} max={0.95} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-valuetext={strength < 0.5 ? 'A little' : strength < 0.8 ? 'Quite a lot' : 'A lot'} />
            <span className="ai-muted">{strength < 0.5 ? 'A little' : strength < 0.8 ? 'Quite a lot' : 'A lot'}</span>
          </label>
        )}
        <div className="ld-actions">
          {running ? (
            <button type="button" className="btn primary" onClick={stop}>
              <Icon name="stop" size={16} /> Stop
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void start()} disabled={!canStart}>
              <Icon name="play" size={16} /> Start
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={status !== 'live' || !frame || saving}
            onClick={() => {
              setSaving(true);
              send({ type: 'save' });
            }}
          >
            <Icon name="save" size={16} /> {saving ? 'Saving…' : 'Save last 10 s'}
          </button>
        </div>
        {machineOn && info && !info.installed && !info.wanted && !info.pending && (
          <button type="button" className="btn ghost" onClick={() => onOpenMakers?.()}>
            <Icon name="plus" size={16} /> Get {maker === 'live-krea' ? 'Krea Realtime' : 'StreamDiffusionV2'}
          </button>
        )}
      </div>
    </section>
  );
}
