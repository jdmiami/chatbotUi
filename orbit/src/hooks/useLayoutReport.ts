import { useEffect } from 'react';
import { connection, getHostClient } from '../services';

/**
 * Layout report (temporary diagnostics). When Orbit runs against the Linux machine, it records
 * how the browser reports the screen and on-screen keyboard (sizes and positions only, nothing
 * typed) and saves the latest 80 readings to `.orbit-layout-report.json` in the projects folder.
 * Phones differ in how they report the keyboard; this shows what the owner's phone actually does.
 */
const FILE = '.orbit-layout-report.json';
const MAX = 80;

type Box = [number, number, number] | null; // top, bottom, height

function box(sel: string): Box {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)];
}

function reading(event: string) {
  const vv = window.visualViewport;
  const active = document.activeElement as HTMLElement | null;
  const xtermScreen = document.querySelector('.term-host .xterm-screen');
  return {
    t: new Date().toISOString(),
    event,
    vv: vv ? { h: Math.round(vv.height), w: Math.round(vv.width), top: Math.round(vv.offsetTop), scale: vv.scale } : null,
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    scrollY: Math.round(window.scrollY),
    docScroll: document.scrollingElement?.scrollTop ?? null,
    css: {
      appHeight: document.documentElement.style.getPropertyValue('--app-height'),
      vvTop: document.documentElement.style.getPropertyValue('--vv-offset-top'),
      kb: document.documentElement.style.getPropertyValue('--keyboard-inset'),
    },
    keyboardFlag: document.querySelector('.shell')?.getAttribute('data-keyboard'),
    focus: active ? `${active.tagName.toLowerCase()}.${String(active.className).split(' ')[0]}` : null,
    shell: box('.shell'),
    header: box('.term-root .app-header'),
    termHost: box('.term-host'),
    xtermScreen: xtermScreen ? box('.term-host .xterm-screen') : null,
    compose: box('.term-compose'),
    keys: box('.term-keys'),
    rows: document.querySelectorAll('.term-host .xterm-rows > div').length,
  };
}

export function useLayoutReport() {
  useEffect(() => {
    if (connection.mode !== 'host') return;
    const host = getHostClient();
    if (!host) return;
    const entries: unknown[] = [];
    const meta = {
      ua: navigator.userAgent,
      build: Array.from(document.scripts).map((s) => s.src.split('/').pop()).filter(Boolean),
      dpr: window.devicePixelRatio,
      screen: [screen.width, screen.height],
      standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = '';
    const record = (event: string) => {
      const r = reading(event);
      const key = JSON.stringify({ ...r, t: 0, event: '' });
      if (key === lastKey && event === 'tick') return;
      lastKey = key;
      entries.push(r);
      if (entries.length > MAX) entries.shift();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void host
          .fetch(`/files/content?path=${encodeURIComponent(FILE)}`, {
            method: 'PUT',
            body: JSON.stringify({ meta, entries }, null, 1),
          })
          .catch(() => {});
      }, 2500);
    };
    // Each change, and again after the keyboard animation has settled.
    const onEvent = (e: Event) => {
      record(e.type);
      setTimeout(() => record(`${e.type}+600ms`), 600);
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onEvent);
    vv?.addEventListener('scroll', onEvent);
    window.addEventListener('resize', onEvent);
    document.addEventListener('focusin', onEvent);
    document.addEventListener('focusout', onEvent);
    const tick = setInterval(() => record('tick'), 3000);
    record('start');
    return () => {
      clearInterval(tick);
      clearTimeout(saveTimer);
      vv?.removeEventListener('resize', onEvent);
      vv?.removeEventListener('scroll', onEvent);
      window.removeEventListener('resize', onEvent);
      document.removeEventListener('focusin', onEvent);
      document.removeEventListener('focusout', onEvent);
    };
  }, []);
}
