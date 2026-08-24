/**
 * จุดเริ่มต้นของแอป
 * โหลดเฉพาะสิ่งที่จำเป็นต่อการแสดงหน้าแรก ส่วนที่เหลือโหลดแบบ lazy (spec ข้อ 91, 92)
 */
import bootstrap from './core/bootstrap.js';
import appState from './core/state.js';
import { route, setNotFound, startRouter, navigate } from './core/router.js';
import { initTheme, refreshUser } from './services/auth.js';
import { startTelemetry, recordPageView } from './services/telemetry.js';
import { initLiff } from './line/liff.js';
import idb from './core/idb.js';
import icon from './ui/icons.js';
import { formatNumber } from './utils/format.js';
import { toastInfo } from './ui/toast.js';

// ---------------- Routes ----------------
route('/', () => import('./pages/home.js'));
route('/tools', () => import('./pages/tools.js'));
route('/tools/:category', () => import('./pages/tools.js'));
route('/tool/:id', () => import('./pages/tool.js'));
route('/scan', () => import('./pages/scan.js'));
route('/history', () => import('./pages/history.js'));
route('/files', () => import('./pages/history.js'));
route('/settings', () => import('./pages/settings.js'));
route('/account', () => import('./pages/settings.js'));
route('/help', () => import('./pages/help.js'));
route('/privacy', () => import('./pages/privacy.js'));
route('/status', () => import('./pages/status.js'));
route('/login', () => import('./pages/login.js'));
setNotFound(() => import('./pages/notfound.js'));

// ---------------- Bottom navigation ----------------
const NAV_ITEMS = [
  { path: '/', label: 'หน้าแรก', icon: 'home' },
  { path: '/tools', label: 'เครื่องมือ', icon: 'grid' },
  { path: '/scan', label: 'สแกน', icon: 'camera' },
  { path: '/history', label: 'ล่าสุด', icon: 'clock' },
  { path: '/settings', label: 'ตั้งค่า', icon: 'sun' },
];

function renderNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const current = location.pathname.replace(/\/+$/, '') || '/';
  nav.innerHTML = NAV_ITEMS.map((item) => {
    const active = item.path === '/'
      ? current === '/'
      : current === item.path || current.startsWith(`${item.path}/`);
    return `<a class="bottom-nav__item" href="${item.path}" data-link ${active ? 'aria-current="page"' : ''}>
      ${icon(item.icon, { size: 23, stroke: active ? 2.2 : 1.9 })}
      <span>${item.label}</span>
    </a>`;
  }).join('');
}

// ---------------- Header ----------------
function renderHeader() {
  const container = document.getElementById('header-actions');
  if (!container) return;
  const state = appState.get();

  const themeIcon = state.theme === 'dark' ? 'sun' : 'moon';
  const parts = [
    `<button class="icon-btn" id="theme-toggle" aria-label="สลับธีมสว่าง/มืด" title="สลับธีม">${icon(themeIcon, { size: 19 })}</button>`,
  ];

  if (state.authenticated && state.user) {
    parts.push(state.user.pictureUrl
      ? `<a class="icon-btn icon-btn--avatar" href="/settings" data-link aria-label="บัญชีของฉัน">
           <img src="${state.user.pictureUrl}" alt="" referrerpolicy="no-referrer">
         </a>`
      : `<a class="icon-btn" href="/settings" data-link aria-label="บัญชีของฉัน">${icon('user', { size: 19 })}</a>`);
  } else {
    parts.push(`<a class="icon-btn" href="/login" data-link aria-label="เข้าสู่ระบบ">${icon('user', { size: 19 })}</a>`);
  }

  container.innerHTML = parts.join('');
  container.querySelector('#theme-toggle')?.addEventListener('click', async () => {
    const { savePreferences } = await import('./services/auth.js');
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(appState.get().theme) + 1) % order.length];
    await savePreferences({ theme: next });
    renderHeader();
  });
}

function renderBranding() {
  document.getElementById('brand-title').textContent = bootstrap.appName;
  document.getElementById('footer-name').textContent = bootstrap.appName;
  const subtitle = document.getElementById('brand-subtitle');
  subtitle.textContent = bootstrap.orgName || 'เครื่องมือ PDF ครบจบในที่เดียว';
  if (bootstrap.orgName) {
    document.getElementById('footer-org').textContent = bootstrap.orgName;
  }
  // บรรทัดเครดิตผู้พัฒนา — ใช้ textContent เพื่อกัน XSS จากค่าที่ตั้งใน environment
  const creditEl = document.getElementById('footer-credit');
  if (creditEl && bootstrap.creditText) creditEl.textContent = bootstrap.creditText;
  document.title = `${bootstrap.appName} — เครื่องมือ PDF ครบจบในที่เดียว`;
}

