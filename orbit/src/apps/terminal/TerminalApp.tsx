import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AppProps } from '../types';
import { AppHeader, ConfirmSheet, DemoChip, IconButton, Segmented, Sheet, Toggle } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { connection, createTerminalBackend } from '../../services';
import type { TerminalBackend, TerminalSize, TerminalStatus } from '../../services/terminal/types';
import type { SimulatedShell } from '../../services/terminal/simulated/SimulatedShell';
import type { PtyBackend } from '../../services/terminal/pty/PtyBackend';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { useLayout } from '../../state/viewport';
import {
  FONT_MAX,
  FONT_MIN,
  TOUCH_KEYS,
  applyStickyCtrl,
  clampFontSize,
  ctrlTransform,
  keySequence,
  parseOsc7,
  terminalSummary,
  withAlpha,
  type TouchKey,
} from './termKeys';
import { lastLink, linkLabel, webLink } from './links';
import { attachTouchGestures } from './touchGestures';
import './terminal.css';

/**
 * Terminal: xterm.js on top of whichever TerminalBackend the service registry hands out
 * (a real tmux-backed PTY on the Linux machine, or the in-browser simulated shell in demo mode).
 *
 * The backend and the xterm instance live as long as the app is open; switching apps only changes
 * `placement`, so scrollback and the running shell survive.
 */

type Conn = { status: TerminalStatus; detail?: string };

const asSimulated = (b: TerminalBackend): SimulatedShell | null =>
  b.kind === 'simulated' ? (b as unknown as SimulatedShell) : null;
const asPty = (b: TerminalBackend): PtyBackend | null => (b.kind === 'pty' ? (b as unknown as PtyBackend) : null);

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** xterm theme from the design tokens (terminal colours + the user's accent for the cursor). */
function readTheme(): ITheme {
  const background = cssVar('--term-bg', '#0d1222');
  const foreground = cssVar('--term-fg', '#e6e9f2');
  const accent = cssVar('--accent', '#6c7cff');
  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: withAlpha(accent, 0.38) ?? '#6c7cff61',
    selectionInactiveBackground: withAlpha(accent, 0.22) ?? '#6c7cff38',
    // Default ANSI blues are too dark on the navy background; keep the rest of xterm's palette.
    blue: '#5c9dff',
    brightBlue: '#82b6ff',
    brightBlack: '#7d869e',
  };
}

/** "Reconnecting (attempt 2)…" from the PTY, or "Reconnecting… (simulated connection drop)". */
function reconnectText(detail?: string): string {
  if (!detail) return 'Reconnecting…';
  if (/^reconnecting/i.test(detail)) return detail;
  return `Reconnecting… (${detail.charAt(0).toLowerCase()}${detail.slice(1)})`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (non-secure contexts, older Safari)
  }
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.fontSize = '16px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.();
  return ok;
}

/** Keep focus (and the iOS keyboard) on the terminal when tapping a toolbar or key-row button. */
const keepFocus = (e: ReactPointerEvent | ReactMouseEvent) => e.preventDefault();

