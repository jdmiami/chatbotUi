# 02 · Tokens

Every CSS custom property Orbit's look is built from, with the exact value and the exact selector under which it applies. Values are copied from the source files named in each table; nothing is rounded.

Source files (and the order they are loaded in, given in `src/styles/README.md` and followed by `example/src/main.tsx`, which decides who wins at equal specificity):

| Order | Package file | Defines |
|---|---|---|
| 1 | `src/styles/tokens.css` | fonts, text scale and sizes, radii, spacing, safe areas, viewport, timings, accents, dark and light palettes, wallpapers |
| 2 | `src/styles/base.css` (the source app's global.css) | no tokens (uses them) |
| 3 | `src/motion/motion.css` (the motion package, `docs/05-motion.md`) | springs and durations, `--sx`/`--sy`, `--depth-1`…`--depth-4`, `--island-top` |
| 4 | `src/styles/glass.css` | `--glass-tint`, `--glass-tint-strong`, `--glass-edge`, `--glass-sheen`, `--glass-blur`, `--lit`, `--sheen` |
| 5 | `src/styles/o5.css` | the o5 skin: `--font-display`, new `--font-ui`, new radii, `--ease-o5`, `--dur-o5`, `--o5-hair`, `--o5-glow`, the warm palettes, `--term-bg`/`--term-fg`, `--code-bg` |
| 6 | `src/orb/orb.css` (the orb package, `docs/09-orb.md`) | `--orb-x`, `--orb-y` (the orb's position) |
| 7 | `src/styles/pages.css` | `--st-gutter`, `--st-col` |

Values written to `<html>` from JavaScript (inline `style`) beat every stylesheet rule: `--text-scale` (a settings screen, if the app has one), `--app-height`, `--vv-offset-top`, `--keyboard-inset` (the viewport hook), and an app's `--accent`, `--st-*` and `--orb-*` (see "The app theme").

Selector specificity, for reading the tables: `:root` = (0,1,0); `:root[data-theme='dark']` = (0,2,0); `:root[data-skin='o5'][data-theme='dark']` = (0,3,0). Higher wins; equal specificity, the later file wins.

## 1. Fonts

| Token | Value | Selector | File | For |
|---|---|---|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` | `:root` | tokens.css | body and UI text, classic look |
| `--font-ui` | `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | `:root[data-skin='o5']` | o5.css | UI text, magazine look |
| `--font-mono` | `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace` | `:root` | tokens.css | code, terminal, `.kbd`, `.mono` |
| `--font-display` | `'Fraunces Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` | `:root[data-skin='o5']` | o5.css | headlines, deks, answers, serif body in the magazine look. **Not defined outside the o5 skin**; pages.css uses `var(--font-display)` with no fallback, so without `data-skin="o5"` those elements inherit the body font. |

See `docs/03-typography.md` for how the faces are loaded.

## 2. Text scale and type sizes

| Token | Value | Selector | File | For |
|---|---|---|---|---|
| `--text-scale` | `1` | `:root` | tokens.css | user text size. The source app's settings hook (§14) overwrote it inline: `root.style.setProperty('--text-scale', String(settings.textScale))`. The example app has no such hook, so there it stays `1`. |
| `--fs-xs` | `calc(12px * var(--text-scale))` | `:root` | tokens.css | captions, labels, chips |
| `--fs-sm` | `calc(13px * var(--text-scale))` | `:root` | tokens.css | hints, small text, `.btn.small` |
| `--fs-md` | `calc(15px * var(--text-scale))` | `:root` | tokens.css | body (`html, body { font-size: var(--fs-md) }`), `.btn` |
| `--fs-lg` | `calc(17px * var(--text-scale))` | `:root` | tokens.css | app header `h1`, sheet `h2`, `.state h3` |
| `--fs-xl` | `calc(22px * var(--text-scale))` | `:root` | tokens.css | switcher `h2`, boot card `h1` |
| `--fs-2xl` | `calc(28px * var(--text-scale))` | `:root` | tokens.css | a greeting in the source app; nothing in this package uses it |

Note that pages.css reads `var(--fs-sm, 14px)` with a `14px` fallback (the token itself is 13px × scale); the fallback only applies if tokens.css is not loaded.

## 3. Radii

| Token | Default (`:root`, tokens.css) | o5 (`:root[data-skin='o5']`, o5.css) | For |
|---|---|---|---|
| `--radius-sm` | `8px` | `999px` | focus ring corner (`:focus-visible { border-radius: var(--radius-sm) }`) |
| `--radius-md` | `12px` | `14px` | `.btn`, `.icon-btn`, `.list`, `.banner`, `.toast`, inputs in o5 |
| `--radius-lg` | `18px` | `22px` | `.widget`, `.switcher-card`, `.cc-tile` |
| `--radius-xl` | `26px` | (inherits `26px`) | `.sheet`, `.dock`, `.cc-panel`, `.boot-card` |
| `--radius-icon` | `22.5%` | (inherits) | app icon tiles (`.glyph`) |

The page look sets `border-radius: 0` on its own elements explicitly (see `docs/04`), so these only affect classic components that appear inside it (sheets, `.btn`, chips).

## 4. Spacing, touch target, shell metrics

All on `:root` in tokens.css.

| Token | Value | For |
|---|---|---|
| `--tap` | `44px` | minimum touch target (`min-height`/`width`/`height` of `.btn`, `.icon-btn`, `.swatch`, `.range`, `.o5-cue`, `.o5-switch`, `.o5-index-close`, …) |
| `--space-1` | `4px` | |
| `--space-2` | `8px` | gaps in headers, rows, chips |
| `--space-3` | `12px` | `.stack` gap, list gaps |
| `--space-4` | `16px` | widget padding, sheet body padding |
| `--space-5` | `24px` | boot card padding, home stack gap |
| `--space-6` | `32px` | `.state` vertical padding |
| `--dock-height` | `64px` | the source app's dock (not used by the page look) |
| `--dock-gap` | `10px` | the source app's dock |

## 5. Safe areas and the viewport

| Token | Value | Selector / setter | For |
|---|---|---|---|
| `--safe-top` | `env(safe-area-inset-top, 0px)` | `:root` tokens.css | notch / status bar |
| `--safe-right` | `env(safe-area-inset-right, 0px)` | `:root` tokens.css | landscape side inset |
| `--safe-bottom` | `env(safe-area-inset-bottom, 0px)` | `:root` tokens.css | home indicator |
| `--safe-left` | `env(safe-area-inset-left, 0px)` | `:root` tokens.css | landscape side inset |
| `--app-height` | `100dvh` | `:root` tokens.css; overwritten inline by `useVisualViewport()` with the visible height in px | height of `.shell`, min-height of `.o5-spread` |
| `--keyboard-inset` | `0px` | `:root` tokens.css; overwritten inline by `useVisualViewport()` | approximate keyboard height |
| `--vv-offset-top` | no stylesheet default; read as `var(--vv-offset-top, 0px)` | set inline by `useVisualViewport()` | how far iOS scrolled the visual viewport (`.shell { transform: translateY(var(--vv-offset-top, 0px)) }`) |
| `--island-top` | `calc(env(safe-area-inset-top, 0px) + 44px)`; `calc(env(safe-area-inset-top, 0px) + 40px)` at `(max-height: 520px)` | `.shell[data-island='true']` motion.css | the status pill strip (Orbit shell only) |

pages.css does not read `--safe-*`; it uses `env(safe-area-inset-*, 0px)` directly (see `docs/04`).

## 6. Timings and easings (tokens.css and o5.css only; the springs are in `docs/05-motion.md`)

| Token | Value | Selector | File |
|---|---|---|---|
| `--dur-fast` | `140ms` | `:root` | tokens.css |
| `--dur-med` | `240ms` | `:root` | tokens.css |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `:root` | tokens.css |
| `--ease-spring` | `cubic-bezier(0.34, 1.3, 0.5, 1)` | `:root` | tokens.css |
| `--ease-o5` | `cubic-bezier(0.22, 1, 0.36, 1)` | `:root[data-skin='o5']` | o5.css |
| `--dur-o5` | `520ms` | `:root[data-skin='o5']` | o5.css |
| `--dur-fast`, `--dur-med` | `0ms` | `@media (prefers-reduced-motion: reduce) { :root:not([data-reduce-motion='false']) }` and `:root[data-reduce-motion='true']` | tokens.css |

pages.css reads `var(--dur-fast, 0.15s)` (fallback 0.15s) and hard-codes `520ms cubic-bezier(0.22, 1, 0.36, 1)` (the same curve and time as `--dur-o5`/`--ease-o5`) for its padding and drawer transitions.

## 7. Accent

Defaults on `:root` (tokens.css):

| Token | Value |
|---|---|
| `--accent` | `#6c7cff` |
| `--accent-strong` | `#5161f5` |
| `--on-accent` | `#ffffff` |
| `--accent-soft` | `rgb(108 124 255 / 0.18)` |

Named accents, `:root[data-accent='…']` (tokens.css):

| `data-accent` | `--accent` | `--accent-strong` | `--accent-soft` | `--on-accent` |
|---|---|---|---|---|
| `indigo` | `#6c7cff` | `#5161f5` | `rgb(108 124 255 / 0.18)` | `#fff` |
| `teal` | `#22b8a8` | `#129a8c` | `rgb(34 184 168 / 0.18)` | `#fff` |
| `amber` | `#f2a93b` | `#d98f1f` | `rgb(242 169 59 / 0.2)` | `#1d1300` |
| `rose` | `#f2557a` | `#da3a61` | `rgb(242 85 122 / 0.18)` | `#fff` |
| `sky` | `#3ea6f5` | `#1f8de0` | `rgb(62 166 245 / 0.18)` | `#fff` |

Light theme darkens them for contrast, `:root[data-theme='light'][data-accent='…']` (tokens.css; `--accent-soft` is not changed):

| `data-accent` | `--accent` | `--accent-strong` | `--on-accent` |
|---|---|---|---|
| `indigo` | `#4a57e0` | `#3a46c9` | (unchanged) |
| `teal` | `#0e8577` | `#0a6c61` | (unchanged) |
| `amber` | `#a86200` | `#8c5100` | `#fff` |
| `rose` | `#c92d55` | `#ad1f45` | (unchanged) |
| `sky` | `#156fb8` | `#0f5b99` | (unchanged) |

An app built on the page look does not set `data-accent`; it writes `--accent` inline from its theme's `orbA` (see "The app theme"). `--accent-strong`, `--accent-soft` and `--on-accent` then keep the `:root` defaults above (`#5161f5`, `rgb(108 124 255 / 0.18)`, `#ffffff`): nothing in pages.css reads them, but classic components inside such a page (`.btn.primary:hover`, `.icon-btn:active`) would.

## 8. Theme palettes

Four columns: the classic dark theme (`:root, :root[data-theme='dark']`, tokens.css), the classic light theme (`:root[data-theme='light']`, tokens.css), and the o5 skin's overrides (`:root[data-skin='o5'][data-theme='dark']` and `:root[data-skin='o5'][data-theme='light']`, o5.css). "inherits" means o5.css does not override it and the classic value applies. The o5 palettes only match when `data-theme` is present on `<html>`.

| Token | Dark (default) | Light | o5 dark | o5 light | For |
|---|---|---|---|---|---|
| `color-scheme` | `dark` | `light` | inherits | inherits | form controls, scrollbars |
| `--bg` | `#0b1020` | `#eef1f7` | `#0d0c0b` | `#f5f1e9` | page background; `.st-go` text colour |
| `--surface` | `#141a2e` | `#ffffff` | `#151311` | `#fbf8f2` | cards, `.list`, drawer background |
| `--surface-2` | `#1b2238` | `#f4f6fb` | `#1b1916` | `#f1ece2` | hover of rows, `.kbd`, `.cc-tile` |
| `--surface-3` | `#232b45` | `#e8ecf5` | `#24211d` | `#e9e3d7` | `.btn` default, `.chip`, `.segmented`, `.switch` |
| `--glass` | `rgb(22 28 48 / 0.72)` | `rgb(255 255 255 / 0.72)` | `rgb(13 12 11 / 0.72)` | `rgb(245 241 233 / 0.78)` | `.glass` background (global.css), `.o5-runhead` |
| `--glass-strong` | `rgb(18 23 40 / 0.9)` | `rgb(255 255 255 / 0.92)` | `rgb(13 12 11 / 0.9)` | `rgb(245 241 233 / 0.94)` | `.sheet`, `.app-header` (global.css), o5 `.sheet`, o5 `.cc-panel` |
| `--glass-border` | `rgb(255 255 255 / 0.1)` | `rgb(15 23 42 / 0.1)` | `transparent` | `transparent` | `.glass`/`.sheet` border (global.css) |
| `--border` | `rgb(255 255 255 / 0.1)` | `rgb(15 23 42 / 0.1)` | `rgb(243 238 230 / 0.08)` | `rgb(23 21 18 / 0.08)` | `.row` separators, `.list` border |
| `--border-strong` | `rgb(255 255 255 / 0.18)` | `rgb(15 23 42 / 0.2)` | `rgb(243 238 230 / 0.16)` | `rgb(23 21 18 / 0.16)` | `.btn.ghost`, `.switch`, `.kbd`, grabbers |
| `--text` | `#eef1fa` | `#111827` | `#f3eee6` | `#171512` | primary text; `.st-go` background |
| `--text-2` | `#b7bfd6` | `#3d4659` | `#c9c1b4` | `#4a453d` | secondary text, deks, resting answers |
| `--text-3` | `#8891ab` | `#5d6679` | `#8f877b` | `#6d665b` | kickers, hints, placeholders |
| `--danger` | `#ff6b7d` | `#c8283f` | inherits | inherits | errors; `.st-error` rule |
| `--danger-soft` | `rgb(255 107 125 / 0.16)` | `rgb(200 40 63 / 0.1)` | inherits | inherits | `.btn.danger`, `.chip.error` backgrounds |
| `--warning` | `#ffc561` | `#8f5a00` | inherits | inherits | demo chips, slow jobs |
| `--warning-soft` | `rgb(255 197 97 / 0.16)` | `rgb(214 140 0 / 0.14)` | inherits | inherits | |
| `--success` | `#4fd69c` | `#137a4c` | inherits | inherits | `.switch:checked`, success toasts |
| `--success-soft` | `rgb(79 214 156 / 0.16)` | `rgb(19 122 76 / 0.12)` | inherits | inherits | |
| `--info` | `#7cc4ff` | `#1765a8` | inherits | inherits | |
| `--info-soft` | `rgb(124 196 255 / 0.16)` | `rgb(23 101 168 / 0.12)` | inherits | inherits | |
| `--shadow-1` | `0 1px 2px rgb(0 0 0 / 0.35), 0 4px 14px rgb(0 0 0 / 0.25)` | `0 1px 2px rgb(15 23 42 / 0.08), 0 4px 14px rgb(15 23 42 / 0.08)` | inherits | inherits | written on `.glass` and `.app-icon .glyph` (global.css) and `.segmented button[aria-pressed='true']`; on `.glass` it is overridden by the `--depth-*` shadows of glass.css/motion.css (`docs/04` §2) |
| `--shadow-2` | `0 10px 40px rgb(0 0 0 / 0.45)` | `0 10px 40px rgb(15 23 42 / 0.18)` | inherits | inherits | written on `.sheet` (global.css; overridden by motion.css's `--depth-3`) and `.switcher-card` |
| `--scrim` | `rgb(5 8 18 / 0.55)` | `rgb(15 23 42 / 0.35)` | `rgb(8 7 6 / 0.7)` | `rgb(245 241 233 / 0.6)` | `.sheet-scrim`, `.cc-scrim` |
| `--focus-ring` | `0 0 0 3px var(--bg), 0 0 0 5px var(--accent)` | same | inherits | inherits | `:focus-visible { box-shadow }` |
| `--term-bg` | `#0d1222` | `#0d1222` | `#0d0c0b` (on `:root[data-skin='o5']`, both themes) | `#0d0c0b` | terminal |
| `--term-fg` | `#e6e9f2` | `#e6e9f2` | `#f3eee6` (on `:root[data-skin='o5']`, both themes) | `#f3eee6` | terminal |
| `--code-bg` | `#10162a` | `#ffffff` | `#171513` (`:root[data-skin='o5'][data-theme='dark']`, o5.css line 868) | inherits | code blocks |

o5-only tokens:

| Token | o5 (both themes, `:root[data-skin='o5']`) | o5 dark | o5 light | For |
|---|---|---|---|---|
| `--o5-hair` | `color-mix(in srgb, var(--text) 12%, transparent)` | | | every hairline: row separators, `.st-top`/`.st-bottom` borders, `.st-sq` border, underlines of text buttons, the input underline, the progress bar track |
| `--o5-glow` | | `radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%)` | `radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%)` | the accent glow at the top right of the page: `.shell`, `.st-root`, `.st-drawer`, `.o5-opener`, `.sheet[data-page]` paint `var(--o5-glow), var(--bg)` |

Because both derive from `--text` and `--accent`, retheming those two retunes the hairline and the glow automatically.

## 9. Glass (glass.css)

| Token | Dark (`:root`) | Light (`:root[data-theme='light']`) | For |
|---|---|---|---|
| `--glass-tint` | `rgb(24 30 52 / 0.48)` | `rgb(255 255 255 / 0.52)` | `.glass` background layer |
| `--glass-tint-strong` | `rgb(18 23 40 / 0.8)` | `rgb(255 255 255 / 0.86)` | `.sheet`, `.cc-panel.glass`, `.app-header` (reading surfaces) |
| `--glass-edge` | `rgb(255 255 255 / 0.16)` | `rgb(255 255 255 / 0.7)` | the `0.5px` border of panes; the bottom hairline of `.app-header` |
| `--glass-sheen` | `rgb(255 255 255 / 0.16)` | `rgb(255 255 255 / 0.55)` | the highlight colour in `--sheen` |
| `--glass-blur` | `blur(26px) saturate(190%) brightness(1.05)` | `blur(26px) saturate(180%) brightness(1.02)` | `backdrop-filter` of every pane |
| `--lit` | `inset 0 1px 0 rgb(255 255 255 / 0.3), inset 1px 0 0 rgb(255 255 255 / 0.1), inset -1px 0 0 rgb(255 255 255 / 0.04), inset 0 -1px 0 rgb(0 0 0 / 0.22), inset 0 0 18px rgb(255 255 255 / 0.04)` | `inset 0 1px 0 rgb(255 255 255 / 0.95), inset 1px 0 0 rgb(255 255 255 / 0.5), inset 0 -1px 0 rgb(15 23 42 / 0.08), inset 0 0 18px rgb(255 255 255 / 0.25)` | the lit rim: first part of every `--depth-*` shadow |
| `--sheen` | `radial-gradient(140% 100% at calc(18% - var(--tx, 0) * 26%) calc(-12% - var(--ty, 0) * 26%), var(--glass-sheen), transparent 48%)` on `.glass, .sheet, .app-header`; `none` on `:root[data-skin='o5'] .glass, :root[data-skin='o5'] .sheet` | | the highlight that slides with the tilt (`--tx`/`--ty` from the motion package) |

## 10. Depth (motion.css; documented here because the surfaces doc refers to them)

`--sx: calc(var(--tx, 0) * -3px)` and `--sy: calc(var(--ty, 0) * -3px)` on `:root` (the shadow offset that swings with the tilt).

| Token | Dark (`:root`) | Light (`:root[data-theme='light']`) |
|---|---|---|
| `--depth-1` | `var(--lit), calc(1px + var(--sx)) calc(2px + var(--sy)) 4px rgb(0 0 0 / 0.22), calc(2px + var(--sx) * 2) calc(6px + var(--sy) * 2) 14px rgb(0 0 0 / 0.18)` | `var(--lit), calc(1px + var(--sx)) calc(2px + var(--sy)) 4px rgb(15 23 42 / 0.1), calc(2px + var(--sx) * 2) calc(6px + var(--sy) * 2) 14px rgb(15 23 42 / 0.1)` |
| `--depth-1-pressed` | `var(--lit), 0 1px 2px rgb(0 0 0 / 0.3)` | `var(--lit), 0 1px 2px rgb(15 23 42 / 0.14)` |
| `--depth-2` | `var(--lit), calc(2px + var(--sx) * 2) calc(4px + var(--sy) * 2) 8px rgb(0 0 0 / 0.22), calc(4px + var(--sx) * 3) calc(14px + var(--sy) * 3) 30px rgb(0 0 0 / 0.24)` | `var(--lit), calc(2px + var(--sx) * 2) calc(4px + var(--sy) * 2) 8px rgb(15 23 42 / 0.1), calc(4px + var(--sx) * 3) calc(14px + var(--sy) * 3) 30px rgb(15 23 42 / 0.14)` |
| `--depth-3` | `var(--lit), 3px 8px 16px rgb(0 0 0 / 0.22), 8px 28px 60px rgb(0 0 0 / 0.36)` | `var(--lit), 3px 8px 16px rgb(15 23 42 / 0.12), 8px 28px 60px rgb(15 23 42 / 0.2)` |
| `--depth-4` | `var(--lit), 3px 10px 20px rgb(0 0 0 / 0.25), 10px 32px 70px rgb(0 0 0 / 0.4)` | `var(--lit), 3px 10px 20px rgb(15 23 42 / 0.14), 10px 32px 70px rgb(15 23 42 / 0.22)` |

## 11. Wallpapers (classic look only; `.shell { background: var(--wallpaper) }`)

`:root` default and `:root[data-wallpaper='orbit']` (identical, tokens.css):

```
radial-gradient(120% 80% at 85% 0%, #3b2a8f 0%, transparent 55%),
radial-gradient(90% 70% at 0% 100%, #0e6f78 0%, transparent 60%),
radial-gradient(60% 50% at 50% 55%, #18204a 0%, transparent 70%), linear-gradient(160deg, #0b1020, #0a1a2a)
```

| Selector | `--wallpaper` |
|---|---|
| `:root[data-wallpaper='dusk']` | `radial-gradient(110% 70% at 10% 0%, #7a3a6b 0%, transparent 55%), radial-gradient(100% 70% at 100% 100%, #c2683a 0%, transparent 55%), linear-gradient(170deg, #241a3a, #3a1f2e)` |
| `:root[data-wallpaper='aurora']` | `radial-gradient(90% 60% at 20% 10%, #1f8f7a 0%, transparent 60%), radial-gradient(80% 60% at 90% 40%, #3651c9 0%, transparent 60%), linear-gradient(180deg, #071a1f, #0b1430)` |
| `:root[data-wallpaper='graphite']` | `radial-gradient(80% 60% at 50% 0%, #3a4152 0%, transparent 65%), linear-gradient(180deg, #1a1d24, #0f1115)` |
| `:root[data-theme='light'][data-wallpaper='orbit']`, `:root[data-theme='light']:not([data-wallpaper])` | `radial-gradient(120% 80% at 85% 0%, #b9b3ff 0%, transparent 55%), radial-gradient(90% 70% at 0% 100%, #9fe3dc 0%, transparent 60%), linear-gradient(160deg, #eef1fb, #e3f2f4)` |
| `:root[data-theme='light'][data-wallpaper='dusk']` | `radial-gradient(110% 70% at 10% 0%, #f2b6d9 0%, transparent 55%), radial-gradient(100% 70% at 100% 100%, #ffc9a3 0%, transparent 55%), linear-gradient(170deg, #fbf1f6, #fff1e8)` |
| `:root[data-theme='light'][data-wallpaper='aurora']` | `radial-gradient(90% 60% at 20% 10%, #a6ecd9 0%, transparent 60%), radial-gradient(80% 60% at 90% 40%, #b8c6ff 0%, transparent 60%), linear-gradient(180deg, #effaf7, #eef1ff)` |
| `:root[data-theme='light'][data-wallpaper='graphite']` | `radial-gradient(80% 60% at 50% 0%, #ffffff 0%, transparent 65%), linear-gradient(180deg, #e9ebef, #d9dce2)` |

In the o5 skin the wallpaper is replaced: `:root[data-skin='o5'] .shell { background: var(--o5-glow), var(--bg); }`.

## 12. Orb colours and page variables

| Token | Value | Set by | Read by |
|---|---|---|---|
| `--orb-a` | the app theme's `orbA` (Compass: `#cfe8f5`) | the example app (`example/src/App.tsx`) inline on `<html>` | **nothing in the package** reads `--orb-a` (searched every `.css`, `.ts`, `.tsx` under `src/`); see `docs/09-orb.md` for the orb's own colours |
| `--orb-b` | the theme's `orbB` (Compass: `#1f5570`) | the example app inline | nothing in the package |
| `--orb-x`, `--orb-y` | `-100px`, `-100px` | orb.css `:root`; updated by the orb cursor | orb.css (position of the orb's panel) |
| `--st-gutter` | `calc(clamp(18px, 6vw, 64px))` | `:root[data-guide]` pages.css | `.st-top` and `.st-scroll` side padding |
| `--st-col` | `760px` | `:root[data-guide]` pages.css | `max-width` of `.st-scroll > *`, `.st-trail`, `.st-now` |
| `--st-paper`, `--st-ink`, `--st-ink2`, `--st-accent`, `--st-desk`, `--st-desk2` | the theme's `paper`, `ink`, `ink2`, `accent`, `desk`, `desk2` | the example app inline | **nothing in the package** reads them. They are published for future use; the visible colours of a page come from the o5 dark palette plus `--accent` (next section). |

## 13. Runtime variables set from JavaScript (for completeness)

| Variable | Set by | Read by |
|---|---|---|
| `--tx`, `--ty` (−1…1) | motion package tilt | `--sheen`, `--sx`/`--sy`, the widget highlight, parallax |
| `--rx`, `--ry` | motion package `useTilt` | `.tilt` |
| `--p`, `--ap` | motion package scroll depth (`useScrollDepth`) | `[data-depth] > *` in pages.css and o5.css (sink-back and blur) |
| `--i` | set per list item in JSX | staggered animation delays |
| `--ta-rows` | `TextArea` component | `.ta-plain { min-height: calc(var(--ta-rows, 2) * 1.5em + 16px) }` |

## 14. How theme and skin are switched

Attributes on `<html>` (`document.documentElement.dataset.*`):

| Attribute | Values | Set by (the source app) | Set by (the example app) |
|---|---|---|---|
| `data-theme` | `dark`, `light` | `useApplySettings` from Settings (`system` resolves with `(prefers-color-scheme: dark)`) | the example app: always `dark` |
| `data-skin` | `classic`, `o5` | `useApplySettings` (`settings.skin ?? 'classic'`) | the example app: always `o5` |
| `data-guide` | the guide id (`compass`) | — | the example app |
| `data-accent` | `indigo`, `teal`, `amber`, `rose`, `sky` | `useApplySettings` | not set |
| `data-wallpaper` | `orbit`, `dusk`, `aurora`, `graphite` | `useApplySettings` | not set |
| `data-reduce-motion` | `true`, `false`, absent (`system`) | `useApplySettings` | not set |
| `data-motion` | `full`, `lite`, `off` | `MotionProvider` (`document.documentElement.dataset.motion = level`) | same provider (main.tsx wraps both) |

The source app's applier (its `useApplySettings` hook; not part of this package), verbatim:

```ts
useEffect(() => {
  const root = document.documentElement;
  const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  root.dataset.theme = theme;
  root.dataset.accent = settings.accent;
  root.dataset.wallpaper = settings.wallpaper;
  // Off (or Auto with the device's Reduce Motion on) also zeroes CSS timings; Full and Lite keep them.
  root.dataset.reduceMotion = settings.motion === 'system' ? '' : settings.motion === 'reduce' ? 'true' : 'false';
  if (settings.motion === 'system') delete root.dataset.reduceMotion;
  root.style.setProperty('--text-scale', String(settings.textScale));
  const skin = settings.skin ?? 'classic';
  root.dataset.skin = skin;
  if (skin === 'o5') loadEditorialFonts();
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#eef1f7');
}, [settings, systemDark]);
```

(The source app's `index.html` ships `<meta name="theme-color" content="#0b1020" />`; the example app does not update it.)

Precedence, highest first, for any one token:

1. Inline style on `<html>` (`root.style.setProperty`): `--text-scale`, `--app-height`, `--vv-offset-top`, `--keyboard-inset`, and in an app built on the page look `--accent`, `--st-*`, `--orb-*`.
2. `:root[data-skin='o5'][data-theme='dark' | 'light']` (0,3,0): the o5 palettes, `--o5-glow`, o5 `--code-bg`.
3. `:root[data-theme='light'][data-accent='…']` (0,3,0, tokens.css, earlier file): light accents.
4. `:root[data-skin='o5']` (0,2,0, o5.css): fonts, radii, `--o5-hair`, `--ease-o5`, `--dur-o5`, `--term-bg`, `--term-fg`.
5. `:root[data-theme='light']` (0,2,0; tokens.css for the palette, glass.css and motion.css for glass and depth), `:root[data-theme='dark']`, `:root[data-accent='…']`, `:root[data-wallpaper='…']`, `:root[data-reduce-motion='true']`, `:root[data-guide]`.
6. `:root` (0,1,0): the defaults.

Where two selectors tie, the later file wins. Example: `--glass-border` is set by `:root[data-theme='light']` (tokens.css, (0,2,0)) and would tie with a `:root[data-skin='o5']` rule, so o5.css puts its palettes on `:root[data-skin='o5'][data-theme='light']` (0,3,0), which beats tokens.css's light palette outright. `--font-ui`, on the other hand, is on plain `:root` in tokens.css (0,1,0) and on `:root[data-skin='o5']` in o5.css (0,2,0): o5 wins by specificity alone.

## 15. The app theme

An app built on the package is one `Guide` (`src/flow/defs.ts`); its colours are the `theme` field:

```ts
/** The colours of a guide: paper, ink and accent for the page; the desk is always dark. */
export interface Theme {
  paper: string;
  ink: string;
  ink2: string;
  accent: string;
  desk: string;
  desk2: string;
  orbA: string;
  orbB: string;
}
```

The code that applies it, from the example app (`example/src/App.tsx`), verbatim:

```ts
// The guide's colours on <html> (docs/02-tokens.md, "The guide's theme").
useEffect(() => {
  const root = document.documentElement;
  root.dataset.theme = 'dark';
  root.dataset.skin = 'o5';
  root.dataset.guide = guide.id;
  const t = guide.theme;
  const vars: Record<string, string> = { '--st-paper': t.paper, '--st-ink': t.ink, '--st-ink2': t.ink2, '--st-accent': t.accent, '--st-desk': t.desk, '--st-desk2': t.desk2, '--accent': t.orbA, '--orb-a': t.orbA, '--orb-b': t.orbB };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.title = guide.name;
}, []);
```

(On the dark page the accent is the orb's light tone, `orbA`. The fonts are fetched separately by `loadFonts()` from `src/styles/fonts.ts`, called once in `example/src/main.tsx`; see `docs/03-typography.md`.)

What each field maps to:

| Field | CSS variable written | Consumed by |
|---|---|---|
| `paper` | `--st-paper` | nothing in the package (the source app's comment called the deep accent "for the paper drawers", but pages.css paints `.st-drawer` with `var(--o5-glow), var(--surface, var(--bg))`) |
| `ink` | `--st-ink` | nothing |
| `ink2` | `--st-ink2` | nothing |
| `accent` | `--st-accent` | nothing |
| `desk` | `--st-desk` | nothing; the page background is o5's `--bg` (`#0d0c0b`), not `desk` |
| `desk2` | `--st-desk2` | nothing |
| `orbA` | `--accent` **and** `--orb-a` | `--accent` is read everywhere: headline italics (`.st-q em`), masthead italic (`.st-flag i`), the ✦ mark, `.st-rec`, hover colours, `.st-go:hover`, the progress bar fill, `.st-bar span`, the `.st-reply` rule, focus outlines, `.st-rules li::before`, `.st-tabs` active icon, and `--o5-glow` through `color-mix` |
| `orbB` | `--orb-b` | nothing in the package |

The worked example, Compass (`src/flow/guides/example.ts`):

```ts
theme: {
  paper: '#f4efe6',
  ink: '#1d2430',
  ink2: '#5b6472',
  accent: '#2a6f8f',
  desk: '#0b1016',
  desk2: '#141c25',
  orbA: '#cfe8f5',
  orbB: '#1f5570',
},
```

So a Compass page, resolved, is: `--bg #0d0c0b`, `--surface #151311`, `--text #f3eee6`, `--text-2 #c9c1b4`, `--text-3 #8f877b`, `--border rgb(243 238 230 / 0.08)`, `--o5-hair color-mix(in srgb, #f3eee6 12%, transparent)`, `--accent #cfe8f5`, `--o5-glow radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, #cfe8f5 22%, transparent), transparent 60%)`, fonts Fraunces Variable / Inter Variable. The masthead reads "Com*pass*" from `mark: ['Com', 'pass']` with `kicker: 'A sample guide'`.

## 16. How to retheme: the variables to change for a new brand

The magazine look is designed so that a new site changes very little. Set these on `<html>` (inline, as the example app does, or in a stylesheet loaded after o5.css under a selector of specificity (0,3,0) or higher):

| # | Variable | What it drives | Compass value |
|---|---|---|---|
| 1 | `--accent` | every italic emphasis, hover, the ✦, the progress fill, the glow (via `--o5-glow`) | `#cfe8f5` (= `orbA`) |
| 2 | `--bg` | the page and the text colour of the primary button | `#0d0c0b` (o5 dark default) |
| 3 | `--text` | ink, the primary button fill, and the hairline (via `--o5-hair`, 12% of it) | `#f3eee6` (o5 dark default) |
| 4 | `--text-2` | deks, resting answers, text buttons | `#c9c1b4` |
| 5 | `--text-3` | kickers, hints, placeholders | `#8f877b` |
| 6 | `--surface` | the drawer background | `#151311` |
| 7 | `--font-display` | every serif headline, answer and body line | `'Fraunces Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` |
| 8 | `--font-ui` | kickers, buttons, hints, bars | `'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |

Optional ninth and tenth: `--o5-glow` if the glow should not be derived from the accent (the default is `radial-gradient(90% 60% at 80% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%)`), and `--accent-strong`/`--accent-soft`/`--on-accent` if classic components (`.btn.primary`, `.icon-btn`) appear on the page.

Compass itself changes only #1; everything else is the o5 dark default. A light-paper site would set `data-theme="light"` instead and get `--bg #f5f1e9`, `--text #171512`, `--text-2 #4a453d`, `--text-3 #6d665b`, `--surface #fbf8f2` and the 16% glow from o5.css, then set its own `--accent` (pick one dark enough to read on `#f5f1e9`; the light accents in §7 show the contrast Orbit considers enough on `#eef1f7`).

The shape of a theme object for a new site is the `Theme` above; only `orbA` has a visible effect today, so give it the colour you want as `--accent`.
