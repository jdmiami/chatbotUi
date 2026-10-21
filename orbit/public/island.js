// <orbit-island>: the glass status pill. Money, auto-off timers and live machine stats, everywhere:
// in Orbit, on the site's pages, and on the pages the machines serve (AI playground, VS Code).
// Tap it and it opens into a task manager.
//
// Plain JavaScript in a shadow root (no framework, no innerHTML), so it works inside other apps
// without clashing with their styles or security rules.
//
// Attributes:
//   api    status endpoint (default /api/status)
//   token  bearer token for pages on the machines' own addresses (they can't send the site cookie)
//   place  orbit | site | playground | code  (where it sits by default)
//   site   the site's address, for links back
const POLL_CLOSED = 15_000;
const POLL_OPEN = 4_000;
const HISTORY = 40;
// The one auto-off rule comes from the status endpoint (autoOff: the site's lib/autoOff.ts). These
// are only used until it answers, and must match shared/autooff.js (ai/gate/test/autooff.test.js checks).
const AUTO_OFF_FALLBACK = { minutes: 60, keepOnMinutes: 30 };

const CSS = `
/* Orbit 0.5: warm ink, editorial type, hairlines instead of boxes. Always dark, so it reads over any page. */
:host {
  all: initial; position: fixed; z-index: 2147483000;
  --ink: #0d0c0b; --text: #f3eee6; --text-2: #c9c1b4; --text-3: #8f877b; --hair: rgb(243 238 230 / 0.12); --hair-2: rgb(243 238 230 / 0.22);
  --accent: #d9c8a6; --good: #8fd3ad; --warn: #e8b86b; --bad: #ef8f80;
  --display: 'Fraunces Variable', 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  --ui: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font: 13px/1.4 var(--ui); letter-spacing: -0.005em; color: var(--text); -webkit-font-smoothing: antialiased;
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; letter-spacing: inherit; }
.glass {
  position: relative; isolation: isolate; overflow: hidden;
  background: rgb(13 12 11 / 0.8);
  -webkit-backdrop-filter: blur(24px) saturate(140%); backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid var(--hair);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.38), 0 1px 2px rgb(0 0 0 / 0.3);
}
.pill {
  display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 13px 0 11px; border-radius: 999px; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none; white-space: nowrap;
  transition: transform 0.5s var(--bounce), border-color 0.3s;
}
.pill:hover { border-color: var(--hair-2); }
.pill:active { transform: scale(0.95); }
.pill:focus-visible, button:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 3px; }
.sep { width: 1px; height: 13px; background: var(--hair-2); }
.money { font: 400 15px/1 var(--display); letter-spacing: -0.01em; font-variant-numeric: tabular-nums lining-nums; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); flex: none; }
.dot.on { background: var(--good); box-shadow: 0 0 0 3px rgb(143 211 173 / 0.18); }
.dot.starting, .dot.downloading { background: var(--warn); animation: pulse 1.2s ease-in-out infinite; }
.dot.error { background: var(--bad); }
.chip { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; color: var(--text-2); }
.chip small { color: var(--text-3); font-size: 11px; }
.bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
.bars i { width: 3px; border-radius: 1px; background: var(--hair-2); }
.bars i.lit { background: var(--text); }
@keyframes pulse { 50% { opacity: 0.35; } }

.panel {
  position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 6px); width: min(440px, calc(100vw - 16px));
  max-height: min(80vh, calc(100dvh - 24px)); overflow: auto; overscroll-behavior: contain; border-radius: 22px; padding: 18px 20px 20px;
  background: rgb(13 12 11 / 0.95);
  transform-origin: 50% 0; translate: -50% 0; -webkit-overflow-scrolling: touch;
}
:host([place='playground']) .panel, :host([place='code']) .panel { top: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); transform-origin: 50% 100%; }
.panel[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.head h2 { margin: 0; flex: 1; font: 340 28px/1 var(--display); letter-spacing: -0.03em; font-variation-settings: 'opsz' 144; }
.x { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--hair); background: transparent; cursor: pointer; display: grid; place-items: center; font-size: 17px; color: var(--text-2); }
.card { padding: 16px 0 4px; margin-top: 12px; border-top: 1px solid var(--hair); }
.big { font: 330 44px/1 var(--display); letter-spacing: -0.035em; font-variation-settings: 'opsz' 144; font-variant-numeric: tabular-nums lining-nums; }
.row { display: flex; align-items: center; gap: 10px; }
.row + .row { margin-top: 8px; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--text-3); font-size: 12px; }
.kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin-top: 12px; }
.kv div { padding: 0 12px; border-left: 1px solid var(--hair); }
.kv div:first-child { padding-left: 0; border-left: 0; }
.kv b { display: block; font: 400 19px/1.2 var(--display); font-variant-numeric: tabular-nums lining-nums; margin-top: 2px; }
.mname { font: 400 21px/1.15 var(--display); letter-spacing: -0.015em; }
.ring { width: 54px; height: 54px; flex: none; position: relative; }
.ring svg { transform: rotate(-90deg); }
.ring span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; line-height: 1.1; color: var(--text-2); }
.meter { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-top: 6px; color: var(--text-2); }
.meter .val { text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; white-space: nowrap; }
.spark { display: block; height: 26px; width: 100%; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
.btn { min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--hair-2); background: transparent; cursor: pointer; font-weight: 500; transition: transform 0.45s var(--bounce), background 0.2s, border-color 0.2s; }
.btn:hover:not(:disabled) { border-color: rgb(243 238 230 / 0.4); }
.btn:active:not(:disabled) { transform: scale(0.94); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.warn { color: var(--bad); border-color: rgb(239 143 128 / 0.45); }
.btn.go { background: var(--text); color: var(--ink); border-color: var(--text); font-weight: 600; }
.btn.small { min-height: 32px; padding: 0 12px; font-size: 12px; }
.users { margin-top: 8px; }
.user { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--hair); }
.user:first-child { border-top: 0; }
.ubar { grid-column: 1 / -1; height: 2px; background: var(--hair); overflow: hidden; }
.ubar i { display: block; height: 100%; background: var(--text-2); }
.procs { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; color: var(--text-2); }
.procs td { padding: 5px 0; border-top: 1px solid var(--hair); font-variant-numeric: tabular-nums; }
.procs td:not(:first-child) { text-align: right; padding-left: 8px; white-space: nowrap; }
.sect { margin: 16px 0 0; font: 600 10px/1.4 var(--ui); letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3); }
.err { color: var(--bad); font-size: 12px; margin-top: 6px; }
.tiers { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.tiers .btn[aria-pressed='true'] { background: rgb(243 238 230 / 0.12); border-color: var(--text-2); }

/* Motion: springy open, staggered cards. */
:host([motion='full']) .panel:not([hidden]) { animation: open 0.6s var(--bounce) both; }
:host([motion='full']) .panel:not([hidden]) .card { animation: rise 0.55s var(--bounce) both; }
:host([motion='full']) .panel .card:nth-child(3) { animation-delay: 0.04s; }
:host([motion='full']) .panel .card:nth-child(4) { animation-delay: 0.08s; }
:host([motion='full']) .panel .card:nth-child(5) { animation-delay: 0.12s; }
:host([motion='lite']) .panel:not([hidden]) { animation: fade 0.18s ease both; }
:host([motion='off']) * { animation: none !important; transition: none !important; }
@keyframes open { from { opacity: 0; transform: scale(0.35, 0.12); border-radius: 999px; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
@keyframes fade { from { opacity: 0; } }
@keyframes tick { 40% { transform: scale(1.06); } }
:host([motion='full']) .money.changed { animation: tick 0.5s var(--bounce); }
`;

