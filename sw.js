/* Offline shell + Android share target */
const CACHE = 'verkaufsklar-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'tokens.css', 'app.js', 'editor.js', 'providers.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'share-inbox').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const cache = await caches.open('share-inbox');
      let i = 0;
      for (const f of form.getAll('photos')) { if (f && f.size) await cache.put(`./shared/${Date.now()}-${i++}`, new Response(f, { headers: { 'content-type': f.type || 'image/jpeg' } })); }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first so updates arrive; fall back to cache offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
