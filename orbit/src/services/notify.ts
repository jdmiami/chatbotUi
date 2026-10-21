/**
 * Notifications from the AI machine: "turns off in 10 minutes" (tap to keep it on). The AI machine
 * sends them, so they arrive with Orbit closed. On iPhone and iPad they need Orbit on the Home
 * Screen (Share → Add to Home Screen) and opened from there.
 */

import { AUTO_OFF } from './autoOff';

const SW = `${import.meta.env.BASE_URL}sw.js`;
const SAVED = 'orbit.aiNotify.saved'; // the address the AI machine has (signing up again is only needed when it changes)

export type NotifyState = 'unsupported' | 'home-screen' | 'blocked' | 'off' | 'on';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function store(key: string, value?: string | null) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  return null;
}

function supported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ?? null;
}

export async function notifyState(): Promise<NotifyState> {
  if (!supported()) return isIos() && !standalone() ? 'home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const sub = await (await registration())?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function key(b64url: string) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Tells the AI machine where to send. Returns false when it is off (Orbit tries again later). */
async function tell(sub: PushSubscription) {
  const res = await fetch('/api/push', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  const out = (await res.json().catch(() => ({}))) as { saved?: boolean };
  if (out.saved) store(SAVED, sub.endpoint);
  return Boolean(out.saved);
}

/** Asks for permission (must follow a tap) and signs this device up. */
export async function enableNotify(): Promise<{ state: NotifyState; saved: boolean }> {
  if (!supported()) return { state: await notifyState(), saved: false };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'off', saved: false };
  const reg = await navigator.serviceWorker.register(SW, { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch('/api/push', { credentials: 'same-origin', cache: 'no-store' });
    const { publicKey } = (await res.json()) as { publicKey?: string };
    if (!publicKey) throw new Error('The site has no notification key yet.');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) });
  }
  return { state: 'on', saved: await tell(sub) };
}

export async function disableNotify() {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/push', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
  store(SAVED, null);
}

/** Signs up again if the AI machine doesn't have this device yet (call when it is on). */
export async function syncNotify() {
  if (!supported() || Notification.permission !== 'granted') return false;
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub || store(SAVED) === sub.endpoint) return Boolean(sub);
  return tell(sub).catch(() => false);
}

/** Notices from the service worker: the warning (while Orbit is open) and a tap on it. */
export function onNotifyMessage(handler: (type: 'turning-off' | 'keep') => void) {
  if (!supported()) return () => {};
  const listen = (e: MessageEvent) => {
    if (e.data?.type === 'orbit:ai-turning-off') handler('turning-off');
    if (e.data?.type === 'orbit:keep-ai') handler('keep');
  };
  navigator.serviceWorker.addEventListener('message', listen);
  return () => navigator.serviceWorker.removeEventListener('message', listen);
}

/** Keeps the AI machine on longer ("Keep on": 30 more minutes). Returns the new turn-off time, if any. */
export async function keepAiOn(minutes: number = AUTO_OFF.keepOnMinutes): Promise<string | null> {
  const res = await fetch('/api/status', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machine: 'ai', action: 'extend', minutes }),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string; machines?: { id: string; offAt?: string | null }[] };
  if (!res.ok) throw new Error(out.error || 'Could not reach the AI machine.');
  return out.machines?.find((m) => m.id === 'ai')?.offAt ?? null;
}
