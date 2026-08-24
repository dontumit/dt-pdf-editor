/**
 * แผงผู้ดูแลระบบ (spec ข้อ 48-52, 83, 86, 108)
 * ตัวเลขทุกตัวมาจาก API จริง ไม่มีข้อมูลจำลอง
 */
import api from '../core/api.js';
import bootstrap from '../core/bootstrap.js';
import { initTheme } from '../services/auth.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { formatNumber, formatBytes, formatDate, formatDuration, formatPercent, escapeHtml, formatRelative } from '../utils/format.js';
import { lineChart, barList, gauge, metricCard } from './charts.js';
import { getTool } from '../core/tools.js';

const TABS = [
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'traffic', label: 'ผู้ใช้งาน' },
  { id: 'tools', label: 'เครื่องมือ' },
  { id: 'jobs', label: 'งานประมวลผล' },
  { id: 'system', label: 'สุขภาพระบบ' },
  { id: 'settings', label: 'ตั้งค่าระบบ' },
  { id: 'logs', label: 'บันทึกการใช้งาน' },
];

const view = document.getElementById('admin-view');
const tabsEl = document.getElementById('admin-tabs');
let activeTab = location.hash.replace('#', '') || 'overview';
let refreshTimer = null;

initTheme();
document.getElementById('admin-subtitle').textContent = bootstrap.appName;
const creditEl = document.getElementById('footer-credit');
if (creditEl && bootstrap.creditText) creditEl.textContent = bootstrap.creditText;

document.getElementById('admin-logout').addEventListener('click', async () => {
  if (!await confirmDialog({ title: 'ออกจากระบบ', message: 'ต้องการออกจากระบบผู้ดูแลหรือไม่', danger: true })) return;
  await api.post('/api/auth/logout', {});
  location.href = '/';
});

boot();

async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    if (!me.authenticated || me.user?.role !== 'admin') { renderLogin(); return; }
    renderTabs();
    await renderTab(activeTab);
    startAutoRefresh();
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  tabsEl.innerHTML = '';
  view.innerHTML = `
    <div class="card admin-login">
      <div class="card__title" style="font-size:17px">เข้าสู่ระบบผู้ดูแล</div>
      <p class="card__hint">ใช้บัญชีผู้ดูแลที่ตั้งไว้ใน environment หรือเข้าสู่ระบบด้วย LINE ที่อยู่ในรายชื่อผู้ดูแล</p>
      <form id="admin-login-form" style="margin-top:14px">
        <div class="field"><label class="field__label">ชื่อผู้ใช้</label>
          <input type="text" id="admin-user" autocomplete="username" required></div>
        <div class="field"><label class="field__label">รหัสผ่าน</label>
          <input type="password" id="admin-pass" autocomplete="current-password" required></div>
        <button class="btn btn--primary btn--block" type="submit">เข้าสู่ระบบ</button>
      </form>
      <div style="text-align:center;margin-top:14px">
        <a href="/api/auth/line/start?next=/admin" class="btn btn--line btn--block">เข้าสู่ระบบด้วย LINE</a>
      </div>
      <div style="text-align:center;margin-top:12px"><a href="/" style="font-size:13px">กลับหน้าเว็บหลัก</a></div>
    </div>`;

  view.querySelector('#admin-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await api.post('/api/auth/admin/login', {
        username: view.querySelector('#admin-user').value,
        password: view.querySelector('#admin-pass').value,
      });
      toastSuccess('เข้าสู่ระบบสำเร็จ');
      location.reload();
    } catch (err) {
      toastError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      button.disabled = false;
    }
  });
}

function renderTabs() {
  tabsEl.innerHTML = TABS.map((tab) => `
    <button class="admin-tab" role="tab" data-tab="${tab.id}"
      aria-selected="${tab.id === activeTab}">${tab.label}</button>`).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      activeTab = button.dataset.tab;
      location.hash = activeTab;
      tabsEl.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === button)));
      await renderTab(activeTab);
    });
  });
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const stats = await api.get('/api/stats/online');
      document.getElementById('hdr-online').textContent = formatNumber(stats.online);
      if (['overview', 'system', 'jobs'].includes(activeTab)) await renderTab(activeTab, { silent: true });
    } catch { /* ไม่ต้องรบกวนผู้ดูแล */ }
  }, 20000);
}

