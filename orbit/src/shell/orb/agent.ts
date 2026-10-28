/**
 * "Do it for me": the orb uses Orbit the way you would. It reads what is on screen (buttons, links,
 * fields, tabs) and acts on it step by step (open an app, tap a button, type, scroll, change a
 * setting, switch a machine on or off), flying to each thing it touches so you can watch.
 *
 * Simple requests ("open terminal", "dark mode", "scroll down", "tap Make") are understood right
 * here, instantly and without the AI machine. Anything else goes to your own model on the AI
 * machine, which plans one step at a time against a fresh look at the screen.
 *
 * Nothing that costs money or can't be undone happens without asking: switching a machine on,
 * and tapping anything that deletes, discards, resets, stops or turns off.
 */
import type { AppId, Settings } from '../../state/shell';

export type Step =
  | { do: 'open'; app: AppId }
  | { do: 'home' }
  | { do: 'back' }
  | { do: 'click'; target: string }
  | { do: 'type'; text: string; target?: string; submit?: boolean }
  | { do: 'scroll'; dir: 'up' | 'down' | 'top' | 'bottom' }
  | { do: 'setting'; name: 'theme' | 'motion' | 'text'; value: string }
  | { do: 'machine'; which: 'ai' | 'linux'; power: 'on' | 'off' }
  | { do: 'say'; text: string }
  | { do: 'done'; say?: string };

export interface PageItem {
  id: number;
  role: 'button' | 'link' | 'field' | 'tab' | 'option' | 'switch';
  label: string;
  value?: string;
  el: HTMLElement;
  /** Further down (or up) the page: it scrolls there first. */
  offscreen?: boolean;
}

export const APP_WORDS: [RegExp, AppId][] = [
  [/\b(term(inal)?|shell|console|command line)\b/, 'terminal'],
  [/\b(code|editor|files?|project)\b/, 'editor'],
  [/\b(anti ?gravity|agent|coding agent)\b/, 'agent'],
  [/\b(so ?real|movies?|films?)\b/, 'soreal'],
  [/\b(stats|statistics|storage|usage|cost|spending|ram|cpu|gpu)\b/, 'stats'],
  [/\b(settings?|preferences|options)\b/, 'settings'],
  [/\b(live ?draw|drawing|sketch(ing)?)\b/, 'livedraw'],
  [/\b(images?|pictures?|photos?|videos?|make|create|draw|gallery)\b/, 'make'],
  [/\b(ai|chat|talk|assistant)\b/, 'ai'],
];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The name a person would use for an element (what a screen reader would say). */
export function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(t)) return clean(t);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const lab = el.labels?.[0]?.textContent;
    if (lab && clean(lab)) return clean(lab);
    if ('placeholder' in el && el.placeholder) return clean(el.placeholder);
  }
  return clean(el.innerText || el.textContent || el.getAttribute('title') || '').slice(0, 80);
}

