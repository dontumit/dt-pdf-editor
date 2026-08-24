/**
 * ชุดทดสอบแบบ end-to-end — ขับเบราว์เซอร์จริงผ่าน UI จริง
 *
 *   npm --prefix server start          # เปิดเซิร์ฟเวอร์ไว้ก่อน
 *   node tests/e2e.mjs                 # แล้วรันชุดทดสอบ
 *
 * ตัวแปรที่ปรับได้
 *   BASE_URL     ค่าเริ่มต้น http://localhost:8080
 *   CHROME_PATH  path ของ Chromium ถ้า playwright หาไม่เจอ
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dtpdf-e2e-'));
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

const launchOptions = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 950 } });

const results = [];
let passed = 0;

async function test(name, fn) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const startedAt = Date.now();
  try {
    const detail = await fn(page);
    passed += 1;
    results.push({ name, ok: true, ms: Date.now() - startedAt, detail, errors });
    console.log(`  PASS  ${name}  (${Date.now() - startedAt} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - startedAt, error: err.message, errors });
    console.log(`  FAIL  ${name}  — ${err.message}`);
    await page.screenshot({ path: path.join(OUT, `fail-${name}.png`), fullPage: true }).catch(() => {});
  }
  await page.close();
}

async function download(page, action) {
  const [event] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), action()]);
  const target = path.join(OUT, event.suggestedFilename() || 'output.bin');
  await event.saveAs(target);
  return { filename: event.suggestedFilename(), size: fs.statSync(target).size, path: target };
}

const fixture = (name) => path.join(FIXTURES, name);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

console.log(`\nทดสอบระบบที่ ${BASE}\n`);

await test('หน้าแรกโหลดได้และแสดงเครื่องมือครบ', async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tool-card');
  const cards = await page.locator('.tool-card').count();
  assert(cards >= 15, `พบเครื่องมือเพียง ${cards} รายการ`);
  const nav = await page.locator('.bottom-nav__item').count();
  assert(nav === 5, 'เมนูล่างไม่ครบ 5 รายการ');
  return { cards, nav };
});

await test('ค้นหาเครื่องมือภาษาไทย', async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#tool-search', 'ลดขนาด');
  await page.waitForTimeout(300);
  const found = await page.locator('.tool-card').count();
  assert(found >= 2, 'ค้นหา "ลดขนาด" ควรพบอย่างน้อย 2 เครื่องมือ');
  return { found };
});

await test('รวมไฟล์ PDF', async (page) => {
  await page.goto(`${BASE}/tool/merge`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', [fixture('doc-a.pdf'), fixture('doc-b.pdf')]);
  await page.waitForSelector('#run-btn');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  const file = await download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
  assert(file.size > 500, 'ไฟล์ผลลัพธ์เล็กผิดปกติ');
  return file;
});

await test('แยกไฟล์ PDF ตามช่วงหน้า', async (page) => {
  await page.goto(`${BASE}/tool/split`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-big.pdf'));
  await page.waitForSelector('#run-btn');
  await page.check('input[name="mode"][value="ranges"]');
  await page.fill('input[data-option="ranges"]', '1-3, 5, 8-10');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  const stats = await page.locator('.result__stat').allTextContents();
  assert(stats.join('').includes('3'), 'ควรได้ไฟล์ 3 ไฟล์');
  return { stats };
});

await test('ลดขนาดเอกสารตามขนาดเป้าหมาย', async (page) => {
  await page.goto(`${BASE}/tool/compress`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('scan-heavy.pdf'));
  await page.waitForSelector('#run-btn');
  await page.fill('input[data-option="targetSizeMb"]', '0.5');
  await page.locator('input[data-option="targetSizeMb"]').blur();
  await page.waitForTimeout(300);
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 180000 });
  const file = await download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
  const originalSize = fs.statSync(fixture('scan-heavy.pdf')).size;
  assert(file.size < originalSize * 0.6, `ลดขนาดได้น้อยเกินไป (${file.size} จาก ${originalSize})`);
  return { ...file, originalSize, reduction: `${((1 - file.size / originalSize) * 100).toFixed(1)}%` };
});

await test('ใส่ลายน้ำภาษาไทย (ตรวจการฝังฟอนต์)', async (page) => {
  await page.goto(`${BASE}/tool/watermark`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-a.pdf'));
  await page.waitForSelector('#run-btn');
  await page.fill('input[data-option="text"]', 'เอกสารลับ ห้ามเผยแพร่');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  const file = await download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
  const original = fs.statSync(fixture('doc-a.pdf')).size;
  // ฟอนต์ไทยที่ฝังจะทำให้ไฟล์ใหญ่ขึ้นอย่างชัดเจน ถ้าไม่ใหญ่แปลว่า fallback ไปฟอนต์มาตรฐาน
  assert(file.size > original + 1500, 'ไม่พบร่องรอยการฝังฟอนต์ไทย — ตรวจ web/assets/fonts');
  return { ...file, originalSize: original };
});

await test('ใส่เลขหน้าแบบเลขไทย', async (page) => {
  await page.goto(`${BASE}/tool/page-number`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-big.pdf'));
  await page.waitForSelector('#run-btn');
  await page.selectOption('select[data-option="format"]', 'thai');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('PDF เป็นรูปภาพ', async (page) => {
  await page.goto(`${BASE}/tool/pdf-to-image`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-a.pdf'));
  await page.waitForSelector('#run-btn');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 120000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('รูปภาพเป็น PDF', async (page) => {
  await page.goto(`${BASE}/tool/image-to-pdf`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', [fixture('img1.png'), fixture('img2.png')]);
  await page.waitForSelector('#run-btn');
  await page.click('#run-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('จัดหน้า PDF: หมุน ลบ และบันทึก', async (page) => {
  await page.goto(`${BASE}/tool/organize`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-big.pdf'));
  await page.waitForSelector('#page-grid .page-thumb', { timeout: 60000 });
  const before = await page.locator('.page-thumb').count();
  for (const index of [0, 1, 2]) await page.locator('.page-thumb').nth(index).click();
  await page.click('[data-bulk="rotate-right"]');
  await page.locator('.page-thumb').nth(3).locator('[data-act="delete"]').click();
  await page.waitForTimeout(400);
  await page.click('#save-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  const stats = await page.locator('.result__stat').allTextContents();
  assert(stats.join('').includes(String(before - 1)), 'จำนวนหน้าหลังลบไม่ถูกต้อง');
  return { before, stats };
});

await test('เซ็นเอกสาร: วาดลายเซ็นและวางลงไฟล์', async (page) => {
  await page.goto(`${BASE}/tool/sign`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-a.pdf'));
  await page.waitForSelector('.signature-pad', { timeout: 60000 });
  const pad = await page.locator('.signature-pad').boundingBox();
  await page.mouse.move(pad.x + 60, pad.y + pad.height * 0.7);
  await page.mouse.down();
  for (let i = 0; i <= 20; i += 1) {
    await page.mouse.move(pad.x + 60 + i * 14, pad.y + pad.height * (0.7 - Math.sin(i / 3) * 0.28));
  }
  await page.mouse.up();
  await page.click('.modal__actions button:has-text("ใช้ลายเซ็นนี้")');
  await page.waitForSelector('.editor__el[data-id]', { timeout: 15000 });
  await page.click('#save-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('แก้ไข PDF: ข้อความไทย และ undo/redo', async (page) => {
  await page.goto(`${BASE}/tool/edit`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-a.pdf'));
  await page.waitForSelector('.editor__page canvas', { timeout: 60000 });
  await page.click('[data-tool="text"]');
  await page.waitForSelector('#prop-text');
  await page.fill('#prop-text', 'ผู้ป่วยชื่อ นายทดสอบ ระบบไทย ๒๕๖๙');
  await page.click('[data-tool="checkbox"]');
  const before = await page.locator('.editor__el').count();
  await page.click('#undo-btn');
  await page.waitForTimeout(300);
  const afterUndo = await page.locator('.editor__el').count();
  assert(afterUndo === before - 1, 'undo ไม่ทำงาน');
  await page.click('#redo-btn');
  await page.waitForTimeout(300);
  assert(await page.locator('.editor__el').count() === before, 'redo ไม่ทำงาน');
  await page.click('#save-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('ครอบตัด: ตรวจหาขอบอัตโนมัติ', async (page) => {
  await page.goto(`${BASE}/tool/crop`, { waitUntil: 'networkidle' });
  await page.setInputFiles('.dropzone input[type=file]', fixture('doc-a.pdf'));
  await page.waitForSelector('#crop-holder canvas', { timeout: 60000 });
  await page.click('#auto-detect');
  await page.waitForTimeout(700);
  await page.click('#apply-btn');
  await page.waitForSelector('.result', { timeout: 90000 });
  return download(page, () => page.click('.result__actions button:has-text("ดาวน์โหลด")'));
});

await test('ตรวจสอบความพร้อมของระบบในหน้าตั้งค่า', async (page) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.click('#run-selftest');
  await page.waitForSelector('#selftest-result .notice', { timeout: 60000 });
  const summary = await page.locator('#selftest-result .notice strong').textContent();
  const thaiPdfOk = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#selftest-result > div:last-child > div'));
    const row = rows.find((r) => r.textContent.includes('สร้าง PDF ภาษาไทยได้'));
    return row ? getComputedStyle(row.firstElementChild).background.includes('79, 209, 181') : false;
  });
  assert(thaiPdfOk, 'ระบบสร้าง PDF ภาษาไทยไม่ได้');
  return { summary };
});

await test('หน้าสถานะระบบและช่วยเหลือ', async (page) => {
  await page.goto(`${BASE}/status`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  const components = await page.locator('.card > div > div').count();
  await page.goto(`${BASE}/help`, { waitUntil: 'networkidle' });
  await page.waitForSelector('details');
  const faq = await page.locator('details').count();
  assert(faq >= 5, 'คำถามที่พบบ่อยน้อยเกินไป');
  return { components, faq };
});

console.log(`\n${passed}/${results.length} ผ่าน  (ผลลัพธ์อยู่ที่ ${OUT})\n`);
const failedTests = results.filter((r) => !r.ok);
if (failedTests.length) {
  console.log('รายการที่ไม่ผ่าน:');
  failedTests.forEach((r) => console.log(` - ${r.name}: ${r.error}`));
}
const withConsoleErrors = results.filter((r) => r.errors.length);
if (withConsoleErrors.length) {
  console.log('\nพบ error ใน console:');
  withConsoleErrors.forEach((r) => console.log(` - ${r.name}: ${r.errors.slice(0, 2).join(' | ')}`));
}

await browser.close();
process.exit(failedTests.length ? 1 : 0);