const BOUNCE =
  'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)';

// ---- small helpers
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const usd = (n, digits = 2) => (n == null ? '—' : `$${n.toFixed(digits)}`);
const gb = (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const rate = (b) => (b == null ? '—' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);
function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
function span(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
const STATE = { on: 'On', off: 'Off', starting: 'Starting…', downloading: 'Getting models…', error: 'Problem', unknown: '—' };

function motionLevel() {
  const set = document.documentElement.dataset.motion;
  if (set === 'full' || set === 'lite' || set === 'off') return set;
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full';
}

class OrbitIsland extends HTMLElement {
  static observedAttributes = ['token', 'api'];

  constructor() {
    super();
    this.data = null;
    this.open = false;
    this.history = new Map(); // key -> number[]
    this.busy = null;
    this.confirming = null;
    this.error = null;
    this.timer = null;
    this.ticker = null;
    this.root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { --bounce: cubic-bezier(0.34, 1.56, 0.64, 1); } @supports (transition-timing-function: linear(0, 1)) { :host { --bounce: ${BOUNCE}; } } ${CSS}`;
    this.pill = h('button', { class: 'pill glass', type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
    this.panel = h('div', { class: 'panel glass', role: 'dialog', 'aria-label': 'Money and machines', hidden: true });
    this.root.append(style, this.pill, this.panel);
  }

  connectedCallback() {
    if (!this.data) this.hidden = true; // until there is something to show
    this.setAttribute('motion', motionLevel());
    this.place();
    this.pill.addEventListener('click', () => {
      if (this.dragged) return;
      this.toggle(true);
    });
    this.dragSetup();
    for (const el of [this.pill, this.panel]) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    }
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.open) this.toggle(false);
    };
    document.addEventListener('keydown', this.onKey);
    this.onVis = () => (document.hidden ? this.stop() : this.poll());
    document.addEventListener('visibilitychange', this.onVis);
    this.onOutside = (e) => {
      if (this.open && !e.composedPath().includes(this)) this.toggle(false);
    };
    document.addEventListener('pointerdown', this.onOutside, true);
    this.ticker = setInterval(() => this.tick(), 1000);
    this.poll();
  }

  disconnectedCallback() {
    this.stop();
    clearInterval(this.ticker);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    document.removeEventListener('pointerdown', this.onOutside, true);
  }

  attributeChangedCallback() {
    if (this.isConnected) this.poll();
  }

  get api() {
    return this.getAttribute('api') || '/api/status';
  }

  // ---- where it sits (you can drag it; the spot is remembered per page type)
  place() {
    const where = this.getAttribute('place') || 'site';
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(`orbit-island:${where}`) || 'null');
    } catch {
      /* storage blocked */
    }
    Object.assign(this.style, { left: '', right: '', top: '', bottom: '', margin: '', width: '' });
    if (saved && typeof saved.x === 'number') {
      this.style.left = `${Math.min(Math.max(4, saved.x), innerWidth - 60)}px`;
      this.style.top = `${Math.min(Math.max(4, saved.y), innerHeight - 40)}px`;
    } else if (where === 'playground' || where === 'code') {
      this.style.right = '12px';
      this.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${where === 'code' ? 34 : 96}px)`;
    } else {
      // Centred without a transform, so the open panel (position: fixed) stays relative to the screen.
      Object.assign(this.style, { left: '0', right: '0', margin: '0 auto', width: 'max-content', top: 'calc(env(safe-area-inset-top, 0px) + 5px)' });
    }
  }

  dragSetup() {
    let start = null;
    this.pill.addEventListener('pointerdown', (e) => {
      const r = this.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId };
      this.dragged = false;
    });
    this.pill.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!this.dragged && Math.hypot(dx, dy) < 8) return;
      if (!this.dragged) this.pill.setPointerCapture(e.pointerId);
      this.dragged = true;
      Object.assign(this.style, { right: '', bottom: '', margin: '', width: '', left: `${start.left + dx}px`, top: `${start.top + dy}px` });
    });
    const end = () => {
      if (start && this.dragged) {
        const r = this.getBoundingClientRect();
        try {
          localStorage.setItem(`orbit-island:${this.getAttribute('place') || 'site'}`, JSON.stringify({ x: r.left, y: r.top }));
        } catch {
          /* storage blocked */
        }
        setTimeout(() => (this.dragged = false), 0);
      }
      start = null;
    };
    this.pill.addEventListener('pointerup', end);
    this.pill.addEventListener('pointercancel', end);
    this.pill.addEventListener('dblclick', () => {
      try {
        localStorage.removeItem(`orbit-island:${this.getAttribute('place') || 'site'}`);
      } catch {
        /* storage blocked */
      }
      this.place();
    });
  }

  toggle(open) {
    this.open = open;
    this.setAttribute('motion', motionLevel());
    this.pill.setAttribute('aria-expanded', String(open));
    this.panel.hidden = !open;
    this.pill.style.visibility = open ? 'hidden' : '';
    this.render();
    if (open) {
      this.panel.querySelector('.x')?.focus();
      this.poll();
    } else {
      this.pill.focus();
    }
  }

  // ---- data
  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  async poll() {
    this.stop();
    if (document.hidden) return;
    try {
      const token = this.getAttribute('token');
      const res = await fetch(`${this.api}${this.open ? '?detail=1' : ''}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        credentials: token ? 'omit' : 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 404) {
        this.setVisible(false);
        return; // not signed in here, or no site behind this page: stay out of the way
      }
      if (!res.ok) throw new Error(`Status ${res.status}`);
      this.accept(await res.json());
      this.error = null;
    } catch (err) {
      this.error = this.data ? 'Can’t reach your site right now; showing the last reading.' : null;
      if (!this.data) {
        this.setVisible(false);
      }
    }
    this.timer = setTimeout(() => this.poll(), this.open ? POLL_OPEN : POLL_CLOSED);
  }

  setVisible(v) {
    if (this.hidden === !v) return;
    this.hidden = !v;
    this.dispatchEvent(new CustomEvent('island-visible', { detail: { visible: v }, bubbles: true, composed: true }));
  }

  accept(data) {
    const before = this.data?.money?.balance;
    this.data = data;
    this.receivedAt = Date.now();
    for (const m of data.machines || []) {
      const s = m.stats;
      const push = (key, v) => {
        if (v == null || Number.isNaN(v)) return;
        const arr = this.history.get(key) || [];
        arr.push(v);
        if (arr.length > HISTORY) arr.shift();
        this.history.set(key, arr);
      };
      const gpu = s?.gpus?.[0];
      // Runpod's own CPU reading knows the machine's real share of cores; the machine itself may not.
      push(`${m.id}:cpu`, m.live?.cpu ?? s?.cpu?.percent);
      push(`${m.id}:mem`, s?.memory ? (s.memory.used / s.memory.total) * 100 : m.live?.memory);
      push(`${m.id}:gpu`, gpu?.percent ?? m.live?.gpu);
      push(`${m.id}:vram`, gpu?.memoryTotal ? (gpu.memoryUsed / gpu.memoryTotal) * 100 : m.live?.gpuMemory);
      push(`${m.id}:net`, s?.network?.rxPerSec != null ? s.network.rxPerSec + s.network.txPerSec : null);
    }
    this.setVisible(true);
    this.render();
    if (before != null && data.money?.balance != null && before !== data.money.balance) {
      const el = this.pill.querySelector('.money');
      el?.classList.remove('changed');
      void el?.offsetWidth;
      el?.classList.add('changed');
    }
  }

  async act(machine, action, extra = {}) {
    this.busy = `${machine}:${action}`;
    this.confirming = null;
    this.render();
    try {
      const token = this.getAttribute('token');
      const res = await fetch(this.api, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        credentials: token ? 'omit' : 'same-origin',
        body: JSON.stringify({ machine, action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`);
      this.accept(body);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = null;
      this.render();
    }
  }

  // Ask twice for anything that ends work.
  confirmOr(key, fn) {
    if (this.confirming === key) return fn();
    this.confirming = key;
    this.render();
    setTimeout(() => {
      if (this.confirming === key) {
        this.confirming = null;
        this.render();
      }
    }, 3500);
  }

  tick() {
    if (!this.data) return;
    // Countdowns move every second without asking the server.
    for (const el of this.root.querySelectorAll('[data-off-at]')) {
      const left = new Date(el.dataset.offAt).getTime() - Date.now();
      el.textContent = left > 0 ? clock(left) : 'now';
    }
    for (const el of this.root.querySelectorAll('[data-ring]')) {
      const m = (this.data.machines || []).find((x) => x.id === el.dataset.ring);
      if (m) this.updateRing(el, m);
    }
  }

  // ---- drawing
  render() {
    const d = this.data;
    if (!d) return;
    const machines = d.machines || [];
    const ai = machines.find((m) => m.id === 'ai');
    const linux = machines.find((m) => m.id === 'linux');

    // Collapsed pill: money · AI timer · GPU bars · Linux dot.
    const kids = [];
    if (d.money?.balance != null) kids.push(h('span', { class: 'money', text: usd(d.money.balance) }), h('span', { class: 'sep' }));
    if (ai) {
      const left = ai.offAt ? new Date(ai.offAt).getTime() - Date.now() : null;
      kids.push(
        h(
          'span',
          { class: 'chip' },
          h('span', { class: `dot ${ai.state}` }),
          h('small', { text: 'AI' }),
          ai.state === 'on' && left != null ? h('span', { 'data-off-at': ai.offAt, text: clock(left) }) : h('span', { text: STATE[ai.state] || ai.state }),
        ),
      );
      const gpu = this.last('ai:gpu');
      if (ai.state === 'on') {
        const lit = gpu == null ? 0 : Math.ceil((gpu / 100) * 4);
        kids.push(h('span', { class: 'bars', 'aria-hidden': 'true' }, [4, 7, 10, 14].map((hgt, i) => h('i', { class: i < lit ? 'lit' : '', style: `height:${hgt}px` }))));
      }
    }
    if (linux) {
      const lleft = linux.offAt ? new Date(linux.offAt).getTime() - Date.now() : null;
      kids.push(
        h('span', { class: 'sep' }),
        h(
          'span',
          { class: 'chip' },
          h('span', { class: `dot ${linux.state}` }),
          h('small', { text: 'Linux' }),
          linux.state === 'on' && lleft != null ? h('span', { 'data-off-at': linux.offAt, text: clock(lleft) }) : null,
        ),
      );
    }
    this.pill.replaceChildren(...kids);
    const left = ai?.offAt ? clock(new Date(ai.offAt).getTime() - Date.now()) : null;
    const linuxLeft = linux?.offAt ? clock(new Date(linux.offAt).getTime() - Date.now()) : null;
    this.pill.setAttribute(
      'aria-label',
      [
        d.money?.balance != null ? `Balance ${usd(d.money.balance)}` : null,
        ai ? `AI machine ${STATE[ai.state] || ai.state}${left && ai.state === 'on' ? `, turns off in ${left}` : ''}` : null,
        linux ? `Linux machine ${STATE[linux.state] || linux.state}${linuxLeft && linux.state === 'on' ? `, turns off in ${linuxLeft}` : ''}` : null,
        'Open money and machines',
      ]
        .filter(Boolean)
        .join('. '),
    );

    if (!this.open) return;
    const top = h(
      'div',
      { class: 'head' },
      h('h2', { text: 'Money & machines' }),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => this.toggle(false), text: '×' }),
    );
    const sections = [top, this.moneyCard(d)];
    for (const m of machines) sections.push(this.machineCard(m, d.canPower));
    if (this.error) sections.push(h('p', { class: 'err', role: 'alert', text: this.error }));
    this.panel.replaceChildren(...sections);
  }

  last(key) {
    const a = this.history.get(key);
    return a?.length ? a[a.length - 1] : null;
  }

  moneyCard(d) {
    const m = d.money;
    if (!m) return h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Add RUNPOD_API_KEY in Vercel to see your balance here.' }));
    const days = m.balance != null && m.spendPerHour > 0 ? m.balance / m.spendPerHour / 24 : null;
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'muted', text: 'Runpod balance' }),
      h('div', { class: 'big', text: usd(m.balance) }),
      h(
        'div',
        { class: 'kv' },
        h('div', {}, h('span', { class: 'muted', text: 'Spending now' }), h('b', { text: m.spendPerHour != null ? `${usd(m.spendPerHour)}/h` : '—' })),
        h('div', {}, h('span', { class: 'muted', text: 'Spent today' }), h('b', { text: usd(m.today) })),
        h('div', {}, h('span', { class: 'muted', text: 'Lasts about' }), h('b', { text: days == null ? '—' : days > 99 ? '99+ days' : `${days.toFixed(days < 3 ? 1 : 0)} days` })),
      ),
    );
  }

  updateRing(el, m) {
    const circle = el.querySelector('circle.fg');
    const label = el.querySelector('span');
    const left = m.offAt ? new Date(m.offAt).getTime() - Date.now() : null;
    const limit = (m.stats?.idle?.limitMinutes || m.autoOffMinutes || this.data?.autoOff?.minutes || AUTO_OFF_FALLBACK.minutes) * 60_000;
    const frac = left == null ? 0 : Math.max(0, Math.min(1, left / Math.max(limit, left)));
    if (circle) circle.setAttribute('stroke-dashoffset', String(150.8 * (1 - frac)));
    if (label) label.textContent = left == null ? '—' : left > 0 ? clock(left) : 'now';
  }

  machineCard(m, canPower) {
    const on = m.state === 'on' || m.state === 'downloading';
    const s = m.stats;
    const head = h(
      'div',
      { class: 'row' },
      h('span', { class: `dot ${m.state}` }),
      h('div', { class: 'grow' }, h('div', { class: 'mname', text: m.name }), h('div', { class: 'muted', text: [STATE[m.state] || m.state, m.gpuName, m.costPerHour != null ? `${usd(m.costPerHour)}/h` : null, on ? `up ${span(m.uptimeSeconds)}` : null].filter(Boolean).join(' · ') })),
    );
    if (m.autoOff && on) {
      const ring = h('div', { class: 'ring', 'data-ring': m.id, role: 'timer', 'aria-label': 'Turns itself off in' });
      const g = svg('svg', { width: 54, height: 54, viewBox: '0 0 54 54', 'aria-hidden': 'true' });
      g.append(svg('circle', { cx: 27, cy: 27, r: 24, fill: 'none', stroke: 'rgb(243 238 230 / 0.12)', 'stroke-width': 3 }));
      g.append(svg('circle', { class: 'fg', cx: 27, cy: 27, r: 24, fill: 'none', stroke: '#f3eee6', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': 150.8, 'stroke-dashoffset': 0 }));
      ring.append(g, h('span', {}));
      head.append(ring);
      this.updateRing(ring, m);
    } else if (!m.autoOff && on) {
      head.append(h('span', { class: 'muted', text: 'Always on' }));
    }

    const meters = [];
    const meter = (label, key, value) => {
      const arr = this.history.get(`${m.id}:${key}`) || [];
      const sv = svg('svg', { class: 'spark', viewBox: `0 0 ${HISTORY} 26`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      if (arr.length > 1) {
        const max = key === 'net' ? Math.max(...arr, 1) : 100;
        const pts = arr.map((v, i) => `${i + HISTORY - arr.length},${25 - (Math.min(v, max) / max) * 23}`).join(' ');
        sv.append(svg('polygon', { points: `${HISTORY - arr.length},26 ${pts} ${HISTORY - 1},26`, fill: 'rgb(243 238 230 / 0.08)' }));
        sv.append(svg('polyline', { points: pts, fill: 'none', stroke: '#c9c1b4', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
      }
      meters.push(h('div', { class: 'meter' }, h('span', { class: 'muted', text: label }), sv, h('span', { class: 'val', text: value })));
    };
    if (on) {
      const gpu = s?.gpus?.[0];
      meter('CPU', 'cpu', pct(m.live?.cpu ?? s?.cpu?.percent));
      meter('Memory', 'mem', s?.memory ? `${gb(s.memory.used)} / ${gb(s.memory.total)}` : pct(m.live?.memory));
      if (gpu || m.live?.gpu != null) {
        meter('GPU', 'gpu', `${pct(gpu?.percent ?? m.live?.gpu)}${gpu?.temperature != null ? ` · ${gpu.temperature}°` : ''}`);
        meter('GPU mem', 'vram', gpu ? `${gb(gpu.memoryUsed)} / ${gb(gpu.memoryTotal)}` : pct(m.live?.gpuMemory));
      }
      if (s?.network) meter('Network', 'net', `↓${rate(s.network.rxPerSec)}`);
      for (const disk of s?.disks || []) {
        meters.push(h('div', { class: 'meter' }, h('span', { class: 'muted', text: disk.label === 'Saved storage' ? 'Storage' : 'Disk' }), h('div', { class: 'ubar', style: 'grid-column:auto' }, h('i', { style: `width:${((disk.total - disk.free) / disk.total) * 100}%` })), h('span', { class: 'val', text: `${gb(disk.free)} free` })));
      }
    }

    // What's using what.
    const users = [];
    if (on && s?.users?.length) {
      const total = s.gpus?.[0]?.memoryTotal || 0;
      users.push(h('div', { class: 'sect', text: 'In GPU memory' }));
      users.push(
        h(
          'div',
          { class: 'users' },
          s.users.map((u) =>
            h(
              'div',
              { class: 'user' },
              h('span', { text: u.label }),
              h('span', { class: 'muted', text: gb(u.memory) }),
              u.kind === 'model'
                ? h('button', { class: 'btn small', type: 'button', disabled: this.busy != null, onclick: () => this.act('ai', 'unload', { model: u.name }), text: this.busy === 'ai:unload' ? '…' : 'Unload' })
                : h('span'),
              h('div', { class: 'ubar' }, h('i', { style: `width:${total ? Math.min(100, (u.memory / total) * 100) : 0}%` })),
            ),
          ),
        ),
      );
    }
    if (on && s?.processes?.length) {
      users.push(h('div', { class: 'sect', text: 'Busiest programs' }));
      const table = h('table', { class: 'procs' });
      const body = h('tbody');
      for (const p of s.processes) body.append(h('tr', {}, h('td', { text: p.count > 1 ? `${p.name} (${p.count})` : p.name }), h('td', { text: p.cpu == null ? '…' : `${p.cpu}%` }), h('td', { text: gb(p.memory) })));
      table.append(body);
      users.push(table);
    }
    if (on && !s) users.push(h('p', { class: 'muted', text: 'Reading this machine’s programs…' }));

    // Actions.
    const actions = [];
    const busy = this.busy != null;
    const step = this.data?.autoOff?.keepOnMinutes || AUTO_OFF_FALLBACK.keepOnMinutes;
    if (m.autoOff && on) actions.push(h('button', { class: 'btn go', type: 'button', disabled: busy, 'aria-label': `Keep on ${step} more min`, onclick: () => this.act(m.id, 'extend', { minutes: step }), text: this.busy === `${m.id}:extend` ? 'Adding…' : `+${step} min` }));
    if (canPower) {
      if (on || m.state === 'starting') {
        const key = `${m.id}:stop`;
        actions.push(
          h('button', {
            class: 'btn warn',
            type: 'button',
            disabled: busy,
            onclick: () => this.confirmOr(key, () => this.act(m.id, 'stop')),
            text: this.busy === key ? 'Turning off…' : this.confirming === key ? 'Tap again to turn off' : 'Turn off',
          }),
        );
      } else if (m.state === 'off') {
        actions.push(h('button', { class: 'btn go', type: 'button', disabled: busy, onclick: () => this.act(m.id, 'start', m.id === 'ai' ? { tier: this.tier || m.tier || undefined } : {}), text: this.busy === `${m.id}:start` ? 'Turning on…' : 'Turn on' }));
      }
    } else if (this.getAttribute('site')) {
      actions.push(h('a', { class: 'btn', href: this.getAttribute('site'), target: '_top', style: 'display:inline-flex;align-items:center;text-decoration:none', text: 'Power controls' }));
    }
    let tiers = null;
    if (m.id === 'ai' && canPower && m.state === 'off' && m.tiers?.length > 1) {
      const chosen = this.tier || m.tier || m.tiers[0].id;
      tiers = h(
        'div',
        { class: 'tiers', role: 'group', 'aria-label': 'Speed' },
        m.tiers.map((t) =>
          h('button', {
            class: 'btn small',
            type: 'button',
            'aria-pressed': String(t.id === chosen),
            onclick: () => {
              this.tier = t.id;
              this.render();
            },
            text: `${t.label} · ${usd(t.pricePerHour)}/h`,
          }),
        ),
      );
    }
    return h('div', { class: 'card' }, head, meters, users, tiers, actions.length ? h('div', { class: 'actions' }, actions) : null, m.detail && m.state === 'error' ? h('p', { class: 'err', text: m.detail }) : null);
  }
}

if (!customElements.get('orbit-island')) customElements.define('orbit-island', OrbitIsland);
