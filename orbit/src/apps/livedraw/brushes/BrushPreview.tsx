import { useEffect, useRef } from 'react';
import { renderBrushPreview } from '../engine/canvas2d';
import type { Brush } from './types';

/** A brush's stroke, drawn small (the library) or large (the brush maker). */
export function BrushPreview({ brush, width, height, color, className, scale }: { brush: Brush; width: number; height: number; color?: string; className?: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ink = color ?? getComputedStyle(c).color ?? '#1b1b1f';
    // Drawn after the panel has painted, so opening a long list stays smooth.
    const id = requestAnimationFrame(() => renderBrushPreview(c, brush, ink, { scale }));
    return () => cancelAnimationFrame(id);
  }, [brush, width, height, color, scale]);
  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden />;
}
