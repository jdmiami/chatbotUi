# 03 · Typography

Two typefaces, one text scale, and a small set of type styles that every screen is built from. All values are copied from `orbit/src/studio/studio.css` (the studio look), `orbit/src/styles/o5.css` (the magazine skin) and `orbit/src/styles/global.css` (the classic components); the file is named in each table.

## 1. The typefaces

| Role | Family name (as declared by `@font-face`) | Package | Files imported | Axes in the package metadata |
|---|---|---|---|---|
| Display (serif) | `'Fraunces Variable'` | `@fontsource-variable/fraunces` 5.3.0 (Fraunces v38) | `opsz.css` (upright) and `opsz-italic.css` (italic) | `ital` 0–1, `opsz` 9–144 (default 14), `wght` 100–900 (default 400), `SOFT` 0–100, `WONK` 0–1 |
| UI (sans) | `'Inter Variable'` | `@fontsource-variable/inter` 5.3.0 (Inter v20) | `index.css` (the `wght` file set, upright only) | `ital` 0–1, `opsz` 14–32 (default 14), `wght` 100–900 |

Each `@font-face` these files add declares `font-weight: 100 900`, `font-display: swap`, a `woff2-variations` source and a `unicode-range` subset (Fraunces: latin, latin-ext, vietnamese; Inter: latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese). The `opsz` file set is what makes `font-variation-settings: 'opsz' …` take effect on Fraunces. Inter's `index.css` is the `wght` set; Orbit never sets an italic or an optical size on Inter. Orbit imports no Inter italic file; browsers synthesise any italic Inter.

### How they are loaded

Dynamically, so the fonts only download for the magazine look. In a studio site, `orbit/src/studio/StudioApp.tsx` (inside the theme `useEffect`):

```ts
void Promise.all([import('@fontsource-variable/fraunces/opsz.css'), import('@fontsource-variable/fraunces/opsz-italic.css'), import('@fontsource-variable/inter/index.css')]).catch(() => {});
```

In Orbit proper, `orbit/src/hooks/useApplySettings.ts` does the same when the skin is `o5`:

```ts
let fontsLoading: Promise<unknown> | null = null;
/** Orbit 0.5's typefaces (a serif with optical sizes for display, Inter for text). Fetched only for that look. */
function loadEditorialFonts() {
  fontsLoading ??= Promise.all([
    import('@fontsource-variable/fraunces/opsz.css'),
    import('@fontsource-variable/fraunces/opsz-italic.css'),
    import('@fontsource-variable/inter/index.css'),
  ]).catch(() => {
    fontsLoading = null; // offline: system fonts stand in; try again next time
  });
}
```

This package exposes the same three imports as `loadFonts()` in `src/styles/fonts.ts`.

### Fallbacks

The families are named through two variables (o5.css, `:root[data-skin='o5']`):

```css
--font-display: 'Fraunces Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
--font-ui: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

Outside the o5 skin, `--font-ui` is the system stack from tokens.css (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`) and `--font-display` is **undefined**: studio.css reads `var(--font-display)` with no fallback, so without `data-skin="o5"` those rules are invalid at computed-value time and the element inherits the body font. Orbit's own apps write `var(--font-display, inherit)` or `var(--font-display, serif)` for that reason.

## 2. Body defaults

global.css:

```css
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden; /* the shell manages scrolling; prevents iOS rubber-banding the whole page */
  overscroll-behavior: none;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
button,
input,
textarea,
.ta-plain,
select {
  font: inherit;
  color: inherit;
}
/* iOS zooms into inputs with font-size < 16px; keep editable text at >= 16px on touch devices. */
@media (pointer: coarse) {
  input,
  textarea,
  .ta-plain,
  select {
    font-size: max(16px, var(--fs-md));
  }
}
```

o5.css adds, for the magazine skin:

```css
:root[data-skin='o5'] body {
  font-family: var(--font-ui);
  letter-spacing: -0.005em;
  background: var(--bg);
  font-feature-settings: 'ss01', 'cv11';
}
```

