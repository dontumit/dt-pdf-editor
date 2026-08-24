/** ประวัติการใช้งาน — เก็บเฉพาะ metadata ไม่มีไฟล์ (spec ข้อ 45) */
import api from '../core/api.js';
import { getTool } from '../core/tools.js';
import icon from '../ui/icons.js';
import { formatBytes, formatRelative, formatDuration, escapeHtml } from '../utils/format.js';
import { confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';

const STATUS_LABEL = {
  SUCCESS: 'สำเร็จ', FAILED: 'ไม่สำเร็จ', CANCELLED: 'ยกเลิก',
  PROCESSING: 'กำลังทำ', WAITING: 'รอคิว', EXPIRED: 'หมดอายุ',
};

export default async function HistoryPage({ root }) {
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px">
      <h2 style="font-size:19px">ประวัติการใช้งาน</h2>
      <button class="btn btn--sm" id="clear-history">${icon('trash', { size: 15 })} ล้างประวัติ</button>
    </div>
    <div class="notice">${icon('info', { size: 18 })}
      <div style="font-size:13px">ระบบเก็บเฉพาะรายการที่ทำ ชื่อไฟล์ และขนาด — <strong>ไม่เก็บตัวไฟล์เอกสารของคุณ</strong></div></div>
    <div id="history-list"><div class="skeleton" style="height:200px"></div></div>`;

  const listEl = root.querySelector('#history-list');

  async function load() {
    try {
      const res = await api.get('/api/history?limit=100');
      if (!res.items.length) {
        listEl.innerHTML = `<div class="empty-state">
          <div class="empty-state__icon">${icon('clock', { size: 44, stroke: 1.4 })}</div>
          <h3>ยังไม่มีประวัติการใช้งาน</h3>
          <p>เมื่อคุณใช้เครื่องมือใด รายการจะมาแสดงที่นี่</p>
          <a class="btn btn--primary" href="/tools" data-link style="margin-top:14px">เลือกเครื่องมือ</a>
        </div>`;
        return;
      }

      listEl.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>เครื่องมือ</th><th>ไฟล์</th><th>ขนาด</th><th>เวลา</th><th>สถานะ</th></tr></thead>
          <tbody>${res.items.map((item) => {
            const tool = getTool(item.tool);
            return `<tr>
              <td><span style="display:flex;align-items:center;gap:8px">
                <span style="width:26px;height:26px;border-radius:9px;display:grid;place-items:center;flex:none;
                  background:${tool?.color || '#94a3b8'};color:#fff;
                  box-shadow:0 0 10px -1px ${tool?.color || '#94a3b8'}99">
                  ${icon(tool?.icon || 'file', { size: 14 })}</span>
                <span>${escapeHtml(tool?.name.th || item.tool)}</span></span></td>
              <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${escapeHtml(item.filename || '-')}</td>
              <td style="white-space:nowrap">${formatBytes(item.sizeIn)}${item.sizeOut ? ` &rarr; ${formatBytes(item.sizeOut)}` : ''}</td>
              <td style="white-space:nowrap">${formatRelative(item.createdAt)}<br>
                <span style="font-size:11.5px;color:var(--text-faint)">${item.processingMs ? formatDuration(item.processingMs) : ''}</span></td>
              <td><span class="badge" data-status="${item.status}">${STATUS_LABEL[item.status] || item.status}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
      <p class="card__hint" style="margin-top:10px;text-align:center">แสดง ${res.items.length} จากทั้งหมด ${res.total} รายการ</p>`;
    } catch (err) {
      listEl.innerHTML = `<div class="error-box"><div class="error-box__title">โหลดประวัติไม่สำเร็จ</div>
        <p style="font-size:13.5px;margin:0">${escapeHtml(err.message)}</p></div>`;
    }
  }

  root.querySelector('#clear-history').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'ล้างประวัติทั้งหมด',
      message: 'รายการประวัติทั้งหมดจะถูกลบถาวรและกู้คืนไม่ได้',
      confirmLabel: 'ล้างประวัติ',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.del('/api/history');
      toastSuccess('ล้างประวัติเรียบร้อย');
      load();
    } catch (err) { toastError(err.message); }
  });

  await load();
  return null;
}
