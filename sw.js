/* Service Worker: アプリシェルをキャッシュしてオフライン起動を可能にする。
   API通信（api.openai.com）はキャッシュせず常にネットワークへ。 */
const CACHE = 'ggai-report-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API呼び出しやクロスオリジンはキャッシュ介さずネットワーク直行
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // アプリシェル: cache-first, フォールバックでnetwork
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