function roleOf(el: HTMLElement): PageItem['role'] {
  const r = el.getAttribute('role');
  if (r === 'tab') return 'tab';
  if (r === 'radio' || r === 'option' || r === 'menuitem') return 'option';
  if (r === 'switch' || (el instanceof HTMLInputElement && el.type === 'checkbox')) return 'switch';
  if (el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return 'field';
  if (el.tagName === 'A') return 'link';
  return 'button';
}

/**
 * What can be used right now, top to bottom. `skip` = the orb's own UI. With `all`, controls
 * scrolled out of view are included too (marked offscreen), so "tap Light" works on a long page.
 */
/** A box whose contents must never leave the page: passwords, one-time codes, card details. */
export function privateField(el: Element): boolean {
  if (el.closest('[data-private]')) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return true;
  const ac = (el.autocomplete || '').toLowerCase();
  return /current-password|new-password|one-time-code|cc-/.test(ac);
}

export function snapshot(skip?: Element | null, root: ParentNode = document, { all = false } = {}): PageItem[] {
  const els = root.querySelectorAll<HTMLElement>(
    'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [contenteditable]:not([contenteditable="false"])',
  );
  const items: PageItem[] = [];
  const vh = window.innerHeight, vw = window.innerWidth;
  for (const el of els) {
    if (skip?.contains(el) || (el as HTMLButtonElement).disabled) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const offscreen = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
    if (offscreen && (!all || r.right < 0 || r.left > vw || getComputedStyle(el).visibility === 'hidden')) continue;
    const label = labelOf(el);
    if (!label) continue;
    const role = roleOf(el);
    // Passwords, codes and card numbers are never read out (to a model or anyone else).
    const value = role === 'field' && 'value' in el && !privateField(el) ? String((el as HTMLInputElement).value).slice(0, 60) : undefined;
    items.push({ id: items.length + 1, role, label, value, el, offscreen: offscreen || undefined });
  }
  items.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
  items.forEach((it, i) => (it.id = i + 1));
  return items;
}

/** Fuzzy match a spoken name to something on screen. Exact > starts with > contains > shared words. */
export function findItem(items: PageItem[], target: string, roles?: PageItem['role'][]): PageItem | null {
  // "A|B": the first alternative that is on screen (labels differ between the two looks).
  if (target.includes('|')) {
    for (const alt of target.split('|')) {
      const hit = findItem(items, alt, roles);
      if (hit) return hit;
    }
    return null;
  }
  const want = target.toLowerCase().replace(/^the\s+/, '').replace(/\s+(button|link|tab|field|box)$/, '').trim();
  if (!want) return null;
  const idMatch = /^#?(\d+)$/.exec(want);
  if (idMatch) return items.find((i) => i.id === Number(idMatch[1])) ?? null;
  let best: PageItem | null = null;
  let bestScore = 0;
  const words = want.split(/\s+/);
  for (const it of items) {
    if (roles && !roles.includes(it.role)) continue;
    const l = it.label.toLowerCase();
    let score = 0;
    if (l === want) score = 100;
    else if (l.startsWith(want)) score = 80;
    else if (l.includes(want)) score = 60;
    else {
      const hit = words.filter((w) => w.length > 2 && l.includes(w)).length;
      score = hit ? (40 * hit) / words.length : 0;
    }
    if (it.offscreen) score -= 1;
    if (score > bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return bestScore >= 30 ? best : null;
}

/** Commands understood without the AI machine. Returns null when it needs the model. */
export function parseCommand(input: string): Step[] | null {
  const t = input.toLowerCase().replace(/[.!?]+$/, '').replace(/^(please|hey orb|orb|can you|could you|would you)[, ]+/g, '').trim();
  if (!t) return null;
  let m: RegExpExecArray | null;

  if (/^(go )?(home|back home|to the home( screen)?)$/.test(t) || /^(show|go to) (the )?(home|path|start)/.test(t)) return [{ do: 'home' }];
  if (/^(go )?back$/.test(t)) return [{ do: 'back' }];

  if ((m = /^(?:open|launch|start|show|go to|take me to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?$/.exec(t))) {
    const what = m[1];
    if (!/\b(machine|computer|pod|server)\b/.test(what)) {
      for (const [re, app] of APP_WORDS) if (re.test(what)) return [{ do: 'open', app }];
    }
  }
  if ((m = /^(?:turn|switch|power)\s+(on|off)\s+(?:the\s+|my\s+)?(ai|linux|gpu)(?: machine| computer| pod)?$/.exec(t)) ||
      (m = /^(?:turn|switch|power)\s+(?:the\s+|my\s+)?(ai|linux|gpu)(?: machine| computer| pod)?\s+(on|off)$/.exec(t))) {
    const power = (m[1] === 'on' || m[1] === 'off' ? m[1] : m[2]) as 'on' | 'off';
    const which = /linux/.test(t) ? 'linux' : 'ai';
    return [{ do: 'machine', which, power }];
  }
  if (/\b(dark mode|go dark|dark theme)\b/.test(t)) return [{ do: 'setting', name: 'theme', value: 'dark' }];
  if (/\b(light mode|go light|light theme)\b/.test(t)) return [{ do: 'setting', name: 'theme', value: 'light' }];
  if ((m = /\b(?:motion|animations?)\s+(off|lite|full|auto)\b/.exec(t)) || (m = /\b(?:turn|switch)\s+(off|on)\s+(?:the\s+)?(?:motion|animations?)\b/.exec(t))) {
    const v = m[1] === 'on' ? 'full' : m[1];
    return [{ do: 'setting', name: 'motion', value: v }];
  }
  if (/\b(bigger|larger) text\b|\btext (bigger|larger)\b/.test(t)) return [{ do: 'setting', name: 'text', value: 'up' }];
  if (/\bsmaller text\b|\btext smaller\b/.test(t)) return [{ do: 'setting', name: 'text', value: 'down' }];

  if ((m = /^scroll\s+(up|down)$/.exec(t)) || (m = /^(?:go|scroll)\s+(?:to\s+)?(?:the\s+)?(top|bottom)$/.exec(t))) return [{ do: 'scroll', dir: m[1] as 'up' | 'down' | 'top' | 'bottom' }];

  if ((m = /^(?:make|create|draw|generate)\s+(?:me\s+)?(?:an?\s+)?(picture|image|photo|video|clip)s?\s+(?:of|showing|with)\s+(.+)$/.exec(t))) {
    const video = /video|clip/.test(m[1]);
    return [
      { do: 'open', app: 'make' },
      { do: 'click', target: video ? 'A video|Video' : 'A picture|Image' },
      { do: 'type', target: 'Describe it', text: input.replace(/^.*?\b(?:of|showing|with)\s+/i, '').trim() },
      { do: 'click', target: video ? 'Make video' : 'Make image' },
    ];
  }
  if ((m = /^(?:ask|tell)\s+(?:the\s+)?(?:ai|assistant|model)\s+(?:to\s+|about\s+|whether\s+|if\s+)?(.+)$/.exec(t))) {
    return [{ do: 'open', app: 'ai' }, { do: 'type', target: 'Message', text: input.replace(/^.*?\b(?:ai|assistant|model)\b\s*(?:to\s+|about\s+)?/i, '').trim(), submit: true }];
  }
  if ((m = /^(?:tap|click|press|hit|select|choose)\s+(?:on\s+)?(?:the\s+)?(.+)$/.exec(t))) return [{ do: 'click', target: input.replace(/^\s*\S+\s+(?:on\s+)?(?:the\s+)?/i, '').trim() }];
  // "type …", or "write/enter "…" in X" (plain "write me a poem" is a request for the model).
  if ((m = /^type\s+["“]?(.+?)["”]?(?:\s+(?:in|into)\s+(?:the\s+)?(.+))?$/.exec(t)) || (m = /^(?:write|enter)\s+["“](.+?)["”](?:\s+(?:in|into)\s+(?:the\s+)?(.+))?$/.exec(t))) {
    const raw = /^\s*\S+\s+["“]?(.+?)["”]?(?:\s+(?:in|into)\s+(?:the\s+)?(.+))?\s*$/i.exec(input)!;
    return [{ do: 'type', text: raw[1], target: raw[2] }];
  }
  return null;
}

/** Steps that need a yes first. */
export function needsConfirm(step: Step, label?: string): string | null {
  if (step.do === 'machine' && step.power === 'on') return `Turn on the ${step.which === 'ai' ? 'AI' : 'Linux'} machine? It bills by the hour while on, and turns itself off when unused.`;
  if (step.do === 'click' && label && /\b(delete|remove|discard|reset|erase|clear all|turn off|stop|sign out|log out|terminate|end session)\b/i.test(label)) return `Tap “${label}”? That can't be undone.`;
  return null;
}

export const PLANNER_PROMPT = `You operate Orbit, a web workspace, for its owner, one step at a time.
Each turn you get the goal, what you've done, and what is on screen now as numbered items ("#3 button: Make").
Reply with ONE JSON object and nothing else, one of:
{"do":"open","app":"terminal|editor|agent|ai|make|soreal|stats|settings"}
{"do":"home"} {"do":"back"}
{"do":"click","target":"#3"}            (use the item number)
{"do":"type","target":"#5","text":"...","submit":true|false}
{"do":"scroll","dir":"up|down|top|bottom"}
{"do":"setting","name":"theme|motion|text","value":"dark|light|off|lite|full|up|down"}
{"do":"machine","which":"ai|linux","power":"on|off"}
{"do":"done","say":"one short sentence for the owner"}
Rules: only use items that are listed. Prefer the fewest steps. If the goal is a question you can answer, answer it with done. If you can't do it, say why with done. Never invent passwords or personal data.`;

/** The screen as the model sees it. */
export function describe(items: PageItem[], app: string | null): string {
  const lines = items.slice(0, 60).map((i) => `#${i.id} ${i.role}: ${i.label}${i.value ? ` (now: "${i.value}")` : ''}`);
  return `App on screen: ${app ?? 'home'}\n${lines.join('\n') || '(nothing to use)'}`;
}

/** First JSON object in a model's reply, as a Step (or null). */
export function parseStep(text: string): Step | null {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) {
      try {
        const s = JSON.parse(body.slice(start, i + 1)) as Step;
        return typeof s?.do === 'string' ? s : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export type SettingsPatch = Partial<Pick<Settings, 'theme' | 'motion' | 'textScale' | 'motionPicked'>>;

/** A settings step as a patch (null if the value isn't understood). */
export function settingPatch(step: Extract<Step, { do: 'setting' }>, current: Settings): SettingsPatch | null {
  const v = step.value.toLowerCase();
  if (step.name === 'theme' && (v === 'dark' || v === 'light' || v === 'system')) return { theme: v };
  if (step.name === 'motion') {
    const map: Record<string, Settings['motion']> = { off: 'reduce', reduce: 'reduce', lite: 'lite', full: 'full', on: 'full', auto: 'system', system: 'system' };
    return map[v] ? { motion: map[v], motionPicked: true } : null;
  }
  if (step.name === 'text') {
    const next = Math.round((current.textScale + (v === 'down' ? -0.1 : 0.1)) * 100) / 100;
    return { textScale: Math.min(1.3, Math.max(0.9, next)) };
  }
  return null;
}

/** Put text into a field the way typing would (works with React-controlled inputs). */
export function setFieldValue(el: HTMLElement, text: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}

/** Send what's in a field: its form's submit, else Enter. */
export function submitField(el: HTMLElement) {
  const form = el.closest('form');
  if (form) {
    form.requestSubmit?.();
    return;
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}

/** The scroller under the main content (the active app's, or the home path). */
export function mainScroller(skip?: Element | null): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>('.app-window:not([data-hidden="true"]) *, .o5-path')].filter((el) => {
    if (skip?.contains(el)) return false;
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 120;
  });
  candidates.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
  return candidates[0] ?? null;
}
