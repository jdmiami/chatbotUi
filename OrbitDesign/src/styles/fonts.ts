/// <reference types="vite/client" />
/**
 * OrbitDesign: the two typefaces of the magazine look.
 *
 * Fraunces Variable (display, the `opsz` file set, upright and italic) and Inter Variable (UI).
 * These are the same three imports Orbit runs for its magazine-look sites (and, for the Orbit 0.5
 * look, in orbit/src/hooks/useApplySettings.ts). They are dynamic imports so the fonts
 * only download when the magazine look is wanted; Vite turns each into a <link rel="stylesheet">.
 *
 * The @font-face rules they add declare `font-family: 'Fraunces Variable'` and
 * `font-family: 'Inter Variable'` with `font-weight: 100 900` and `font-display: swap`, which is
 * what `--font-display` and `--font-ui` in o5.css name first. Until they load, or if they never do
 * (offline), the fallbacks in those variables stand in.
 *
 * Call once, after the page has set `data-skin="o5"` (see README.md). Safe to call again.
 */
let loading: Promise<unknown> | null = null;

export function loadFonts(): Promise<void> {
  loading ??= Promise.all([import('@fontsource-variable/fraunces/opsz.css'), import('@fontsource-variable/fraunces/opsz-italic.css'), import('@fontsource-variable/inter/index.css')]).catch(() => {
    loading = null; // offline: system fonts stand in; try again next time
  });
  return loading.then(() => undefined);
}