// ---------------- Service worker ----------------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'http:' && location.hostname !== 'localhost') return;
  try {
    const registration = await navigator.serviceWorker.register(
      `/service-worker.js?v=${bootstrap.cacheVersion}`,
      { scope: '/' },
    );
    // แจ้งเตือนเมื่อมีเวอร์ชันใหม่ (spec ข้อ 32)
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toastInfo('มีเวอร์ชันใหม่พร้อมใช้งาน', {
            duration: 12000,
            action: {
              label: 'อัปเดต',
              onClick: () => {
                installing.postMessage({ type: 'SKIP_WAITING' });
                location.reload();
              },
            },
          });
        }
      });
    });
  } catch (err) {
    console.warn('service worker registration failed', err);
  }
}

// ---------------- กู้คืนงานที่ค้าง (spec ข้อ 107) ----------------
/**
 * ถามกู้คืนงานที่ค้างเฉพาะตอนที่ผู้ใช้ยังไม่ได้เริ่มทำอย่างอื่น
 *
 * เดิมหน้าต่างนี้เด้งขึ้นมาทับทุกหน้า ทำให้ขัดจังหวะคนที่กำลังใช้เครื่องมืออื่นอยู่
 * จึงจำกัดให้ถามเฉพาะบนหน้าแรก และถามครั้งเดียวต่อหนึ่งงาน
 */
async function checkCrashRecovery() {
  const currentPath = location.pathname.replace(/\/+$/, '') || '/';
  if (currentPath !== '/') return;

  try {
    const projects = await idb.listProjects();
    const recent = projects.find((project) => (
      Date.now() - project.updatedAt < 24 * 3600 * 1000
      && !project.data?.completed
      && !project.data?.prompted
      && Array.isArray(project.data?.elements)
      && project.data.elements.length > 0
    ));
    if (!recent) return;

    // ทำเครื่องหมายว่าเคยถามแล้ว จะได้ไม่ถามซ้ำทุกครั้งที่เปิดเว็บ
    await idb.saveProject(recent.id, { ...recent.data, prompted: true });

    const { confirmDialog } = await import('./ui/modal.js');
    const restore = await confirmDialog({
      title: 'พบงานที่ยังไม่ได้บันทึก',
      message: `พบงาน "${recent.data?.toolName || 'ไม่ระบุ'}" จาก ${recent.data?.fileName || 'ไฟล์ก่อนหน้า'} ที่ค้างอยู่ ต้องการกู้คืนหรือไม่`,
      confirmLabel: 'กู้คืน',
      cancelLabel: 'ลบทิ้ง',
    });
    if (restore) navigate(`/tool/${recent.data.toolId}?restore=${encodeURIComponent(recent.id)}`);
    else await idb.deleteProject(recent.id);
  } catch { /* ไม่สำคัญพอจะรบกวนผู้ใช้ */ }
}

// ---------------- Boot ----------------
async function boot() {
  initTheme();
  renderBranding();
  renderNav();
  renderHeader();

  appState.subscribe(() => { renderHeader(); });
  window.addEventListener('dtpdf:navigated', renderNav);

  startRouter();
  recordPageView();

  // งานที่ไม่ต้องรอ ทำแบบขนานเพื่อให้หน้าแรกแสดงเร็วที่สุด
  const liffResult = await initLiff();
  if (!liffResult.isLiff) await refreshUser();

  startTelemetry();
  registerServiceWorker();
  idb.cleanup();
  setTimeout(checkCrashRecovery, 1800);

  // แจ้งเตือนเมื่อออฟไลน์
  appState.subscribe((state) => {
    document.body.dataset.offline = String(!state.online);
  });
  window.addEventListener('offline', () => {
    toastInfo('ออฟไลน์อยู่ — เครื่องมือที่ประมวลผลบนเครื่องยังใช้งานได้ตามปกติ', { duration: 6000 });
  });
}

boot().catch((err) => {
  console.error('boot failed', err);
  document.getElementById('view').innerHTML = `
    <div class="error-box">
      <div class="error-box__title">เริ่มระบบไม่สำเร็จ</div>
      <p>กรุณารีเฟรชหน้าเว็บ หากยังพบปัญหาให้ลองล้างแคชของเบราว์เซอร์</p>
      <div class="error-box__actions">
        <button class="btn btn--sm btn--primary" onclick="location.reload()">โหลดใหม่</button>
      </div>
    </div>`;
});

export { formatNumber };
