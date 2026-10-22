import { AnimatePresence, motion } from 'motion/react';
import { SPRING, transitionFor, useMotionLevel } from '../motion';
import type { Choice } from '../flow/defs';
import { OrbSpot } from './Sheets';

/**
 * The answers to one question, each its own piece on a spring. They come in one after another out of
 * a blur; pick one and it lifts while the others leave one by one, and (with `layoutPrefix`) it then
 * flies on into the trail of answers above.
 */
export function Choices({
  items,
  picked,
  onPick,
  layoutPrefix,
  delay = 0.08,
  label = 'Answers',
  recommended,
}: {
  items: Choice[];
  picked: string | null;
  onPick: (label: string) => void;
  /** The picked answer carries `${layoutPrefix}` as its layout id, so it can fly to where it lands. */
  layoutPrefix?: string;
  /** Seconds before the first answer arrives (after the question). */
  delay?: number;
  label?: string;
  /** The orb's pick: marked, and the orb sits on it until you choose. */
  recommended?: string | null;
}) {
  const level = useMotionLevel();
  const full = level === 'full';
  const shown = picked ? items.filter((c) => c.label === picked) : items;
  return (
    <ul className="st-choices" aria-label={label}>
      <AnimatePresence initial custom={0}>
        {shown.map((c) => {
          const i = items.indexOf(c);
          const chosen = picked === c.label;
          const rec = picked === null && recommended === c.label;
          return (
            <motion.li
              key={c.label}
              layoutId={chosen && layoutPrefix ? layoutPrefix : undefined}
              layout={full ? 'position' : false}
              custom={i}
              initial={full ? { opacity: 0, y: 26, filter: 'blur(10px)' } : { opacity: 0 }}
              animate={
                chosen && full
                  ? { opacity: 1, y: 0, scale: 1.03, filter: 'blur(0px)', transition: SPRING.playful }
                  : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay: delay + i * 0.055 } : transitionFor(level) }
              }
              exit={
                full
                  ? { opacity: 0, x: -36, filter: 'blur(12px)', transition: { ...SPRING.smooth, delay: i * 0.04 } }
                  : { opacity: 0, transition: transitionFor(level) }
              }
            >
              <motion.button
                type="button"
                className="st-choice"
                data-rec={rec || undefined}
                aria-pressed={chosen}
                disabled={picked !== null}
                onClick={() => onPick(c.label)}
                whileTap={full && picked === null ? { scale: 0.97 } : undefined}
              >
                {rec && <span className="st-rec">The orb’s pick</span>}
                <span className="st-lb">{c.label}</span>
                {c.hint && <span className="st-ht">{c.hint}</span>}
                {(chosen || rec) && <OrbSpot size={40} className="st-choice-spot" />}
              </motion.button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
