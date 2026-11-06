// v98: futár offline – az oldal és a statikus fájlok gyorsítótárból is megnyílnak, ha nincs térerő.
// Az /api/ kérések soha nem kerülnek ide: a feladatokat és a sorban álló műveleteket maga az oldal tárolja.
const CACHE = "gg-courier-v1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/logo.png"])).catch(() => undefined));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gg-courier-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    // Hálózat elsőként; ha nincs, az utoljára sikeresen betöltött futároldal.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/courier", copy));
          }
          return res;
        })
        .catch(() => caches.match("/courier").then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/") || /\.(png|svg|css|js|woff2?)$/.test(url.pathname)) {
    // A fájlnevek tartalomhoz kötöttek (nem változnak), ezért előbb a gyorsítótár.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