(`ss01` and `cv11` are Inter's stylistic set 1 and character variant 11.) studio.css sets `.st-root { color: var(--text); font-family: var(--font-ui); }` and `.st-root button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }`.

## 3. The text scale

`--text-scale` is `1` on `:root` (tokens.css). Orbit's Settings → Text size writes it inline on `<html>`: `root.style.setProperty('--text-scale', String(settings.textScale))` (`useApplySettings.ts`). A studio site never runs that hook, so there it is always `1`. Every size that should follow the user's setting is written as a multiplication:

- the token sizes: `--fs-xs: calc(12px * var(--text-scale))`, `--fs-sm: calc(13px * …)`, `--fs-md: calc(15px * …)`, `--fs-lg: calc(17px * …)`, `--fs-xl: calc(22px * …)`, `--fs-2xl: calc(28px * …)`;
- fixed sizes: `calc(22px * var(--text-scale))`; studio.css writes `var(--text-scale, 1)` with a fallback, o5.css writes `var(--text-scale)` without;
- fluid sizes: `calc(clamp(min, vw, max) * var(--text-scale))`, so the clamp is computed first and then scaled.

Sizes written as plain `px` (for example `.st-rec`, `.st-frames li`, `.st-script-meta`, `.st-row-n`, `.o5-display`, `.o5-numeral`) do **not** scale.

## 4. Type styles: the studio look (studio.css)

Column key: size is the exact `font-size` (ts = `var(--text-scale, 1)`); weight; tracking = `letter-spacing`; lh = `line-height`; opsz = `font-variation-settings`; case = `text-transform`.

### Headline, kicker, dek

| Style | Selector | Family | Size | Weight | Tracking | lh | opsz | Case | Colour | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Headline / question | `.st-q` | `var(--font-display)` | `calc(clamp(36px, 8.4vw, 64px) * ts)` | `340` | `-0.035em` | `1` | `'opsz' 120` | — | inherits `--text` | `margin: 0; padding-right: 64px; text-wrap: balance;` (`padding-right: 56px` at `max-width: 560px`) |
| Headline emphasis | `.st-q em` | inherits | inherits | `300` | | | | | `var(--accent)` | `font-style: italic` |
| Kicker (running head) | `.o5-kicker` (o5.css) | `var(--font-ui)` | `calc(11px * var(--text-scale))` | `600` | `0.18em` | `1.4` | — | `uppercase` | `var(--text-3)` | `margin: 0`. In the studio it carries `.st-kick` (`display: flex; justify-content: space-between; gap: 12px`) with a `.st-num` span (`font-variant-numeric: tabular-nums`) at the right |
| Dek (standfirst) | `.st-dek` | `var(--font-display)` | `calc(clamp(18px, 2.4vw, 22px) * ts)` | (400) | — | `1.38` | `'opsz' 24` | — | `var(--text-2)` | `margin: 0; max-width: 34ch` |
| Masthead kicker | `.st-flag small` | `var(--font-ui)` | `calc(10.5px * ts)` | `600` | `0.18em` | `1.3` | — | `uppercase` | `var(--text-3)` | |
| Masthead | `.st-flag b` | `var(--font-display)` | `calc(26px * ts)` | `340` | `-0.02em` | `1.05` | `'opsz' 72` | — | inherits | |
| Masthead italic half | `.st-flag i` | inherits | inherits | `300` | | | | | `var(--accent)` | `font-style: italic` |

### Answers (choices) and the trail

| Style | Selector | Family | Size | Weight | Tracking | lh | opsz | Case | Colour | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Choice label | `.st-lb` | `var(--font-display)` | `calc(clamp(24px, 4.4vw, 34px) * ts)` | `380` | `-0.02em` | `1.12` | `'opsz' 48` | — | from `.st-choice`: `var(--text-2) !important`, `var(--text) !important` on hover / `[aria-pressed='true']` / `[data-rec]` / `[data-orb-hover]` / `[data-orb-pressed]` | `overflow-wrap: anywhere`. Pressed: `font-style: italic` and `::after { content: ' ✦'; color: var(--accent); font-style: normal; font-size: 0.55em; vertical-align: middle; }` |
| Choice hint | `.st-ht` | `var(--font-ui)` | `var(--fs-sm, 14px)` | `400` | — | `1.35` | — | — | `var(--text-3)` | |
| "The orb's pick" | `.st-rec` | `var(--font-ui)` | `10.5px` (not scaled) | `600` | `0.16em` | `1` | — | `uppercase` | `var(--accent)` | |
| Thinking line | `.st-predicting` | `var(--font-display)` | inherits | | | | | | `var(--text-3)` | `font-style: italic; margin: 0; animation: st-pulse 1.4s ease-in-out infinite` |
| Trail answer | `.st-trail-ans` | `var(--font-display)` | `calc(22px * ts)` | `340` | — | `1.2` | — | — | `var(--text)`; `var(--accent)` on `.st-trail-row:hover` | `font-style: italic; display: block; overflow-wrap: anywhere` |
| Trail key | `.o5-kicker` inside `.st-trail-row` | as kicker | | | | | | | | |

### Own words, text buttons, bars

| Style | Selector | Family | Size | Weight | Tracking | lh | Case | Colour | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Own-words input | `.st-own input` | `var(--font-display)` | `calc(22px * ts)` | (400) | — | — | — | `var(--text)`; placeholder `var(--text-3)` italic | `padding: 6px 0 10px`; underlined (see `docs/04`) |
| Text button (own words, shortcuts) | `.st-own button, .st-shortcuts button` | `var(--font-ui)` | `calc(11px * ts)` | `600` | `0.16em` | `1.3` | `uppercase` | `var(--text-2) !important`; `var(--accent) !important` on hover (not disabled) | `font: … !important`; `text-decoration: underline; text-decoration-color: var(--o5-hair); text-underline-offset: 6px`; `min-height: 44px` |
| Text button (script desk) | `.st-scene-tools button, .st-ghost, .st-scene-form button` | `var(--font-ui)` | `calc(11px * ts)` | `600` | `0.16em` | `1.3` | `uppercase` | `var(--text-2) !important`; hover `var(--accent) !important` | underline offset `5px`, colour `var(--o5-hair)`; disabled `opacity: 0.4` |
| Primary button | `.st-go` | `var(--font-ui)` | `calc(12px * ts)` | `600` | `0.18em` | `1` | `uppercase` | `var(--bg) !important` on `background: var(--text)` | `font: … !important`; see `docs/04` |
| Bottom bar button | `.st-bar-btn` | `var(--font-ui)` | `calc(11px * ts)` | `600` | `0.16em` | `1` | `uppercase` | `var(--text-2) !important`; hover `var(--accent) !important`; disabled `opacity: 0.3` | `.st-bar-btn span { font-size: 10px }` at `max-width: 560px` |
| Drawer tab | `.st-tabs button` | `var(--font-ui)` | `calc(9.5px * ts)` | `600` | `0.12em` | `1.2` | `uppercase` | `var(--text-3) !important`; `var(--text) !important` when `[aria-pressed='true']` | |

### Contents rows, rules, brief

| Style | Selector | Family | Size | Weight | Tracking | lh | opsz | Case | Colour |
|---|---|---|---|---|---|---|---|---|---|
| Row number | `.st-row-n` | `var(--font-display)` | `26px` (not scaled) | | | | | | `var(--accent)`, `font-style: italic` |
| Row title | `.st-row-t` | `var(--font-display)` | `calc(clamp(22px, 3.8vw, 30px) * ts)` | `380` | `-0.02em` | `1.15` | `'opsz' 48` | — | inherits `var(--text) !important` from `.st-row`; `var(--accent)` on `.st-row:hover` |
| Row meta | `.st-row-m` | `var(--font-ui)` | `var(--fs-sm, 14px)` | `400` | — | `1.35` | — | — | `var(--text-3)` |
| Empty line | `.st-empty` | `var(--font-display)` | inherits | | | | | | `var(--text-3)`, italic; `padding: 18px 0` |
| House rule | `.st-rules li` | `var(--font-display)` | `calc(17px * ts)` | | | | | | `var(--text-2)` |
| Brief key | `.st-brieflist dt` | `var(--font-ui)` | `calc(11px * ts)` | `600` | `0.18em` | `1.4` | — | `uppercase` | `var(--text-3)`; `padding-top: 5px` |
| Brief value | `.st-brieflist dd` | `var(--font-display)` | `calc(20px * ts)` | | | | | | inherits; `overflow-wrap: anywhere` |
| Frame caption | `.st-frames li` | `var(--font-ui)` | `11px` (not scaled) | `600` | `0.14em` | `1.3` | — | `uppercase` | `var(--text-3)` |
| Error | `.st-error` | inherits | inherits | | | | | | `var(--text)`; `border-left: 2px solid var(--danger, #e5484d); padding-left: 14px` |

### The script desk and Talk

| Style | Selector | Family | Size | Weight | Tracking | lh | opsz | Case | Colour | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Script meta line | `.st-script-meta` | `var(--font-ui)` | `11px` (not scaled) | `600` | `0.14em` | `1.4` | — | `uppercase` | `var(--text-3)`; first `span` `var(--text-2)` | `gap: 4px 18px` |
| Scene heading | `.st-scene-head` (an `.o5-kicker`) | as kicker | | | | | | | first `span` `var(--accent)` | `gap: 2px 14px` |
| Scene action | `.st-action` | `var(--font-display)` | `calc(clamp(20px, 3.4vw, 25px) * ts)` | (400) | `-0.01em` | `1.32` | `'opsz' 36` | — | `var(--text)` | |
| "Ends on" | `.st-ends` | `var(--font-ui)` | `var(--fs-sm, 14px)` | `400` | — | `1.45` | — | — | `var(--text-2)` | its label `.st-ends span`: `600 10.5px / 1 var(--font-ui)`, `0.16em`, uppercase, `var(--text-3)`, `margin-right: 6px` |
| Says (dialogue) | `.st-says` | `var(--font-display)` | `calc(18px * ts)` | | | | | | `var(--text-2)` | italic; `padding-left: 14px; border-left: 1px solid var(--accent)` |
| Scene form fields | `.st-scene-form :is(input, textarea)` | `var(--font-display)` | `calc(19px * ts)` | | | `1.4` | | | `var(--text)` | underlined (see `docs/04`) |
| You said | `.st-said` | `var(--font-display)` | `calc(19px * ts)` | | | `1.5` | | | `var(--text-2)` | italic; `align-self: flex-end; max-width: 85%; text-align: right; white-space: pre-wrap` |
| Writer's reply | `.st-reply` | `var(--font-display)` | `calc(19px * ts)` | | | `1.5` | | | inherits | `padding-left: 16px; border-left: 1px solid var(--accent); white-space: pre-wrap` |
| Drawer title | `.st-drawer h3` | `var(--font-display)` | `calc(36px * ts)` | `340` | `-0.03em` | — | — | — | inherits | `margin: 0`; its `em`: `font-weight: 300; color: var(--accent)` |

## 5. Type styles: the magazine skin's shared pieces (o5.css)

These are unscoped classes (usable anywhere once o5.css is loaded); the `:root[data-skin='o5']` ones only apply under the skin.

| Style | Selector | Family | Size | Weight | Tracking | lh | opsz | Case | Colour | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Kicker | `.o5-kicker` | `var(--font-ui)` | `calc(11px * var(--text-scale))` | `600` | `0.18em` | `1.4` | — | `uppercase` | `var(--text-3)` | `margin: 0` |
| Display | `.o5-display` | `var(--font-display)` | `clamp(56px, 15vw, 132px)` (not scaled) | `340` | `-0.035em` | `0.92` | `'opsz' 144` | — | `var(--text)` | `margin: 0` |
| Hero | `.o5-hero` | | `clamp(64px, 17vw, 168px)` | `300` | | | | | | `font-style: italic` |
| Dek | `.o5-dek` | `var(--font-display)` | `calc(clamp(19px, 2.6vw, 24px) * var(--text-scale))` | | | `1.38` | `'opsz' 24` | | `var(--text-2)` | `max-width: 34ch` |
| Link hint | `.o5-go-hint` | `var(--font-ui)` | `var(--fs-sm)` | `400` | `0` | `1.3` | | | `var(--text-3)` | |
| Link label | `.o5-go-label` | `var(--font-display)` | `calc(clamp(26px, 4.4vw, 40px) * var(--text-scale))` | `380` | `-0.02em` | `1.1` | `'opsz' 48` | | | nowrap, ellipsis |
| Chapter numeral | `.o5-numeral` | `var(--font-display)` | `clamp(220px, 58vw, 620px)` | `200` | `-0.06em` | `0.8` | `'opsz' 144` | | `color-mix(in srgb, var(--text) 5%, transparent)` | italic |
| Cue | `.o5-cue` | `var(--font-ui)` | `var(--fs-md)` | `500` | `0.04em` | `1` | | | `var(--text)` | |
| Handle word | `.o5-handle-word` | `var(--font-ui)` | `calc(11px * var(--text-scale))` | `600` | `0.22em` | `1` | | `uppercase` | `var(--text-2)` | |
| Index number | `.o5-index-n` | `var(--font-ui)` | `var(--fs-sm)` | `500` | | `1` | | | `var(--text-3)` | `tabular-nums` |
| Index title | `.o5-index-title` | `var(--font-display)` | `calc(clamp(38px, 8vw, 72px) * var(--text-scale))` | `340` | `-0.03em` | `1` | `'opsz' 96` | | | `[aria-current]`: italic, `var(--accent)` |
| Open-app name | `.o5-open-name` | `var(--font-display)` | `calc(22px * var(--text-scale))` | | | | `'opsz' 36` | | | |
| Switch word | `.o5-switch` | `var(--font-ui)` | `var(--fs-md)` | `500` | | `1` | | | `var(--text-2)`; hover `var(--text)` underlined, offset `6px` | |
| Index sub-link | `.o5-index-sub` | `var(--font-display)` | `calc(19px * var(--text-scale))` | | | | | | `var(--text-2)` | underline `1px`, offset `6px`; hover italic `var(--text)` |
| Colophon | `.o5-colophon` | `var(--font-display)` | `var(--fs-lg)` | | | | | | `var(--text-3)` | italic |
| Step / chapter title | `.o5-step-title, .o5-chapter-title` | `var(--font-display)` | `calc(clamp(32px, 7vw, 54px) * var(--text-scale))` | `340` | `-0.03em` | `1.02` | `'opsz' 96` | | | |
| AI bar title | `.o5-ai-title` | `var(--font-display)` | `calc(30px * var(--text-scale))` | `360` | `-0.02em` | | `'opsz' 72` | | `var(--text)` | italic |
| Orb button | `.o5-orb-btn` | `var(--font-ui)` | `calc(11px * var(--text-scale, 1))` | | `0.16em` | | | `uppercase` | `var(--text-2)` | |
| Folio | `.o5-folio` | inherits | `calc(9.5px * var(--text-scale))` | | `0.24em` | | | | `var(--text-3)` | |
| Opener kicker | `.o5-opener-kicker` | `var(--font-ui)` | `calc(10px * var(--text-scale))` | `600` | `0.24em` | `1` | | `uppercase` | `var(--text-3)` | |
| Opener title | `.o5-opener-title` | `var(--font-display)` | `clamp(56px, 13vw, 128px)` | `330` | `-0.04em` | `0.92` | `'opsz' 144` | | `var(--text)` | |
| Opener line | `.o5-opener-line` | `var(--font-display)` | `calc(20px * var(--text-scale))` | | | | | | `var(--text-2)` | italic |
| Opener numeral | `.o5-opener-n` | `var(--font-display)` | `clamp(220px, 52vmin, 520px)` | `300` | `-0.06em` | `0.8` | `'opsz' 144` | | `color-mix(in srgb, var(--text) 7%, transparent)` | |
| Running head | `.o5-runhead` | `var(--font-ui)` | `calc(9.5px * var(--text-scale))` | `600` | `0.24em` | `1.2` | | `uppercase` | `var(--text-3)` | centred |
| Magazine title | `:root[data-skin='o5'] .mag-title` | `var(--font-display)` | `clamp(56px, 15vw, 128px)` | `300` | `-0.035em` | `0.92` | `'opsz' 144` | | | italic |
| Magazine head | `:root[data-skin='o5'] .mag-head` | `var(--font-display)` | `clamp(42px, 10vw, 84px)` | `340` | `-0.03em` | `0.95` | `'opsz' 144` | | | |
| Magazine dek | `:root[data-skin='o5'] .mag-dek` | `var(--font-display)` | `calc(clamp(18px, 2.4vw, 22px) * var(--text-scale))` | | | `1.38` | `'opsz' 24` | | | `max-width: 34ch` |
| Magazine numeral | `:root[data-skin='o5'] .mag-numeral` | `var(--font-display)` | `clamp(160px, 42vw, 380px)` | `200` | `-0.06em` | `0.8` | `'opsz' 144` | | `color-mix(in srgb, var(--text) 5%, transparent)` | italic |
| Contents entry | `:root[data-skin='o5'] .mag-contents button` | `var(--font-display)` | `calc(20px * var(--text-scale))` | | | | | | | hover italic; its number `.mag-contents-n`: `500 var(--fs-xs) / 1 var(--font-ui)`, `0.1em`, `var(--text-3)` |
| Magazine colophon | `:root[data-skin='o5'] .mag-colophon` | `var(--font-display)` | `calc(17px * var(--text-scale))` | | | | | | `var(--text-3)` | italic |
| App header title | `:root[data-skin='o5'] .app-header h1` | `var(--font-display)` | `calc(26px * var(--text-scale))` | `400` | `-0.02em` | | `'opsz' 72` | | | subtitle: `var(--text-3)`, `var(--fs-xs)`, `0.04em` |
| Sheet title | `:root[data-skin='o5'] .sheet-header h2` | `var(--font-display)` | `calc(24px * var(--text-scale))` | `400` | `-0.02em` | | | | | |
| Page-sheet title | `:root[data-skin='o5'] .sheet[data-page] .sheet-header h2` | `var(--font-ui)` | `calc(11px * var(--text-scale))` | `600` | `0.18em` | `1.4` | | `uppercase` | `var(--text-3)` | a kicker |
| Empty-state title | `:root[data-skin='o5'] .state h3` | `var(--font-display)` | `calc(30px * var(--text-scale))` | `380` | `-0.02em` | | | | | |
| List title | `:root[data-skin='o5'] :is(.settings-section h2, .list-title)` | `var(--font-display)` | (inherits `var(--fs-xs)`) | `400` | `-0.01em` | | | | | |
| Status chip | `:root[data-skin='o5'] span.chip` | `var(--font-ui)` | `calc(10.5px * var(--text-scale))` | `600` | `0.18em` | `1.4` | | `uppercase` | | no box |
| Button | `:root[data-skin='o5'] .btn` | (inherits) | (`var(--fs-md)`) | `500` | | | | | | pill |

## 6. Type styles: the classic components (global.css)

| Style | Selector | Size | Weight | Tracking | lh | Case | Colour |
|---|---|---|---|---|---|---|---|
| Body | `html, body` | `var(--fs-md)` | | | `1.4` | | `var(--text)` |
| Button | `.btn` | `var(--fs-md)` | `600` | | | | `var(--text)`; `.primary` `var(--on-accent)`; `.danger` `var(--danger)` |
| Small button | `.btn.small` | `var(--fs-sm)` | | | | | |
| Chip | `.chip` | `var(--fs-xs)` | `600` | | | | `var(--text-2)` |
| Widget heading | `.widget h2` | `var(--fs-sm)` | `650` | `0.6px` | | `uppercase` | `var(--text-2)` |
| App header title | `.app-header h1` | `var(--fs-lg)` | `650` | | | | nowrap, ellipsis |
| App header subtitle | `.app-header .subtitle` | `var(--fs-xs)` | | | | | `var(--text-3)` |
| Sheet title | `.sheet-header h2` | `var(--fs-lg)` | | | | | |
| List caption | `.list-caption` | `var(--fs-xs)` | | | | | `var(--text-3)` |
| List title | `.list-title` | `var(--fs-xs)` | `650` | `0.6px` | | `uppercase` | `var(--text-3)` |
| Row subtitle | `.row .row-sub` | `var(--fs-xs)` | | | | | `var(--text-3)` |
| Segmented option | `.segmented button` | `var(--fs-sm)` | `600` | | | | `var(--text-2)`; pressed `var(--text)` |
| Empty-state title / text | `.state h3` / `.state p` | `var(--fs-lg)` / `var(--fs-sm)` | | | | | `var(--text)` / `var(--text-2)`; `p { max-width: 42ch }` |
| Banner | `.banner` | `var(--fs-sm)` | | | `1.35` | | |
| Toast | `.toast` | `var(--fs-sm)` | `500` | | | | |
| Keycap | `.kbd` | `var(--fs-xs)` | | | | | `var(--font-mono)` |
| Plain text box placeholder | `.ta-plain:empty::before` | | | | | | `var(--text-3, #8f877b)` |

## 7. The italic-emphasis convention

Questions and titles mark the word that matters with asterisks in the data; the `Headline` component turns every odd-numbered part into an `<em>`, which `.st-q em` sets in italic, weight 300, in the accent colour. From `orbit/src/studio/Sheets.tsx`:

```tsx
/** "Where are *we?*": words between asterisks are set in italics, the magazine way. The orb waits beside it. */
export function Headline({ text, id, orb = true }: { text: string; id?: string; orb?: boolean }) {
  const parts = text.split('*');
  return (
    <div className="st-qwrap">
      <h2 className="st-q" id={id}>
        {parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
      </h2>
      {orb && <OrbSpot />}
    </div>
  );
}
```

```css
.st-q em {
  font-style: italic;
  font-weight: 300;
  color: var(--accent);
}
```

`StepDef.q` in `defs.ts` documents it: "The question, as the orb asks it. *Words between asterisks* are set in italics." Examples from `afterdark.ts`: `'Who is *in it?*'`, `'What is the *mood?*'`, `'Where are *we?*'`, `'How *dressed?*'`, `'Quick film or *director’s cut?*'`, `'Here is the *script.*'`; from `StudioApp.tsx`: `"What shall we *make?*"`; from `Sheets.tsx`: `'Your *projects*'`, `` `Welcome to ${studio.mark[0]} *${studio.mark[1]}*` ``, `"Adults *only.*"`; from `Make.tsx`: `` `Here is your *${what}.*` ``, `` `Making your *${what}…*` ``; from `Talk.tsx`: `"What are you *in the mood for?*"`. Note the punctuation sits inside the asterisks. The same text is given to the orb with the asterisks stripped: `step.q.replace(/\*/g, '')`.

The same idea, written in markup rather than data, appears in the masthead (`<b>{studio.mark[0]} <i>{studio.mark[1]}</i></b>` with `.st-flag i { font-style: italic; font-weight: 300; color: var(--accent); }`) and the drawer titles (`<h3>Your <em>gallery</em></h3>`, `.st-drawer h3 em { font-weight: 300; color: var(--accent); }`).

A related convention: the selected or current item goes italic rather than getting a highlight box: `.st-choice[aria-pressed='true'] .st-lb { font-style: italic }` (plus the accent `✦`), `.o5-index-go[aria-current] .o5-index-title { font-style: italic; color: var(--accent); }`, `.o5-choice[aria-checked='true'] .o5-go-label { font-style: italic; }`, `.o5-open-go[aria-current] .o5-open-name { font-style: italic; color: var(--accent); }`, `.st-trail-ans` is italic throughout (it is an answer already given). Accent is used only for italics, hairline-sized marks and the primary button's hover: never as a fill behind text, except in the classic skin's `.btn.primary`.

## 8. Optical sizes used

Fraunces' `opsz` axis is set per role; the values in use are `144` (display, numerals, magazine titles), `120` (`.st-q`), `96` (index and chapter titles, greeting), `72` (masthead, app header, AI bar), `48` (answers, link labels, contents rows), `36` (scene action, open-app name), `24` (deks), `18` (serif body copy in the AI apps). Inter is never given an `opsz`.
