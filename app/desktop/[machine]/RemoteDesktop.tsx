'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as G from 'guacamole-common-js';

type Phase = 'connecting' | 'connected' | 'disconnected' | 'error';

const KEY = {
  ctrl: 0xffe3,
  alt: 0xffe9,
  del: 0xffff,
  win: 0xffeb,
};

// Guacamole status codes worth explaining in plain words.
function describeError(status: G.Status, name: string): string {
  switch (status.code) {
    case 0x0201: // SERVER_BUSY
      return `${name} is busy or too many sessions are open.`;
    case 0x0202: // UPSTREAM_TIMEOUT
    case 0x0207: // UPSTREAM_NOT_FOUND
      return `Could not reach ${name}. Is it running, and is its gateway up?`;
    case 0x0203: // UPSTREAM_ERROR
      return `${name} refused the connection.`;
    case 0x0301: // CLIENT_UNAUTHORIZED
    case 0x0303: // CLIENT_FORBIDDEN
      return `${name} rejected the username or password configured on its gateway.`;
    case 0x0308: // CLIENT_TIMEOUT
      return 'The session timed out.';
    case 0x0209: // SESSION_CONFLICT
      return `Someone else signed in to ${name}, so this session was ended.`;
    case 0x0205: // SESSION_CLOSED
      return `The session was closed by ${name}.`;
    default:
      return status.message ? `Connection error: ${status.message}` : 'The connection was lost.';
  }
}

type Machine = { id: string; name: string; os: 'windows' | 'linux' };

