import type { CSSProperties } from 'react';
import { Icon, type IconName } from '../../../ui/Icon';

/** Live Draw's own icons (same 24 px grid and stroke as Orbit's), so the shared set stays untouched. */
const EXTRA = {
  brushTip: 'M14 4l6 6-8 8-6-6zM6 12l-2.5 2.5a2.1 2.1 0 0 0 0 3l1 1a2.1 2.1 0 0 0 3 0L10 16M14 4l2-2 6 6-2 2',
  smudge: 'M8 13V5a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v8M16 11a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.2-3L4 13.5a1.8 1.8 0 0 1 3-2L8 13',
  select: 'M5 3l14 8.5-6.2 1.6L9.5 19zM13 13l5 5',
  guides: 'M3 21L21 3v18zM7 21v-2.5M11 21v-4M15 21v-2.5M17 13h-3v3',
  perspective: 'M2 9h20M12 9l-9 12M12 9l9 12M12 9l-4 12M12 9l4 12M12 9v12',
  symmetry: 'M12 2v20M9 6 3 12l6 6zM15 6l6 6-6 6z',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  merge: 'M6 3v5a6 6 0 0 0 6 6v7M18 3v5a6 6 0 0 1-6 6M9 18l3 3 3-3',
  mask: 'M4 4h16v16H4zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  clip: 'M7 4v8a4 4 0 0 0 4 4h8M16 13l3 3-3 3',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  radial: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  nib: 'M12 3l7 7-7 11-7-11zM12 3v8M12 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  shapes: 'M4 20 20 4M15 20h5v-5M7.5 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  steady: 'M3 17c3 0 4-10 9-10s6 10 9 10M3 21h18',
  wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v9l7.8 4.5M12 12l-7.8 4.5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4M13 20h7',
} as const;

export type StudioIconName = IconName | keyof typeof EXTRA;

export function SIcon({ name, size = 22, strokeWidth = 1.9, style, className }: { name: StudioIconName; size?: number; strokeWidth?: number; style?: CSSProperties; className?: string }) {
  if (!(name in EXTRA)) return <Icon name={name as IconName} size={size} strokeWidth={strokeWidth} style={style} className={className} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style} className={className}>
      <path d={EXTRA[name as keyof typeof EXTRA]} />
    </svg>
  );
}
