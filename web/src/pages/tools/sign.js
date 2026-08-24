/**
 * เซ็นเอกสาร PDF — ใช้หน้าจอเดียวกับ PDF Editor แต่เปิดแผงลายเซ็นให้ทันที
 *
 * หมายเหตุทางกฎหมาย: ระบบนี้เป็น "ลายเซ็นอิเล็กทรอนิกส์" (Electronic Signature)
 * ไม่ใช่ Digital Signature ตามมาตรฐาน PKI ที่ต้องใช้ใบรับรองดิจิทัล (spec ข้อ 25)
 */
import EditPage from './edit.js';

export default async function SignPage({ root, tool, query }) {
  const cleanup = await EditPage({ root, tool, query, signatureFirst: true });

  const notice = document.createElement('div');
  notice.className = 'notice notice--warn';
  notice.style.marginTop = '10px';
  notice.innerHTML = `
    <div style="font-size:13px">
      <strong>ลายเซ็นอิเล็กทรอนิกส์ (Electronic Signature)</strong>
      <p style="margin:3px 0 0">ลายเซ็นที่วางในเอกสารนี้เป็นภาพลายเซ็น ไม่ใช่ Digital Signature
      ตามมาตรฐาน PKI ที่ใช้ใบรับรองดิจิทัลยืนยันตัวตนและตรวจจับการแก้ไขเอกสารได้</p>
    </div>`;
  root.querySelector('#upload-area')?.after(notice);

  return cleanup;
}
