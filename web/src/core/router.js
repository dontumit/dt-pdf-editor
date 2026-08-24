/**
 * Router แบบ History API — ไม่ใช้ hash เพื่อให้ URL สวยและแชร์ได้
 * โหลดหน้าแบบ dynamic import ทำให้ bundle แรกเล็ก (spec ข้อ 91)
 */
const routes = [];
let currentCleanup = null;
let notFoundHandler = null;

export function route(pattern, loader) {
  const keys = [];
  const regex = new RegExp(`^${pattern
    .replace(/\/:([A-Za-z]+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; })
    .replace(/\*/g, '.*')}/?$`);
  routes.push({ regex, keys, loader });
}

export function setNotFound(loader) { notFoundHandler = loader; }

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

function matchRoute(pathname) {
  for (const item of routes) {
    const match = pathname.match(item.regex);
    if (match) {
      const params = {};
      item.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); });
      return { loader: item.loader, params };
    }
  }
  return null;
}

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const view = document.getElementById('view');
  if (!view) return;

  // เรียก cleanup ของหน้าเดิม เพื่อคืนหน่วยความจำ/ยกเลิกงานที่ค้าง (spec ข้อ 70)
  if (currentCleanup) {
    try { await currentCleanup(); } catch (err) { console.error('cleanup failed', err); }
    currentCleanup = null;
  }

  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const matched = matchRoute(pathname);
  const query = Object.fromEntries(new URLSearchParams(location.search));

  view.innerHTML = '<div class="skeleton" style="height:180px;margin-bottom:12px"></div><div class="skeleton" style="height:120px"></div>';

  try {
    const loader = matched?.loader || notFoundHandler;
    if (!loader) { view.innerHTML = ''; return; }
    const module = await loader();
    if (token !== renderToken) return; // ผู้ใช้เปลี่ยนหน้าไปแล้วระหว่างโหลด
    view.innerHTML = '';
    const result = await module.default({
      root: view,
      params: matched?.params || {},
      query,
      path: pathname,
    });
    if (token !== renderToken) {
      if (typeof result === 'function') await result();
      return;
    }
    currentCleanup = typeof result === 'function' ? result : null;
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    window.dispatchEvent(new CustomEvent('dtpdf:navigated', { detail: { path: pathname } }));
  } catch (err) {
    console.error('route render failed', err);
    if (token !== renderToken) return;
    view.innerHTML = `
      <div class="error-box">
        <div class="error-box__title">เปิดหน้านี้ไม่สำเร็จ</div>
        <p>${err.message === 'Failed to fetch dynamically imported module'
          ? 'โหลดส่วนประกอบของหน้าไม่สำเร็จ อาจเกิดจากอินเทอร์เน็ตขัดข้อง'
          : 'เกิดข้อผิดพลาดที่ไม่คาดคิด'}</p>
        <div class="error-box__actions">
          <button class="btn btn--sm btn--primary" onclick="location.reload()">โหลดใหม่</button>
          <a class="btn btn--sm" href="/" data-link>กลับหน้าแรก</a>
        </div>
      </div>`;
  }
}

/** ดักคลิกลิงก์ภายในทั้งหมดให้ใช้ router แทนการโหลดหน้าใหม่ */
export function startRouter() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || link.target === '_blank') return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', render);
  render();
}
