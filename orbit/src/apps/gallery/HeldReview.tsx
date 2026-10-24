import { useRef, useState } from 'react';
import { Censor } from '../../ui/Censor';
import { ConfirmSheet } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { TextArea } from '../../ui/TextArea';
import { useShell } from '../../state/shell';
import type { LocalAi } from '../../services/ai/LocalAi';
import { approveHeld, noteHeld, type HeldItem } from '../../services/ai/HeldReview';
import { DevelopImg, GalleryViewer, type GalleryMedia } from '../ai/Gallery';

/**
 * Held for review: results the AI machine set aside instead of showing (the safety check could not look,
 * or it flagged adult content where that is not allowed). Only the owner gets this list. Every preview is
 * blurred: keep a finger on it to see it. You can approve one (it goes back to that person's gallery,
 * still marked NSFW) or keep it held with a note. There is no delete here: that is your separate decision.
 */
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const firstFrame = (url: string) => (url.includes('#') ? url : `${url}#t=0.1`);
const media = (h: HeldItem): GalleryMedia => ({ id: h.id, kind: h.kind, url: h.url, label: h.prompt || 'Held result', nsfw: true, seconds: h.seconds });

export function HeldReview({ items, ai, machineOn, onChanged }: { items: HeldItem[]; ai: LocalAi; machineOn: boolean; onChanged: () => void }) {
  const toast = useShell((s) => s.toast);
  const [viewing, setViewing] = useState<string | null>(null);
  const viewFrom = useRef<DOMRect | null>(null);
  const [confirm, setConfirm] = useState<HeldItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const approve = async (h: HeldItem) => {
    setBusy(h.id);
    try {
      await approveHeld(ai, machineOn, h.id);
      toast("Approved: it is back in that person's gallery, still marked NSFW.", 'success');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const keepHeld = async (h: HeldItem) => {
    const text = (notes[h.id] ?? '').trim();
    if (!text) {
      toast('Kept held. Add a note if you want to remember why.', 'info');
      return;
    }
    setBusy(h.id);
    try {
      await noteHeld(ai, machineOn, h.id, text);
      setNotes((n) => ({ ...n, [h.id]: '' }));
      toast('Kept held, with your note.', 'success');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = viewing ? (items.find((x) => x.id === viewing) ?? null) : null;
  const index = open ? items.findIndex((x) => x.id === open.id) : -1;

  return (
    <section className="held" aria-label="Held for review">
      <p className="held-intro">
        These were set aside instead of going to a gallery. Nothing here is deleted. Every picture is blurred: keep a finger on it to see it.
      </p>
      <ul className="held-list">
        {items.map((h) => (
          <li key={h.id} className="held-card" data-testid="held-item">
            <Censor as="div" nsfw className="held-thumb">
              <button
                type="button"
                className="ai-tile"
                aria-label={`Held ${h.kind === 'video' ? 'video' : 'picture'}: ${h.prompt || 'no description'}`}
                onClick={(e) => {
                  viewFrom.current = (e.currentTarget.querySelector('img, video') ?? e.currentTarget).getBoundingClientRect();
                  setViewing(h.id);
                }}
              >
                {h.kind === 'image' ? (
                  <DevelopImg src={h.url} alt="" loading="lazy" />
                ) : (
                  <>
                    <video src={firstFrame(h.url)} muted playsInline preload="metadata" />
                    <span className="ai-tile-badge">
                      <Icon name="play" size={14} /> {h.seconds ? `${Math.round(h.seconds)}s` : ''}
                    </span>
                  </>
                )}
              </button>
            </Censor>
            <div className="held-body">
              <p className="held-kicker">
                Made by {h.madeBy}
                {h.character ? ` · character: ${h.character.name}` : ''}
                {h.heldAt ? ` · held ${when(h.heldAt)}` : ''}
              </p>
              <p className="held-reason">
                <strong>Why:</strong> {h.reason}
              </p>
              {h.prompt && (
                <Censor as="div" text nsfw>
                  <p className="held-prompt">{h.prompt}</p>
                </Censor>
              )}
              {h.notes.length > 0 && (
                <ul className="held-notes" aria-label="Your notes">
                  {h.notes.map((n, i) => (
                    <li key={i}>
                      {n.text} <span className="ai-muted">{when(n.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!h.canApprove && <p className="ai-muted">It can't be approved: it has a real person's photo, or a video that was not made here. It stays held.</p>}
              <label className="held-note">
                <span className="ai-muted">Note (why it stays held)</span>
                <TextArea
                  rows={2}
                  maxLength={1000}
                  value={notes[h.id] ?? ''}
                  placeholder="Optional"
                  aria-label={`Note for ${h.prompt || 'this result'}`}
                  onChange={(e) => setNotes((n) => ({ ...n, [h.id]: e.target.value }))}
                />
              </label>
              <div className="held-actions">
                {h.canApprove && (
                  <button type="button" className="btn primary" disabled={busy === h.id} onClick={() => setConfirm(h)}>
                    <Icon name="check" size={16} /> Approve
                  </button>
                )}
                <button type="button" className="btn" disabled={busy === h.id} onClick={() => void keepHeld(h)}>
                  Keep held
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {open && (
        <GalleryViewer
          media={media(open)}
          title="Held result"
          origin={viewFrom.current}
          lockNsfw
          onClose={() => setViewing(null)}
          onPrev={index > 0 ? () => setViewing(items[index - 1].id) : null}
          onNext={index >= 0 && index < items.length - 1 ? () => setViewing(items[index + 1].id) : null}
          position={index >= 0 ? { index, count: items.length } : undefined}
          words={open.prompt ? <p className="ai-viewer-prompt">{open.prompt}</p> : undefined}
        >
          <p className="ai-muted gallery-meta">
            {open.reason} Made by {open.madeBy}
            {open.character ? ` · character: ${open.character.name}` : ''}.
          </p>
        </GalleryViewer>
      )}
      {confirm && (
        <ConfirmSheet
          title="Approve this?"
          message={`It goes back into ${confirm.madeBy === 'You' ? 'your' : "that studio member's"} gallery. It stays marked NSFW, so it is still blurred until held.`}
          confirmLabel="Approve"
          onConfirm={() => {
            const h = confirm;
            setConfirm(null);
            setViewing(null);
            void approve(h);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
