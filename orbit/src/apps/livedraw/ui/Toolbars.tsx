import type { StageTool } from '../canvas/Stage';
import { MiniSlider, VSlider } from './controls';
import { SIcon, type StudioIconName } from './StudioIcon';

export const TOOLS: { value: StageTool; label: string; icon: StudioIconName; key: string }[] = [
  { value: 'brush', label: 'Brush', icon: 'brushTip', key: 'B' },
  { value: 'eraser', label: 'Eraser', icon: 'eraser', key: 'E' },
  { value: 'smudge', label: 'Smudge', icon: 'smudge', key: 'S' },
  { value: 'fill', label: 'Fill', icon: 'bucket', key: 'G' },
  { value: 'picker', label: 'Pick a colour', icon: 'dropper', key: 'I' },
  { value: 'select', label: 'Edit ink', icon: 'select', key: 'V' },
];

interface Common {
  tool: StageTool;
  onTool: (t: StageTool) => void;
  color: string;
  onColour: () => void;
  size: number;
  onSize: (v: number) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  painting: boolean;
}

/** iPad held sideways and desktop: tools, colour, size and opacity down the left. */
export function Rail(p: Common & { onFit: () => void; onRadial: () => void; onHide: () => void; brushName: string }) {
  return (
    <div className="ldx-rail-in" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      <div className="ldx-rail-grid" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button key={t.value} type="button" role="radio" aria-checked={p.tool === t.value} aria-label={t.label} title={`${t.label} (${t.key})`} className="ldx-tool" disabled={p.painting && t.value !== 'brush' && t.value !== 'eraser'} onClick={() => p.onTool(t.value)}>
            <SIcon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      <p className="ldx-rail-brush" title="The brush in hand">
        {p.brushName}
      </p>
      <div className="ldx-rail-grid">
        <button type="button" className="ldx-swatch ldx-swatch-big" aria-label={`Colour ${p.color}`} title="Colour" onClick={p.onColour}>
          <span style={{ background: p.color }} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Quick menu" title="Quick menu (or press and hold the canvas with two fingers)" onClick={p.onRadial}>
          <SIcon name="radial" size={20} />
        </button>
      </div>
      <div className="ldx-rail-sliders">
        <VSlider label="Size" value={p.size} min={0.25} max={4} onChange={p.onSize} text={`${Math.round(p.size * 100)}%`} preview="size" />
        <VSlider label="Opacity" value={p.opacity} min={0.05} max={1} onChange={p.onOpacity} text={`${Math.round(p.opacity * 100)}%`} preview="opacity" />
      </div>
      <div className="ldx-rail-grid">
        <button type="button" className="ldx-tool" aria-label="Undo" title="Undo (or tap with two fingers)" disabled={!p.canUndo} onClick={p.onUndo}>
          <SIcon name="undo" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Redo" title="Redo (or tap with three fingers)" disabled={!p.canRedo} onClick={p.onRedo}>
          <SIcon name="redo" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Whole canvas" title="Show the whole canvas" onClick={p.onFit}>
          <SIcon name="fit" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Hide the tools" title="Hide the tools (or tap with four fingers)" onClick={p.onHide}>
          <SIcon name="eyeOff" size={20} />
        </button>
      </div>
    </div>
  );
}

/** iPhone (and iPad upright): the tools in one row above the canvas. */
export function QuickBar(p: Common & { onBrushes: () => void }) {
  return (
    <div className="ldx-quick" role="toolbar" aria-label="Drawing tools">
      <div className="ldx-quick-tools" role="radiogroup" aria-label="Tool">
        {TOOLS.slice(0, 3).map((t) => (
          <button key={t.value} type="button" role="radio" aria-checked={p.tool === t.value} aria-label={t.label} className="ldx-tool" disabled={p.painting && t.value === 'smudge'} onClick={() => (p.tool === t.value && !p.painting ? p.onBrushes() : p.onTool(t.value))}>
            <SIcon name={t.icon} size={20} />
          </button>
        ))}
        <button type="button" role="radio" aria-checked={['fill', 'picker', 'select'].includes(p.tool)} aria-label="More tools" className="ldx-tool" disabled={p.painting} onClick={p.onBrushes}>
          <SIcon name={TOOLS.find((t) => t.value === p.tool && ['fill', 'picker', 'select'].includes(t.value))?.icon ?? 'more'} size={20} />
        </button>
      </div>
      <button type="button" className="ldx-swatch" aria-label={`Colour ${p.color}`} onClick={p.onColour}>
        <span style={{ background: p.color }} />
      </button>
      <button type="button" className="ldx-tool" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
        <SIcon name="undo" size={20} />
      </button>
      <button type="button" className="ldx-tool" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
        <SIcon name="redo" size={20} />
      </button>
    </div>
  );
}

/** iPhone: size and opacity under the canvas. */
export function QuickSliders(p: Pick<Common, 'size' | 'onSize' | 'opacity' | 'onOpacity'>) {
  return (
    <div className="ldx-quick ldx-quick-sliders">
      <MiniSlider label="Size" value={p.size} min={0.25} max={4} step={0.05} onChange={p.onSize} text={`${Math.round(p.size * 100)}%`} />
      <MiniSlider label="Opacity" value={p.opacity} min={0.05} max={1} step={0.01} onChange={p.onOpacity} text={`${Math.round(p.opacity * 100)}%`} />
    </div>
  );
}

/** Every tool, for the phone's sheet. */
export function ToolPicker({ tool, onTool, painting }: { tool: StageTool; onTool: (t: StageTool) => void; painting: boolean }) {
  return (
    <div className="ldx-chips ldx-toolpick" role="radiogroup" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.value} type="button" role="radio" className="ldx-chip ldx-toolchip" aria-checked={tool === t.value} disabled={painting && t.value !== 'brush' && t.value !== 'eraser'} onClick={() => onTool(t.value)}>
          <SIcon name={t.icon} size={18} /> {t.label}
        </button>
      ))}
    </div>
  );
}
