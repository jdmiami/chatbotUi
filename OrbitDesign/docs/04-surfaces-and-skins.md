# 04 · Surfaces and skins

How a screen is built: the two skins, the depth and glass system, the hairline-and-space system of the magazine look, every element recipe with its exact CSS, the icon set, the layout grid and the phone/tablet rules. CSS is quoted verbatim from `orbit/src/styles/global.css` (global), `orbit/src/styles/glass.css` (glass), `orbit/src/styles/motion.css` (motion), `orbit/src/styles/o5.css` (o5) and `orbit/src/studio/studio.css` (studio). Markup is quoted from the `.tsx` files named. Where a statement is a consequence of the cascade rather than a single rule, it is marked **derived**.

## 1. The two skins

| | Classic ("liquid glass") | o5 (Orbit 0.5, the magazine) |
|---|---|---|
| Switch | `<html data-skin="classic">` (or any value other than `o5`; Orbit's default is `settings.skin ?? 'classic'`) | `<html data-skin="o5">`; a studio site always sets it |
| Fonts | system UI stack | Fraunces Variable + Inter Variable |
| Surfaces | tinted, blurred panes with a lit rim and a sliding sheen; cards, tiles, pills | no boxes: transparent backgrounds, hairlines between rows, type and space carry the structure |
| Corners | `8 / 12 / 18 / 26px` radii, `22.5%` icon tiles | `999px` pills for buttons, `14 / 22px` for the few remaining boxes; the studio look is square (`border-radius: 0`) everywhere |
| Primary action | accent fill (`.btn.primary { background: var(--accent); color: var(--on-accent) }`) | ink on paper (`background: var(--text); color: var(--bg)`) |
| Background | wallpaper gradients | flat `--bg` with an accent glow at the top right (`--o5-glow`) |
| Selection | highlight backgrounds | italics, an accent `✦`, an underline |

### What o5.css changes, rule by rule

Palette, fonts, radii, timing (see `docs/02-tokens.md` §1, §3, §6, §8 for the values):

```css
:root[data-skin='o5'] {
  --font-display: 'Fraunces Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  --font-ui: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --radius-sm: 999px;
  --radius-md: 14px;
  --radius-lg: 22px;
  --ease-o5: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-o5: 520ms;
  --o5-hair: color-mix(in srgb, var(--text) 12%, transparent);
}
```

The page:

```css
:root[data-skin='o5'] body {
  font-family: var(--font-ui);
  letter-spacing: -0.005em;
  background: var(--bg);
  font-feature-settings: 'ss01', 'cv11';
}
:root[data-skin='o5'] .shell {
  background: var(--o5-glow), var(--bg);
}
:root[data-skin='o5'] .app-window { background: transparent; }
```

De-boxing the classic components:

```css
/* Buttons: ink, not tiles. Primary keeps a soft accent wash so the main action is still obvious. */
:root[data-skin='o5'] .btn {
  border-radius: 999px;
  background: transparent;
  border: 1px solid var(--o5-hair);
  font-weight: 500;
}
:root[data-skin='o5'] .btn:hover { background: var(--o5-hair); }
:root[data-skin='o5'] .btn.primary { background: var(--text); color: var(--bg); border-color: transparent; }
:root[data-skin='o5'] .btn.ghost { border-color: transparent; }
:root[data-skin='o5'] .icon-btn { border-radius: 50%; background: transparent; }

/* Lists, cards, tiles, banners: no boxes. Hairlines only where rows need separating. */
:root[data-skin='o5'] :is(.list, .widget, .glass, .banner, .ai-banner, .state, .cc-tile, .switcher-card) {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
:root[data-skin='o5'] .row { border-bottom-color: var(--o5-hair); }
:root[data-skin='o5'] .segmented { background: transparent; border: 1px solid var(--o5-hair); border-radius: 999px; }
:root[data-skin='o5'] .segmented button { border-radius: 999px; min-width: var(--tap); min-height: var(--tap); }
:root[data-skin='o5'] .segmented button[aria-pressed='true'] { background: var(--text); color: var(--bg); box-shadow: none; }
:root[data-skin='o5'] .chip { background: transparent; border: 1px solid var(--o5-hair); }
:root[data-skin='o5'] :is(input, textarea, .ta-plain, select):not([type='range']):not([type='checkbox']) { border-radius: var(--radius-md); }
```

(The comment on `.btn.primary` says "soft accent wash"; the rule actually fills it with `var(--text)`.)

Headers and glass lose their rim and sheen:

```css
:root[data-skin='o5'] .app-header {
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  border-bottom: 0;
  min-height: calc(var(--safe-top) + 60px);
  max-height: calc(var(--safe-top) + 140px);
  overflow: hidden;
  transition: max-height var(--dur-o5) var(--ease-o5), opacity var(--dur-o5) var(--ease-o5), padding var(--dur-o5) var(--ease-o5),
    min-height var(--dur-o5) var(--ease-o5);
}
/* glass.css draws a rim and a sheen on headers: none here. */
:root[data-skin='o5'] .app-header { box-shadow: none; background: color-mix(in srgb, var(--bg) 72%, transparent); }
:root[data-skin='o5'] .glass, :root[data-skin='o5'] .sheet { --sheen: none; }
```

and, at the very end of the file (so it wins over the two above): `:root[data-skin='o5'] .app-header { background: color-mix(in srgb, var(--bg) 90%, transparent); }`.

Sheets rise from the depth over a blurred page:

```css
:root[data-skin='o5'] .sheet {
  border: 0;
  background: var(--glass-strong);
  box-shadow: 0 -30px 80px rgb(0 0 0 / 0.35);
}
:root[data-skin='o5'] .sheet-scrim {
  background: color-mix(in srgb, var(--bg) 46%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
  backdrop-filter: blur(14px) saturate(120%);
}
:root[data-skin='o5'] .cc-panel { border: 0; background: var(--glass-strong); }
```

The classic 3D rims (the `--depth-*` shadows from motion.css) are switched off; the doubled attribute selector gives it (0,4,0) so it beats motion.css without `!important`:

```css
:root[data-skin='o5'][data-skin] :is(.app-icon .glyph, .home .widget, .ai-card, .ai-suggest-btn, .ai-tile, .cc-tile, .btn, .icon-btn, .segmented button, button.chip, button.row, .ai-model-row, .ai-model-chip),
:root[data-skin='o5'][data-skin] :is(.ai-suggest-btn, .ai-tile, .cc-tile, .btn, .icon-btn, .segmented button):active {
  box-shadow: none;
}
```

Status chips become small-caps labels, and the last accent fills become ink:

```css
:root[data-skin='o5'] span.chip {
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  font: 600 calc(10.5px * var(--text-scale)) / 1.4 var(--font-ui);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
:root[data-skin='o5'] span.chip .dot { width: 5px; height: 5px; }
:root[data-skin='o5'] :is(.term-compose-send, .ag-send, .ai-send) {
  background: var(--text) !important;
  color: var(--bg) !important;
  box-shadow: none;
}
```

## 2. Depth, glass, hairlines, glow

### Depth layers (motion.css)

One light, above and to the left. Every shadow begins with `var(--lit)` (the inset rim, glass.css) and then one or two drop shadows whose offsets swing with the tilt (`--sx`/`--sy`). Values for dark and light are in `docs/02-tokens.md` §10. The layer assignments:

```css
/* Layer 1 · surface */
.app-icon .glyph, .home .widget, .ai-card, .ai-suggest-btn, .ai-tile, .cc-tile { box-shadow: var(--depth-1); }
/* Layer 2 · raised */
.dock, .ai-composer-card { box-shadow: var(--depth-2); }
.app-window:not([data-placement='full']):not([data-placement^='split']) { box-shadow: var(--depth-2); }
/* Layer 3 · floating */
.sheet { box-shadow: var(--depth-3); }
/* Layer 4 · top */
.toast { box-shadow: var(--depth-4); }
```

Pressing pushes a surface into the page: `box-shadow: var(--depth-1-pressed)` (see `docs/05-motion.md`). The classic tokens `--shadow-1` and `--shadow-2` (tokens.css) are the older, tilt-free shadows. global.css still writes them on `.glass` (`--shadow-1`) and `.sheet` (`--shadow-2`), but with the files loaded in Orbit's order every pane ends up with a depth shadow instead: glass.css gives `.glass:not(.dock):not(.toast)` `--depth-3`, and motion.css (loaded before glass.css but after global.css) gives `.dock` `--depth-2`, `.sheet` `--depth-3` and `.toast` `--depth-4`, all at the same (0,1,0) specificity and later than global.css. **Derived:** `--shadow-1` therefore only survives on `.segmented button[aria-pressed='true']` and `.app-icon .glyph`, and `--shadow-2` on `.switcher-card`.

### Glass (glass.css, whole file)

```css
:root {
  --glass-tint: rgb(24 30 52 / 0.48);
  --glass-tint-strong: rgb(18 23 40 / 0.8);
  --glass-edge: rgb(255 255 255 / 0.16);
  --glass-sheen: rgb(255 255 255 / 0.16);
  --glass-blur: blur(26px) saturate(190%) brightness(1.05);
  /* The rim: lit top and left edges, a faint right edge, a shaded bottom, and a little inner glow. */
  --lit: inset 0 1px 0 rgb(255 255 255 / 0.3), inset 1px 0 0 rgb(255 255 255 / 0.1), inset -1px 0 0 rgb(255 255 255 / 0.04),
    inset 0 -1px 0 rgb(0 0 0 / 0.22), inset 0 0 18px rgb(255 255 255 / 0.04);
}
:root[data-theme='light'] {
  --glass-tint: rgb(255 255 255 / 0.52);
  --glass-tint-strong: rgb(255 255 255 / 0.86);
  --glass-edge: rgb(255 255 255 / 0.7);
  --glass-sheen: rgb(255 255 255 / 0.55);
  --glass-blur: blur(26px) saturate(180%) brightness(1.02);
  --lit: inset 0 1px 0 rgb(255 255 255 / 0.95), inset 1px 0 0 rgb(255 255 255 / 0.5), inset 0 -1px 0 rgb(15 23 42 / 0.08),
    inset 0 0 18px rgb(255 255 255 / 0.25);
}

/* The sheen sits where the light hits, and slides as you tilt (--tx / --ty from motion/tilt.ts). */
.glass,
.sheet,
.app-header {
  --sheen: radial-gradient(140% 100% at calc(18% - var(--tx, 0) * 26%) calc(-12% - var(--ty, 0) * 26%), var(--glass-sheen), transparent 48%);
}
.glass {
  background: var(--sheen), linear-gradient(180deg, rgb(255 255 255 / 0.05), transparent 45%), var(--glass-tint);
  border: 0.5px solid var(--glass-edge);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.glass:not(.dock):not(.toast) { box-shadow: var(--depth-3); }
.sheet,
.cc-panel.glass {
  background: var(--sheen), var(--glass-tint-strong);
  border: 0.5px solid var(--glass-edge);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.app-header {
  background: var(--sheen), var(--glass-tint-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  box-shadow: inset 0 -0.5px 0 var(--glass-edge);
}

/* Liquid: pressing a pane makes its glass gather toward your finger for a moment. */
:root[data-motion='full'] .dock.glass:active { scale: 0.985; transition: scale var(--dur-snappy) var(--spring-snappy); }
:root[data-motion='full'] .dock.glass { transition: scale var(--dur-playful) var(--spring-playful); }

/* People who ask the device for less transparency get solid panes (same layers, same rims). */
@media (prefers-reduced-transparency: reduce) {
  .glass, .sheet, .cc-panel.glass, .app-header {
    background: var(--glass-tint-strong);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  :root:not([data-theme='light']) .glass, :root:not([data-theme='light']) .sheet { background: rgb(22 27 44); }
}
```

The older `.glass` in global.css, which glass.css and motion.css override property by property (see the derived note above on its `box-shadow`):

```css
.glass {
  background: var(--glass);
  border: 1px solid var(--glass-border);
  -webkit-backdrop-filter: saturate(160%) blur(22px);
  backdrop-filter: saturate(160%) blur(22px);
  box-shadow: var(--shadow-1);
}
```

### Hairlines

One token, `--o5-hair: color-mix(in srgb, var(--text) 12%, transparent)`, drawn as `1px solid` (or as a 2px track for the progress bar). It is the only line in the magazine look: `.st-top { border-bottom }`, `.st-bottom { border-top }`, `.st-sq { border }`, `.st-ico { border }`, every list row's `border-bottom` plus the first row's `border-top`, the `.st-own input` and `.st-scene-form` underlines, the `text-decoration-color` of text buttons, `.st-bar` (track), `.st-frame-wait`, `.st-scenes { border-top }`, `.st-drawer { border-left }`, `.st-brieflist > div`, `.st-rules li`. Hover and focus turn a line to `--text-3` (`.st-sq:hover`) or to the accent (`input:focus`).

### The glow and the dark desk

```css
:root[data-skin='o5'][data-theme='dark'] { --o5-glow: radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%); }
:root[data-skin='o5'][data-theme='light'] { --o5-glow: radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%); }
```

It is layered over the flat background wherever a page is painted: `.st-root { background: var(--o5-glow), var(--bg); }`, `.st-drawer { background: var(--o5-glow), var(--surface, var(--bg)); }`, `.o5-opener { background: var(--o5-glow), var(--bg); }`, `:root[data-skin='o5'] .sheet[data-page] { background: var(--o5-glow), var(--bg); }`, `:root[data-skin='o5'] .shell { background: var(--o5-glow), var(--bg); }`. The studio's "dark desk" is the o5 dark palette (`--bg #0d0c0b`), forced by `root.dataset.theme = 'dark'`; the `desk`/`desk2` fields of the theme are published as `--st-desk`/`--st-desk2` but no stylesheet reads them (`docs/02-tokens.md` §15).

Translucent strips over the page use `color-mix` with the background plus a blur: `.st-bottom` (80 %, `blur(18px) saturate(1.3)`), `.st-scrim` (55 %, `blur(12px)`), `.o5-index` (82 %, `blur(28px) saturate(140%)`), `.st-script-go` (a `linear-gradient(to bottom, transparent, var(--bg) 26px)` fade behind the sticky button), the o5 `.sheet-scrim` (46 %, `blur(14px) saturate(120%)`) and `.sheet-scrim[data-page]` (62 %, `blur(22px) saturate(120%)`).

## 3. Element recipes (studio.css unless marked)

Each recipe gives the markup as the components render it and the rules that style it. Classes prefixed `st-` are the studio look; `o5-kicker` comes from o5.css.

### 3.1 The root and its bars

Markup (`StudioApp.tsx`):

```tsx
<div className="st-root" data-view={view}>
  <header className="st-top">
    <div className="st-flag">
      <small>{studio.kicker}</small>
      <b>{studio.mark[0]} <i>{studio.mark[1]}</i></b>
    </div>
    <nav className="st-top-actions" aria-label="Studio">
      <button type="button" className="st-sq" aria-label="Options"><SqIcon name="options" /></button>
      <button type="button" className="st-sq" aria-label="Your gallery"><SqIcon name="menu" /></button>
    </nav>
  </header>
  <main className="st-stage" id="st-stage">
    <motion.div className="st-view">{walking ? body : <div className="st-scroll">{body}</div>}</motion.div>
  </main>
  <footer className="st-bottom">
    <button type="button" className="st-bar-btn"><SqIcon name="back" /> <span>Back</span></button>
    <button type="button" className="st-bar-btn"><SqIcon name="home" /> <span>Home</span></button>
    <button type="button" className="st-bar-btn"><SqIcon name="save" /> <span>Save draft</span></button>
  </footer>
  <Toasts />
  <OrbCursor />
</div>
```

```css
:root[data-studio] {
  --st-gutter: calc(clamp(18px, 6vw, 64px));
  --st-col: 760px;
}

.st-root {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: var(--text);
  font-family: var(--font-ui);
  background: var(--o5-glow), var(--bg);
}
.st-root button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.st-root :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

/* ---- top bar: the masthead, options and the gallery */
.st-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) calc(env(safe-area-inset-right, 0px) + var(--st-gutter)) 10px calc(env(safe-area-inset-left, 0px) + var(--st-gutter));
  border-bottom: 1px solid var(--o5-hair);
}
.st-flag {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.st-flag small {
  font: 600 calc(10.5px * var(--text-scale, 1)) / 1.3 var(--font-ui);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}
.st-flag b {
  font-family: var(--font-display);
  font-weight: 340;
  font-variation-settings: 'opsz' 72;
  font-size: calc(26px * var(--text-scale, 1));
  letter-spacing: -0.02em;
  line-height: 1.05;
}
.st-flag i {
  font-style: italic;
  font-weight: 300;
  color: var(--accent);
}
.st-top-actions {
  display: flex;
  gap: 8px;
}
```

Square icon button:

```css
.st-sq {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--o5-hair);
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  transition: color var(--dur-fast, 0.15s), border-color var(--dur-fast, 0.15s);
}
.st-sq:hover {
  color: var(--text);
  border-color: var(--text-3);
}
```

(The drawers' close buttons carry `className="st-sq st-sq-ink"`; there is no `.st-sq-ink` rule in any stylesheet.)

Bottom bar:

```css
/* ---- bottom bar: back, home, save */
.st-bottom {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  border-top: 1px solid var(--o5-hair);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  backdrop-filter: blur(18px) saturate(1.3);
}
.st-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 54px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font: 600 calc(11px * var(--text-scale, 1)) / 1 var(--font-ui) !important;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-2) !important;
  transition: color var(--dur-fast, 0.15s);
}
.st-bar-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.st-bar-btn:hover:not(:disabled) {
  color: var(--accent) !important;
}
```

**Derived, focus:** global.css's `:focus-visible { box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }` still matches inside `.st-root`, so a keyboard-focused button shows both the accent outline and the two-ring box shadow (`0 0 0 3px var(--bg), 0 0 0 5px var(--accent)`); the `border-radius: var(--radius-sm)` (999px under o5) loses, at equal specificity, to the later `border-radius: 0` that `.st-sq`, `.st-choice`, `.st-trail-row`, `.st-row`, `.st-go` and `.st-bar-btn` each set; `.st-tabs button` sets none, so its focus ring is pill-shaped. Fields are the exception: studio.css removes the ring (see 3.6).

### 3.2 The page column

```css
/* ---- the middle: the only part that moves */
.st-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
}
.st-view {
  position: absolute;
  inset: 0;
  will-change: transform, opacity, filter;
}
.st-scroll {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 calc(env(safe-area-inset-right, 0px) + var(--st-gutter)) 0 calc(env(safe-area-inset-left, 0px) + var(--st-gutter));
}
.st-scroll > * {
  max-width: var(--st-col);
  margin-inline: auto;
}
.st-sheet {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: clamp(28px, 7vh, 64px) 0 calc(env(safe-area-inset-bottom, 0px) + 18vh);
}
```

o5.css also has `:root[data-skin='o5'] .st-scroll { padding-left: calc(var(--safe-left) + clamp(18px, 6vw, 64px)); padding-right: calc(var(--safe-right) + clamp(18px, 6vw, 64px)); }` (written for Orbit's Settings app, which uses the same class name). It is more specific than `.st-scroll`, so under the skin it is the rule that sets the side padding; the value is the same number as studio.css's, since `--safe-left` is `env(safe-area-inset-left, 0px)` and `--st-gutter` is `clamp(18px, 6vw, 64px)`.

A screen is an `<article class="st-sheet">` holding, in order: kicker, headline, dek, then its own content (`Sheets.tsx`, `Talk.tsx`, `Make.tsx`, `StudioApp.tsx`):

```tsx
<article className="st-sheet" aria-labelledby="st-start-t">
  <p className="o5-kicker st-kick"><span>Opening</span></p>
  <Headline text="What shall we *make?*" id="st-start-t" orb={picked === null} />
  <p className="st-dek">Pick one. Every choice is a short walk, one question at a time.</p>
  <Choices items={START} picked={picked} onPick={(l) => void pick(l)} delay={0.2} />
</article>
```

### 3.3 Kicker, headline, dek

```css
.o5-kicker {           /* o5.css */
  margin: 0;
  font: 600 calc(11px * var(--text-scale)) / 1.4 var(--font-ui);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}
.st-kick {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.st-num {
  font-variant-numeric: tabular-nums;
}
/* The question, with the orb's place kept at its right. */
.st-qwrap {
  position: relative;
}
.st-q {
  margin: 0;
  padding-right: 64px;
  font-family: var(--font-display);
  font-weight: 340;
  font-variation-settings: 'opsz' 120;
  font-size: calc(clamp(36px, 8.4vw, 64px) * var(--text-scale, 1));
  letter-spacing: -0.035em;
  line-height: 1;
  text-wrap: balance;
}
.st-q em {
  font-style: italic;
  font-weight: 300;
  color: var(--accent);
}
.st-orb-spot {
  position: absolute;
  top: 0;
  right: 4px;
  width: 52px;
  height: 52px;
}
.st-dek {
  margin: 0;
  max-width: 34ch;
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 24;
  font-size: calc(clamp(18px, 2.4vw, 22px) * var(--text-scale, 1));
  line-height: 1.38;
  color: var(--text-2);
}
```

The kicker's right-hand `<span class="st-num">` carries the count ("3 of 12", "18+", "Finished"). `.st-orb-spot` is the empty `<span data-orb-spot>` the orb rests on (`docs/09-orb.md`); the headline keeps `padding-right: 64px` (`56px` under 560px wide) for it.

### 3.4 Answers between hairlines (at rest; the springs are in `docs/05-motion.md`)

Markup (`Choices.tsx`):

```tsx
<ul className="st-choices" aria-label={label}>
  <li>
    <button type="button" className="st-choice" data-rec={rec || undefined} aria-pressed={chosen} disabled={picked !== null}>
      {rec && <span className="st-rec">The orb’s pick</span>}
      <span className="st-lb">{c.label}</span>
      {c.hint && <span className="st-ht">{c.hint}</span>}
      {(chosen || rec) && <OrbSpot size={40} className="st-choice-spot" />}
    </button>
  </li>
</ul>
```

```css
/* ---- answers: words to pick, between hairlines, like the rest of Orbit */
.st-choices {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.st-choices > li:first-child .st-choice {
  border-top: 1px solid var(--o5-hair);
}
.st-choice {
  position: relative;
  width: 100%;
  display: grid;
  gap: 3px;
  min-height: 68px;
  padding: 14px 56px 14px 0;
  border: 0;
  border-bottom: 1px solid var(--o5-hair);
  border-radius: 0;
  background: none;
  text-align: left;
  color: var(--text-2) !important;
  transition: color var(--dur-fast, 0.15s), padding 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
.st-choice:hover:not(:disabled),
.st-choice[data-orb-hover] {
  color: var(--text) !important;
}
.st-choice[aria-pressed='true'],
.st-choice[data-orb-pressed] {
  color: var(--text) !important;
  padding-left: 12px;
}
.st-lb {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 48;
  font-size: calc(clamp(24px, 4.4vw, 34px) * var(--text-scale, 1));
  font-weight: 380;
  letter-spacing: -0.02em;
  line-height: 1.12;
  overflow-wrap: anywhere;
}
.st-choice[aria-pressed='true'] .st-lb {
  font-style: italic;
}
.st-choice[aria-pressed='true'] .st-lb::after {
  content: ' ✦';
  color: var(--accent);
  font-style: normal;
  font-size: 0.55em;
  vertical-align: middle;
}
/* The orb's pick: it rests on it, the words a shade brighter, a small kicker above. */
.st-choice[data-rec] {
  color: var(--text) !important;
}
.st-rec {
  font: 600 10.5px / 1 var(--font-ui);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}
.st-ht {
  font: 400 var(--fs-sm, 14px) / 1.35 var(--font-ui);
  color: var(--text-3);
}
.st-choice-spot {
  position: absolute;
  top: 50%;
  right: 6px;
  width: 40px;
  height: 40px;
  margin-top: -20px;
}
.st-predicting {
  margin: 0;
  font-family: var(--font-display);
  font-style: italic;
  color: var(--text-3);
  animation: st-pulse 1.4s ease-in-out infinite;
}
@keyframes st-pulse {
  50% {
    opacity: 0.4;
  }
}
```

The o5 equivalent in Orbit's apps is `.o5-choices`/`.o5-choice` (o5.css): the same hairline list with `min-height: 64px`, `padding: 12px 0`, `color: var(--text-3)`, `[aria-checked='true']` → `color: var(--text); padding-left: 10px`, italic label and `' ✦'` at `0.6em`; and the home's link rows `.o5-go` (`min-height: 64px`, `padding: 14px 0`, hairline above the first and below each, arrow at the right that slides `6px` and turns accent on hover).

### 3.5 Your own words: one underlined line, and the text buttons

Markup (`Walk.tsx`; `Talk.tsx` adds a `.st-mic` button between input and submit):

```tsx
<form className="st-own">
  <label className="o5-kicker" htmlFor={`own-${step.id}`}>Or in your own words</label>
  <input id={`own-${step.id}`} value={own} placeholder="Something else…" autoComplete="off" enterKeyHint="next" />
  <button type="submit" disabled={!own.trim()}>Use this</button>
</form>
<p className="st-shortcuts">
  <button type="button"><SqIcon name="shuffle" /> Pick for me</button>
  <button type="button"><SqIcon name="forward" /> Finish it for me</button>
</p>
```

```css
/* ---- your own words: one underlined line */
.st-own {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 4px 14px;
  margin-top: 8px;
}
.st-own label {
  grid-column: 1 / -1;
}
.st-own input {
  min-width: 0;
  padding: 6px 0 10px;
  border: 0;
  border-bottom: 1px solid var(--o5-hair);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-display);
  font-size: calc(22px * var(--text-scale, 1));
  outline: none;
  transition: border-color var(--dur-fast, 0.15s);
}
.st-own input:focus {
  border-bottom-color: var(--accent);
}
.st-own input::placeholder {
  color: var(--text-3);
  font-style: italic;
}
.st-own button,
.st-shortcuts button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: 600 calc(11px * var(--text-scale, 1)) / 1.3 var(--font-ui) !important;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-2) !important;
  text-decoration: underline;
  text-decoration-color: var(--o5-hair);
  text-underline-offset: 6px;
  transition: color var(--dur-fast, 0.15s);
}
.st-own button:hover:not(:disabled),
.st-shortcuts button:hover {
  color: var(--accent) !important;
}
.st-own button:disabled {
  opacity: 0.4;
}
.st-mic[aria-pressed='true'] {
  color: var(--accent) !important;
}
.st-shortcuts {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 22px;
}
```

The same ghost text button, used in the script desk (`.st-scene-tools button`, `.st-ghost`, `.st-scene-form button`): identical except `text-underline-offset: 5px` and the declaration order (`text-decoration-color` after the offset); hover `var(--accent) !important`, disabled `opacity: 0.4`. See 3.11 for the rule.

### 3.6 Fields: square, underlined, no focus ring

Scene form fields:

```css
.st-scene-form {
  display: grid;
  gap: 4px;
}
.st-scene-form :is(input, textarea) {
  min-width: 0;
  margin-bottom: 10px;
  padding: 6px 0 10px;
  border: 0;
  border-bottom: 1px solid var(--o5-hair);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-display);
  font-size: calc(19px * var(--text-scale, 1));
  line-height: 1.4;
  resize: vertical;
  outline: none;
}
.st-scene-form :is(input, textarea):focus {
  border-bottom-color: var(--accent);
}
.st-scene-form button {
  justify-self: start;
}
```

Focus-ring removal and the square override of o5's rounded fields (end of studio.css):

```css
/* Fields keep the square hairline look when focused (no rounded focus ring); the line turns accent. */
.st-root :is(input, textarea):focus-visible {
  box-shadow: none;
  border-radius: 0;
  outline: none;
}
/* Square everywhere: beats Orbit 0.5's rounded fields (o5.css gives inputs --radius-md). */
:root[data-skin='o5'] .st-root :is(input, textarea, select):not([type='range']):not([type='checkbox']) {
  border-radius: 0;
}
```

Remember global.css's touch rule: `@media (pointer: coarse) { input, textarea, .ta-plain, select { font-size: max(16px, var(--fs-md)); } }` (0,0,1) is beaten by `.st-own input` (0,1,1) and `.st-scene-form :is(input, textarea)` (0,1,1), whose sizes (22px, 19px × scale) are above 16px anyway.

### 3.7 The trail (answers so far)

Markup (`Walk.tsx`):

```tsx
<div className="st-scroll" ref={scroller}>
  <ol className="st-trail" aria-label="Your answers so far">
    <li data-depth="">
      <button type="button" className="st-trail-row" aria-label={`${s.key}: ${answers[s.id]}. Change it`}>
        <span className="o5-kicker">{s.key}</span>
        <motion.span layoutId={`ans-${s.id}`} className="st-trail-ans">{answers[s.id]}</motion.span>
      </button>
    </li>
  </ol>
  <motion.section className="st-now" aria-labelledby={`q-${step.id}`}>
    <p className="o5-kicker st-kick"><span>{step.kick}</span><span className="st-num">{n} of {total}</span></p>
    <Headline text={step.q} id={`q-${step.id}`} … />
    {step.dek && <p className="st-dek">{step.dek}</p>}
    …
  </motion.section>
</div>
```

```css
/* ---- the walkthrough: the answers so far stacked small above the question you're on */
.st-trail {
  list-style: none;
  margin: 0;
  padding: 16vh 0 0;
}
.st-trail-row {
  width: 100%;
  display: grid;
  gap: 2px;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--o5-hair);
  border-radius: 0;
  background: none;
  text-align: left;
}
.st-trail-ans {
  display: block;
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 340;
  font-size: calc(22px * var(--text-scale, 1));
  line-height: 1.2;
  color: var(--text);
  overflow-wrap: anywhere;
}
.st-trail-row:hover .st-trail-ans {
  color: var(--accent);
}
.st-now {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 80%;
  padding: clamp(28px, 6vh, 56px) 0 calc(env(safe-area-inset-bottom, 0px) + 30vh);
}
.st-scroll > .st-trail,
.st-scroll > .st-now {
  max-width: var(--st-col);
  margin-inline: auto;
}
/* Depth: what leaves the middle sinks back and blurs, so one thing is in focus at a time. */
:root[data-motion='full'] .st-scroll [data-depth] > * {
  transform: translate3d(0, calc(var(--p, 0) * -2vh), 0) scale(calc(1 - var(--ap, 0) * 0.06));
  transform-origin: 0 50%;
  opacity: calc(1 - var(--ap, 0) * 0.62);
  filter: blur(calc(var(--ap, 0) * 3px));
}
:root[data-motion='lite'] .st-scroll [data-depth] > * {
  opacity: calc(1 - var(--ap, 0) * 0.5);
}
```

(`--p`/`--ap` are written by the motion package's `useScrollDepth`; the trail's `padding: 16vh 0 0` and `.st-now`'s `30vh` bottom padding leave room so the current question can be scrolled to 20 % from the top: `box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.2) })`.)

### 3.8 Contents rows

Markup (`Sheets.tsx` `Rows`/`Row`; also the gallery's project list in `StudioApp.tsx`):

```tsx
<ol className="st-contents" aria-label="Contents">
  <li>
    <button type="button" className="st-row">
      <SqIcon name="plus" framed />              {/* or: <span className="st-row-n" aria-hidden>01</span> */}
      <span className="st-row-t">Start something new</span>
      <span className="st-row-m">Picture, video or movie</span>
    </button>
  </li>
</ol>
```

A non-interactive row is `<div className="st-row st-row-static">` (no `.st-row-static` rule exists).

```css
/* ---- contents (home, projects, characters) */
.st-contents {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.st-contents > li:first-child .st-row {
  border-top: 1px solid var(--o5-hair);
}
.st-row {
  width: 100%;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 2px 16px;
  min-height: 72px;
  padding: 14px 0;
  border: 0;
  border-bottom: 1px solid var(--o5-hair);
  border-radius: 0;
  background: none;
  text-align: left;
  color: var(--text) !important;
}
.st-row > :first-child {
  grid-row: span 2;
}
.st-row:hover .st-row-t {
  color: var(--accent);
}
.st-row-n {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 26px;
  color: var(--accent);
}
.st-row-t {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 48;
  font-weight: 380;
  font-size: calc(clamp(22px, 3.8vw, 30px) * var(--text-scale, 1));
  letter-spacing: -0.02em;
  line-height: 1.15;
  overflow-wrap: anywhere;
  transition: color var(--dur-fast, 0.15s);
}
.st-row-m {
  font: 400 var(--fs-sm, 14px) / 1.35 var(--font-ui);
  color: var(--text-3);
}
.st-ico {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid var(--o5-hair);
  border-radius: 0;
  color: var(--text-2);
}
.st-empty {
  margin: 0;
  padding: 18px 0;
  font-family: var(--font-display);
  font-style: italic;
  color: var(--text-3);
}
.st-rules {
  margin: 0;
  padding: 0;
  list-style: none;
}
.st-rules li {
  position: relative;
  padding: 10px 0 10px 22px;
  border-bottom: 1px solid var(--o5-hair);
  font-family: var(--font-display);
  font-size: calc(17px * var(--text-scale, 1));
  color: var(--text-2);
}
.st-rules li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 19px;
  width: 7px;
  height: 7px;
  background: var(--accent);
}
```

**Derived, a name collision:** o5.css (written for Orbit's Settings app) also defines, unscoped, `.st-contents { display: flex; flex-direction: column; gap: 8px; padding: clamp(24px, 6vh, 56px) 0 8px; }`. Both rules match the studio's list; studio.css comes later, so its `margin` and `padding` win, but o5.css's `display: flex; flex-direction: column; gap: 8px` are not overridden and remain in effect. The studio's contents list is therefore a flex column with an 8px gap between rows (on top of each row's own padding). Keep that file order to reproduce the look (see `src/styles/README.md`).

### 3.9 The brief and the primary button

Markup (`Make.tsx`):

```tsx
<dl className="st-brieflist">
  <div><dt>{b.key}</dt><dd>{b.value}</dd></div>
</dl>
<div className="st-script-go">
  <button type="button" className="st-go">Make the picture<OrbSpot size={40} className="st-choice-spot" /></button>
</div>
```

```css
/* ---- brief and making */
.st-brieflist {
  margin: 8px 0 0;
}
.st-brieflist > div {
  display: grid;
  grid-template-columns: minmax(96px, 30%) minmax(0, 1fr);
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--o5-hair);
}
.st-brieflist dt {
  padding-top: 5px;
  font: 600 calc(11px * var(--text-scale, 1)) / 1.4 var(--font-ui);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-3);
}
.st-brieflist dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: calc(20px * var(--text-scale, 1));
  overflow-wrap: anywhere;
}
.st-go {
  align-self: flex-start;
  min-height: 52px;
  padding: 0 26px;
  border: 0;
  border-radius: 0;
  background: var(--text);
  color: var(--bg) !important;
  font: 600 calc(12px * var(--text-scale, 1)) / 1 var(--font-ui) !important;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  transition: background var(--dur-fast, 0.15s);
}
.st-go:hover {
  background: var(--accent);
}
```

The sticky holder that keeps it in reach at the foot of a long page, with the orb's place on its right:

```css
/* "This is the script" stays in reach at the foot of the page, with the orb resting on it. */
.st-script-go {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-top: -8px;
  padding: 28px 0 10px;
  background: linear-gradient(to bottom, transparent, var(--bg) 26px);
}
.st-script-go .st-go {
  position: relative;
  padding-right: 64px;
}
.st-script-go .st-choice-spot {
  right: 6px;
}
.st-review-go {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 22px;
}
```

### 3.10 Progress bar, error, result, frames

Markup (`Make.tsx`):

```tsx
<div className="st-making" role="status">
  <div className="st-bar" aria-hidden><span style={{ width: `${progress ?? 8}%` }} className={progress == null ? 'st-bar-busy' : undefined} /></div>
  <p className="st-dek">{note ?? 'Starting…'}</p>
  <p className="st-ht">You can leave this page. …</p>
</div>
<p className="st-error" role="alert">{project.error}</p>
<figure className="st-result"><img src={url} alt={…} /></figure>
<ol className="st-frames" aria-label="Storyboard">
  <li><button type="button" aria-pressed={redo.has(f.id)}><img src={f.url} alt="Opening" /><span className="st-num">Opening</span></button></li>
  <li><span className="st-frame-wait" aria-hidden /><span className="st-num">Scene 1 ends · drawing</span></li>
</ol>
```

```css
.st-making {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.st-bar {
  height: 2px;
  background: var(--o5-hair);
  overflow: hidden;
}
.st-bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
}
.st-bar-busy {
  animation: st-busy 1.6s ease-in-out infinite;
}
@keyframes st-busy {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(1000%);
  }
}
.st-error {
  margin: 0;
  padding-left: 14px;
  border-left: 2px solid var(--danger, #e5484d);
  color: var(--text);
}
.st-result {
  margin: 0;
}
.st-result :is(img, video) {
  display: block;
  width: 100%;
  max-height: 64vh;
  object-fit: contain;
  background: #000;
}
.st-frames {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.st-frames li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-3);
  font: 600 11px / 1.3 var(--font-ui);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.st-frames img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

/* Storyboard check: tap pictures to draw them again. */
.st-frames button {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: left;
}
.st-frames button[aria-pressed='true'] img {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  opacity: 0.55;
}
.st-frames button[aria-pressed='true'] .st-num::after {
  content: ' · draw again';
  color: var(--accent);
}
.st-frames [aria-busy='true'] img,
.st-frame-wait {
  aspect-ratio: 16 / 9;
  background: var(--o5-hair);
  animation: st-pulse 1.4s ease-in-out infinite;
}
```

### 3.11 The script desk

Markup (`Script.tsx`):

```tsx
<div className="st-script">
  <p className="st-script-meta"><span>{premise}</span><span>{n} scenes · about {n * 5} seconds</span><span>{cast}</span><span>{BY[script.by]}</span></p>
  <ol className="st-scenes">
    <motion.li className="st-scene" aria-busy={…}>
      <p className="o5-kicker st-scene-head"><span>Scene 01</span><span>{s.heading}</span></p>
      <p className="st-action">{s.action}</p>
      <p className="st-ends"><span>Ends on</span> {s.end}</p>
      {s.says && <p className="st-says">{s.says}</p>}
      <p className="st-scene-tools">
        <button type="button"><SqIcon name="shuffle" /> Another take</button>
        <button type="button">Edit</button>
      </p>
    </motion.li>
  </ol>
  <div className="st-script-go">
    <button type="button" className="st-go">This is the script<OrbSpot size={40} className="st-choice-spot" /></button>
    <button type="button" className="st-ghost">Rewrite it all with the writer</button>
  </div>
</div>
```

```css
/* ---- the script desk: scene by scene, like a shooting script */
.st-script {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.st-script-meta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  font: 600 11px / 1.4 var(--font-ui);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-3);
}
.st-script-meta span:first-child {
  color: var(--text-2);
}
.st-scenes {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--o5-hair);
}
.st-scene {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 0 14px;
  border-bottom: 1px solid var(--o5-hair);
  transition: opacity 0.2s;
}
.st-scene[aria-busy='true'] {
  opacity: 0.5;
}
.st-scene-head {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
}
.st-scene-head span:first-child {
  color: var(--accent);
}
.st-action {
  margin: 0;
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 36;
  font-size: calc(clamp(20px, 3.4vw, 25px) * var(--text-scale, 1));
  line-height: 1.32;
  letter-spacing: -0.01em;
  color: var(--text);
}
.st-ends {
  margin: 0;
  font: 400 var(--fs-sm, 14px) / 1.45 var(--font-ui);
  color: var(--text-2);
}
.st-ends span {
  margin-right: 6px;
  font: 600 10.5px / 1 var(--font-ui);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-3);
}
.st-says {
  margin: 0;
  padding-left: 14px;
  border-left: 1px solid var(--accent);
  font-family: var(--font-display);
  font-style: italic;
  font-size: calc(18px * var(--text-scale, 1));
  color: var(--text-2);
}
.st-scene-tools {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
}
.st-scene-tools button,
.st-ghost,
.st-scene-form button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: 600 calc(11px * var(--text-scale, 1)) / 1.3 var(--font-ui) !important;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-2) !important;
  text-decoration: underline;
  text-underline-offset: 5px;
  text-decoration-color: var(--o5-hair);
}
.st-scene-tools button:hover:not(:disabled),
.st-ghost:hover:not(:disabled) {
  color: var(--accent) !important;
}
.st-scene-tools button:disabled,
.st-ghost:disabled {
  opacity: 0.4;
}
```

### 3.12 Talk: the thread

Markup (`Talk.tsx`): `<div className="st-thread" aria-live="polite">` holding `<p className="st-said">` (yours) and `<p className="st-reply">` (the writer's).

```css
/* ---- talk */
.st-thread {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.st-said,
.st-reply {
  margin: 0;
  font-family: var(--font-display);
  font-size: calc(19px * var(--text-scale, 1));
  line-height: 1.5;
  white-space: pre-wrap;
}
.st-said {
  align-self: flex-end;
  max-width: 85%;
  font-style: italic;
  color: var(--text-2);
  text-align: right;
}
.st-reply {
  padding-left: 16px;
  border-left: 1px solid var(--accent);
}
```

### 3.13 Drawers, tabs, the picture grid

Markup (`StudioApp.tsx` `Gallery` and `Options`):

```tsx
<div className="st-drawer-wrap" role="dialog" aria-modal="true" aria-label="After Dark: your gallery">
  <button type="button" className="st-scrim" aria-label="Close the gallery" />
  <aside className="st-drawer">
    <div className="st-drawer-head">
      <h3>Your <em>gallery</em></h3>
      <button type="button" className="st-sq st-sq-ink" aria-label="Close"><SqIcon name="close" /></button>
    </div>
    <nav className="st-tabs" aria-label="Shelves">
      <button type="button" aria-pressed={shelf === s.id}><SqIcon name={s.icon} framed /><span>{s.label}</span></button>
    </nav>
    <div className="st-shelf">
      <ol className="st-contents">…</ol>          {/* or <ul className="st-grid"><li><img … /></li></ul>, or <p className="st-empty">Nothing here yet.</p> */}
    </div>
  </aside>
</div>
```

(No `.st-shelf` rule exists.) Options uses the same shell with `<h3>House <em>rules</em></h3>`, a `<ul className="st-rules">` and a closing `<p className="st-dek">`.

```css
/* ---- drawers: the gallery and the options, sliding in from the right over a blur */
.st-drawer-wrap {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.st-scrim {
  position: absolute;
  inset: 0;
  border: 0;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  animation: st-fade 300ms ease both;
}
.st-drawer {
  position: absolute;
  inset: 0 0 0 auto;
  width: min(460px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding: calc(env(safe-area-inset-top, 0px) + 18px) calc(env(safe-area-inset-right, 0px) + 22px) calc(env(safe-area-inset-bottom, 0px) + 22px) 24px;
  color: var(--text);
  background: var(--o5-glow), var(--surface, var(--bg));
  border-left: 1px solid var(--o5-hair);
  box-shadow: -30px 0 60px rgb(0 0 0 / 0.45);
  animation: st-slide 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes st-fade {
  from {
    opacity: 0;
  }
}
@keyframes st-slide {
  from {
    transform: translateX(104%);
  }
}
.st-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.st-drawer h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 340;
  font-size: calc(36px * var(--text-scale, 1));
  letter-spacing: -0.03em;
}
.st-drawer h3 em {
  font-weight: 300;
  color: var(--accent);
}
.st-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.st-tabs button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text-3) !important;
  font: 600 calc(9.5px * var(--text-scale, 1)) / 1.2 var(--font-ui) !important;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.st-tabs button[aria-pressed='true'] {
  color: var(--text) !important;
}
.st-tabs button[aria-pressed='true'] .st-ico {
  border-color: var(--accent);
  color: var(--accent);
}
.st-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.st-grid :is(img, video) {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  background: #000;
}

@media (max-width: 560px) {
  .st-q {
    padding-right: 56px;
  }
  .st-bar-btn span {
    font-size: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .st-drawer,
  .st-scrim,
  .st-predicting,
  .st-bar-busy {
    animation: none;
  }
}
```

### 3.14 Toasts

Markup (`orbit/src/shell/Toasts.tsx`, rendered inside `.st-root` in a studio and inside `.shell` in Orbit):

```tsx
<div className="toasts" role="status" aria-live="polite">
  <div className="toast glass" style={t.tone === 'error' ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : t.tone === 'success' ? { borderColor: 'var(--success)' } : undefined} onClick={() => dismissToast(t.id)}>
    {t.text}
  </div>
</div>
```

A toast lives 3200 ms (`setTimeout(() => get().dismissToast(id), 3200)` in `orbit/src/state/shell.ts`); tones are `'info' | 'error' | 'success'`.

```css
/* Toasts */                                      /* global.css */
.toasts {
  position: absolute;
  left: 50%;
  /* below the 52px app header, so toasts never cover header buttons */
  top: calc(var(--safe-top) + 60px);
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(420px, calc(100% - 24px));
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  font-weight: 500;
  animation: sheet-up var(--dur-med) var(--ease-out);
}
@keyframes sheet-up {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
}
.toast { box-shadow: var(--depth-4); }           /* motion.css */
```

Classic look: a glass pane (`.glass` from glass.css: tint, 0.5px edge, blur, sheen) with the layer-4 shadow and a `14px` radius (o5's `--radius-md`) or `12px` (classic). **Derived, o5 skin / studio:** `:root[data-skin='o5'] :is(… .glass …)` sets `background: transparent; border-color: transparent; box-shadow: none; backdrop-filter: none`, and `--sheen: none`; so a toast in the magazine look is just its text over the page, and only an error or success toast shows an edge, because the inline `borderColor` wins over `border-color: transparent` (the border width stays glass.css's `0.5px solid`). In a studio `.toasts` is positioned relative to `.st-root` (fixed, `inset: 0`), so `top: calc(var(--safe-top) + 60px)` is measured from the top of the screen.

## 4. Icons

### SqIcon: the square line-icon set (`orbit/src/studio/icons.tsx`, whole file)

"Thin square-cut line drawings in a square frame, like the marks in a magazine's contents. No rounded corners anywhere." Rendered at `20 × 20` on a `0 0 24 24` box, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`, `strokeLinecap="square"`, `strokeLinejoin="miter"`. `framed` wraps it in `<span class="st-ico">` (the 40px hairline square, 3.8); `label` makes it `role="img"`, otherwise `aria-hidden`.

```tsx
const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h10',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M14 5l-7 7 7 7M7 12h13',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 14h8',
  options: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
  picture: 'M3.5 5.5h17v13h-17zM3.5 15l5-4 4 3 3-2 5 4',
  video: 'M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3',
  movie: 'M3.5 4.5h17v15h-17zM7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4',
  project: 'M3.5 6.5h7l2 2h8v10h-17z',
  character: 'M8.5 3.5h7v7h-7zM4.5 20.5v-4h15v4',
  talk: 'M4 5h16v10H9l-5 4z',
  mic: 'M9 4h6v9H9zM5 11v2h0a7 7 0 0 0 14 0v-2M12 20v-0',
  shuffle: 'M4 7h4l8 10h4M4 17h4l2.5-3M14 10l2-3h4M18 4l2 3-2 3M18 14l2 3-2 3',
  forward: 'M4 6l7 6-7 6zM13 6l7 6-7 6z',
  plus: 'M12 5v14M5 12h14',
} as const;

export type IconName = keyof typeof PATHS;

export function SqIcon({ name, framed = false, label }: { name: IconName; framed?: boolean; label?: string }) {
  const svg = (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
  return framed ? <span className="st-ico">{svg}</span> : svg;
}
```

Where each is used: `options`, `menu` (top bar), `back`, `home`, `save` (bottom bar), `close` (drawers), `project`, `picture`, `video`, `movie`, `character` (gallery tabs, framed), `plus`, `talk`, `character` (contents rows, framed), `shuffle`, `forward` (shortcuts), `picture`, `video`, `movie` (Talk's "make it" buttons), `mic` (Talk).

### Icon: the general set (`orbit/src/ui/Icon.tsx`)

A separate, rounded set for the classic components ("Stroke icons on a 24px grid. Decorative by default"). Rendered at `size = 22` (default), `strokeWidth = 1.9`, `strokeLinecap="round"`, `strokeLinejoin="round"`, `fill="none"`, `stroke="currentColor"`, `focusable="false"`; `aria-hidden` unless `label` is given (then `role="img"`). The 57 names: `home`, `switcher`, `sliders`, `terminal`, `code`, `sparkle`, `gear`, `plus`, `close`, `back`, `forward`, `down`, `arrowUp`, `folder`, `file`, `save`, `send`, `stop`, `split`, `trash`, `pencil`, `copy`, `paste`, `more`, `info`, `alert`, `check`, `refresh`, `keyboard`, `sidebar`, `search`, `moon`, `sun`, `text`, `motion`, `history`, `wifiOff`, `lock`, `play`, `mic`, `globe`, `speaker`, `pause`, `user`, `tool`, `undo`, `redo`, `download`, `upload`, `link`, `bolt`, `image`, `film`, `external`, `brush`, `eraser`, `camera`. The path data is in that file; the components package copies it. The `Magazine.tsx` contents line uses `<Icon name="down" size={14} />`; the `Sheet` close button uses `<IconButton icon="close" label="Close" />`; `EmptyState` uses `<Icon name={icon} size={28} />`.

## 5. Layout of a studio screen

```
<html data-theme="dark" data-skin="o5" data-studio="…">   ← palette, fonts, --st-gutter / --st-col
└ .st-root   position: fixed; inset: 0; grid rows: auto | minmax(0, 1fr) | auto; background: glow + --bg
  ├ .st-top     masthead · [options][gallery]      padding-top: env(safe-area-inset-top) + 10px, sides env(side) + --st-gutter; hairline below
  ├ .st-stage   position: relative; overflow: hidden   (the only part that animates between screens)
  │ └ .st-view  position: absolute; inset: 0       (one per screen; enter/exit on springs)
  │   └ .st-scroll  height: 100%; overflow-y: auto; overflow-x: hidden; side padding env(side) + --st-gutter
  │       └ .st-sheet | .st-trail + .st-now   max-width: --st-col (760px); margin-inline: auto
  ├ .st-bottom  3 equal columns; padding sides/bottom = env(safe-area-inset-*); hairline above; 80% --bg + blur
  ├ .toasts     absolute, centred, top: --safe-top + 60px
  └ the orb     (docs/09-orb.md)
```

Widths and paddings, exactly: gutter `clamp(18px, 6vw, 64px)` plus the side safe-area inset; column `760px`; sheet top padding `clamp(28px, 7vh, 64px)`, bottom `calc(env(safe-area-inset-bottom, 0px) + 18vh)`; the walkthrough's `.st-now` top `clamp(28px, 6vh, 56px)`, bottom `calc(env(safe-area-inset-bottom, 0px) + 30vh)`, `min-height: 80%`; trail top `16vh`; drawer `min(460px, 92vw)`. Gap between a sheet's children `16px`; between script scenes `18px`; between thread lines `14px`.

Note that `.st-root` uses `position: fixed; inset: 0`, not `--app-height`. The on-screen keyboard is handled by the viewport meta (`interactive-widget=resizes-content` makes the layout viewport itself shrink) together with the hook below, which `StudioApp` calls (`useVisualViewport();` is its first line) and which keeps the shared `--app-height`/`--keyboard-inset` variables and the `keyboardOpen` flag current for the orb and the toasts.

### The visual-viewport hook (`orbit/src/hooks/useVisualViewport.ts`, whole file)

On iOS Safari the *visual* viewport shrinks when the keyboard opens while the layout viewport does not. The hook measures the visible height each frame it changes, writes three variables on `<html>`, publishes `keyboardOpen` to a store (`useViewportStore` from `orbit/src/state/viewport.ts`, a small store with a `set` action; a copy needs an equivalent or can drop that call), and undoes the scroll iOS applies to `overflow: hidden` boxes when it brings a focused field into view.

```ts
import { useEffect } from 'react';
import { useViewportStore } from '../state/viewport';

/**
 * Tracks the *visual* viewport, which on iOS Safari shrinks when the on-screen keyboard opens
 * (the layout viewport does not). We publish:
 *   --app-height      visible height in px (the shell is sized to this)
 *   --vv-offset-top   how far iOS has scrolled the visual viewport (keeps the shell pinned)
 *   --keyboard-inset  approximate keyboard height
 * and a `keyboardOpen` flag in the viewport store (the dock hides while typing).
 */
export function useVisualViewport() {
  const setViewport = useViewportStore((s) => s.set);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visible = vv?.height ?? window.innerHeight;
        const offsetTop = vv?.offsetTop ?? 0;
        const layoutHeight = window.innerHeight;
        const keyboard = Math.max(0, layoutHeight - visible - offsetTop);
        // A soft keyboard is at least ~150px; smaller differences are browser chrome changing.
        const editing = isEditableFocused();
        const keyboardOpen = keyboard > 150 || (editing && isCoarsePointer() && visible < layoutHeight * 0.75);
        // Safari 26 on iPhone floats its AutoFill and hide-keyboard buttons over the bottom of the
        // page, just above the keyboard: keep what you type (and the composer's buttons) above them.
        const covered = keyboardOpen && floatingKeyboardBar ? FLOATING_BAR : 0;
        const height = visible - covered;
        root.style.setProperty('--app-height', `${Math.round(height)}px`);
        root.style.setProperty('--vv-offset-top', `${Math.round(offsetTop)}px`);
        root.style.setProperty('--keyboard-inset', `${Math.round(keyboard + covered)}px`);
        setViewport({
          width: Math.round(window.innerWidth),
          height: Math.round(height),
          keyboardOpen,
        });
      });
    };

    // iOS may scroll even overflow:hidden boxes to reveal a focused input under the keyboard,
    // which leaves part of the app shifted out of view. Those boxes never scroll on purpose,
    // so put them straight back.
    const unshift = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.scrollTop === 0) return;
      if (getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
    };
    document.addEventListener('scroll', unshift, true);

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', unshift, true);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [setViewport]);
}

/** Height of Safari 26's floating bar above the iPhone keyboard (AutoFill, hide keyboard), with its margin. */
const FLOATING_BAR = 76;
const floatingKeyboardBar =
  typeof navigator !== 'undefined' &&
  /iPhone/.test(navigator.userAgent) &&
  Number(navigator.userAgent.match(/Version\/(\d+)/)?.[1] ?? 0) >= 26;

function isEditableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
```

Who reads what it writes: `.shell { height: var(--app-height); transform: translateY(var(--vv-offset-top, 0px)); }` (global.css, Orbit's shell), `.o5-spread { min-height: var(--app-height, 100dvh) }` and `.cc-panel { max-height: calc(var(--app-height) - …) }`. The stylesheet defaults are `--app-height: 100dvh` and `--keyboard-inset: 0px` (tokens.css).

## 6. iPhone and iPad rules, with where they live

| Rule | Where |
|---|---|
| Paint under the notch and home indicator, pad with the insets; the keyboard shrinks the page rather than covering it | `orbit/index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />`, with `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `format-detection="telephone=no"` |
| Safe-area insets | tokens.css `--safe-*: env(safe-area-inset-*, 0px)`; studio.css uses `env(safe-area-inset-top/right/bottom/left, 0px)` directly in `.st-top`, `.st-scroll`, `.st-sheet`, `.st-now`, `.st-bottom`, `.st-drawer`; o5.css adds them to every gutter (`calc(var(--safe-left) + clamp(…))`) |
| Minimum 44px touch targets | tokens.css `--tap: 44px`; studio.css `.st-sq { width: 44px; height: 44px }`, `.st-own button, .st-shortcuts button { min-height: 44px }`, `.st-scene-tools button, .st-ghost, .st-scene-form button { min-height: 44px }`, `.st-bar-btn { min-height: 54px }`, `.st-go { min-height: 52px }`, `.st-choice { min-height: 68px }`, `.st-row { min-height: 72px }`; global.css `.btn { min-height: var(--tap) }`, `.icon-btn { width: var(--tap); height: var(--tap) }`, `button.chip { min-height: 32px }` (the one exception, a chip), `.swatch`, `.range`; o5.css `.segmented button { min-width: var(--tap); min-height: var(--tap) }`, `.o5-cue`, `.o5-switch`, `.o5-index-close`, `.o5-handle`, `.o5-orb-btn { min-height: 44px }` |
| No iOS zoom on focus: editable text at least 16px on touch | global.css `@media (pointer: coarse) { input, textarea, .ta-plain, select { font-size: max(16px, var(--fs-md)); } }` |
| No horizontal scroll | global.css `html, body { overflow: hidden; overscroll-behavior: none }`; studio.css `.st-scroll { overflow-x: hidden; overscroll-behavior: contain }`, `.st-stage { overflow: hidden }`; o5.css `.o5-path { overflow-x: hidden }`; motion.css `.shell, .app-host, .app-window { overflow: clip }` |
| No tap flash, no rubber-banding, no text inflation | global.css `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`, `-webkit-text-size-adjust: 100%; text-size-adjust: 100%`; studio.css `.st-root button { -webkit-tap-highlight-color: transparent }` |
| Momentum scrolling | `-webkit-overflow-scrolling: touch` on `.st-scroll`, `.home`, `.sheet-body`, `.o5-path` |
| Full height that follows the keyboard | `--app-height` (100dvh, then the measured visible height) and `useVisualViewport()`; the studio root uses `position: fixed; inset: 0` and relies on `interactive-widget=resizes-content` |
| Side gutters | studio: `--st-gutter: calc(clamp(18px, 6vw, 64px))` (never below **18px**; the task's "16px" minimum does not appear in the studio look); o5 AI bar `clamp(16px, 5vw, 48px)`; o5 app pages `clamp(18px, 6vw, 64px)`; o5 home `clamp(24px, 7vw, 96px)`; toasts `width: min(420px, calc(100% - 24px))` (12px each side); classic `.app-header` `calc(var(--safe-right) + 10px)`; the dock `max-width: calc(100% - 16px - var(--safe-left) - var(--safe-right))` (8px each side) |
| Phone-width adjustments | studio.css `@media (max-width: 560px) { .st-q { padding-right: 56px } .st-bar-btn span { font-size: 10px } }`; o5.css `@media (max-width: 700px) { .o5-folio { display: none } }`, `@media (max-height: 520px) { .o5-path { scroll-snap-type: none } }`; global.css `@media (min-width: 700px) and (min-height: 500px)` turns the bottom sheet into a centred card `min(560px, calc(100% - 48px))`; o5.css `@media (min-width: 1100px)` moves the message author into the margin (iPad) |
| Reduced motion / transparency | tokens.css zeroes `--dur-fast`/`--dur-med`; studio.css `@media (prefers-reduced-motion: reduce) { .st-drawer, .st-scrim, .st-predicting, .st-bar-busy { animation: none } }`; glass.css `@media (prefers-reduced-transparency: reduce)` gives solid panes |
| iPad split view | global.css `.split-divider` (24px wide hit area, 5 × 56px handle), `.app-window[data-placement='split-…']` — Orbit shell only, not copied into base.css |
