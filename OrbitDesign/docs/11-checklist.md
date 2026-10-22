# 11 · Checklist before a screen ships

Run through every line for every new screen. These are the things that, when missed, make a screen
stop feeling like Orbit.

## Look

- [ ] One kicker, one headline, at most one dek. The headline uses `*asterisks*` for the italic
      accent half and is set in `--font-display`.
- [ ] Content sits between hairlines (`--o5-hair`). No card borders, no filled boxes, no rounded
      corners in the magazine skin (`data-skin="o5"`).
- [ ] Exactly one primary action per screen (`.st-go`, solid ink, uppercase, letter-spaced). All
      other actions are underlined text buttons.
- [ ] Inputs are a single underline; the focus ring is removed and replaced by the underline turning
      accent (`.st-own input:focus`).
- [ ] Icons are from the square line set (`SqIcon`), one stroke weight, never filled.
- [ ] Colours come only from tokens. No hex values in component CSS.
- [ ] The accent is used for: italic headline half, the orb's light, hover on the primary button,
      the "The orb's pick" kicker, the says-line rule. Nowhere else.

## Motion

- [ ] Every element that appears does so on a named spring via `transitionFor(level, name)`.
      No raw `duration:` values except the Lite/Off fallbacks inside `transitionFor`.
- [ ] Lists arrive staggered (`delay + i * 0.055`) out of a blur (`blur(10px)`, `y: 26`).
- [ ] Leaving elements exit one by one (`x: -36`, `blur(12px)`, `delay i * 0.04`), never as a block.
- [ ] A picked item lifts (`scale: 1.03`, `playful`) and, where it lands somewhere, flies there
      with a shared `layoutId`.
- [ ] Screen changes use the stage crossfade (`AnimatePresence mode="wait"`, blur 14 px, y 28/−18).
- [ ] The current item has no `data-depth`; finished items do, inside a scroller with
      `useScrollDepth`.
- [ ] Tested at Motion Full, Lite and Off (`data-motion` on `<html>`): nothing jumps at Off, nothing
      bounces at Lite.
- [ ] Nothing animates `width`, `height`, `top`, `left`, `margin` or `padding`.

## The orb

- [ ] The one thing the screen wants next carries `data-orb-spot` (and `data-orb-size` when it is
      not the default 56 px): the headline while reading, the recommended answer while choosing, the
      primary button when the page is done.
- [ ] No element positions the orb by hand. The orb finds `[data-orb-*]` on its own.
- [ ] The screen sets `document.documentElement.dataset.orbContext` to a one-paragraph description
      of where the user is and what the controls do, so an adapter (if any) can explain the screen.
- [ ] The orb's note (`orbNote`) is set for the screen and cleared on leave. It never speaks on its
      own (`orbSay` is reserved for genuine interruptions such as an error).
- [ ] Every forward or backward step dispatches `orbHome()` so a dragged orb returns.
- [ ] Text boxes work with the orb as caret: the box is a real `<input>` or `<textarea>`, not a
      contenteditable with transforms.

## Phones and tablets

- [ ] 390 × 844 (iPhone), 430 × 932, 768 × 1024 and 1024 × 768 (iPad) all checked in a browser.
- [ ] With the keyboard open, the primary action and the input stay reachable (`useVisualViewport`).
- [ ] No horizontal scroll at any width. Long words break (`overflow-wrap: anywhere` on labels).
- [ ] Touch targets are at least 44 px tall. Underlined text buttons have `min-height: 44px`.
- [ ] Safe-area insets respected in the top and bottom bars.
- [ ] The bottom bar's Back does what the state diagram in `07-layout-and-navigation.md` says for
      this view.

## Words

- [ ] Labels read as spoken sentences. No "Submit", "OK", "Error 500".
- [ ] Busy states say what is happening ("The writer is thinking of more…", "Warming up the studio").
- [ ] Errors say what happened and what to do, in one line, in `.st-error`.
- [ ] Nothing in the interface names a vendor, a model, a machine or a token.

## Accessibility

- [ ] Headline has an `id` and the section uses `aria-labelledby`.
- [ ] Lists of answers are `<ul aria-label>`; the chosen one has `aria-pressed="true"`.
- [ ] Decorative spots are `role="presentation"` (never `aria-hidden` on something the orb reads).
- [ ] Live regions (`aria-live="polite"`) on threads and status lines.
- [ ] Keyboard: Escape closes drawers; Enter submits own words; the orb can be opened with
      Shift+click or the keyboard.

## Before merging

- [ ] Typecheck passes.
- [ ] Screenshots at the four sizes above, at Motion Full, saved with the change.
- [ ] If the screen adds a step to a walkthrough, the engine tests cover its `when`, its `meta`
      flag and its `suits` words.
