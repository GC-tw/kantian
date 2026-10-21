// 看天爬山：離線查看（2026-10-21 使用者決定）
// 有網路時一律先抓最新的網頁與預報，順便存一份在手機裡；沒有網路時改用存著的版本。
// 從存檔拿出來的預報會加上 x-kantian-offline 標記，網頁看到後顯示「目前沒有網路」提示。
const CACHE = 'kantian-v1';
const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const keyOf = req => { const u = new URL(req.url); u.search = ''; return u.href; };   // forecast.json?t=… 都存成同一份

async function networkFirst(req, mark){
  const c = await caches.open(CACHE);
  try{
    const r = await fetch(req, {cache: 'no-store'});
    if (r.ok) await c.put(keyOf(req), r.clone());
    return r;
  }catch(e){
    const hit = await c.match(keyOf(req));
    if (!hit) throw e;
    if (!mark) return hit;
    const h = new Headers(hit.headers); h.set('x-kantian-offline', '1');
    return new Response(await hit.blob(), {status: 200, headers: h});
  }
}
async function cacheFirst(req){                       // 字型、圖示：不會變，存過就直接用
  const c = await caches.open(CACHE), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') await c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (FONT.test(req.url)) return e.respondWith(cacheFirst(req));
  if (u.origin !== location.origin) return;
  if (u.pathname.endsWith('/forecast.json')) return e.respondWith(networkFirst(req, true));
  if (req.mode === 'navigate' || u.pathname.endsWith('/index.html')) return e.respondWith(networkFirst(req, false));
  if (/\.(png|svg|webmanifest)$/.test(u.pathname)) return e.respondWith(cacheFirst(req));
});
