const C = 'sama-v1';
const SHELL = ['/', '/index.html', '/app.js', '/logic.js', '/i18n.js', '/style.css', '/manifest.webmanifest', '/icons/sama.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL))));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/') || u.pathname === '/stream') return; // live data always goes to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
