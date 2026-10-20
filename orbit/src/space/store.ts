import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Layout } from './model';

/**
 * What the space remembers in this browser: how each room is laid out (only once you have
 * changed it; otherwise Orbit picks per content type) and which card is on top of each stack.
 */
interface SpaceState {
  layouts: Record<string, Layout>;
  tops: Record<string, number>;
  setLayout(room: string, layout: Layout): void;
  flip(room: string, dir: 1 | -1, count: number): void;
}

export const useSpace = create<SpaceState>()(
  persist(
    (set, get) => ({
      layouts: {},
      tops: {},
      setLayout(room, layout) {
        if (get().layouts[room] === layout) return;
        set({ layouts: { ...get().layouts, [room]: layout } });
      },
      flip(room, dir, count) {
        if (count < 2) return;
        const top = ((get().tops[room] ?? 0) + dir + count) % count;
        set({ tops: { ...get().tops, [room]: top } });
      },
    }),
    { name: 'orbit:space:v1', storage: createJSONStorage(() => localStorage), partialize: (s) => ({ layouts: s.layouts, tops: s.tops }) },
  ),
);
