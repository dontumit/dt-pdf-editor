/** หน้าสถานะระบบ /status (spec ข้อ 87) */
import api from '../core/api.js';
import icon from '../ui/icons.js';
import { escapeHtml, formatDate } from '../utils/format.js';

const STATUS_META = {
  operational: { label: 'ทำงานปกติ', color: 'var(--accent-mint)' },
  degraded: { label: 'ช้ากว่าปกติ', color: 'var(--accent-sun)' },
  down: { label: 'ขัดข้อง', color: 'var(--danger)' },
  unavailable: { label: 'ไม่ได้เปิดใช้งาน', color: 'var(--text-faint)' },
};

export default async function StatusPage({ root }) {
  root.innerHTML = '<div class="skeleton" style="height:230px"></div>';

  try {
    const res = await api.get('/api/status');
    const overall = STATUS_META[res.overall] || STATUS_META.operational;

    root.innerHTML = `
      <div class="card" style="text-align:center;border-color:color-mix(in srgb,${overall.color} 45%,transparent)">
        <div style="display:inline-flex;align-items:center;gap:10px;font-size:18px;font-weight:700">
          <span style="width:13px;height:13px;border-radius:50%;background:${overall.color};
            box-shadow:0 0 14px 3px ${overall.color}"></span>
          ${res.overall === 'operational' ? 'ระบบทำงานปกติทุกส่วน' : `ระบบ${overall.label}`}
        </div>
        <p class="card__hint" style="margin:8px 0 0">
          อัปเดตเมื่อ ${formatDate(res.serverTime)} · เวอร์ชัน ${escapeHtml(res.version)}
        </p>
      </div>

      ${res.maintenance ? `<div class="notice notice--warn">${icon('alert', { size: 18 })}
        <div>ระบบอยู่ระหว่างปิดปรับปรุง ผู้ใช้ทั่วไปจะยังไม่สามารถส่งงานประมวลผลได้</div></div>` : ''}
      ${res.announcement ? `<div class="notice">${icon('info', { size: 18 })}<div>${escapeHtml(res.announcement)}</div></div>` : ''}

      <div class="card" style="padding:0;overflow:hidden;margin-top:12px">
        ${res.components.map((component, index) => {
          const meta = STATUS_META[component.status] || STATUS_META.unavailable;
          return `<div style="display:flex;align-items:center;gap:11px;padding:13px 16px;
            ${index ? 'border-top:1px solid var(--border)' : ''}">
            <span style="width:10px;height:10px;border-radius:50%;flex:none;background:${meta.color};
              box-shadow:0 0 10px 2px ${meta.color}"></span>
            <span style="flex:1;font-size:14px">${escapeHtml(component.label)}</span>
            <span style="font-size:12.5px;color:${meta.color};font-weight:600">${meta.label}</span>
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card__title">คิวงานฝั่งเซิร์ฟเวอร์</div>
        <div style="display:flex;gap:22px;font-size:14px">
          <div><span style="color:var(--text-muted)">รอคิว</span> <strong>${res.queue.waiting}</strong></div>
          <div><span style="color:var(--text-muted)">กำลังประมวลผล</span> <strong>${res.queue.processing}</strong></div>
        </div>
        <p class="card__hint" style="margin:10px 0 0">
          เครื่องมือส่วนใหญ่ทำงานบนเครื่องของคุณโดยตรง จึงไม่ได้รับผลจากคิวนี้
        </p>
      </div>

      <div style="text-align:center;margin-top:16px">
        <button class="btn btn--sm" id="refresh-status">${icon('refresh', { size: 15 })} รีเฟรช</button>
      </div>`;

    root.querySelector('#refresh-status').addEventListener('click', () => StatusPage({ root }));
  } catch (err) {
    root.innerHTML = `<div class="error-box">
      <div class="error-box__title">${icon('alert', { size: 18 })} ไม่สามารถอ่านสถานะระบบได้</div>
      <p style="font-size:13.5px;margin:0">${escapeHtml(err.message)}</p></div>`;
  }
  return null;
}
