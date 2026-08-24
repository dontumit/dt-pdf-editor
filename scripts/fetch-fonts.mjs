/**
 * ดาวน์โหลดและประกอบฟอนต์ไทยสำหรับฝังลงไฟล์ PDF
 *   node scripts/fetch-fonts.mjs
 *
 * ใช้ Sarabun (SIL Open Font License 1.1) ซึ่งอนุญาตให้ฝังในเอกสารได้
 * ดึงผ่าน npm package @fontsource/sarabun เพราะเสถียรกว่าการดึงจาก CDN โดยตรง
 *
 * หมายเหตุ: @fontsource แจกเป็นไฟล์ woff2 แยก subset (thai / latin)
 * แต่ pdf-lib + fontkit ต้องใช้ TTF/OTF จึงต้องแปลงและรวม subset เข้าด้วยกัน
 * สคริปต์นี้จะแจ้งวิธีทำถ้าเครื่องยังไม่มีเครื่องมือที่จำเป็น
 *
 * ทางลัดที่ง่ายที่สุด: ดาวน์โหลด Sarabun-Regular.ttf และ Sarabun-Bold.ttf
 * จาก https://fonts.google.com/specimen/Sarabun แล้ววางไว้ที่ web/assets/fonts/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = path.join(root, 'web/assets/fonts');
const required = ['Sarabun-Regular.ttf', 'Sarabun-Bold.ttf'];

fs.mkdirSync(fontDir, { recursive: true });

const missing = required.filter((name) => {
  const file = path.join(fontDir, name);
  return !fs.existsSync(file) || fs.statSync(file).size < 20000;
});

if (!missing.length) {
  console.log('ฟอนต์ไทยครบแล้ว:');
  for (const name of required) {
    console.log(`  ${name} — ${(fs.statSync(path.join(fontDir, name)).size / 1024).toFixed(0)} KB`);
  }
  process.exit(0);
}

console.log('ยังไม่มีฟอนต์เหล่านี้:', missing.join(', '));
console.log('');
console.log('วิธีติดตั้ง (เลือกวิธีใดวิธีหนึ่ง)');
console.log('');
console.log('  1) ดาวน์โหลดด้วยตนเอง (ง่ายที่สุด)');
console.log('     เปิด https://fonts.google.com/specimen/Sarabun แล้วกด "Get font" > "Download all"');
console.log(`     แตกไฟล์แล้วคัดลอก Sarabun-Regular.ttf และ Sarabun-Bold.ttf ไปที่ ${fontDir}`);
console.log('');
console.log('  2) ใช้ fonttools แปลงจาก @fontsource (ต้องมี Python)');
console.log('     npm install --no-save @fontsource/sarabun');
console.log('     pip install "fonttools[woff]" brotli');
console.log('     python3 scripts/build-thai-font.py');
console.log('');
console.log('ระบบยังใช้งานได้โดยไม่มีฟอนต์เหล่านี้ แต่ข้อความภาษาไทยที่เพิ่มลงไฟล์ PDF');
console.log('(ลายน้ำ เลขหน้า ข้อความในหน้าแก้ไข) จะแสดงเป็นเครื่องหมายคำถามแทน');
process.exit(missing.length ? 1 : 0);
