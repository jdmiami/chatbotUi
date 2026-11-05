import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '../../ui/components';
import { playable, type Scene } from './model';
import { paintNote } from './ink';
import { listScenes } from './store';

/**
 * Flipbook on iPhone: a viewer. Drawing happens on the iPad; the phone plays what is saved on it.
 * (Scenes reach the phone once account backup is in; until then it shows what this phone holds.)
 */
export function Viewer({ isActive }: { isActive: boolean }) {
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [pick, setPick] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isActive) return;
    void listScenes().then((all) => setScenes(all.filter((s) => s.frames.some((f) => f.strokes.length))));
  }, [isActive]);

  const scene = scenes?.[pick] ?? null;
  const order = scene ? playable(scene) : [];

  useEffect(() => {
    if (!scene || !playing || !isActive) return;
    const t = setInterval(() => setAt((k) => (k + 1) % order.length), 1000 / scene.fps);
    return () => clearInterval(t);
  }, [scene, playing, isActive, order.length]);

  useLayoutEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !scene) return;
    paintNote(ctx, scene.frames[order[at % order.length]]?.strokes ?? [], cv.width, { paper: true });
  });

  if (scenes === null) return <div className="fb-viewer" />;
  if (!scene)
    return (
      <div className="fb-viewer">
        <div className="fb-viewer-empty">
          <h2>Flipbook draws on iPad</h2>
          <p>Draw your animation on the iPad with the pen. On iPhone, Flipbook plays it back.</p>
          <p className="fb-hint">Animations reach this phone once account backup is turned on, in a later update. For now each device keeps its own.</p>
        </div>
      </div>
    );

  return (
    <div className="fb-viewer">
      <h2 className="fb-viewer-title">{scene.name}</h2>
      <canvas ref={ref} className="fb-viewer-note" width={720} height={720} role="img" aria-label={`${scene.name}, frame ${(at % order.length) + 1} of ${order.length}`} />
      <div className="fb-viewer-bar">
        <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} />
        <input type="range" min={0} max={Math.max(0, order.length - 1)} value={at % order.length} aria-label="Frame" onChange={(e) => (setPlaying(false), setAt(Number(e.target.value)))} />
        <span className="fb-hint">
          {(at % order.length) + 1} / {order.length}
        </span>
      </div>
      {scenes.length > 1 && (
        <div className="fb-viewer-list" role="list">
          {scenes.map((s, i) => (
            <button key={s.id} type="button" role="listitem" className="btn" aria-pressed={i === pick} onClick={() => (setPick(i), setAt(0), setPlaying(true))}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
