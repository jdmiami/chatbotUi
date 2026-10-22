/**
 * OrbitDesign motion: one physical world for every screen. See docs/05-motion.md.
 *
 *   import 'orbit-design/motion/motion.css';   // springs as linear() easings, depth shadows, presses, Off
 *   import 'orbit-design/motion/depth.css';    // optional: the --p / --ap and data-chrome consumers
 */
export { ios, SPRING, transitionFor, type SpringName } from './springs';
export { resolveLevel, cachedProbe, measureFrames, rememberProbe, type MotionLevel, type MotionPref } from './level';
export { MotionProvider, useMotionLevel, useSpringTransition, type MotionProviderProps } from './MotionProvider';
export { useMediaQuery } from './useMediaQuery';
export { springValue, type SpringParams } from './physics';
export { cue, tick, configureFeedback, feedbackConfig, type Cue, type FeedbackConfig } from './feedback';
export { configureMorph, cancelMorph, iconRect, morphIn, morphOut, homeDrag, homeFling, homeCancel, pageTurnIn, pageTurnOut, type MorphConfig } from './morph';
export { startTilt, tiltNeedsPermission, requestTiltPermission, recentTap } from './tilt';
export { useTilt } from './useTilt';
export { useScrollDepth } from './depth';
export { useChromeOnScroll } from './chrome';
