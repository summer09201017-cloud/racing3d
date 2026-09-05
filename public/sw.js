// 📲 簡易 SW(baseball3d 家族範式):全部 network-first、斷網退 cache。
// ★ 殼層(index.html / manifest / icon / sw 自己)有改就 bump 這個號碼(static-pwa-ship 鐵則)。
const CACHE = "racing3d-v2";   // v2 2026-09-06:極速/輔助開關/起跑格/人聲/雙人同機(index.html 殼層有改)
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
