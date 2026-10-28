import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, ClipboardEventHandler, FocusEventHandler, ForwardedRef, InputHTMLAttributes, KeyboardEventHandler, TextareaHTMLAttributes } from 'react';

/**
 * Text boxes that keep the iPhone keyboard small.
 *
 * iPhones and iPads treat every <textarea> and <input> as a form field: Safari pins its ∧ ∨ Done bar
 * above the keyboard (and, from Safari 26, floats AutoFill and hide-keyboard buttons over the page),
 * Chrome pins a passwords, cards and addresses bar. Both make the keyboard taller and cover what you
 * type. A plain editable block is not a form field, so on those devices these render one instead, with
 * the same value, change, key and focus behaviour. Everywhere else they are a normal <textarea> / <input>.
 *
 *   <TextArea>   many lines (a description, a message)
 *   <TextField>  one line (a name, what to replace): Enter is "done" and never adds a line
 */

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'children'> & { value: string };
type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'children' | 'type'> & { value: string };

/** An iPhone or iPad (Safari or Chrome). `data-textbox="plain"` on <html> forces the plain box, for tests. */
export function isPlainTextBox(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.textbox === 'plain') return true;
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod|CriOS/.test(navigator.userAgent)) return true;
  // An iPad asking for desktop pages says it is a Mac; a Mac has no touch screen.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

export const TextArea = forwardRef(function TextArea(props: Props, ref: ForwardedRef<HTMLTextAreaElement>) {
  return isPlainTextBox() ? <PlainBox {...props} fwd={ref} /> : <textarea ref={ref} {...props} />;
});

export const TextField = forwardRef(function TextField(props: FieldProps, ref: ForwardedRef<HTMLInputElement>) {
  if (!isPlainTextBox()) return <input ref={ref} type="text" {...props} />;
  const { onChange, onKeyDown, onPaste, onFocus, onBlur, ...rest } = props as unknown as Props;
  return <PlainBox {...rest} onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} onFocus={onFocus} onBlur={onBlur} rows={1} single fwd={ref as unknown as ForwardedRef<HTMLTextAreaElement>} />;
});

/** Text of an editable block, the way a textarea would report it. */
function textOf(el: HTMLElement): string {
  const t = el.innerText ?? el.textContent ?? '';
  return t === '\n' ? '' : t;
}

function PlainBox({ value, onChange, onKeyDown, onPaste, onFocus, onBlur, className, placeholder, rows, maxLength, disabled, readOnly, style, fwd, id, single = false, ...rest }: Props & { fwd: ForwardedRef<HTMLTextAreaElement>; single?: boolean }) {
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
  const clean = (t: string) => {
    const one = single ? t.replace(/[\r\n]+/g, ' ') : t;
    return maxLength && one.length > maxLength ? one.slice(0, maxLength) : one;
  };
  // What the box holds, reported as a change. iOS applies a pending autocorrection when focus leaves
  // (and a composition ends) without always saying so: take whatever is there at those moments.
  const report = (node: HTMLDivElement) => {
    const t = textOf(node);
    const fixed = clean(t);
    if (fixed !== t) node.textContent = fixed;
    if (fixed !== value) onChange?.({ target: node, currentTarget: node } as unknown as ChangeEvent<HTMLTextAreaElement>);
  };
  return (
    <div
      ref={setRef}
      id={id}
      role="textbox"
      aria-multiline={single ? undefined : 'true'}
      aria-label={a11y['aria-label'] as string | undefined}
      aria-describedby={a11y['aria-describedby'] as string | undefined}
      aria-busy={a11y['aria-busy'] as boolean | undefined}
      aria-disabled={disabled || undefined}
      aria-readonly={readOnly || undefined}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      // The same attribute a textarea carries, for anything that reads it (tests, the orb).
      {...{ placeholder }}
      className={['ta-plain', single ? 'ta-line' : null, className].filter(Boolean).join(' ')}
      style={{ ...style, ['--ta-rows' as string]: rows ?? 2 }}
      contentEditable={editable ? ('plaintext-only' as unknown as boolean) : false}
      suppressContentEditableWarning
      tabIndex={disabled ? -1 : 0}
      spellCheck={rest.spellCheck}
      autoCapitalize={rest.autoCapitalize}
      enterKeyHint={rest.enterKeyHint ?? (single ? 'done' : undefined)}
      inputMode={rest.inputMode ?? 'text'}
      onInput={(e) => {
        const node = e.currentTarget;
        const t = textOf(node);
        const fixed = clean(t);
        if (fixed !== t) node.textContent = fixed;
        onChange?.({ target: node, currentTarget: node } as unknown as ChangeEvent<HTMLTextAreaElement>);
      }}
      onCompositionEnd={(e) => report(e.currentTarget)}
      onKeyDown={(e) => {
        // One line: Enter means done, like the keyboard's key says.
        if (single && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        (onKeyDown as unknown as KeyboardEventHandler<HTMLDivElement>)?.(e);
      }}
      onPaste={(e) => {
        (onPaste as unknown as ClipboardEventHandler<HTMLDivElement>)?.(e);
        if (e.defaultPrevented) return;
        // Keep pasted text plain even where plaintext-only isn't supported.
        e.preventDefault();
        document.execCommand('insertText', false, clean(e.clipboardData.getData('text/plain')));
      }}
      onFocus={onFocus as unknown as FocusEventHandler<HTMLDivElement>}
      onBlur={(e) => {
        report(e.currentTarget);
        (onBlur as unknown as FocusEventHandler<HTMLDivElement>)?.(e);
      }}
    />
  );
}
