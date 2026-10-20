// Orbit's service worker: only for notifications from the AI machine (it caches nothing).
// The push carries no message; the AI machine only sends one kind: "turning off in 10 minutes".
const BASE = new URL('./', self.location).pathname; // "/orbit/"
const ORBIT = BASE.length > 1 ? BASE.slice(0, -1) : '/'; // the page: "/orbit"

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.showNotification('Your AI machine turns off in 10 minutes', {
        body: 'Nothing is using it. Tap to keep it on 30 more minutes.',
        tag: 'ai-turning-off',
        renotify: true,
        icon: `${BASE}apple-touch-icon.png`,
        badge: `${BASE}icon.svg`,
        data: { url: `${ORBIT}?keep=ai` },
      });
      // An open Orbit shows it too, with the button.
      for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'orbit:ai-turning-off' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).find((c) => new URL(c.url).pathname.startsWith(ORBIT));
      if (open) {
        open.postMessage({ type: 'orbit:keep-ai' });
        return open.focus();
      }
      return self.clients.openWindow(event.notification.data?.url || `${ORBIT}?keep=ai`);
    })(),
  );
});
