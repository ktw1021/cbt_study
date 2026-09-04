/**
 * GitHub Pages가 JS/CSS를 캐시해서 배포 직후 옛 코드가 남는 것을 막는다.
 * 같은 사이트 GET만 네트워크에서 다시 받는다. IndexedDB는 HTTP가 아니라 건드리지 않음.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request)),
  );
});