export default function RemoteDesktop({
  machine,
  canSwitch,
  logout,
}: {
  machine: Machine;
  canSwitch: boolean;
  logout: () => Promise<void>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<G.Client | null>(null);
  const guacRef = useRef<typeof G | null>(null);
  const sinkRef = useRef<G.InputSink | null>(null);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [remoteClipboard, setRemoteClipboard] = useState('');
  const [clipboardDraft, setClipboardDraft] = useState('');

  const sendClipboard = useCallback((text: string) => {
    const Guacamole = guacRef.current;
    const client = clientRef.current;
    if (!Guacamole || !client || !text) return;
    const stream = client.createClipboardStream('text/plain');
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
  }, []);

  useEffect(() => {
    let disposed = false;
    const teardown: Array<() => void> = [];
    setPhase('connecting');
    setMessage('');

    (async () => {
      const mod = await import('guacamole-common-js');
      const Guacamole = (mod as unknown as { default: typeof G }).default;
      guacRef.current = Guacamole;

      const res = await fetch(`/api/gateway-token?machine=${encodeURIComponent(machine.id)}`, {
        method: 'POST',
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error('Could not get a connection ticket from the server.');
      const { gatewayUrl, token } = (await res.json()) as { gatewayUrl: string; token: string };
      if (disposed) return;

      const viewport = viewportRef.current!;
      const tunnel = new Guacamole.WebSocketTunnel(gatewayUrl);
      const client = new Guacamole.Client(tunnel);
      clientRef.current = client;

      const display = client.getDisplay();
      const displayEl = display.getElement();
      displayEl.classList.add('guac-display');
      viewport.appendChild(displayEl);
      teardown.push(() => displayEl.remove());

      // Scale the remote screen to fit the window.
      const fit = () => {
        const w = display.getWidth();
        const h = display.getHeight();
        if (!w || !h) return;
        display.scale(Math.min(viewport.clientWidth / w, viewport.clientHeight / h));
      };
      display.onresize = fit;

      // Ask Windows for a resolution that matches the window, at device pixel density.
      const desiredSize = () => {
        const dpr = window.devicePixelRatio || 1;
        return {
          width: Math.floor(viewport.clientWidth * dpr),
          height: Math.floor(viewport.clientHeight * dpr),
          dpi: Math.round(96 * dpr),
        };
      };
      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      const observer = new ResizeObserver(() => {
        fit();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const { width, height } = desiredSize();
          client.sendSize(width, height);
        }, 400);
      });
      observer.observe(viewport);
      teardown.push(() => {
        observer.disconnect();
        clearTimeout(resizeTimer);
      });

      // Mouse: use the remote cursor image as the local cursor for zero-latency pointing.
      const mouse = new Guacamole.Mouse(displayEl);
      mouse.onEach(['mousedown', 'mousemove', 'mouseup'], (e) => {
        display.showCursor(false);
        client.sendMouseState((e as G.Mouse.Event).state, true);
      });
      display.oncursor = (canvas, x, y) => {
        mouse.setCursor(canvas, x, y);
      };

      // Touch: tap = click, drag = move, two-finger tap = right click.
      const touch = new Guacamole.Mouse.Touchscreen(displayEl);
      touch.onEach(['mousedown', 'mousemove', 'mouseup'], (e) => {
        display.showCursor(true);
        client.sendMouseState((e as G.Mouse.Event).state, true);
      });

      // Keyboard. The input sink lets phones/tablets pop up their on-screen keyboard.
      const sink = new Guacamole.InputSink();
      sink.getElement().setAttribute('data-input-sink', '');
      document.body.appendChild(sink.getElement());
      sinkRef.current = sink;
      const keyboard = new Guacamole.Keyboard(document);
      keyboard.listenTo(sink.getElement());
      const typingInPage = () => {
        const el = document.activeElement as HTMLElement | null;
        return (
          !!el &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
          !el.hasAttribute('data-input-sink')
        );
      };
      keyboard.onkeydown = (keysym) => {
        if (typingInPage()) return true;
        client.sendKeyEvent(1, keysym);
        return false;
      };
      keyboard.onkeyup = (keysym) => {
        if (typingInPage()) return;
        client.sendKeyEvent(0, keysym);
      };
      teardown.push(() => {
        keyboard.onkeydown = null;
        keyboard.onkeyup = null;
        keyboard.reset();
        sink.getElement().remove();
        sinkRef.current = null;
      });

      // Clipboard: PC -> browser.
      client.onclipboard = (stream, mimetype) => {
        if (!/^text\//.test(mimetype)) return;
        const reader = new Guacamole.StringReader(stream);
        let text = '';
        reader.ontext = (chunk) => (text += chunk);
        reader.onend = () => {
          setRemoteClipboard(text);
          navigator.clipboard?.writeText(text).catch(() => {});
        };
      };

      // Clipboard: browser -> PC, whenever the tab regains focus (if the browser allows it).
      let lastSent = '';
      const syncLocalClipboard = async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text !== lastSent) {
            lastSent = text;
            sendClipboard(text);
          }
        } catch {
          /* permission denied or unsupported: the clipboard panel still works */
        }
      };
      window.addEventListener('focus', syncLocalClipboard);
      teardown.push(() => window.removeEventListener('focus', syncLocalClipboard));

      client.onstatechange = (state) => {
        if (disposed) return;
        if (state === 3) {
          setPhase('connected');
          setToolbarOpen(false);
          fit();
          syncLocalClipboard();
        } else if (state === 5) {
          setPhase((p) => (p === 'error' ? p : 'disconnected'));
        }
      };
      client.onerror = (status) => {
        if (disposed) return;
        setMessage(describeError(status, machine.name));
        setPhase('error');
      };

      const { width, height, dpi } = desiredSize();
      client.connect(
        new URLSearchParams({
          token,
          width: String(width),
          height: String(height),
          dpi: String(dpi),
        }).toString(),
      );
      teardown.push(() => {
        client.onstatechange = null;
        client.onerror = null;
        client.disconnect();
        clientRef.current = null;
      });

      const onUnload = () => client.disconnect();
      window.addEventListener('pagehide', onUnload);
      teardown.push(() => window.removeEventListener('pagehide', onUnload));
    })().catch((err: Error) => {
      if (disposed) return;
      setMessage(err.message);
      setPhase('error');
    });

    return () => {
      disposed = true;
      teardown.reverse().forEach((fn) => fn());
    };
  }, [attempt, sendClipboard, machine.id]);

  const press = (...keys: number[]) => {
    const client = clientRef.current;
    if (!client) return;
    keys.forEach((k) => client.sendKeyEvent(1, k));
    keys.reverse().forEach((k) => client.sendKeyEvent(0, k));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const showKeyboard = () => sinkRef.current?.focus();

  return (
    <div className="desktop">
      <div ref={viewportRef} className="viewport" onMouseDown={() => setClipboardOpen(false)} />

      {phase !== 'connected' && (
        <div className="overlay">
          <div className="card">
            {phase === 'connecting' && (
              <>
                <div className="spinner" aria-hidden />
                <p>Connecting to {machine.name}…</p>
              </>
            )}
            {phase === 'disconnected' && <p>Disconnected.</p>}
            {phase === 'error' && (
              <p className="error" role="alert">
                {message}
              </p>
            )}
            {phase !== 'connecting' && (
              <div className="row">
                <button onClick={() => setAttempt((n) => n + 1)}>Reconnect</button>
                {canSwitch && (
                  <a className="button secondary" href="/?choose=1">
                    Switch workspace
                  </a>
                )}
                <form action={logout}>
                  <button type="submit" className="secondary">
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'connected' && (
        <div className={`toolbar ${toolbarOpen ? 'open' : ''}`}>
          <button
            className="handle"
            aria-label={toolbarOpen ? 'Hide toolbar' : 'Show toolbar'}
            onClick={() => setToolbarOpen((o) => !o)}
          >
            {toolbarOpen ? '▲' : '▼'}
          </button>
          {toolbarOpen && (
            <div className="tools">
              <button onClick={toggleFullscreen}>Fullscreen</button>
              <button onClick={showKeyboard}>Keyboard</button>
              {machine.os === 'windows' && (
                <button onClick={() => press(KEY.ctrl, KEY.alt, KEY.del)}>Ctrl+Alt+Del</button>
              )}
              <button onClick={() => press(KEY.win)}>{machine.os === 'windows' ? 'Win' : 'Super'}</button>
              <button onClick={() => setClipboardOpen((o) => !o)}>Clipboard</button>
              <button onClick={() => clientRef.current?.disconnect()}>Disconnect</button>
              {canSwitch && (
                <a className="button secondary" href="/?choose=1">
                  Switch
                </a>
              )}
              <form action={logout}>
                <button type="submit" className="secondary">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {phase === 'connected' && clipboardOpen && (
        <div className="clipboard card">
          <label>
            Copied on your PC
            <textarea readOnly value={remoteClipboard} rows={3} />
          </label>
          <label>
            Send text to your PC&apos;s clipboard
            <textarea
              value={clipboardDraft}
              onChange={(e) => setClipboardDraft(e.target.value)}
              rows={3}
              placeholder="Paste here, then Send"
            />
          </label>
          <div className="row">
            <button
              onClick={() => {
                sendClipboard(clipboardDraft);
                setClipboardOpen(false);
              }}
            >
              Send
            </button>
            <button className="secondary" onClick={() => setClipboardOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
