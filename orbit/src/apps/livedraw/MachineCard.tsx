import { motion } from 'motion/react';
import { useMotionLevel } from '../../motion/MotionProvider';
import { transitionFor } from '../../motion/springs';
import { OrbSpot } from '../../studio/Sheets';
import type { CanvasStatus } from '../../services/ai/liveCanvas';

const STEPS = [
  { id: 'off', label: 'Off' },
  { id: 'starting', label: 'Starting' },
  { id: 'downloading', label: 'Getting ready' },
  { id: 'on', label: 'On' },
] as const;

export const price = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)} an hour` : null);

export function autoOffNote(s: CanvasStatus | null): string {
  const m = s?.autoOffMinutes ?? s?.idle?.limitMinutes;
  return m ? `It turns itself off after ${m} minutes without drawing, so it never runs on for nothing.` : 'It turns itself off when you stop drawing, so it never runs on for nothing.';
}

/**
 * The drawing machine, before it is on: what it costs, Start, how starting goes (off → starting →
 * getting ready → on), and that it turns itself off. Calm: one question, one action.
 */
export function MachineCard({ status, error, powering, onStart, onLater }: { status: CanvasStatus | null; error: string | null; powering: boolean; onStart: () => void; onLater: () => void }) {
  const level = useMotionLevel();
  const state = status?.state ?? 'off';
  const waking = state === 'starting' || state === 'downloading';
  const at = Math.max(0, STEPS.findIndex((s) => s.id === state));
  const cost = price(status?.pricePerHour ?? status?.costPerHour);
  const headline =
    state === 'unconfigured' ? (
      <>
        The drawing machine <em>isn’t set up</em> yet.
      </>
    ) : waking ? (
      <>
        Your drawing machine is <em>waking up.</em>
      </>
    ) : (
      <>
        Draw, and watch it <em>become a picture.</em>
      </>
    );
  return (
    <motion.div
      className="ldx-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="ldx-card-t"
      initial={level === 'full' ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: transitionFor(level, 'bouncy') }}
    >
      <p className="o5-kicker">Live Draw · the drawing machine</p>
      <h2 className="ldx-card-t" id="ldx-card-t">
        {headline}
      </h2>
      <p className="ldx-card-dek">
        {state === 'unconfigured'
          ? 'Once it is, the picture appears under your lines while you draw.'
          : 'A machine of its own turns your lines into a picture underneath them, many times a second.'}
        {cost && state !== 'unconfigured' ? ` It costs ${cost} while it is on.` : ''}
      </p>
      {state !== 'unconfigured' && (
        <ol className="ldx-steps" aria-label="Starting">
          {STEPS.map((s, i) => (
            <li key={s.id} data-done={i < at || undefined} data-now={i === at || undefined} aria-current={i === at ? 'step' : undefined}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {(status?.detail || error) && (
        <p className="ldx-card-detail" role="status">
          {error ?? status?.detail}
        </p>
      )}
      {state !== 'unconfigured' && <p className="ldx-note">{autoOffNote(status)}</p>}
      <div className="ldx-card-go">
        {state !== 'unconfigured' && !waking && (
          <span className="ldx-go-wrap">
            <button type="button" className="btn primary ldx-go" onClick={onStart} disabled={powering}>
              {powering ? 'Starting…' : state === 'error' ? 'Try again' : 'Start'}
            </button>
            <OrbSpot size={44} className="ldx-go-spot" />
          </span>
        )}
        <button type="button" className="ldx-link" onClick={onLater}>
          {waking ? 'Draw while it starts' : 'Just draw for now'}
        </button>
      </div>
    </motion.div>
  );
}
