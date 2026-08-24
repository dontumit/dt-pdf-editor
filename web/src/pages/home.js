/**
 * หน้าแรก — ตารางเครื่องมือแบบเดียวกับที่ผู้ใช้เห็นหลังเข้าสู่ระบบด้วย LINE
 * ตัวเลขผู้เข้าชม/กำลังใช้งาน ดึงจาก API จริงทั้งหมด ไม่มีข้อมูลจำลอง
 */
import { TOOLS, CATEGORIES, searchTools, toolRoute, getTool } from '../core/tools.js';
import appState from '../core/state.js';
import bootstrap from '../core/bootstrap.js';
import api from '../core/api.js';
import icon from '../ui/icons.js';
import { formatNumber, escapeHtml } from '../utils/format.js';
import { refreshStats } from '../services/telemetry.js';

export function toolCardHtml(tool, lang = 'th') {
  const badge = tool.runsOn === 'server'
    ? '<span class="tool-card__badge" title="ต้องเชื่อมต่ออินเทอร์เน็ต"></span>'
    : tool.heavy
      ? '<span class="tool-card__badge" title="ใช้ทรัพยากรเครื่องสูง"></span>'
      : '';
  return `
    <a class="tool-card" href="${toolRoute(tool)}" data-link
       style="--tool-color:${tool.color};--tool-bg:${tool.bg};--tool-border:${tool.border};--tool-shadow:${tool.color}80"
       aria-label="${escapeHtml(tool.name[lang] || tool.name.th)} — ${escapeHtml(tool.desc[lang] || tool.desc.th)}">
      ${badge}
      <span class="tool-card__icon" aria-hidden="true">${icon(tool.icon, { size: 25 })}</span>
      <span class="tool-card__label">${escapeHtml(tool.name[lang] || tool.name.th)}</span>
    </a>`;
}

function statPillsHtml(stats) {
  return `
    <div class="stat-pills">
      <div class="stat-pill" title="จำนวนผู้เข้าชมสะสมทั้งหมด">
        ${icon('eye', { size: 17 })}
        <span>ผู้เข้าชมทั้งหมด</span>
        <strong id="stat-visitors">${formatNumber(stats.total?.visits || 0)}</strong>
      </div>
      <div class="stat-pill" title="จำนวนผู้ที่กำลังใช้งานอยู่ในขณะนี้">
        <span class="live-dot" aria-hidden="true"></span>
        <span>กำลังใช้งานอยู่</span>
        <strong id="stat-online">${formatNumber(stats.online?.total || 0)}</strong>
        <span>คน</span>
      </div>
    </div>`;
}

