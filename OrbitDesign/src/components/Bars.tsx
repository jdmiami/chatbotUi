import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SPRING, transitionFor, useMotionLevel } from '../motion';
import { SqIcon } from './icons';

/**
 * The frame of a studio screen, extracted from Orbit's StudioApp: a top bar (the masthead and two
 * square buttons), the stage in the middle (the only part that moves) and a bottom bar (Back, Home,
 * Save draft). The screen logic that decides what each button does stays in the app; see
 * docs/07-layout-and-navigation.md for the exact rules.
 */

/** The fixed, full-screen root: top bar, stage and bottom bar in a three-row grid. */
export function Root({ view, children }: { view: string; children: ReactNode }) {
  return (
    <div className="st-root" data-view={view}>
      {children}
    </div>
  );
}

export function TopBar({
  kicker,
  mark,
  actions = true,
  onOptions,
  onGallery,
  optionsLabel = 'Options',
  galleryLabel = 'Your gallery',
  label = 'Studio',
}: {
  /** The small line over the masthead ("An Orbit studio · 18+"). */
  kicker: string;
  /** The masthead: the roman half and the italic half ("After", "Dark"). */
  mark: [string, string];
  /** Show the two square buttons (hidden on the gate). */
  actions?: boolean;
  onOptions?: () => void;
  onGallery?: () => void;
  optionsLabel?: string;
  galleryLabel?: string;
  /** The nav's accessible name. */
  label?: string;
}) {
  return (
    <header className="st-top">
      <div className="st-flag">
        <small>{kicker}</small>
        <b>
          {mark[0]} <i>{mark[1]}</i>
        </b>
      </div>
      {actions && (
        <nav className="st-top-actions" aria-label={label}>
          <button type="button" className="st-sq" aria-label={optionsLabel} onClick={onOptions}>
            <SqIcon name="options" />
          </button>
          <button type="button" className="st-sq" aria-label={galleryLabel} onClick={onGallery}>
            <SqIcon name="menu" />
          </button>
        </nav>
      )}
    </header>
  );
}

/**
 * The stage: one screen at a time. When `screenKey` changes the old screen leaves (sinking into a
 * blur) before the next rises in (AnimatePresence mode="wait"). A walking screen brings its own
 * scroller; every other screen is wrapped in one column (`.st-scroll`).
 */
export function Stage({ screenKey, walking = false, children }: { screenKey: string; walking?: boolean; children: ReactNode }) {
  const level = useMotionLevel();
  const full = level === 'full';
  return (
    <main className="st-stage" id="st-stage">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screenKey}
          className="st-view"
          initial={full ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? SPRING.smooth : transitionFor(level) }}
          exit={full ? { opacity: 0, y: -18, filter: 'blur(14px)', transition: { ...SPRING.smooth, stiffness: 260 } } : { opacity: 0, transition: transitionFor(level) }}
        >
          {walking ? children : <div className="st-scroll">{children}</div>}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

export function BottomBar({
  canBack,
  canHome,
  canSave,
  onBack,
  onHome,
  onSave,
  backLabel = 'Back',
  homeLabel = 'Home',
  saveLabel = 'Save draft',
}: {
  canBack: boolean;
  canHome: boolean;
  canSave: boolean;
  onBack: () => void;
  onHome: () => void;
  onSave: () => void;
  backLabel?: string;
  homeLabel?: string;
  saveLabel?: string;
}) {
  return (
    <footer className="st-bottom">
      <button type="button" className="st-bar-btn" onClick={onBack} disabled={!canBack}>
        <SqIcon name="back" /> <span>{backLabel}</span>
      </button>
      <button type="button" className="st-bar-btn" onClick={onHome} disabled={!canHome}>
        <SqIcon name="home" /> <span>{homeLabel}</span>
      </button>
      <button type="button" className="st-bar-btn" onClick={onSave} disabled={!canSave}>
        <SqIcon name="save" /> <span>{saveLabel}</span>
      </button>
    </footer>
  );
}
