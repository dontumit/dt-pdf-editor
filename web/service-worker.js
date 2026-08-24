/**
 * Service Worker (spec ข้อ 33, 61, 62, 71)
 *
 * กฎสำคัญ:
 *   - แคชเฉพาะ application shell (HTML/CSS/JS/ฟอนต์/ไอคอน)
 *   - ห้ามแคชไฟล์ของผู้ใช้ (PDF/รูปภาพ/DOCX) และห้ามแคช API ที่มีข้อมูลส่วนตัว
 *   - แยกแคชเป็น STATIC / RUNTIME เพื่อให้ล้างเฉพาะส่วนได้
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE = `dtpdf-static-${VERSION}`;
const RUNTIME_CACHE = `dtpdf-runtime-${VERSION}`;
const VENDOR_CACHE = `dtpdf-vendor-${VERSION}`;

// ไฟล์ที่ต้องมีเสมอเพื่อให้เปิดแอปได้แม้ออฟไลน์
const APP_SHELL = [
  '/',
  '/assets/css/app.css',
  '/src/main.js',
  '/src/core/bootstrap.js',
  '/src/core/api.js',
  '/src/core/state.js',
  '/src/core/router.js',
  '/src/core/tools.js',
  '/src/ui/icons.js',
  '/src/ui/toast.js',
  '/src/pages/home.js',
  '/assets/fonts/Sarabun-Regular.ttf',
  '/assets/icons/icon.svg',
  '/manifest.json',
];

// เส้นทางที่ห้ามแคชเด็ดขาด เพราะเป็นข้อมูล/ไฟล์ของผู้ใช้
const NEVER_CACHE = [
  /^\/api\/files\//,
  /^\/api\/jobs\//,
  /^\/api\/history/,
  /^\/api\/admin\//,
  /^\/api\/auth\//,
  /^\/api\/heartbeat/,
  /^\/api\/visit/,
  /^\/api\/vitals/,
  /^\/s\//,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // ใช้ allSettled เพื่อไม่ให้ไฟล์เดียวพังทำให้ติดตั้งล้มเหลวทั้งหมด
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('dtpdf-') && ![STATIC_CACHE, RUNTIME_CACHE, VENDOR_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_TEMP') {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((pattern) => pattern.test(url.pathname))) return;

  // ไลบรารีขนาดใหญ่: cache-first ตลอด เพราะไม่เปลี่ยนภายในเวอร์ชันเดียวกัน
  if (url.pathname.startsWith('/assets/vendor/') || url.pathname.startsWith('/assets/fonts/')) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  // โมดูล JS และ CSS ของแอป: stale-while-revalidate ให้เปิดเร็วแต่ได้ของใหม่รอบถัดไป
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // เอกสาร HTML: network-first เพื่อให้ได้ค่า bootstrap ล่าสุดเสมอ
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  // API สาธารณะ (สถานะ/สถิติ): network-first พร้อม fallback แคชสั้น ๆ
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || network || fetch(request);
}

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    return (await cache.match('/')) || new Response(
      '<!doctype html><meta charset="utf-8"><title>ออฟไลน์</title>'
      + '<body style="font-family:sans-serif;text-align:center;padding:48px">'
      + '<h1>ออฟไลน์อยู่</h1><p>กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ success: false, errorCode: 'OFFLINE', message: 'ออฟไลน์อยู่ กรุณาเชื่อมต่ออินเทอร์เน็ต' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
