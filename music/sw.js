// 香布纏原聲帶 PWA。快取照壽命分兩層，名字都帶 buchanost- 前綴（同 origin 別站的快取不碰）：
//   SHELL：頁面、曲目表、manifest、圖示，每次部署換名（版號由 music_player.py 用內容 hash 產生）
//   ASSET：封面、CG、音檔，用到才存（作者 2026-10-05：初次載入不要先載全部），換內容的檔一定換檔名，所以這層不跟著部署換
const SHELL = "buchanost-shell-73fe8c6bf4", ASSET = "buchanost-asset-v1";
const SHELL_FILES = ["./", "index.html", "tracks.json", "manifest.webmanifest", "icons/icon-v1-192.png", "icons/icon-v1-512.png", "icons/icon-v1-32.png"];
const KEEP = [SHELL, ASSET];
const M = { ignoreSearch: true, ignoreVary: true };

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.allSettled(SHELL_FILES.map(f => c.add(f)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("buchanost-") && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const pending = new Set();
function storeFull(url) {   // 音檔：播放器要的是 Range，第一次播就在背景把整首抓下來存，下次離線也能播
  if (pending.has(url)) return Promise.resolve();
  pending.add(url);
  return caches.open(ASSET).then(async c => {
    if (await c.match(url, M)) return;
    const r = await fetch(url, { mode: "cors" });
    if (r.ok && r.status === 200) await c.put(url, r);
  }).catch(() => {}).finally(() => pending.delete(url));
}
async function ranged(req, res) {   // 快取裡是整首，播放器要一段：自己合成 206
  const range = req.headers.get("range");
  if (!range) return res;
  const b = await res.arrayBuffer(), m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], b.byteLength - 1) : b.byteLength - 1;
  return new Response(b.slice(s, e + 1), { status: 206, headers: {
    "Content-Type": res.headers.get("Content-Type") || "audio/mpeg", "Content-Range": `bytes ${s}-${e}/${b.byteLength}`,
    "Content-Length": String(e - s + 1), "Accept-Ranges": "bytes" } });
}

// waitUntil 一定要在事件處理函式裡同步叫：寫在 then 裡面會丟 InvalidStateError，respondWith 跟著失敗，圖載不出來、音樂播到一半卡住（2026-10-05 實測）
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const isAudio = /\.mp3$/i.test(url.pathname), isImg = /\.(webp|avif|png|jpg)$/i.test(url.pathname);
  let put = Promise.resolve();
  const keep = (cache, key) => r => { if (r.ok && r.status === 200) { const cp = r.clone(); put = caches.open(cache).then(c => c.put(key, cp)).catch(() => {}); } return r; };
  if (req.mode === "navigate" || /\/(tracks\.json|manifest\.webmanifest)$/.test(url.pathname)) {   // 頁面與曲目表：網路優先，離線吃快取
    const work = fetch(req).then(keep(SHELL, req)).catch(() => caches.match(req, M).then(r => r || caches.match("index.html", M)));
    e.respondWith(work); e.waitUntil(work.then(() => put));
    return;
  }
  if (isAudio) {
    const hit = caches.match(req.url, M);
    e.respondWith(hit.then(h => h ? ranged(req, h) : fetch(req)));
    e.waitUntil(hit.then(h => h ? null : storeFull(req.url)));
    return;
  }
  if (isImg) {   // 封面與 CG：快取優先，用到才存
    const work = caches.match(req, M).then(h => h || fetch(req).then(keep(ASSET, req)));
    e.respondWith(work); e.waitUntil(work.then(() => put, () => {}));
  }
});
