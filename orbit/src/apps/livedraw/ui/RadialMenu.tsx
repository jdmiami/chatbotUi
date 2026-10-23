import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useMotionLevel } from '../../../motion/MotionProvider';
import { SPRING } from '../../../motion/springs';
import type { Brush } from '../brushes/types';
import { MiniSlider } from './controls';
import { SIcon } from './StudioIcon';

const R = 92;

/**
 * The quick menu, opened where the pen is (press and hold): the last brushes, the last colours, undo
 * and redo round a ring, and size and opacity under it. Tap outside (or Escape) to close.
 */
export function RadialMenu(p: {
  x: number;
  y: number;
  bounds: { width: number; height: number };
  brushes: Brush[];
  currentBrush: string;
  colors: string[];
  color: string;
  size: number;
  opacity: number;
  onBrush: (b: Brush) => void;
  onColor: (c: string) => void;
  onSize: (v: number) => void;
  onOpacity: (v: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}) {
  const level = useMotionLevel();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const W = 2 * R + 64;
  const H = W + 104;
  const left = Math.min(Math.max(8, p.x - W / 2), Math.max(8, p.bounds.width - W - 8));
  const top = Math.min(Math.max(8, p.y - W / 2), Math.max(8, p.bounds.height - H - 8));
  const items: { key: string; label: string; node: React.ReactNode; on: () => void; current?: boolean }[] = [
    ...p.brushes.slice(0, 3).map((b) => ({ key: `b${b.id}`, label: b.name, node: <span className="ldx-radial-brush">{b.name}</span>, on: () => p.onBrush(b), current: b.id === p.currentBrush })),
    { key: 'undo', label: 'Undo', node: <SIcon name="undo" size={20} />, on: p.onUndo },
    ...p.colors.slice(0, 3).map((c) => ({ key: `c${c}`, label: `Colour ${c}`, node: <span className="ldx-radial-dot" style={{ background: c }} />, on: () => p.onColor(c), current: c === p.color })),
    { key: 'redo', label: 'Redo', node: <SIcon name="redo" size={20} />, on: p.onRedo },
  ];
  return (
    <div className="ldx-radial-scrim" onPointerDown={p.onClose} onKeyDown={(e) => e.key === 'Escape' && p.onClose()}>
      <motion.div
        className="ldx-radial"
        role="dialog"
        aria-label="Quick menu"
        style={{ left, top, width: W }}
        onPointerDown={(e) => e.stopPropagation()}
        initial={level === 'off' ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: level === 'full' ? SPRING.playful : { duration: 0.12 } }}
      >
        <div className="ldx-radial-ring" style={{ width: W, height: W }}>
          <span className="ldx-radial-centre" aria-hidden>
            <span style={{ background: p.color, width: Math.max(6, Math.min(56, p.size * 18)), height: Math.max(6, Math.min(56, p.size * 18)), opacity: p.opacity }} />
          </span>
          {items.map((it, i) => {
            const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
            return (
              <button
                key={it.key}
                ref={i === 0 ? first : undefined}
                type="button"
                className="ldx-radial-item"
                aria-label={it.label}
                aria-pressed={it.current}
                style={{ left: W / 2 + Math.cos(a) * R - 26, top: W / 2 + Math.sin(a) * R - 26 }}
                onClick={() => {
                  it.on();
                  if (it.key !== 'undo' && it.key !== 'redo') p.onClose();
                }}
              >
                {it.node}
              </button>
            );
          })}
        </div>
        <div className="ldx-radial-sliders">
          <MiniSlider label="Size" value={p.size} min={0.25} max={4} step={0.05} onChange={p.onSize} text={`${Math.round(p.size * 100)}%`} />
          <MiniSlider label="Opacity" value={p.opacity} min={0.05} max={1} step={0.01} onChange={p.onOpacity} text={`${Math.round(p.opacity * 100)}%`} />
        </div>
      </motion.div>
    </div>
  );
}
