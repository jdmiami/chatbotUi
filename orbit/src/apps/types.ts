export type Placement = 'full' | 'split-left' | 'split-right' | 'hidden';

/** Props every Orbit app receives from the shell. */
export interface AppProps {
  /** Where the app is shown. 'hidden' apps stay mounted so their state survives app switching. */
  placement: Placement;
  /** True when the app is visible and focused (full screen, or the focused split pane). */
  isActive: boolean;
  /** True when the app's own area is narrow (< 600px): use stacked, one-pane navigation. */
  compact: boolean;
}
