import icon from '../ui/icons.js';

export default async function NotFoundPage({ root }) {
  root.innerHTML = `
    <div class="empty-state" style="padding-top:60px">
      <div class="empty-state__icon">${icon('search', { size: 52, stroke: 1.3 })}</div>
      <h3>ไม่พบหน้าที่คุณค้นหา</h3>
      <p>หน้านี้อาจถูกย้ายหรือลิงก์ไม่ถูกต้อง</p>
      <div style="display:flex;gap:9px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        <a class="btn btn--primary" href="/" data-link>กลับหน้าแรก</a>
        <a class="btn" href="/tools" data-link>ดูเครื่องมือทั้งหมด</a>
      </div>
    </div>`;
  return null;
}
