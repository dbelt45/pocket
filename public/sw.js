// Pocket's service worker: a small program the phone keeps running beside the
// app. It does two jobs.
//
// 1. OFFLINE. It keeps a copy of the app's own files (the "shell") so Pocket
//    opens with no signal. Those are the only files cached, and only those:
//    the page, its script, its styles, the database library, the manifest and
//    the icons. Everything under /api is personal, changing data, so it is
//    NEVER cached here; the app keeps its own last-known copy instead and labels
//    it "saved copy" so stale data is never passed off as fresh.
//
// 2. NOTIFICATIONS. It receives the morning push and shows it, even when
//    Pocket is closed.

const VERSION = "pocket-v2"; // bump to force every phone to take a fresh copy
const SHELL = [
  "/", "/app.js", "/styles.css", "/vendor/supabase.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Stale-while-revalidate: answer instantly from the saved copy, then fetch a
// fresh one in the background for next time. On a bad connection the app still
// opens instantly; with a good one it is at most one open behind a new deploy.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const key = e.request.mode === "navigate" ? "/" : e.request;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(key);
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached ?? fresh;
  }));
});

self.addEventListener("push", (e) => {
  const d = e.data?.json() ?? { title: "Pocket", body: "" };
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url ?? "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((wins) =>
    wins.length ? wins[0].focus() : self.clients.openWindow(e.notification.data.url)));
});
