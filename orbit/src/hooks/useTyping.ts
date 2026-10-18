import { useEffect } from 'react';

/** Text boxes in an app (not the orb's own, not editors that draw their own caret). */
function isTextBox(el: Element | null): boolean {
  if (!el || !el.closest('.app-window')) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * While you type in an app, <html data-typing> lets the machine banners at the top step aside so
 * what you write stays in view. When you leave the box they come back only after a quiet moment
 * (no taps or keys for 600 ms): popping back mid-tap would push the page down under your finger
 * and the tap would land on the wrong thing.
 */
export function useTyping() {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    let pending = false;
    const settle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        pending = false;
        if (!isTextBox(document.activeElement)) delete root.dataset.typing;
      }, 600);
    };
    const onIn = (e: FocusEvent) => {
      if (!isTextBox(e.target as Element)) return;
      clearTimeout(timer);
      pending = false;
      root.dataset.typing = '';
    };
    const onOut = () => {
      if (!('typing' in root.dataset)) return;
      pending = true;
      settle();
    };
    // Any tap or key while it is about to come back starts the quiet moment again.
    const onActivity = () => pending && settle();
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    window.addEventListener('pointerdown', onActivity, true);
    window.addEventListener('keydown', onActivity, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      window.removeEventListener('pointerdown', onActivity, true);
      window.removeEventListener('keydown', onActivity, true);
      delete root.dataset.typing;
    };
  }, []);
}
