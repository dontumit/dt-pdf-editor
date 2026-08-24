/** ศูนย์ช่วยเหลือ — คำถามที่พบบ่อยและวิธีใช้งาน */
import bootstrap from '../core/bootstrap.js';
import { escapeHtml } from '../utils/format.js';
import icon from '../ui/icons.js';

const FAQ = [
  {
    q: 'ไฟล์ของฉันถูกอัปโหลดขึ้นเซิร์ฟเวอร์หรือไม่',
    a: 'เครื่องมือส่วนใหญ่ประมวลผลบนเบราว์เซอร์ของคุณ ไฟล์จึงไม่ถูกส่งออกจากเครื่องเลย มีเพียงเครื่องมือใส่/ปลดรหัสผ่าน PDF และแปลงเป็น Word ที่ต้องใช้เซิร์ฟเวอร์ ซึ่งไฟล์จะถูกลบอัตโนมัติภายใน 30 นาที และการ์ดของเครื่องมือเหล่านั้นจะมีจุดสีส้มกำกับไว้',
  },
  {
    q: 'ทำไมภาษาไทยในไฟล์ที่ใส่ลายน้ำหรือเลขหน้าถึงแสดงผลได้',
    a: 'ระบบฝังฟอนต์ Sarabun ที่รองรับภาษาไทยลงในไฟล์ PDF ให้อัตโนมัติ พร้อมตัดเฉพาะอักขระที่ใช้จริง (subset) จึงแสดงผลถูกต้องโดยไฟล์ไม่ใหญ่เกินจำเป็น',
  },
  {
    q: 'ลดขนาด PDF แบบไหนดีกว่ากัน',
    a: 'เลือก "คงข้อความ" หากยังต้องการค้นหาหรือคัดลอกข้อความในเอกสาร ส่วน "ลดขนาดมาก" จะแปลงทุกหน้าเป็นภาพ ทำให้ไฟล์เล็กลงมาก เหมาะกับเอกสารสแกนที่ต้องส่งทางอีเมล แต่ข้อความจะเลือกไม่ได้',
  },
  {
    q: 'เซ็นเอกสารในระบบนี้มีผลทางกฎหมายหรือไม่',
    a: 'ระบบนี้ให้ลายเซ็นอิเล็กทรอนิกส์ (Electronic Signature) คือภาพลายเซ็นที่วางลงบนเอกสาร ไม่ใช่ Digital Signature ตามมาตรฐาน PKI ที่ใช้ใบรับรองดิจิทัลยืนยันตัวตนและตรวจจับการแก้ไขเอกสาร หากต้องการผลทางกฎหมายระดับสูง ควรใช้ระบบที่ออกใบรับรองดิจิทัลโดยเฉพาะ',
  },
  {
    q: 'ลืมรหัสผ่านไฟล์ที่ตั้งไว้ กู้คืนได้ไหม',
    a: 'ไม่ได้ ระบบไม่เก็บรหัสผ่านของคุณไว้ที่ใดเลย ทั้งในฐานข้อมูลและใน log จึงไม่มีทางกู้คืนให้ได้ กรุณาจดจำหรือบันทึกรหัสผ่านไว้ในที่ปลอดภัยเสมอ',
  },
  {
    q: 'ใช้งานตอนไม่มีอินเทอร์เน็ตได้ไหม',
    a: 'ได้ หลังเปิดเว็บครั้งแรกแล้ว ระบบจะเก็บส่วนประกอบของแอปไว้ในเครื่อง เครื่องมือที่ประมวลผลบนเบราว์เซอร์จึงยังใช้งานได้ ส่วนเครื่องมือที่ต้องใช้เซิร์ฟเวอร์และการอ่านข้อความครั้งแรกจะต้องต่ออินเทอร์เน็ต',
  },
  {
    q: 'ไฟล์ใหญ่มากแล้วเบราว์เซอร์ค้าง ทำอย่างไร',
    a: 'ลองแยกไฟล์เป็นส่วนย่อยก่อนแล้วค่อยประมวลผลทีละส่วน หรือใช้คอมพิวเตอร์แทนมือถือ เพราะการประมวลผลบนเครื่องขึ้นกับหน่วยความจำของอุปกรณ์ ระบบรองรับไฟล์ได้ถึง ' + bootstrap.maxFileSizeMb + ' MB และ ' + bootstrap.maxPdfPages + ' หน้า',
  },
  {
    q: 'เปิดใช้งานจาก LINE ได้อย่างไร',
    a: 'เพิ่มเพื่อนบัญชีทางการของหน่วยงาน แล้วเลือกเมนู DT PDF Editor จากเมนูด้านล่างของแชท ระบบจะเข้าสู่ระบบให้อัตโนมัติโดยไม่ต้องกรอกรหัสผ่านซ้ำ',
  },
];

