// Service worker: adds COOP + COEP headers to every response so the page
// becomes cross-origin isolated, which is required for SharedArrayBuffer.
// Intercepting ALL fetch events (not just navigate) means cross-origin
// sub-resources are routed through the SW's same-origin fetch context,
// satisfying require-corp without blocking them.

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(r => {
      const h = new Headers(r.headers);
      h.set('Cross-Origin-Opener-Policy',   'same-origin');
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }).catch(() => fetch(e.request))
  );
});