export default function TerminalApp({ placement, isActive, compact }: AppProps) {
  const fontSize = useShell((s) => clampFontSize(s.settings.terminalFontSize));
  const showKeys = useShell((s) => s.settings.terminalKeys);
  const typingBoxPref = useShell((s) => s.settings.terminalTypingBox);
  /** Fixed width in columns (0 = fit the screen). Wider than the screen → swipe sideways to pan. */
  const fixedCols = useShell((s) => s.settings.terminalColumns) || 0;
  const fixedColsRef = useRef(fixedCols);
  fixedColsRef.current = fixedCols;
  /** Where the visible part of a wide terminal is: left edge and width, as fractions of the whole. */
  const [panView, setPanView] = useState<{ left: number; width: number } | null>(null);
  const [coarse] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false);
  /** Type into a visible box above the keys (phones by default) instead of straight into xterm. */
  const { isPhone } = useLayout();
  const typingBox = typingBoxPref ?? (isPhone && coarse);
  const typingBoxRef = useRef(typingBox);
  typingBoxRef.current = typingBox;
  const composeRef = useRef<HTMLInputElement>(null);
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const setDraft = useCallback((v: string) => {
    draftRef.current = v;
    setDraftState(v);
  }, []);
  /** The shell is asking for a password: the typing box hides what is typed. */
  const [secretPrompt, setSecretPrompt] = useState(false);
  const accent = useShell((s) => s.settings.accent);
  const themePref = useShell((s) => s.settings.theme);
  const updateSettings = useShell((s) => s.updateSettings);
  const toast = useShell((s) => s.toast);

  // One backend per mounted Terminal app.
  const backendRef = useRef<TerminalBackend | null>(null);
  backendRef.current ??= createTerminalBackend();
  const backend = backendRef.current;
  const sim = asSimulated(backend);
  const pty = asPty(backend);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSize = useRef<TerminalSize | null>(null);
  const fitFrame = useRef(0);
  const ctrlRef = useRef(false);

  const [conn, setConn] = useState<Conn>({ status: 'connecting' });
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [kbFocused, setKbFocused] = useState(false);
  const [sheet, setSheet] = useState<null | 'more' | 'restart' | 'history'>(null);
  const [history, setHistory] = useState<{ status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string }>({
    status: 'loading',
  });
  const [cwd, setCwd] = useState<string | null>(null);
  const [commandTick, setCommandTick] = useState(0);
  const [persistent, setPersistent] = useState(true);
  const [slow, setSlow] = useState(false);
  const [restarting, setRestarting] = useState(false);
  /** The newest web address printed in the terminal (e.g. a sign-in link), for the "Open link" bar. */
  const [link, setLink] = useState<string | null>(null);
  const dismissedLink = useRef<string | null>(null);
  /** The newest address a program sent as a hidden full link (OSC 8), even if cut off on screen. */
  const oscLink = useRef<string | null>(null);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const outputTail = useRef('');
  /** What the error panel's Retry repeats. */
  const [retryKind, setRetryKind] = useState<'connect' | 'restart'>('connect');

  const setCtrl = useCallback((armed: boolean) => {
    ctrlRef.current = armed;
    setCtrlArmed(armed);
  }, []);

  /** All input (typed, pasted, key row) goes through here so sticky Ctrl applies uniformly. */
  const sendInput = useCallback(
    (data: string) => {
      const r = applyStickyCtrl(data, ctrlRef.current);
      if (r.armed !== ctrlRef.current) setCtrl(r.armed);
      if (r.data) backend.write(r.data);
      followCursorUntil.current = performance.now() + 800;
    },
    [backend, setCtrl],
  );

  /** Fit xterm to its box and tell the backend, skipping while hidden / zero-sized. */
  const fitNow = useCallback(() => {
    const host = hostRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!host || !term || !fit) return;
    if (host.clientWidth < 24 || host.clientHeight < 24) return;
    const dims = fit.proposeDimensions();
    if (!dims || !(dims.cols >= 2) || !(dims.rows >= 1)) return;
    const prevRows = term.rows;
    const fixed = fixedColsRef.current;
    if (fixed) {
      // Fixed width: rows still fit the screen; the columns may run past it (pan sideways).
      if (term.cols !== fixed || term.rows !== dims.rows) term.resize(fixed, dims.rows);
    } else {
      fit.fit();
      host.scrollLeft = 0;
    }
    requestAnimationFrame(() => updatePanRef.current());
    // Fewer rows (e.g. the on-screen keyboard opened): keep the newest line and the prompt in view.
    if (term.rows !== prevRows) term.scrollToBottom();
    const last = lastSize.current;
    if (!last || last.cols !== term.cols || last.rows !== term.rows) {
      lastSize.current = { cols: term.cols, rows: term.rows };
      backend.resize(lastSize.current);
    }
  }, [backend]);

  const scheduleFit = useCallback(() => {
    cancelAnimationFrame(fitFrame.current);
    fitFrame.current = requestAnimationFrame(() => fitNow());
  }, [fitNow]);

  const currentSize = useCallback((): TerminalSize => {
    fitNow();
    const term = termRef.current;
    return lastSize.current ?? { cols: term?.cols ?? 80, rows: term?.rows ?? 24 };
  }, [fitNow]);

  /** Recompute the sideways position bar (shown only when the terminal is wider than the screen). */
  const updatePan = useCallback(() => {
    const host = hostRef.current;
    if (!host || host.scrollWidth <= host.clientWidth + 2) {
      setPanView((v) => (v ? null : v));
      return;
    }
    const left = host.scrollLeft / host.scrollWidth;
    const width = host.clientWidth / host.scrollWidth;
    setPanView((v) => (v && Math.abs(v.left - left) < 0.002 && Math.abs(v.width - width) < 0.002 ? v : { left, width }));
  }, []);
  const updatePanRef = useRef(updatePan);
  updatePanRef.current = updatePan;

  /** Sideways pan for a wide terminal; false when everything already fits. */
  const panBy = useCallback(
    (dx: number) => {
      const host = hostRef.current;
      if (!host || host.scrollWidth <= host.clientWidth + 2) return false;
      host.scrollLeft -= dx;
      updatePan();
      return true;
    },
    [updatePan],
  );
  const panByRef = useRef(panBy);
  panByRef.current = panBy;
  const keepCursorInViewRef = useRef<() => void>(() => {});

  /** After you type, keep the cursor in view in a wide terminal (not during program redraws). */
  const followCursorUntil = useRef(0);
  const keepCursorInView = useCallback(() => {
    const host = hostRef.current;
    const term = termRef.current;
    const screen = host?.querySelector<HTMLElement>('.xterm-screen');
    if (!host || !term || !screen || host.scrollWidth <= host.clientWidth + 2) return;
    const cell = screen.clientWidth / term.cols;
    const x = term.buffer.active.cursorX * cell;
    if (x < host.scrollLeft + cell) host.scrollLeft = Math.max(0, x - 3 * cell);
    else if (x > host.scrollLeft + host.clientWidth - 3 * cell) host.scrollLeft = x - host.clientWidth + 6 * cell;
    else return;
    updatePan();
  }, [updatePan]);

  keepCursorInViewRef.current = keepCursorInView;

  /** Zoom a wide terminal out until its whole width fits the screen. */
  const fitWidth = () => {
    const host = hostRef.current;
    const screen = host?.querySelector<HTMLElement>('.xterm-screen');
    if (!host || !screen || !screen.clientWidth) return;
    const next = clampFontSize(Math.floor((fontSize * (host.clientWidth - 14)) / screen.clientWidth));
    updateSettings({ terminalFontSize: next });
    host.scrollLeft = 0;
  };

  /** The shell's history view is showing (after swiping back); offers "↓ Latest". */
  const [scrolledBack, setScrolledBack] = useState(false);
  const pendingScroll = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Swipe scrolling, batched to one message every ~40 ms. */
  const scrollBy = useCallback(
    (lines: number) => {
      pendingScroll.current += lines;
      if (scrollTimer.current) return;
      scrollTimer.current = setTimeout(() => {
        scrollTimer.current = undefined;
        const n = pendingScroll.current;
        pendingScroll.current = 0;
        if (!n) return;
        const p = asPty(backend);
        if (p) p.scroll(n);
        else termRef.current?.scrollLines(n); // simulated shell: xterm's own scrollback
      }, 40);
    },
    [backend],
  );
  const scrollByRef = useRef(scrollBy);
  scrollByRef.current = scrollBy;
  const openHistoryRef = useRef<() => void>(() => {});

  /**
   * Look for a web address in recent output. On the Linux machine this reads tmux's copy of the
   * screen, where an address that wrapped across lines is already joined back together.
   */
  const findLink = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    let text = '';
    const p = asPty(backend);
    if (p) {
      try {
        text = await p.history();
      } catch {
        return;
      }
    } else {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const s = line.translateToString(true);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += s;
        else lines.push(s);
      }
      text = lines.join('\n');
    }
    // Only recent output: an address from long ago (still in tmux's history) isn't what you want.
    const recent = text.replace(/\s+$/, '').split('\n').slice(-60).join('\n');
    let url = lastLink(recent, termRef.current?.cols ?? 0);
    // A program's hidden full link wins over the (possibly cut-off) text on screen.
    const osc = oscLink.current;
    if (osc && (!url || osc.startsWith(url) || recent.includes(osc.slice(0, 40)))) url = osc;
    if (url && url !== dismissedLink.current) setLink(url);
  }, [backend]);
  const findLinkRef = useRef(findLink);
  findLinkRef.current = findLink;

  // ------------------------------------------------------------------ xterm + backend lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontFamily: cssVar('--font-mono', 'ui-monospace, Menlo, Consolas, monospace'),
      fontSize: clampFontSize(useShell.getState().settings.terminalFontSize),
      lineHeight: 1.12,
      scrollback: 5000,
      cursorBlink: true,
      macOptionIsMeta: true,
      theme: readTheme(),
      // Tapping/clicking an underlined link a program printed (OSC 8) opens it directly.
      linkHandler: {
        activate: (_e, uri) => {
          if (webLink(uri)) window.open(uri, '_blank', 'noopener,noreferrer');
        },
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl+Shift combos are Orbit's own shortcuts (app switching etc.): never send them to the shell.
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey));

    const disposables = [
      term.onData((d) => sendInput(d)),
      term.onCursorMove(() => {
        if (performance.now() < followCursorUntil.current) keepCursorInViewRef.current();
      }),
      // OSC 7 = "current directory" (simulated shell, zsh, vte-enabled bash).
      term.parser.registerOscHandler(7, (d) => {
        const p = parseOsc7(d);
        if (p) setCwd(p);
        return true;
      }),
      // OSC 8 = hyperlink. Programs such as agy send the full address this way even when the text
      // on screen is cut off, so the Open link bar uses it. Returning false lets xterm draw the link.
      term.parser.registerOscHandler(8, (d) => {
        const uri = webLink(d.slice(d.indexOf(';') + 1));
        if (uri) {
          oscLink.current = uri;
          if (uri !== dismissedLink.current) setLink(uri);
        }
        return false;
      }),
      // OSC 133;D = "command finished" (shell integration).
      term.parser.registerOscHandler(133, (d) => {
        if (d.startsWith('D')) setCommandTick((n) => n + 1);
        return true;
      }),
    ];
    let secretTimer: ReturnType<typeof setTimeout> | undefined;
    const offOutput = backend.onOutput((d) => {
      term.write(d);
      // Is the line the cursor is on a password prompt? (sudo, ssh, passwd, gpg…)
      clearTimeout(secretTimer);
      secretTimer = setTimeout(() => {
        const b = term.buffer.active;
        const line = b.getLine(b.baseY + b.cursorY)?.translateToString(true) ?? '';
        setSecretPrompt(/(password|passphrase|passcode|\bpin)\b[^:\n]*:\s*$/i.test(line));
      }, 150);
      // An address may arrive split across chunks; keep a little of the previous one.
      const seen = outputTail.current + d;
      outputTail.current = seen.slice(-16);
      if (/https?:|:\/\//.test(seen)) {
        clearTimeout(linkTimer.current);
        linkTimer.current = setTimeout(() => void findLinkRef.current(), 600);
      }
    });

    // Touch: swipe to scroll (with momentum), pinch for text size, long-press to select and copy,
    // tap to type. See touchGestures.ts.
    let pinchFont = 0;
    const detachGestures = attachTouchGestures(host, {
      lineHeight: () => (host.clientHeight > 0 && term.rows > 0 ? host.clientHeight / term.rows : 18),
      scroll: (lines) => scrollByRef.current(lines),
      pinch: (scale, phase) => {
        if (phase === 'start') pinchFont = clampFontSize(useShell.getState().settings.terminalFontSize);
        if (phase !== 'move') return;
        const next = clampFontSize(Math.round(pinchFont * scale));
        if (next !== useShell.getState().settings.terminalFontSize) useShell.getState().updateSettings({ terminalFontSize: next });
      },
      longPress: () => openHistoryRef.current(),
      pan: (dx) => panByRef.current(dx),
      tap: () => {
        // In the typing box mode a tap puts you in the box (and keeps xterm's own hidden input,
        // which the phone can't keep in view, out of the way).
        if (!typingBoxRef.current) return false;
        composeRef.current?.focus();
        return true;
      },
    });
    const offStatus = backend.onStatus((status, detail) => {
      setConn({ status, detail });
      const p = asPty(backend);
      if (status === 'connected' && p) setPersistent(p.persistent);
    });

    const offScrollback = asPty(backend)?.onScrollback((active) => setScrolledBack(active)) ?? (() => {});
    const ta = term.textarea;
    const onFocus = () => setKbFocused(true);
    const onBlur = () => setKbFocused(false);
    ta?.addEventListener('focus', onFocus);
    ta?.addEventListener('blur', onBlur);

    lastSize.current = null;
    fitNow();
    const size = lastSize.current ?? { cols: term.cols, rows: term.rows };
    lastSize.current = size;
    setConn({ status: 'connecting' });
    backend.connect(size).catch((err: unknown) => setConn({ status: 'error', detail: messageOf(err) }));

    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(host);
    void document.fonts?.ready.then(() => scheduleFit());

    return () => {
      cancelAnimationFrame(fitFrame.current);
      clearTimeout(linkTimer.current);
      clearTimeout(secretTimer);
      detachGestures();
      offScrollback();
      clearTimeout(scrollTimer.current);
      ro.disconnect();
      ta?.removeEventListener('focus', onFocus);
      ta?.removeEventListener('blur', onBlur);
      disposables.forEach((d) => d.dispose());
      offOutput();
      offStatus();
      backend.disconnect();
      termRef.current = null;
      fitRef.current = null;
      // xterm 5.x queues a viewport sync (setTimeout) when it opens; disposing synchronously makes
      // that timer throw ("reading 'dimensions'"), e.g. under StrictMode's mount/unmount/mount.
      // Detach now so a re-mount gets a clean host, and dispose once those timers have run.
      term.element?.remove();
      setTimeout(() => term.dispose(), 100);
    };
  }, [backend, fitNow, scheduleFit, sendInput]);

  // Width setting changed: resize the terminal (and the machine's window) to it.
  useEffect(() => {
    scheduleFit();
  }, [fixedCols, scheduleFit]);

  // Live font size from Settings / the More sheet.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    scheduleFit();
  }, [fontSize, scheduleFit]);

  // Accent / theme changes: re-read tokens after the shell has applied them to <html>.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (termRef.current) termRef.current.options.theme = readTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [accent, themePref]);

  // Re-measure when shown again (size may have changed while hidden: rotation, split view…).
  const visible = placement !== 'hidden';
  useEffect(() => {
    if (!visible) return;
    scheduleFit();
    const t = setTimeout(scheduleFit, 320); // after the window's open transition
    return () => clearTimeout(t);
  }, [visible, placement, showKeys, scheduleFit]);

  // With a hardware keyboard / mouse, focus the terminal when the app comes to the front.
  useEffect(() => {
    if (isActive && window.matchMedia?.('(pointer: fine)').matches) termRef.current?.focus();
  }, [isActive]);

  // A connection that never answers must not spin silently forever.
  useEffect(() => {
    setSlow(false);
    if (conn.status !== 'connecting') return;
    const t = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(t);
  }, [conn.status]);

  // App Switcher summary.
  useEffect(() => {
    useWorkspace.getState().setSummary(
      'terminal',
      terminalSummary({
        mode: backend.kind === 'pty' ? 'host' : 'demo',
        status: conn.status,
        cwd: sim ? sim.cwdDisplay : cwd,
        commands: sim?.commandsRun,
        session: pty?.session,
        persistent,
      }),
    );
  }, [backend, sim, pty, conn.status, cwd, commandTick, persistent]);
  useEffect(() => () => useWorkspace.getState().setSummary('terminal', undefined), []);

  // ------------------------------------------------------------------ actions
  const reconnect = useCallback(async () => {
    setRetryKind('connect');
    backend.disconnect(); // stops pending retries / a hung attempt
    // The panel's button is about to disappear: put focus back in the terminal (still inside the
    // tap, so iOS also raises the keyboard, ready to type).
    termRef.current?.focus();
    termRef.current?.write('\r\n');
    try {
      await backend.connect(currentSize());
    } catch (err) {
      setConn({ status: 'error', detail: messageOf(err) });
    }
  }, [backend, currentSize]);

  const restart = useCallback(async () => {
    setSheet(null);
    setRetryKind('restart');
    setRestarting(true);
    backend.disconnect();
    const p = asPty(backend);
    if (p) {
      try {
        await p.endSession();
      } catch (err) {
        setRestarting(false);
        setConn({
          status: 'error',
          detail: `Couldn't end the old shell (${messageOf(err)}). It may still be running; Re-attach keeps using it.`,
        });
        return;
      }
    }
    // The old shell is gone: from here on a failure is a plain connection problem.
    setRetryKind('connect');
    termRef.current?.reset();
    setCwd(null);
    setRestarting(false);
    try {
      await backend.connect(currentSize());
    } catch (err) {
      setConn({ status: 'error', detail: messageOf(err) });
    }
  }, [backend, currentSize]);

  const retry = () => void (retryKind === 'restart' ? restart() : reconnect());

  const copy = async () => {
    const text = termRef.current?.getSelection() ?? '';
    if (!text) {
      // Touch screens can't drag-select in the terminal: open the text view, where the phone's
      // own selection (long-press, drag the handles) and Copy all / Copy screen work.
      if (coarse || compact) openHistory();
      else toast('Nothing selected. Drag across the text first, or use More → Show history.');
      return;
    }
    const ok = await writeClipboard(text);
    if (ok) {
      termRef.current?.clearSelection();
      toast('Copied', 'success');
    }
    else toast("Couldn't copy: the browser blocked clipboard access.", 'error');
  };

  const paste = async () => {
    let text: string;
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      text = await navigator.clipboard.readText();
    } catch {
      toast('Clipboard access was blocked. Tap the terminal, then long-press it and choose Paste (or press ⌘V).');
      return;
    }
    if (!text) {
      toast('The clipboard is empty.');
      return;
    }
    setCtrl(false); // a paste is never a Ctrl chord
    if (typingBoxRef.current) {
      // Into the typing box, so it can be checked before it runs.
      setDraft(draftRef.current + text);
      composeRef.current?.focus();
      return;
    }
    termRef.current?.paste(text); // honours bracketed paste; arrives through onData
    termRef.current?.scrollToBottom();
  };

  const toggleKeyboard = () => {
    if (typingBoxRef.current) {
      if (kbFocused) composeRef.current?.blur();
      else composeRef.current?.focus();
      return;
    }
    const term = termRef.current;
    if (!term) return;
    if (kbFocused) term.blur();
    else term.focus();
  };

  const pressKey = (k: TouchKey) => {
    if (k.kind === 'ctrl') {
      setCtrl(!ctrlRef.current);
      return;
    }
    if (k.kind === 'paste') {
      void paste();
      return;
    }
    const term = termRef.current;
    flushDraft(); // anything half-typed goes first, so the order is what you typed
    sendInput(keySequence(k.id, { appCursor: term?.modes.applicationCursorKeysMode }));
    term?.scrollToBottom();
  };

  /** Send the typing box's text as typed so far (no Return). */
  function flushDraft() {
    const v = draftRef.current;
    if (!v) return;
    setDraft('');
    sendInput(v);
  }

  const submitDraft = (e: FormEvent) => {
    e.preventDefault();
    const v = draftRef.current;
    setDraft('');
    sendInput(`${v}\r`); // an empty box still sends Return ("press Enter to continue")
    termRef.current?.scrollToBottom();
  };

  /** Keys with no text of their own, from a hardware keyboard or the phone's Delete key. */
  const onComposeKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const empty = draftRef.current === '';
    const appCursor = termRef.current?.modes.applicationCursorKeysMode;
    const arrows: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    let seq: string | null = null;
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) seq = keySequence(e.key === 'ArrowUp' ? 'shiftUp' : 'shiftDown');
    else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) seq = ctrlTransform(e.key);
    else if (e.key === 'Tab') seq = '\t';
    else if (e.key === 'Escape') seq = '\x1b';
    else if (empty && e.key === 'Backspace') seq = '\x7f';
    else if (empty && arrows[e.key]) seq = keySequence(arrows[e.key], { appCursor });
    if (seq === null) return;
    e.preventDefault();
    flushDraft();
    sendInput(seq);
  };

  const changeFont = (delta: number) => updateSettings({ terminalFontSize: clampFontSize(fontSize + delta) });

  const clearScreen = () => {
    termRef.current?.clearSelection();
    termRef.current?.clear();
    setSheet(null);
  };

  /** Earlier output as selectable text: tmux's full scrollback on the machine, or the simulated shell's buffer. */
  const openHistory = () => {
    setSheet('history');
    if (pty) {
      setHistory({ status: 'loading' });
      pty.history().then(
        (text) => setHistory({ status: 'ready', text }),
        (err: unknown) => setHistory({ status: 'error', message: messageOf(err) }),
      );
      return;
    }
    const buf = termRef.current?.buffer.active;
    const lines: string[] = [];
    if (buf) for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
    setHistory({ status: 'ready', text: lines.join('\n').replace(/\s+$/, '') + '\n' });
  };

  openHistoryRef.current = openHistory;

  /** What is on the terminal screen right now, as text. */
  const screenText = () => {
    const term = termRef.current;
    if (!term) return '';
    const b = term.buffer.active;
    const lines: string[] = [];
    for (let i = b.viewportY; i < b.viewportY + term.rows; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n').replace(/\s+$/, '') + '\n';
  };

  const selectAll = () => {
    termRef.current?.selectAll();
    setSheet(null);
    toast('All text selected. Tap Copy to copy it.');
  };

  // ------------------------------------------------------------------ render
  const status = conn.status;
  const inputEnabled = !restarting && (status === 'connected' || (status === 'reconnecting' && !!sim));

  const chip =
    connection.mode === 'demo' ? (
      <DemoChip text="Simulated" title="Commands run in this browser, not on your Linux machine." />
    ) : (
      <HostChip status={restarting ? 'connecting' : status} />
    );

  // Phones: the chip already says "Linux machine", so keep the subtitle short enough to fit.
  const subtitle = pty
    ? persistent
      ? compact
        ? `Runs in tmux session “${pty.session}”`
        : backend.label
      : compact
        ? 'Shell ends when you disconnect'
        : 'Linux machine · the shell ends when you disconnect'
    : backend.label;
  const shellEnded = !pty || pty.lastDisconnect === 'shell-exited' || /ended/i.test(conn.detail ?? '');

  return (
    <div className="term-root" data-placement={placement} data-compact={compact} data-phone={isPhone} data-wide={fixedCols > 0}>
      <AppHeader
        title="Terminal"
        subtitle={subtitle}
        chip={chip}
        actions={
          <>
            <IconButton
              icon="keyboard"
              label="Keyboard"
              pressed={kbFocused}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={toggleKeyboard}
            />
            <IconButton icon="more" label="More terminal options" onClick={() => setSheet('more')} />
          </>
        }
      />

      <div className="term-body">
        <div className="term-screen">
          <div className="term-host" ref={hostRef} />

          {link && (
            <div className="term-link" role="status" aria-label="Link printed in the terminal">
              <Icon name="link" size={18} />
              <span className="term-link-url" title={link}>
                {linkLabel(link)}
              </span>
              <a className="btn primary" href={link} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={16} />
                Open
              </a>
              <button
                type="button"
                className="btn ghost"
                aria-label="Copy link"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(link)
                    .then(() => toast('Link copied.'), () => toast("Couldn't copy the link. Open it instead.", 'error'))
                }
              >
                <Icon name="copy" size={16} />
              </button>
              <button
                type="button"
                className="btn ghost"
                aria-label="Hide link"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => {
                  dismissedLink.current = link;
                  setLink(null);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {panView && (
            <>
              <div className="term-panbar" aria-hidden>
                <span style={{ left: `${panView.left * 100}%`, width: `${panView.width * 100}%` }} />
              </div>
              <button
                type="button"
                className="term-fitwidth"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={fitWidth}
              >
                Fit width
              </button>
            </>
          )}

          {scrolledBack && (
            <button
              type="button"
              className="term-latest"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => asPty(backend)?.scrollToLatest()}
            >
              <Icon name="down" size={16} /> Latest
            </button>
          )}

          {restarting ? (
            <div className="term-overlay" role="status">
              <div className="term-overlay-card">
                <span className="term-spinner" aria-hidden />
                Restarting the shell…
              </div>
            </div>
          ) : status === 'connecting' ? (
            <div className="term-overlay" role="status">
              <div className="term-overlay-card">
                <div className="term-overlay-line">
                  <span className="term-spinner" aria-hidden />
                  {pty ? 'Connecting to your Linux machine…' : (conn.detail ?? 'Starting the simulated shell…')}
                </div>
                {slow && (
                  <>
                    <p className="term-overlay-note">This is taking longer than usual. Check that the machine is on.</p>
                    <button type="button" className="btn primary" onClick={() => void reconnect()}>
                      Try again
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {!restarting && status === 'reconnecting' && (
            <div className="term-banner" role="status">
              <span className="term-spinner small" aria-hidden />
              <span className="term-banner-text">
                {reconnectText(conn.detail)}
                {pty && persistent ? ' Your shell keeps running on the machine.' : ''}
              </span>
            </div>
          )}

          {!restarting && status === 'disconnected' && (
            <div className="term-panel" role="status">
              <div className="term-panel-icon" aria-hidden>
                <Icon name="wifiOff" size={22} />
              </div>
              <div className="term-panel-main">
                <h2 className="term-panel-title">{shellEnded ? 'Session ended' : 'Disconnected'}</h2>
                <p className="term-panel-text">
                  {!pty
                    ? 'The simulated shell exited. Reconnect starts a fresh one; files you saved are kept.'
                    : shellEnded
                      ? `The shell on your Linux machine ended (for example after “exit”). Reconnect starts a new one${persistent ? ` in tmux session “${pty.session}”` : ''}.`
                      : persistent
                        ? 'Your tmux session may still be running; Reconnect re-attaches to it (or starts a new shell if it ended).'
                        : 'Reconnect starts a new shell on your Linux machine.'}
                </p>
              </div>
              <button type="button" className="btn primary term-panel-btn" onClick={() => void reconnect()}>
                <Icon name="refresh" size={18} />
                Reconnect
              </button>
            </div>
          )}

          {!restarting && status === 'error' && (
            <div className="term-panel error" role="alert">
              <div className="term-panel-icon" aria-hidden>
                <Icon name="alert" size={22} />
              </div>
              <div className="term-panel-main">
                <h2 className="term-panel-title">
                  {retryKind === 'restart' ? "Couldn't restart the shell" : pty ? "Can't reach the shell" : 'Terminal problem'}
                </h2>
                <p className="term-panel-text">{conn.detail || 'Something went wrong with the terminal connection.'}</p>
              </div>
              <div className="term-panel-actions">
                <button type="button" className="btn primary term-panel-btn" onClick={retry}>
                  <Icon name="refresh" size={18} />
                  Retry
                </button>
                {retryKind === 'restart' && (
                  <button type="button" className="btn ghost term-panel-btn" onClick={() => void reconnect()}>
                    Re-attach instead
                  </button>
                )}
                {pty && retryKind === 'connect' && /reload/i.test(conn.detail ?? '') && (
                  <button type="button" className="btn ghost term-panel-btn" onClick={() => window.location.reload()}>
                    Reload Orbit
                  </button>
                )}
              </div>
            </div>
          )}
        </div>


        {showKeys && (
          <div className="term-keys" role="toolbar" aria-label="Terminal keys">
            {TOUCH_KEYS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`term-key${k.kind === 'paste' ? ' wide' : ''}`}
                aria-label={k.ariaLabel}
                title={k.ariaLabel}
                aria-pressed={k.kind === 'ctrl' ? ctrlArmed : undefined}
                disabled={!inputEnabled}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => pressKey(k)}
              >
                {k.kind === 'paste' ? <Icon name="paste" size={18} /> : null}
                <span aria-hidden>{k.label}</span>
              </button>
            ))}
          </div>
        )}

        {typingBox && (
          <form className="term-compose" onSubmit={submitDraft}>
            <input
              ref={composeRef}
              className="term-compose-input"
              type={secretPrompt ? 'password' : 'text'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposeKey}
              onFocus={() => setKbFocused(true)}
              onBlur={() => setKbFocused(false)}
              placeholder={secretPrompt ? 'Password (hidden), then Return' : 'Type here, then Return'}
              aria-label={secretPrompt ? 'Password for the terminal (hidden)' : 'Type into the terminal'}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              disabled={!inputEnabled}
            />
            <button
              type="submit"
              className="term-compose-send"
              aria-label={draft ? 'Send' : 'Send Return'}
              disabled={!inputEnabled}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
            >
              <Icon name="send" size={18} />
            </button>
            {kbFocused && (
              <button
                type="button"
                className="term-compose-hide"
                aria-label="Hide keyboard"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => composeRef.current?.blur()}
              >
                <Icon name="keyboard" size={18} />
              </button>
            )}
          </form>
        )}
      </div>

      {sheet === 'more' && (
        <Sheet title="Terminal options" onClose={() => setSheet(null)}>
          <div className="stack">
            <div className="list">
              <button
                type="button"
                className="row"
                onClick={() => {
                  setSheet(null);
                  void copy();
                }}
              >
                <Icon name="copy" />
                <span className="row-main">Copy selection</span>
              </button>
              <button
                type="button"
                className="row"
                disabled={!inputEnabled}
                onClick={() => {
                  setSheet(null);
                  void paste();
                }}
              >
                <Icon name="paste" />
                <span className="row-main">Paste</span>
              </button>
            </div>
            <div className="list">
              <div className="row">
                <div className="row-main">
                  <span className="row-title">Text size</span>
                  <span className="row-sub">Also in Settings</span>
                </div>
                <div className="term-stepper" role="group" aria-label="Terminal text size">
                  <button
                    type="button"
                    className="term-step"
                    aria-label="Smaller text"
                    disabled={fontSize <= FONT_MIN}
                    onClick={() => changeFont(-1)}
                  >
                    A−
                  </button>
                  <output className="term-step-value" aria-live="polite">
                    {fontSize} px
                  </output>
                  <button
                    type="button"
                    className="term-step big"
                    aria-label="Larger text"
                    disabled={fontSize >= FONT_MAX}
                    onClick={() => changeFont(1)}
                  >
                    A+
                  </button>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <span className="row-title">Touch key row</span>
                  <span className="row-sub">Esc, Tab, Ctrl, arrows and symbols</span>
                </div>
                <Toggle
                  checked={showKeys}
                  onChange={(v) => updateSettings({ terminalKeys: v })}
                  label="Show touch key row"
                />
              </div>
              <div className="row">
                <div className="row-main">
                  <span className="row-title">Typing box</span>
                  <span className="row-sub">Type above the keys, then Return. Off: type straight into the terminal.</span>
                </div>
                <Toggle
                  checked={typingBox}
                  onChange={(v) => updateSettings({ terminalTypingBox: v })}
                  label="Use the typing box"
                />
              </div>
              <div className="row term-width-row">
                <div className="row-main">
                  <span className="row-title">Width</span>
                  <span className="row-sub">
                    Fit the screen, or a fixed number of columns: swipe sideways to see the rest, pinch or Fit width to
                    zoom out.
                  </span>
                </div>
                <Segmented
                  label="Terminal width"
                  value={fixedCols ? String(fixedCols) : 'fit'}
                  options={[
                    { value: 'fit', label: 'Fit' },
                    { value: '80', label: '80' },
                    { value: '100', label: '100' },
                    { value: '120', label: '120' },
                    { value: '160', label: '160' },
                  ]}
                  onChange={(v) => updateSettings({ terminalColumns: v === 'fit' ? 0 : Number(v) })}
                />
              </div>
            </div>

            <div className="list">
              <button type="button" className="row" onClick={openHistory}>
                <Icon name="history" size={20} />
                <span className="row-main">
                  <span className="row-title">Show history</span>
                  <span className="row-sub">Scroll back, select and copy earlier output</span>
                </span>
              </button>
              <button type="button" className="row" onClick={clearScreen}>
                <Icon name="text" size={20} />
                <span className="row-main">
                  <span className="row-title">Clear screen</span>
                </span>
              </button>
              <button type="button" className="row" onClick={selectAll}>
                <Icon name="copy" size={20} />
                <span className="row-main">
                  <span className="row-title">Select all</span>
                  <span className="row-sub">Then tap Copy</span>
                </span>
              </button>
              <button
                type="button"
                className="row term-row-danger"
                onClick={() => (pty ? setSheet('restart') : void restart())}
                disabled={restarting}
              >
                <Icon name="refresh" size={20} />
                <span className="row-main">
                  <span className="row-title">Restart shell</span>
                  <span className="row-sub">
                    {pty ? 'Ends the running shell and starts a new one' : 'Starts a fresh simulated session'}
                  </span>
                </span>
              </button>
              {sim && (
                <button
                  type="button"
                  className="row"
                  disabled={status !== 'connected'}
                  onClick={() => {
                    sim.simulateDrop();
                    setSheet(null);
                  }}
                >
                  <Icon name="wifiOff" size={20} />
                  <span className="row-main">
                    <span className="row-title">Simulate connection drop</span>
                    <span className="row-sub">Demo only: preview how a lost connection looks</span>
                  </span>
                </button>
              )}
            </div>

            <p className="list-caption term-caption">
              {pty
                ? persistent
                  ? `Runs on your Linux machine in tmux session “${pty.session}”, so it keeps running if you close Orbit or lose signal.`
                  : 'Runs on your Linux machine. Disconnecting ends this shell.'
                : 'Simulated shell: commands run in this browser, not on your Linux machine. Files are the demo project saved in this browser.'}{' '}
              With a hardware keyboard, Ctrl keys go to the shell; Ctrl+Shift shortcuts belong to Orbit.
            </p>
          </div>
        </Sheet>
      )}

      {sheet === 'history' && (
        <Sheet
          title="Select and copy"
          onClose={() => setSheet(null)}
          footer={
            <div className="term-history-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={history.status !== 'ready'}
                onClick={() => {
                  if (history.status !== 'ready') return;
                  void writeClipboard(history.text).then((ok) =>
                    toast(ok ? 'History copied' : "Couldn't copy: the browser blocked clipboard access.", ok ? 'success' : 'error'),
                  );
                }}
              >
                <Icon name="copy" size={18} /> Copy all
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void writeClipboard(screenText()).then((ok) =>
                    toast(ok ? 'Screen copied' : "Couldn't copy: the browser blocked clipboard access.", ok ? 'success' : 'error'),
                  )
                }
              >
                Copy screen
              </button>
              <button type="button" className="btn primary" onClick={() => setSheet(null)}>
                Done
              </button>
            </div>
          }
        >
          {history.status === 'loading' && (
            <p className="muted" role="status">
              Loading history…
            </p>
          )}
          {history.status === 'error' && (
            <p role="alert">
              Couldn&apos;t load the history: {history.message}{' '}
              <button type="button" className="btn ghost small" onClick={openHistory}>
                Retry
              </button>
            </p>
          )}
          {history.status === 'ready' && <HistoryText text={history.text} />}
        </Sheet>
      )}

      {sheet === 'restart' && (
        <ConfirmSheet
          title="Restart shell?"
          message="Ends the running shell and everything in it, including programs still running in its tmux session, then starts a new shell."
          confirmLabel="Restart"
          destructive
          onConfirm={() => void restart()}
          onCancel={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** Host-mode chip: the real connection state (no demo chip in host mode). */
function HostChip({ status }: { status: TerminalStatus }) {
  const map: Record<TerminalStatus, { cls: string; text: string }> = {
    connected: { cls: 'ok', text: 'Linux machine' },
    connecting: { cls: 'info', text: 'Connecting…' },
    reconnecting: { cls: 'info', text: 'Reconnecting…' },
    disconnected: { cls: '', text: 'Disconnected' },
    error: { cls: 'error', text: 'Not connected' },
  };
  const m = map[status];
  return (
    <span className={`chip ${m.cls}`}>
      <span className="dot" aria-hidden />
      {m.text}
    </span>
  );
}

/** Selectable, scrollable text (long-press to select on iPhone), scrolled to the newest output. */
function HistoryText({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre ref={ref} className="term-history" tabIndex={0} aria-label="Terminal history">
      {text.trim() ? text : 'No output yet.'}
    </pre>
  );
}
