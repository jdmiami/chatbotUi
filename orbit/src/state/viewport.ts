import { create } from 'zustand';

interface ViewportState {
  width: number;
  height: number;
  keyboardOpen: boolean;
  set(patch: Partial<Omit<ViewportState, 'set'>>): void;
}

export const useViewportStore = create<ViewportState>()((set) => ({
  width: typeof window !== 'undefined' ? window.innerWidth : 1024,
  height: typeof window !== 'undefined' ? window.innerHeight : 768,
  keyboardOpen: false,
  set: (patch) => set(patch),
}));

/**
 * Layout classes used across Orbit.
 *  - phone: the short side is < 600px (iPhone in either orientation) → apps are full screen.
 *  - tablet: short side >= 600px (iPad) → split view is available when wide enough.
 */
export function useLayout() {
  const { width, height, keyboardOpen } = useViewportStore();
  const shortSide = Math.min(width, height);
  const isTablet = shortSide >= 600;
  const landscape = width > height;
  return {
    width,
    height,
    keyboardOpen,
    isTablet,
    isPhone: !isTablet,
    landscape,
    /** Split view needs a tablet and at least 768px of width. */
    canSplit: isTablet && width >= 768,
    /** Narrow widths (phone portrait, or a narrow split pane) use stacked navigation. */
    compact: width < 600,
  };
}
