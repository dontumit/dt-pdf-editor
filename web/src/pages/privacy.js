/** นโยบายความเป็นส่วนตัว (spec ข้อ 57) */
import bootstrap from '../core/bootstrap.js';
import { escapeHtml } from '../utils/format.js';
import icon from '../ui/icons.js';

export default async function PrivacyPage({ root }) {
  const name = escapeHtml(bootstrap.appName);
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><h2 style="font-size:19px">นโยบายความเป็นส่วนตัว</h2></div>

    <div class="card" style="border-color:color-mix(in srgb,var(--accent-mint) 45%,transparent)">
      <div style="display:flex;gap:11px">
        <span style="color:var(--accent-mint);flex:none">${icon('lock', { size: 22 })}</span>
        <div>
          <div style="font-weight:700;margin-bottom:4px">หลักการสำคัญ: ประมวลผลบนเครื่องคุณก่อนเสมอ</div>
          <p class="card__hint" style="margin:0">${name} ออกแบบให้เครื่องมือส่วนใหญ่ทำงานภายในเบราว์เซอร์ของคุณ
          เอกสารจึงไม่ถูกส่งออกจากเครื่อง เหมาะกับเอกสารสำคัญ เช่น บัตรประชาชน เวชระเบียน เอกสารราชการ และเอกสารทางการเงิน</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card__title">1. ไฟล์ของคุณถูกจัดการอย่างไร</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.75">
        <li><strong>เครื่องมือที่ทำงานบนเครื่อง</strong> (รวม แยก จัดหน้า ลดขนาด แปลงรูป ลายน้ำ เลขหน้า ครอบตัด เซ็นเอกสาร แก้ไข อ่านข้อความ):
          ไฟล์ไม่ถูกอัปโหลด ไม่มีสำเนาบนเซิร์ฟเวอร์</li>
        <li><strong>เครื่องมือที่ต้องใช้เซิร์ฟเวอร์</strong> (ใส่/ปลดรหัสผ่าน PDF และแปลงเป็น Word):
          ไฟล์ถูกส่งขึ้นเซิร์ฟเวอร์เพื่อประมวลผลชั่วคราว แล้วลบอัตโนมัติภายใน 30 นาที
          ไฟล์ต้นฉบับที่อัปโหลดจะถูกลบทันทีเมื่อประมวลผลเสร็จ</li>
        <li>รหัสผ่านที่คุณกรอกใช้เฉพาะระหว่างประมวลผล ไม่ถูกบันทึกลงฐานข้อมูลและไม่ถูกเขียนลง log</li>
        <li>ลิงก์แชร์เป็นลิงก์ชั่วคราว มีโทเคนสุ่ม จำกัดจำนวนครั้งดาวน์โหลด และหมดอายุอัตโนมัติ</li>
      </ul>
    </div>

    <div class="card">
      <div class="card__title">2. ข้อมูลที่ระบบจัดเก็บ</div>
      <div class="table-wrap"><table>
        <thead><tr><th>ประเภทข้อมูล</th><th>รายละเอียด</th><th>ระยะเวลา</th></tr></thead>
        <tbody>
          <tr><td>สถิติผู้เข้าชม</td><td>วันเวลา รหัสเซสชัน ชนิดอุปกรณ์ เบราว์เซอร์ ระบบปฏิบัติการ หน้าที่เข้าชม<br>
            <span style="color:var(--text-muted);font-size:12px">ไม่เก็บหมายเลข IP และไม่เก็บ user agent ดิบ</span></td><td>90 วัน</td></tr>
          <tr><td>ประวัติการใช้งาน</td><td>ชื่อเครื่องมือ ชื่อไฟล์ ขนาดไฟล์ สถานะ เวลาที่ใช้ประมวลผล<br>
            <span style="color:var(--text-muted);font-size:12px">ไม่เก็บเนื้อหาภายในเอกสาร</span></td><td>จนกว่าคุณจะลบเอง</td></tr>
          <tr><td>บัญชี LINE</td><td>ชื่อที่แสดง รูปโปรไฟล์ และรหัสผู้ใช้ที่ผ่านการแปลงเป็นค่าอ้างอิง</td><td>จนกว่าจะขอให้ลบ</td></tr>
          <tr><td>ไฟล์ชั่วคราว</td><td>เฉพาะเครื่องมือที่ต้องใช้เซิร์ฟเวอร์</td><td>30 นาที</td></tr>
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card__title">3. การเข้าสู่ระบบด้วย LINE</div>
      <p class="card__hint" style="margin:0">
        เมื่อคุณเข้าสู่ระบบ ระบบจะได้รับเพียงชื่อที่แสดงและรูปโปรไฟล์จาก LINE เท่านั้น
        รหัสผู้ใช้ LINE จะถูกแปลงเป็นค่าอ้างอิงแบบทางเดียวก่อนนำไปแสดงผลหรือบันทึกลง log
        ระบบไม่เข้าถึงรายชื่อเพื่อน ข้อความ หรือข้อมูลอื่นในบัญชี LINE ของคุณ
      </p>
    </div>

    <div class="card">
      <div class="card__title">4. สิทธิของคุณตาม PDPA</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.75">
        <li>ขอเข้าถึงและขอสำเนาข้อมูลส่วนบุคคลของคุณ</li>
        <li>ขอแก้ไขข้อมูลให้ถูกต้องเป็นปัจจุบัน</li>
        <li>ขอลบข้อมูล — ล้างประวัติได้เองจากหน้า "ล่าสุด" และล้างข้อมูลในเครื่องได้จากหน้า "ตั้งค่า"</li>
        <li>ขอถอนความยินยอมโดยออกจากระบบและหยุดใช้บริการ</li>
        <li>ร้องเรียนต่อหน่วยงานกำกับดูแลหากเห็นว่าการประมวลผลไม่ชอบด้วยกฎหมาย</li>
      </ul>
    </div>

    <div class="card">
      <div class="card__title">5. คุกกี้และข้อมูลในเบราว์เซอร์</div>
      <p class="card__hint" style="margin:0">
        ระบบใช้คุกกี้ที่จำเป็นต่อการทำงานเท่านั้น ได้แก่ คุกกี้ระบุเซสชันเพื่อนับสถิติและจำกัดโควตา
        คุกกี้ป้องกันการปลอมแปลงคำขอ (CSRF) และคุกกี้เข้าสู่ระบบซึ่งเป็นแบบ HttpOnly
        ไม่มีคุกกี้เพื่อการโฆษณาหรือติดตามข้ามเว็บไซต์
        ส่วนธีมและภาษาถูกเก็บใน Local Storage ของเบราว์เซอร์คุณเอง
      </p>
    </div>

    <p style="text-align:center;font-size:12.5px;color:var(--text-faint);margin-top:18px">
      หากมีข้อสงสัยเกี่ยวกับนโยบายนี้ กรุณาติดต่อผู้ดูแลระบบของหน่วยงานที่ให้บริการ
    </p>`;
  return null;
}
