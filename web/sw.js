// Daybook's offline layer, on the phone: a page opens even when the Pi cannot be reached, showing what it
// showed last time, and a slow signal does not leave a blank screen.
//   /_v/<version>/…  scripts, styles, fonts, icons: never change under one name, so kept and served from here
//   a page           the network, unless it is slow (2 s) or not there: then the copy kept last time
//   an API read      the same, after 6 s; a kept answer carries X-Daybook-Kept, and the page says it is offline
// Writes always go to the Pi; Log keeps an entry made offline itself (web/core/outbox.js).
const FILES = 'daybook-files', KEPT = 'daybook-kept', MAX = 300;   // ponytail: a kept answer per URL, the oldest dropped past 300
const SKIP = /\/api\/(login|logout|t\/attachment|t\/inbox)|\/clip\//;  // sign-in, and photos and videos (big; fetched when opened)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || SKIP.test(u.pathname)) return;
  if (u.pathname.startsWith('/_v/')) e.respondWith(file(r));
  else if (r.mode === 'navigate') e.respondWith(fresh(r, 2000));
  else if (u.pathname.includes('/api/')) e.respondWith(fresh(r, 6000));
});

async function file(r) {
  const c = await caches.open(FILES), hit = await c.match(r);
  if (hit) return hit;
  const res = await fetch(r);
  if (res.ok) {
    await c.put(r, res.clone());
    // a file of a new version: Daybook was updated, and the old version's files are no use now
    const ver = `/_v/${new URL(r.url).pathname.split('/')[2]}/`;
    for (const k of await c.keys()) if (!new URL(k.url).pathname.startsWith(ver)) c.delete(k);
  }
  return res;
}

async function fresh(r, wait) {
  const c = await caches.open(KEPT);
  const net = fetch(r).then(res => {
    if (res.ok && !res.redirected) c.put(r, res.clone()).then(() => trim(c));   // only a good answer is kept
    return res;
  });
  const slow = new Promise(ok => setTimeout(ok, wait, 'slow'));
  try {
    const got = await Promise.race([net, slow]);
    if (got !== 'slow') return got;
    const hit = await kept(c, r);
    return hit || await net;                     // nothing kept: wait for the network after all
  } catch {
    return await kept(c, r) || Response.error();
  }
}

async function kept(c, r) {
  const hit = await c.match(r, { ignoreSearch: r.mode === 'navigate' });
  if (!hit) return null;
  const h = new Headers(hit.headers);
  h.set('X-Daybook-Kept', hit.headers.get('Date') || '1');
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
}

async function trim(c) {
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) await c.delete(k);
}