const RENDERERS = {
  overview: renderOverview,
  traffic: renderTraffic,
  tools: renderTools,
  jobs: renderJobs,
  system: renderSystem,
  settings: renderSettings,
  logs: renderLogs,
};

async function renderTab(tab, { silent = false } = {}) {
  const renderer = RENDERERS[tab] || renderOverview;
  if (!silent) view.innerHTML = '<div class="skeleton" style="height:240px"></div>';
  try {
    await renderer();
  } catch (err) {
    view.innerHTML = `<div class="error-box"><div class="error-box__title">โหลดข้อมูลไม่สำเร็จ</div>
      <p style="font-size:13.5px;margin:0">${escapeHtml(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------- ภาพรวม
async function renderOverview() {
  const [overview, series] = await Promise.all([
    api.get('/api/admin/overview'),
    api.get('/api/admin/series?days=14'),
  ]);
  document.getElementById('hdr-online').textContent = formatNumber(overview.online.total);

  view.innerHTML = `
    <div class="metric-grid">
      ${metricCard({ label: 'กำลังใช้งานขณะนี้', value: formatNumber(overview.online.total), sub: `ผู้ใช้ทั่วไป ${overview.online.byType.guest} · LINE ${overview.online.byType.line}`, color: '#4fd1b5' })}
      ${metricCard({ label: 'ผู้เข้าชมวันนี้', value: formatNumber(overview.today.visitors), sub: `เปิดหน้าเว็บ ${formatNumber(overview.today.visits)} ครั้ง`, color: '#7c6bf5' })}
      ${metricCard({ label: 'งานวันนี้', value: formatNumber(overview.today.jobs), sub: `สำเร็จ ${overview.today.jobsSuccess} · ล้มเหลว ${overview.today.jobsFailed}`, color: '#ff8ec7' })}
      ${metricCard({ label: 'ไฟล์ที่ประมวลผลวันนี้', value: formatNumber(overview.today.files), sub: `รวม ${formatBytes(overview.today.bytesIn)}`, color: '#ffc857' })}
      ${metricCard({ label: 'ผู้ใช้ทั้งหมด', value: formatNumber(overview.total.users), sub: `ผ่าน LINE ${formatNumber(overview.total.lineUsers)}`, color: '#60a5fa' })}
      ${metricCard({ label: 'ผู้เข้าชมสะสม', value: formatNumber(overview.total.visits), sub: `ไม่ซ้ำ ${formatNumber(overview.total.uniqueVisitors)}`, color: '#f97316' })}
    </div>

    <div class="chart-card">
      <div class="chart-card__head"><h3>ผู้ใช้งานและงานประมวลผล 14 วันล่าสุด</h3></div>
      ${lineChart({
        data: series.series,
        series: [
          { key: 'uniqueSessions', label: 'ผู้เข้าชม (ไม่ซ้ำ)', color: '#7c6bf5' },
          { key: 'jobs', label: 'งานทั้งหมด', color: '#4fd1b5' },
        ],
        formatX: (row) => row.day.slice(5).replace('-', '/'),
      })}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
      <div class="chart-card">
        <div class="chart-card__head"><h3>อัตราความสำเร็จ 7 วัน</h3></div>
        ${overview.jobs7d.successRate === null
          ? '<div class="empty-state" style="padding:20px">ยังไม่มีงานในช่วงนี้</div>'
          : gauge({
            ratio: overview.jobs7d.successRate,
            color: overview.jobs7d.successRate > 0.9 ? '#4fd1b5' : '#ffc857',
            label: `สำเร็จ ${formatNumber(overview.jobs7d.success)} จาก ${formatNumber(overview.jobs7d.total)} งาน`
              + (overview.jobs7d.avgProcessingMs ? ` · เฉลี่ย ${formatDuration(overview.jobs7d.avgProcessingMs)}` : ''),
          })}
      </div>
      <div class="chart-card">
        <div class="chart-card__head"><h3>คิวและพื้นที่จัดเก็บ</h3></div>
        <div style="display:grid;gap:9px;font-size:14px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">รอคิว</span><strong>${overview.queue.waiting}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">กำลังประมวลผล</span><strong>${overview.queue.processing}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">ไฟล์ชั่วคราวบนดิสก์</span><strong>${overview.storage.files} ไฟล์</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">พื้นที่ที่ใช้</span><strong>${formatBytes(overview.storage.bytes)}</strong></div>
        </div>
        <button class="btn btn--sm btn--block" id="run-cleanup" style="margin-top:12px">ล้างไฟล์ชั่วคราวทันที</button>
      </div>
    </div>

    ${overview.online.topPages.length ? `
      <div class="chart-card">
        <div class="chart-card__head"><h3>หน้าที่มีคนใช้อยู่ตอนนี้</h3></div>
        ${barList({
          items: overview.online.topPages.map((p) => ({ label: p.page, value: p.count })),
          suffix: ' คน',
        })}
      </div>` : ''}`;

  view.querySelector('#run-cleanup')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const result = await api.post('/api/admin/cleanup', {});
      toastSuccess(`ล้างแล้ว ${result.filesRemoved} ไฟล์ คืนพื้นที่ ${formatBytes(result.bytesFreed)}`);
      await renderTab('overview');
    } catch (err) { toastError(err.message); }
  });
}

// ---------------------------------------------------------------- ผู้ใช้งาน
async function renderTraffic() {
  const [series, users] = await Promise.all([
    api.get('/api/admin/series?days=30'),
    api.get('/api/admin/users?limit=50'),
  ]);

  view.innerHTML = `
    <div class="chart-card">
      <div class="chart-card__head"><h3>ผู้เข้าชมรายวัน 30 วัน</h3></div>
      ${lineChart({
        data: series.series,
        series: [
          { key: 'visits', label: 'เปิดหน้าเว็บ', color: '#7c6bf5' },
          { key: 'uniqueSessions', label: 'ผู้เข้าชมไม่ซ้ำ', color: '#4fd1b5' },
          { key: 'newUsers', label: 'ผู้ใช้ใหม่', color: '#ff8ec7' },
        ],
        formatX: (row) => row.day.slice(5).replace('-', '/'),
        height: 210,
      })}
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-weight:700;font-size:15px">ผู้ใช้ล่าสุด (${users.users.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>ผู้ใช้</th><th>ช่องทาง</th><th>สิทธิ์</th><th>เพิ่มเพื่อน</th><th>เข้าใช้ล่าสุด</th></tr></thead>
        <tbody>${users.users.length ? users.users.map((user) => `
          <tr>
            <td>${escapeHtml(user.displayName || '(ไม่ระบุชื่อ)')}<br>
              <span style="font-size:11px;color:var(--text-faint)">${escapeHtml(user.ref.slice(0, 12))}</span></td>
            <td>${user.provider === 'line' ? 'LINE' : 'ภายในระบบ'}</td>
            <td><span class="badge" ${user.role === 'admin' ? 'data-status="PROCESSING"' : ''}>${user.role === 'admin' ? 'ผู้ดูแล' : 'ผู้ใช้'}</span></td>
            <td>${user.isFriend ? '<span class="badge" data-status="SUCCESS">เพิ่มแล้ว</span>' : '<span class="badge">ยังไม่เพิ่ม</span>'}</td>
            <td>${user.lastLoginAt ? formatRelative(user.lastLoginAt) : '-'}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">ยังไม่มีผู้ใช้ที่เข้าสู่ระบบ</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}

// ---------------------------------------------------------------- เครื่องมือ
async function renderTools() {
  const res = await api.get('/api/admin/tools?days=30');
  const items = res.tools.map((item) => {
    const tool = getTool(item.tool);
    return { ...item, label: tool?.name.th || item.tool };
  });

  view.innerHTML = `
    <div class="chart-card">
      <div class="chart-card__head"><h3>เครื่องมือยอดนิยม 30 วัน</h3></div>
      ${barList({ items: items.map((i) => ({ label: i.label, value: i.uses })), suffix: ' ครั้ง' })}
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-weight:700;font-size:15px">รายละเอียดการใช้งาน</div>
      <div class="table-wrap"><table>
        <thead><tr><th>เครื่องมือ</th><th>ใช้งาน</th><th>สำเร็จ</th><th>ล้มเหลว</th><th>เวลาเฉลี่ย</th></tr></thead>
        <tbody>${items.length ? items.map((item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${formatNumber(item.uses)}</td>
            <td style="color:var(--success)">${formatNumber(item.success)}</td>
            <td style="color:${item.failed ? 'var(--danger)' : 'var(--text-faint)'}">${formatNumber(item.failed)}</td>
            <td>${item.avgMs ? formatDuration(item.avgMs) : '-'}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">ยังไม่มีการใช้งานในช่วงนี้</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}

// ---------------------------------------------------------------- งานประมวลผล
async function renderJobs() {
  const res = await api.get('/api/admin/jobs?limit=80');
  const STATUS_LABEL = {
    SUCCESS: 'สำเร็จ', FAILED: 'ล้มเหลว', PROCESSING: 'กำลังทำ',
    WAITING: 'รอคิว', CANCELLED: 'ยกเลิก', EXPIRED: 'หมดอายุ',
  };

  view.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;display:flex;align-items:center;gap:10px">
        <span style="font-weight:700;font-size:15px;flex:1">งานล่าสุด (${res.jobs.length})</span>
        <button class="btn btn--sm" id="refresh-jobs">รีเฟรช</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>เครื่องมือ</th><th>ที่มา</th><th>ผู้ใช้</th><th>ขนาด</th><th>ใช้เวลา</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${res.jobs.length ? res.jobs.map((job) => {
          const tool = getTool(job.tool);
          return `<tr>
            <td style="white-space:nowrap">${formatRelative(job.createdAt)}</td>
            <td>${escapeHtml(tool?.name.th || job.tool)}</td>
            <td>${job.mode === 'server' ? '<span class="badge" data-status="PROCESSING">เซิร์ฟเวอร์</span>' : '<span class="badge">เครื่องผู้ใช้</span>'}</td>
            <td>${job.userType}</td>
            <td style="white-space:nowrap">${formatBytes(job.bytesIn)}${job.bytesOut ? ` &rarr; ${formatBytes(job.bytesOut)}` : ''}</td>
            <td>${job.processingMs ? formatDuration(job.processingMs) : '-'}</td>
            <td><span class="badge" data-status="${job.status}">${STATUS_LABEL[job.status] || job.status}</span>
              ${job.errorCode ? `<div style="font-size:11px;color:var(--danger)">${escapeHtml(job.errorCode)}</div>` : ''}</td>
            <td>${['WAITING', 'PROCESSING'].includes(job.status)
              ? `<button class="btn btn--sm btn--danger" data-cancel="${job.jobId}">ยกเลิก</button>` : ''}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">ยังไม่มีงาน</td></tr>'}
        </tbody>
      </table></div>
    </div>`;

  view.querySelector('#refresh-jobs').addEventListener('click', () => renderTab('jobs'));
  view.querySelectorAll('[data-cancel]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.del(`/api/admin/jobs/${button.dataset.cancel}`);
        toastSuccess('ยกเลิกงานแล้ว');
        await renderTab('jobs');
      } catch (err) { toastError(err.message); }
    });
  });
}

// ---------------------------------------------------------------- สุขภาพระบบ
async function renderSystem() {
  const [system, status] = await Promise.all([
    api.get('/api/admin/system'),
    api.get('/api/status'),
  ]);
  const memoryRatio = system.memory.rss / system.memory.systemTotal;
  const STATUS_COLOR = { operational: '#4fd1b5', degraded: '#ffc857', down: '#dc2626', unavailable: 'var(--text-faint)' };
  const STATUS_TEXT = { operational: 'ทำงานปกติ', degraded: 'ช้ากว่าปกติ', down: 'ขัดข้อง', unavailable: 'ไม่ได้เปิดใช้' };

  view.innerHTML = `
    <div class="metric-grid">
      ${metricCard({ label: 'เวลาทำงานต่อเนื่อง', value: formatDuration(system.uptimeSeconds * 1000), sub: `Node ${system.node}`, color: '#4fd1b5' })}
      ${metricCard({ label: 'หน่วยความจำที่ใช้', value: formatBytes(system.memory.rss), sub: `จากทั้งหมด ${formatBytes(system.memory.systemTotal)}`, color: '#7c6bf5' })}
      ${metricCard({ label: 'CPU', value: `${system.cpu.count} คอร์`, sub: `โหลดเฉลี่ย ${system.cpu.load1.toFixed(2)}`, color: '#60a5fa' })}
      ${metricCard({ label: 'อัตราข้อผิดพลาด 24 ชม.', value: formatPercent(system.errorRate24h), sub: system.errorRate24h > 0.1 ? 'สูงกว่าปกติ' : 'อยู่ในเกณฑ์ดี', color: system.errorRate24h > 0.1 ? '#dc2626' : '#4fd1b5' })}
    </div>

    <div class="chart-card">
      <div class="chart-card__head"><h3>สถานะส่วนประกอบ</h3></div>
      <div style="display:grid;gap:2px">
        ${status.components.map((component) => `
          <div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--border)">
            <span style="width:9px;height:9px;border-radius:50%;flex:none;background:${STATUS_COLOR[component.status]};
              box-shadow:0 0 9px 1px ${STATUS_COLOR[component.status]}"></span>
            <span style="flex:1;font-size:14px">${escapeHtml(component.label)}</span>
            <span style="font-size:12.5px;color:${STATUS_COLOR[component.status]};font-weight:600">${STATUS_TEXT[component.status]}</span>
          </div>`).join('')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
      <div class="chart-card">
        <div class="chart-card__head"><h3>หน่วยความจำ</h3></div>
        ${gauge({ ratio: memoryRatio, color: memoryRatio > 0.8 ? '#dc2626' : '#7c6bf5',
          label: `heap ที่ใช้ ${formatBytes(system.memory.heapUsed)} จาก ${formatBytes(system.memory.heapTotal)}` })}
      </div>
      <div class="chart-card">
        <div class="chart-card__head"><h3>พื้นที่ไฟล์ชั่วคราว</h3></div>
        <div style="font-size:14px;display:grid;gap:7px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">จำนวนไฟล์</span><strong>${system.storage.files}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">ขนาดรวม</span><strong>${formatBytes(system.storage.bytes)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">ฐานข้อมูล</span><strong>${escapeHtml(system.dbDriver)}</strong></div>
        </div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-card__head"><h3>ประสิทธิภาพหน้าเว็บ (Core Web Vitals, 7 วัน)</h3></div>
      ${system.vitals.length ? `<div class="table-wrap"><table>
        <thead><tr><th>ตัวชี้วัด</th><th>ค่าเฉลี่ย</th><th>อยู่ในเกณฑ์ดี</th><th>จำนวนตัวอย่าง</th></tr></thead>
        <tbody>${system.vitals.map((vital) => `
          <tr><td>${vital.metric}</td>
            <td>${vital.metric === 'CLS' ? vital.average.toFixed(3) : `${Math.round(vital.average)} ms`}</td>
            <td>${formatPercent(vital.goodRatio, 0)}</td>
            <td>${formatNumber(vital.samples)}</td></tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty-state" style="padding:22px">ยังไม่มีข้อมูล — ตัวชี้วัดจะถูกเก็บเมื่อมีผู้ใช้เข้าชมเว็บ</div>'}
    </div>`;
}

// ---------------------------------------------------------------- ตั้งค่าระบบ
async function renderSettings() {
  const res = await api.get('/api/admin/settings');

  view.innerHTML = `
    <div class="notice">
      <div style="font-size:13px">ค่าเหล่านี้มีผลทันทีโดยไม่ต้องแก้ซอร์สโค้ดหรือรีสตาร์ทเซิร์ฟเวอร์
      ค่าที่ถูกแก้จะทับค่าจากไฟล์ environment</div>
    </div>
    <div class="card">
      <form id="settings-form">
        ${res.settings.map((setting) => `
          <div class="settings-row">
            <div>
              <div class="settings-row__label">${escapeHtml(setting.label)}</div>
              <div class="settings-row__meta">${escapeHtml(setting.key)}
                ${setting.isOverridden ? ' · ถูกแก้ไขแล้ว' : ` · ค่าเริ่มต้น ${escapeHtml(String(setting.defaultValue))}`}
                ${setting.min !== undefined ? ` · ช่วง ${setting.min}–${setting.max}` : ''}</div>
            </div>
            <div>
              ${setting.type === 'boolean'
                ? `<span class="switch__control"><input type="checkbox" data-key="${setting.key}" ${setting.value ? 'checked' : ''}><span class="switch__track"></span></span>`
                : setting.type === 'number'
                  ? `<input type="number" data-key="${setting.key}" value="${setting.value}" min="${setting.min ?? ''}" max="${setting.max ?? ''}">`
                  : `<input type="text" data-key="${setting.key}" value="${escapeHtml(String(setting.value))}" maxlength="500">`}
            </div>
          </div>`).join('')}
        <div style="display:flex;gap:9px;margin-top:18px">
          <button class="btn btn--primary" type="submit" style="flex:1">บันทึกการตั้งค่า</button>
          <button class="btn" type="button" id="reload-settings">ยกเลิก</button>
        </div>
      </form>
    </div>`;

  view.querySelector('#reload-settings').addEventListener('click', () => renderTab('settings'));
  view.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    const settings = {};
    view.querySelectorAll('[data-key]').forEach((input) => {
      settings[input.dataset.key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    try {
      await api.put('/api/admin/settings', { settings });
      toastSuccess('บันทึกการตั้งค่าเรียบร้อย');
      await renderTab('settings');
    } catch (err) {
      toastError(err.message);
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- บันทึก
async function renderLogs() {
  const [audit, cleanup] = await Promise.all([
    api.get('/api/admin/audit?limit=100'),
    api.get('/api/admin/cleanup-logs'),
  ]);

  view.innerHTML = `
    <div class="notice">
      <div style="font-size:13px">บันทึกเก็บเฉพาะการกระทำและผลลัพธ์
      <strong>ไม่มีการเก็บเนื้อหาเอกสาร รหัสผ่าน หรือลายเซ็นของผู้ใช้</strong></div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-weight:700;font-size:15px">บันทึกการใช้งาน (${audit.logs.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>เป้าหมาย</th><th>ผล</th></tr></thead>
        <tbody>${audit.logs.length ? audit.logs.map((log) => `
          <tr>
            <td style="white-space:nowrap">${formatDate(log.ts)}</td>
            <td style="font-size:11.5px">${escapeHtml((log.actorRef || 'ไม่ระบุ').slice(0, 12))}</td>
            <td>${escapeHtml(log.action)}</td>
            <td>${escapeHtml(log.target || '-')}</td>
            <td><span class="badge" data-status="${log.result === 'success' ? 'SUCCESS' : 'FAILED'}">${escapeHtml(log.result)}</span></td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">ยังไม่มีบันทึก</td></tr>'}
        </tbody>
      </table></div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-weight:700;font-size:15px">บันทึกการล้างไฟล์ชั่วคราว</div>
      <div class="table-wrap"><table>
        <thead><tr><th>เวลา</th><th>ประเภท</th><th>จำนวนที่ลบ</th><th>พื้นที่ที่คืน</th><th>ใช้เวลา</th></tr></thead>
        <tbody>${cleanup.logs.length ? cleanup.logs.map((log) => `
          <tr>
            <td style="white-space:nowrap">${formatDate(log.ts)}</td>
            <td>${escapeHtml(log.scope)}</td>
            <td>${formatNumber(log.removed_count)}</td>
            <td>${formatBytes(log.freed_bytes)}</td>
            <td>${log.duration_ms} ms</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">ยังไม่มีการล้างไฟล์</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}
