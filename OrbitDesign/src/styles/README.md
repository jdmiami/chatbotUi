# OrbitDesign styles

Six files. Import them in this order, once, at the top of your app's entry file (the order matters: later files override earlier ones at equal specificity, and the docs in `docs/02`–`04` describe the cascade that results from exactly this order, which is the order Orbit itself uses in `orbit/src/main.tsx`).

```ts
import 'orbit-design/styles/tokens.css';
import 'orbit-design/styles/base.css';
// import 'orbit-design/motion/motion.css';   // from the motion package (docs/05-motion.md); Orbit loads it here
import 'orbit-design/styles/glass.css';
import 'orbit-design/styles/o5.css';
// import 'orbit-design/orb/face.css';        // the orb's face (docs/09-orb.md) — before orb.css
// import 'orbit-design/orb/orb.css';         // the orb; Orbit loads it here
import 'orbit-design/styles/studio.css';
import { loadFonts } from 'orbit-design/styles/fonts';
```

**tokens.css** — Every CSS custom property Orbit's look is built from: fonts, text scale and sizes, radii, spacing, the 44px touch target, safe-area insets, viewport height, timings, the five accents, the dark and light palettes, wallpapers and the reduced-motion zeroing. It is a verbatim copy of `orbit/src/styles/tokens.css`. Import it first; everything else reads from it. Values and selectors are tabulated in `docs/02-tokens.md`.

**base.css** — The generic part of `orbit/src/styles/global.css`: the box-sizing reset, `html`/`body` defaults (100% height, `overflow: hidden`, the UI font, `-webkit-tap-highlight-color: transparent`), the 16px-on-touch rule for inputs, the focus ring, `.visually-hidden`, `.ta-plain`, and the shared classic components: `.glass`, `.widget`, `.app-header`, `.btn` (`.primary`, `.ghost`, `.danger`, `.small`, `.block`), `.icon-btn`, `.chip`, `.sheet*`, `.list`/`.row`, `.switch`, `.segmented`, `.state`, `.banner`, `.toasts`/`.toast`, `.swatch`, `.range`, the small helpers and the `fade-in`/`sheet-up`/`spin` keyframes. The rules that belong to Orbit's shell (home screen, dock, app windows, switcher, control centre, boot screen, censor) were dropped; the header comment of the file lists every dropped selector. Import it second.

**glass.css** — Liquid Glass, verbatim from `orbit/src/styles/glass.css`: the tint, edge, sheen and blur variables for dark and light, and the rules that paint `.glass`, `.sheet`, `.cc-panel.glass` and `.app-header` as panes of glass. It reads `--depth-3`, `--dur-snappy`, `--dur-playful`, `--spring-snappy` and `--spring-playful`, which `orbit/src/styles/motion.css` defines (the motion package); without motion.css the `box-shadow: var(--depth-3)` on `.glass` is invalid and simply draws no shadow, and the two `.dock.glass` transitions do nothing. Import it after base.css.

**o5.css** — The Orbit 0.5 magazine skin from `orbit/src/styles/o5.css`, scoped to `<html data-skin="o5">`: the warm palettes, the Fraunces/Inter font variables, the hairline (`--o5-hair`) and glow (`--o5-glow`), the editorial pieces (`.o5-kicker`, `.o5-display`, `.o5-dek`, `.o5-go`, the index, the handle, the chapter opener, the running head, the `.mag-*` pages) and the overrides that turn the classic components into ink on paper. Rules that only restyle Orbit's own apps (`.ai-*`, `.ag-*`, `.term-*`, `.ed-*`, `.sr-*`, the Settings app's `.st-page`/`.st-section`/`.st-heading`/`.st-caption`) were dropped and are listed in the file's header comment. Two unscoped rules in it reach the studio look: `.st-contents` (gives the studio's contents list `display: flex; flex-direction: column; gap: 8px`) and `:root[data-skin='o5'] .st-scroll` (sets the studio scroller's side padding); keep o5.css **before** studio.css so studio.css's own `.st-contents` margin/padding win, as they do in Orbit. Import it after glass.css.

**studio.css** — The magazine site look, verbatim from `orbit/src/studio/studio.css`: the `.st-root` three-row grid, the masthead bar, the square icon buttons, the headline/kicker/dek stack, answers between hairlines, the underlined input, small-caps underlined text buttons, the trail, contents rows, the brief, the ink-on-paper `.st-go` button, the 2px progress bar, the script desk, the talk thread, the bottom bar, the drawers and tabs. Import it last. It uses `--font-display`, `--o5-hair` and `--o5-glow` without fallbacks, so it needs o5.css and `data-skin="o5"` on `<html>`.

**fonts.ts** — `loadFonts()` runs the exact three dynamic imports Orbit uses for the magazine faces (`@fontsource-variable/fraunces/opsz.css`, `@fontsource-variable/fraunces/opsz-italic.css`, `@fontsource-variable/inter/index.css`). Call it once after the attributes below are set. Both `@fontsource-variable` packages are dependencies of this package (`^5.3.0`).

## The html attributes

For the magazine look set, on `<html>` (Orbit's `StudioApp` sets the first three in a `useEffect`, quoted in `docs/02-tokens.md`):

```html
<html lang="en" data-theme="dark" data-skin="o5" data-studio="afterdark">
```

- `data-theme`: `dark` or `light`. tokens.css treats a missing attribute as dark; o5.css's palettes only match when it is present (`:root[data-skin='o5'][data-theme='dark']`), so set it explicitly.
- `data-skin`: `o5` for the magazine skin. Anything else (Orbit uses `classic`) gives the classic glass look.
- `data-studio`: any id. studio.css defines `--st-gutter` and `--st-col` under `:root[data-studio]`; the value itself is not read by any stylesheet.
- `data-motion`: `full`, `lite` or `off`, set by the motion package's `MotionProvider`; several rules in o5.css and studio.css are gated on it (`docs/05-motion.md`).
- Optional, classic look only: `data-accent` (`indigo` | `teal` | `amber` | `rose` | `sky`), `data-wallpaper` (`orbit` | `dusk` | `aurora` | `graphite`), `data-reduce-motion` (`true` | `false`).

Per-site colours are inline custom properties on the same element (`--accent`, and the `--st-*` and `--orb-*` variables), set with `document.documentElement.style.setProperty(...)`; see "The studio theme" in `docs/02-tokens.md`.

Also copy the viewport meta from `orbit/index.html`, which the safe-area padding and the keyboard handling depend on:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
```