export default async function HelpPage({ root }) {
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><h2 style="font-size:19px">ศูนย์ช่วยเหลือ</h2></div>

    <div class="card">
      <div class="card__title">ใช้งานใน 3 ขั้นตอน</div>
      <div style="display:grid;gap:12px">
        ${[
          { n: 1, t: 'เลือกไฟล์', d: 'ลากไฟล์มาวาง แตะเพื่อเลือกจากเครื่อง หรือวางจากคลิปบอร์ด' },
          { n: 2, t: 'ตั้งค่า', d: 'ปรับตัวเลือกให้ตรงกับที่ต้องการ ทุกเครื่องมือมีค่าเริ่มต้นที่ใช้ได้ทันที' },
          { n: 3, t: 'ดาวน์โหลด', d: 'กดประมวลผลแล้วดาวน์โหลดไฟล์ผลลัพธ์ได้เลย' },
        ].map((step) => `
          <div style="display:flex;gap:12px;align-items:flex-start">
            <span style="width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;
              background:linear-gradient(135deg,var(--brand),#b06ef0);color:#fff;font-weight:700;font-size:14px;
              box-shadow:0 0 14px -2px var(--brand)">${step.n}</span>
            <div><strong>${step.t}</strong>
            <div style="font-size:13.5px;color:var(--text-muted)">${step.d}</div></div>
          </div>`).join('')}
      </div>
    </div>

    <div class="section-title"><h2>คำถามที่พบบ่อย</h2></div>
    <div id="faq"></div>

    <div class="card">
      <div class="card__title">แป้นพิมพ์ลัด (ในหน้าแก้ไข PDF)</div>
      <div class="table-wrap"><table>
        <tbody>
          <tr><td><kbd>Ctrl</kbd> + <kbd>Z</kbd></td><td>ย้อนกลับ</td></tr>
          <tr><td><kbd>Ctrl</kbd> + <kbd>Y</kbd></td><td>ทำซ้ำ</td></tr>
          <tr><td><kbd>Delete</kbd></td><td>ลบองค์ประกอบที่เลือก</td></tr>
          <tr><td>ปุ่มลูกศร</td><td>ขยับองค์ประกอบทีละน้อย</td></tr>
          <tr><td><kbd>Shift</kbd> + ลูกศร</td><td>ขยับเป็นช่วงใหญ่</td></tr>
        </tbody>
      </table></div>
    </div>`;

  const faqEl = root.querySelector('#faq');
  FAQ.forEach((item, index) => {
    const details = document.createElement('details');
    details.className = 'card';
    details.style.cssText = 'padding:0;overflow:hidden';
    details.innerHTML = `
      <summary style="padding:14px 16px;cursor:pointer;font-weight:600;font-size:14.5px;list-style:none;
        display:flex;align-items:center;gap:10px">
        <span style="color:var(--brand);flex:none">${icon('info', { size: 17 })}</span>
        <span style="flex:1">${escapeHtml(item.q)}</span>
      </summary>
      <div style="padding:0 16px 15px 43px;font-size:13.5px;color:var(--text-muted);line-height:1.7">
        ${escapeHtml(item.a)}</div>`;
    if (index === 0) details.open = true;
    faqEl.appendChild(details);
  });

  return null;
}
