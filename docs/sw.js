const V = 'heirloom-v5';
const SHELL = ['./', 'index.html', 'assets/styles.css', 'assets/app.js', 'assets/notion-map.js', 'assets/content.js', 'assets/icons.svg', 'assets/sync-config.js', 'assets/data.json', 'vendor/force-graph.min.js', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'fonts/newsreader-latin-wght-normal.woff2', 'fonts/newsreader-latin-wght-italic.woff2', 'fonts/source-sans-3-latin-wght-normal.woff2', 'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2', 'favicon.svg', 'icon-192.png'];
const TILES = 'heirloom-tiles-v1', MAX_TILES = 800;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function trim() { const c = await caches.open(TILES); const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); }
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // network first for data and html so updates arrive; cache first for the rest
    const fresh = /data\.json$|\/$|index\.html$|app\.js$|notion-map\.js$|content\.js$|sync-config\.js$|styles\.css$/.test(u.pathname);
    e.respondWith(fresh
      ? fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))
      : caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
    return;
  }
  if (/openfreemap\.org$/.test(u.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { if (r.ok) { c.put(e.request, r.clone()); trim(); } return r; }).catch(() => hit); return hit || net; }));
  }
});
