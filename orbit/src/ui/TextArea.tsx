import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, ClipboardEventHandler, FocusEventHandler, ForwardedRef, KeyboardEventHandler, TextareaHTMLAttributes } from 'react';

/**
 * A multi-line text box.
 *
 * Chrome on iPhone and iPad treats every <textarea> as a form field and pins its passwords, cards and
 * addresses bar above the keyboard, covering the page. A plain editable block is not a form field, so
 * on that browser this renders one instead, with the same value, change, key and focus behaviour.
 * Everywhere else it is a normal <textarea>.
 */

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'children'> & { value: string };

/** Chrome on iOS ("CriOS"). `data-textbox="plain"` on <html> forces the plain box, for tests. */
export function isPlainTextBox(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.textbox === 'plain') return true;
  return typeof navigator !== 'undefined' && /CriOS/.test(navigator.userAgent);
}

export const TextArea = forwardRef(function TextArea(props: Props, ref: ForwardedRef<HTMLTextAreaElement>) {
  return isPlainTextBox() ? <PlainBox {...props} fwd={ref} /> : <textarea ref={ref} {...props} />;
});

/** Text of an editable block, the way a textarea would report it. */
function textOf(el: HTMLElement): string {
  const t = el.innerText ?? el.textContent ?? '';
  return t === '\n' ? '' : t;
}

function PlainBox({ value, onChange, onKeyDown, onPaste, onFocus, onBlur, className, placeholder, rows, maxLength, disabled, readOnly, style, fwd, id, ...rest }: Props & { fwd: ForwardedRef<HTMLTextAreaElement> }) {
  const el = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      el.current = node;
      if (node && !Object.getOwnPropertyDescriptor(node, 'value')) {
        // Callers read and write `.value` as on a textarea.
        Object.defineProperty(node, 'value', {
          configurable: true,
          get: () => textOf(node),
          set: (v: string) => void (node.textContent = v),
        });
      }
      const target = node as unknown as HTMLTextAreaElement | null;
      if (typeof fwd === 'function') fwd(target);
      else if (fwd) fwd.current = target;
    },
    [fwd],
  );

  // Show outside changes (cleared after send, a chip that fills the box) without moving the caret while typing.
  useLayoutEffect(() => {
    const node = el.current;
    if (node && textOf(node) !== value) node.textContent = value;
  }, [value]);

  const editable = !disabled && !readOnly;
  const a11y = rest as Record<string, unknown>;
  return (
    <div
      ref={setRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      aria-label={a11y['aria-label'] as string | undefined}
      aria-describedby={a11y['aria-describedby'] as string | undefined}
      aria-busy={a11y['aria-busy'] as boolean | undefined}
      aria-disabled={disabled || undefined}
      aria-readonly={readOnly || undefined}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      className={['ta-plain', className].filter(Boolean).join(' ')}
      style={{ ...style, ['--ta-rows' as string]: rows ?? 2 }}
      contentEditable={editable ? ('plaintext-only' as unknown as boolean) : false}
      suppressContentEditableWarning
      tabIndex={disabled ? -1 : 0}
      spellCheck={rest.spellCheck}
      autoCapitalize={rest.autoCapitalize}
      enterKeyHint={rest.enterKeyHint}
      inputMode="text"
      onInput={(e) => {
        const node = e.currentTarget;
        if (maxLength && textOf(node).length > maxLength) node.textContent = textOf(node).slice(0, maxLength);
        onChange?.({ target: node, currentTarget: node } as unknown as ChangeEvent<HTMLTextAreaElement>);
      }}
      onKeyDown={onKeyDown as unknown as KeyboardEventHandler<HTMLDivElement>}
      onPaste={(e) => {
        (onPaste as unknown as ClipboardEventHandler<HTMLDivElement>)?.(e);
        if (e.defaultPrevented) return;
        // Keep pasted text plain even where plaintext-only isn't supported.
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onFocus={onFocus as unknown as FocusEventHandler<HTMLDivElement>}
      onBlur={onBlur as unknown as FocusEventHandler<HTMLDivElement>}
    />
  );
}