export default async function HomePage({ root }) {
  const state = appState.get();
  const lang = state.language || 'th';

  root.innerHTML = `
    ${statPillsHtml(state.stats)}

    ${bootstrap.announcement ? `<div class="notice">${icon('info', { size: 18 })}<div>${escapeHtml(bootstrap.announcement)}</div></div>` : ''}

    <div id="friend-gate"></div>

    <div class="search-box">
      <span class="search-box__icon">${icon('search', { size: 18 })}</span>
      <input type="search" id="tool-search" placeholder="ค้นหาเครื่องมือ เช่น รวม PDF, ลดขนาด" autocomplete="off"
             aria-label="ค้นหาเครื่องมือ" enterkeyhint="search">
      <button class="search-box__clear" id="search-clear" hidden aria-label="ล้างคำค้นหา">${icon('close', { size: 16 })}</button>
    </div>

    <div id="recent-section"></div>

    <div id="tool-sections"></div>

    <div class="card" style="margin-top:22px">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <span style="color:var(--success);flex:none;margin-top:2px">${icon('lock', { size: 20 })}</span>
        <div>
          <div style="font-weight:700;margin-bottom:4px">เอกสารของคุณไม่ถูกอัปโหลด</div>
          <p class="card__hint" style="margin:0">
            เครื่องมือส่วนใหญ่ประมวลผลบนเครื่องของคุณโดยตรง ไฟล์จึงไม่ถูกส่งขึ้นเซิร์ฟเวอร์
            เครื่องมือที่มีจุดสีส้มต้องใช้เซิร์ฟเวอร์ช่วยประมวลผล และไฟล์จะถูกลบอัตโนมัติภายใน 30 นาที
            <a href="/privacy" data-link>อ่านนโยบายความเป็นส่วนตัว</a>
          </p>
        </div>
      </div>
    </div>`;

  const sectionsEl = root.querySelector('#tool-sections');
  const searchInput = root.querySelector('#tool-search');
  const clearButton = root.querySelector('#search-clear');

  function renderSections(filter = '') {
    const matched = searchTools(filter, lang);

    if (filter && !matched.length) {
      sectionsEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">${icon('search', { size: 42, stroke: 1.5 })}</div>
          <h3>ไม่พบเครื่องมือที่ค้นหา</h3>
          <p>ลองใช้คำอื่น เช่น "รวม" "แยก" "ลดขนาด" หรือ "เซ็น"</p>
        </div>`;
      return;
    }

    if (filter) {
      sectionsEl.innerHTML = `
        <div class="section-title"><h2>ผลการค้นหา (${matched.length})</h2></div>
        <div class="tool-grid">${matched.map((tool) => toolCardHtml(tool, lang)).join('')}</div>`;
      return;
    }

    sectionsEl.innerHTML = CATEGORIES.map((category) => {
      const tools = TOOLS.filter((tool) => tool.category === category.id);
      if (!tools.length) return '';
      return `
        <div class="section-title"><h2>${category.name[lang] || category.name.th}</h2></div>
        <div class="tool-grid">${tools.map((tool) => toolCardHtml(tool, lang)).join('')}</div>`;
    }).join('');
  }

  renderSections();

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearButton.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderSections(searchInput.value), 120);
  });
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    clearButton.hidden = true;
    renderSections('');
    searchInput.focus();
  });

  // ---------- เครื่องมือที่ใช้ล่าสุด (spec ข้อ 44) ----------
  (async () => {
    try {
      const res = await api.get('/api/history/recent-tools', { timeout: 8000 });
      const tools = (res.tools || []).map((item) => getTool(item.tool)).filter(Boolean).slice(0, 6);
      if (!tools.length) return;
      root.querySelector('#recent-section').innerHTML = `
        <div class="section-title"><h2>ใช้ล่าสุด</h2><a href="/history" data-link>ดูประวัติทั้งหมด</a></div>
        <div class="tool-grid">${tools.map((tool) => toolCardHtml(tool, lang)).join('')}</div>`;
    } catch { /* ไม่มีประวัติก็ไม่ต้องแสดง */ }
  })();

  // ---------- ประตูเพิ่มเพื่อน LINE ----------
  renderFriendGate(root.querySelector('#friend-gate'));

  // ---------- อัปเดตตัวเลขสดโดยไม่ต้องรีเฟรชหน้า ----------
  const unsubscribe = appState.subscribe((next) => {
    const visitors = root.querySelector('#stat-visitors');
    const online = root.querySelector('#stat-online');
    if (visitors) visitors.textContent = formatNumber(next.stats.total?.visits || 0);
    if (online) online.textContent = formatNumber(next.stats.online?.total || 0);
  });
  refreshStats();

  return () => {
    unsubscribe();
    clearTimeout(searchTimer);
  };
}

function renderFriendGate(container) {
  if (!container) return;
  const state = appState.get();

  if (state.requiresFriend && state.addFriendUrl) {
    container.innerHTML = `
      <div class="notice notice--warn">
        ${icon('line', { size: 20 })}
        <div style="flex:1">
          <strong>เพิ่มเพื่อนเพื่อใช้งานได้เต็มรูปแบบ</strong>
          <p style="margin:4px 0 8px;font-size:13px">เครื่องมือที่ต้องใช้เซิร์ฟเวอร์จะปลดล็อกหลังเพิ่มเพื่อนบัญชีทางการของเรา</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn btn--sm btn--line" href="${state.addFriendUrl}" target="_blank" rel="noopener">เพิ่มเพื่อน</a>
            <button class="btn btn--sm" id="recheck-friend">เพิ่มเพื่อนแล้ว</button>
          </div>
        </div>
      </div>`;
    container.querySelector('#recheck-friend')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'กำลังตรวจสอบ...';
      const { recheckFriendship } = await import('../line/liff.js');
      const { toastSuccess, toastWarning } = await import('../ui/toast.js');
      try {
        const res = await recheckFriendship();
        if (res.isFriend) { toastSuccess('ขอบคุณที่เพิ่มเพื่อน ใช้งานได้เต็มรูปแบบแล้ว'); container.innerHTML = ''; }
        else { toastWarning('ยังไม่พบการเพิ่มเพื่อน กรุณาลองอีกครั้ง'); button.disabled = false; button.textContent = 'เพิ่มเพื่อนแล้ว'; }
      } catch {
        toastWarning('ตรวจสอบไม่สำเร็จ กรุณาลองใหม่');
        button.disabled = false;
        button.textContent = 'เพิ่มเพื่อนแล้ว';
      }
    });
    return;
  }

  if (!state.authenticated && bootstrap.lineEnabled) {
    container.innerHTML = `
      <div class="notice">
        ${icon('line', { size: 20 })}
        <div style="flex:1">
          <strong>เข้าสู่ระบบด้วย LINE</strong>
          <p style="margin:4px 0 8px;font-size:13px">เก็บประวัติการใช้งาน เพิ่มโควตาไฟล์ และใช้เครื่องมือได้ครบทุกตัว</p>
          <a class="btn btn--sm btn--line" href="/login" data-link>เข้าสู่ระบบ</a>
        </div>
      </div>`;
  }
}
