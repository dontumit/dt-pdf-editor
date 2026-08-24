/**
 * ส่ง heartbeat / visit / web vitals ไปยังเซิร์ฟเวอร์
 * เป็นแหล่งข้อมูลจริงของตัวเลข "กำลังใช้งาน" และ "ผู้เข้าชม" (spec ข้อ 8, 9, 51)
 */
import api from '../core/api.js';
import bootstrap from '../core/bootstrap.js';
import appState from '../core/state.js';

let heartbeatTimer = null;
let statsTimer = null;
let lastVisitPath = null;

function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function browserKind() {
  const ua = navigator.userAgent;
  if (/Line\//i.test(ua)) return 'line';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Chrome\//i.test(ua)) return 'chrome';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Safari\//i.test(ua)) return 'safari';
  return 'other';
}

async function sendHeartbeat() {
  if (document.visibilityState === 'hidden') return;
  try {
    const res = await api.post('/api/heartbeat', {
      page: location.pathname,
      device: deviceKind(),
      browser: browserKind(),
    }, { timeout: 10000 });
    appState.set((state) => ({
      ...state,
      stats: { ...state.stats, online: { ...state.stats.online, total: res.online } },
    }));
  } catch { /* heartbeat ล้มเหลวไม่ควรรบกวนผู้ใช้ */ }
}

export function recordPageView(path = location.pathname) {
  if (path === lastVisitPath) return;
  lastVisitPath = path;
  api.beacon('/api/visit', {
    page: path,
    referrer: document.referrer || '',
    isLiff: appState.get().isLiff,
  });
}

export async function refreshStats() {
  try {
    const res = await api.get('/api/stats/public', { timeout: 10000 });
    appState.set({ stats: { online: res.online, today: res.today, total: res.total } });
    return res;
  } catch { return null; }
}

export function startTelemetry() {
  const interval = Math.max(10, bootstrap.heartbeatInterval) * 1000;
  sendHeartbeat();
  refreshStats();

  heartbeatTimer = setInterval(sendHeartbeat, interval);
  statsTimer = setInterval(refreshStats, Math.max(interval * 2, 45000));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { sendHeartbeat(); refreshStats(); }
  });
  window.addEventListener('dtpdf:navigated', (event) => recordPageView(event.detail.path));
  window.addEventListener('online', () => appState.set({ online: true }));
  window.addEventListener('offline', () => appState.set({ online: false }));

  collectWebVitals();
}

export function stopTelemetry() {
  clearInterval(heartbeatTimer);
  clearInterval(statsTimer);
}

/**
 * เก็บ Core Web Vitals ด้วย PerformanceObserver โดยตรง (spec ข้อ 51, 93)
 * ไม่พึ่ง library ภายนอกเพื่อไม่ให้ bundle แรกใหญ่ขึ้น
 */
function collectWebVitals() {
  if (!('PerformanceObserver' in window)) return;
  const collected = [];
  const rate = (metric, value) => {
    const thresholds = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
    const [good, poor] = thresholds[metric] || [Infinity, Infinity];
    return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
  };
  const push = (name, value) => {
    collected.push({ name, value, rating: rate(name, value), page: location.pathname, device: deviceKind() });
  };

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) push('LCP', last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') push('FCP', entry.startTime);
      }
    }).observe({ type: 'paint', buffered: true });

    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    let maxInp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        maxInp = Math.max(maxInp, entry.duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });

    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) push('TTFB', navigation.responseStart);

    // ส่งเมื่อผู้ใช้กำลังจะออกจากหน้า
    const flush = () => {
      if (clsValue > 0) push('CLS', Number(clsValue.toFixed(4)));
      if (maxInp > 0) push('INP', maxInp);
      if (!collected.length) return;
      api.beacon('/api/vitals', { metrics: collected.splice(0, collected.length) });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  } catch { /* เบราว์เซอร์เก่าไม่รองรับ ข้ามไป */ }
}
