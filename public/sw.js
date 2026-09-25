// Pocket's service worker: a small program the phone keeps running beside the
// app. It does two jobs.
//
// 1. OFFLINE. It keeps a copy of the app's own files (the "shell") so Pocket
//    opens with no signal. Those are the only files cached, and only those:
//    the page, its script, its styles, the database library, the manifest and
//    the icons, and the brand font. Everything under /api is personal, changing data, so it is
//    NEVER cached here; the app keeps its own last-known copy instead and labels
//    it "saved copy" so stale data is never passed off as fresh.
//
// 2. NOTIFICATIONS. It receives the morning push and shows it, even when
//    Pocket is closed.

const VERSION = "pocket-v11"; // bump to force every phone to take a fresh copy
const SHELL = [
  "/", "/app.js", "/styles.css", "/vendor/supabase.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
  "/icons/tk-mark.png", "/fonts/plus-jakarta-sans.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, saved copy as the fallback. With a signal the phone always
// gets the newest app (the first plan, "show the saved copy, refresh it in the
// background", left phones one or two opens behind every deploy, which broke
// sign-in on day one). With no signal, or a signal too weak to answer in 3
// seconds, it opens from the saved copy.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const key = e.request.mode === "navigate" ? "/" : url.pathname;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    const slow = new Promise((r) => setTimeout(r, 3000)).then(() => cache.match(key));
    try {
      return (await Promise.race([net, slow])) ?? (await net);
    } catch {
      return (await cache.match(key)) ?? Response.error();
    }
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
