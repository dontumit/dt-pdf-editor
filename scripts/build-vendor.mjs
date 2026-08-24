/**
 * เตรียมไลบรารีฝั่ง browser ให้ self-host ทั้งหมด
 *   node scripts/build-vendor.mjs
 *
 * เหตุผล:
 *   1) ไม่ต้องพึ่ง CDN — โรงเรียน/หน่วยงานที่อินเทอร์เน็ตไม่เสถียรยังใช้งานได้
 *   2) ตั้ง Content-Security-Policy ให้เข้มขึ้นได้ (script-src 'self')
 *   3) Service Worker แคชไว้ใช้ออฟไลน์ได้
 *
 * หมายเหตุสำคัญ: @pdf-lib/fontkit เวอร์ชัน ESM มี bare import ของ "pako"
 * ซึ่ง browser resolve ไม่ได้ จึงต้องใช้เวอร์ชัน UMD ที่รวม dependency ไว้แล้ว
 * แล้วห่อเป็น ES module เพื่อให้ import ได้ทั้งบน main thread และใน Web Worker
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'web/assets/vendor');
const modules = path.join(root, 'server/node_modules');

fs.mkdirSync(vendorDir, { recursive: true });

const COPIES = [
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.js'],
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['jszip/dist/jszip.min.js', 'jszip.min.js'],
];

for (const [source, target] of COPIES) {
  const from = path.join(modules, source);
  if (!fs.existsSync(from)) { console.warn(`ข้าม (ไม่พบไฟล์): ${source}`); continue; }
  fs.copyFileSync(from, path.join(vendorDir, target));
  console.log(`คัดลอก ${target}`);
}

// fontkit: ห่อ UMD ให้เป็น ES module
const fontkitUmd = path.join(modules, '@pdf-lib/fontkit/dist/fontkit.umd.min.js');
if (fs.existsSync(fontkitUmd)) {
  const source = fs.readFileSync(fontkitUmd, 'utf8');
  const wrapped = `/* fontkit (UMD) ห่อเป็น ES module โดย scripts/build-vendor.mjs
   ใช้เวอร์ชัน UMD เพราะเวอร์ชัน ESM มี bare import ของ "pako" ที่ browser resolve ไม่ได้ */
const __scope = typeof self !== 'undefined' ? self : globalThis;
${source}
const fontkit = __scope.fontkit;
export default fontkit;
export { fontkit };
`;
  fs.writeFileSync(path.join(vendorDir, 'fontkit.esm.js'), wrapped);
  console.log('สร้าง fontkit.esm.js จากเวอร์ชัน UMD');
}

console.log('เสร็จสิ้น — ไฟล์อยู่ที่ web/assets/vendor');
