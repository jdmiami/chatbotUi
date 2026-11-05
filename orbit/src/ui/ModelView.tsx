import { createElement, useEffect, useRef, useState } from 'react';

/**
 * A 3D object (.glb) you can turn with a finger, pinch to zoom, on iPhone and iPad. Google's
 * model-viewer, loaded only the first time a 3D object is shown (it brings three.js with it). Its
 * picture shows while it loads. Drags on it turn the object and never reach what is behind (the
 * gallery's swipe to the next item).
 */
let loading: Promise<unknown> | null = null;
const load = () => (loading ??= import('@google/model-viewer'));

export function ModelView({ src, poster, label, onReady }: { src: string; poster?: string; label: string; onReady?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load().then(
      () => live && setReady(true),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const done = () => onReady?.();
    const bad = () => {
      setFailed(true);
      onReady?.();
    };
    el.addEventListener('load', done);
    el.addEventListener('error', bad);
    return () => {
      el.removeEventListener('load', done);
      el.removeEventListener('error', bad);
    };
  }, [ready, onReady]);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  if (failed) {
    return (
      <div className="model-view model-view-failed" role="img" aria-label={label}>
        {poster ? <img src={poster} alt="" /> : null}
        <p>This 3D object can't be shown here. Save it to open it in another app.</p>
      </div>
    );
  }
  return (
    <div className="model-view" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onTouchStart={stop}>
      {ready
        ? createElement('model-viewer', {
            ref,
            src,
            poster,
            alt: label,
            'camera-controls': '',
            'touch-action': 'none',
            'auto-rotate': '',
            'auto-rotate-delay': '1500',
            'shadow-intensity': '1',
            exposure: '1',
            'interaction-prompt': 'none',
            style: { width: '100%', height: '100%', background: 'transparent' },
          })
        : poster
          ? <img src={poster} alt="" className="model-view-poster" />
          : null}
    </div>
  );
}
