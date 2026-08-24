/**
 * ทดสอบ API ฝั่งเซิร์ฟเวอร์ (ไม่ต้องใช้เบราว์เซอร์)
 *   node tests/api.mjs
 *
 * ตรวจ: การยืนยันตัวตน, CSRF, สถิติ, โควตา, สิทธิ์ผู้ดูแล และงานฝั่งเซิร์ฟเวอร์
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

let cookies = new Map();
let passed = 0;
let failed = 0;

function cookieHeader() {
  return Array.from(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() || [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function call(method, url, { body, formData, headers = {} } = {}) {
  const init = { method, headers: { ...headers, Cookie: cookieHeader() }, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(method)) init.headers['X-CSRF-Token'] = cookies.get('dtpdf_csrf') || '';
  if (formData) init.body = formData;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(BASE + url, init);
  storeCookies(response);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: response.status, data, headers: response.headers };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

console.log(`\nทดสอบ API ที่ ${BASE}\n`);

await test('GET /api/health ตอบ 200', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
});

await test('GET /api/auth/config ส่งค่าตั้งและตั้งคุกกี้', async () => {
  const res = await call('GET', '/api/auth/config');
  assert.equal(res.status, 200);
  assert.ok(res.data.appName, 'ไม่มีชื่อระบบ');
  assert.ok(cookies.get('dtpdf_csrf'), 'ไม่ได้ตั้งคุกกี้ CSRF');
  assert.ok(cookies.get('dtpdf_sid'), 'ไม่ได้ตั้งคุกกี้ session');
  assert.ok(!('channelSecret' in res.data), 'ห้ามส่ง channel secret ให้ client');
});

await test('ส่ง POST โดยไม่มี CSRF token ต้องถูกปฏิเสธ', async () => {
  const response = await fetch(`${BASE}/api/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ page: '/' }),
  });
  assert.equal(response.status, 403);
});

await test('POST /api/heartbeat นับผู้ใช้ออนไลน์', async () => {
  const res = await call('POST', '/api/heartbeat', { body: { page: '/', device: 'desktop' } });
  assert.equal(res.status, 200);
  assert.ok(res.data.online >= 1, 'ควรนับอย่างน้อย 1 คน');
});

await test('GET /api/stats/public ให้ตัวเลขจริงจากฐานข้อมูล', async () => {
  await call('POST', '/api/visit', { body: { page: '/' } });
  const res = await call('GET', '/api/stats/public');
  assert.equal(res.status, 200);
  assert.ok(res.data.today.visits >= 1, 'ยอดเข้าชมวันนี้ควรมากกว่า 0 หลังบันทึก visit');
  assert.equal(typeof res.data.online.total, 'number');
});

await test('บันทึกงานฝั่ง client และเก็บลงประวัติ', async () => {
  const start = await call('POST', '/api/jobs/client/start', {
    body: { tool: 'merge', fileCount: 2, bytesIn: 2048 },
  });
  assert.equal(start.status, 200);
  const jobId = start.data.jobId;
  assert.ok(jobId, 'ไม่ได้รับ jobId');

  const done = await call('POST', '/api/jobs/client/complete', {
    body: { jobId, status: 'SUCCESS', bytesOut: 1024, processingMs: 120, filename: 'merged.pdf' },
  });
  assert.equal(done.data.status, 'SUCCESS');

  const history = await call('GET', '/api/history?limit=5');
  assert.ok(history.data.items.some((item) => item.tool === 'merge'), 'ไม่พบรายการในประวัติ');
});

await test('เครื่องมือที่ไม่รู้จักต้องถูกปฏิเสธ', async () => {
  const res = await call('POST', '/api/jobs/client/start', { body: { tool: 'ไม่มีจริง', fileCount: 1 } });
  assert.equal(res.status, 400);
  assert.equal(res.data.errorCode, 'VALIDATION_ERROR');
});

await test('เข้า /api/admin โดยไม่มีสิทธิ์ต้องถูกปฏิเสธ', async () => {
  const res = await call('GET', '/api/admin/overview');
  assert.equal(res.status, 403);
});

await test('ผู้ดูแลเข้าสู่ระบบและอ่านภาพรวมได้', async () => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) { console.log('        (ข้าม — ไม่ได้ตั้ง ADMIN_PASSWORD)'); return; }
  const login = await call('POST', '/api/auth/admin/login', {
    body: { username: process.env.ADMIN_USERNAME || 'admin', password },
  });
  assert.equal(login.status, 200);
  const overview = await call('GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(typeof overview.data.online.total, 'number');
  assert.equal(typeof overview.data.storage.bytes, 'number');
});

await test('ไฟล์ที่ไม่ใช่ PDF ต้องถูกปฏิเสธจากการตรวจ magic number', async () => {
  const form = new FormData();
  form.append('tool', 'pdf-to-word');
  form.append('files', new Blob(['ไม่ใช่ไฟล์ PDF จริง'], { type: 'application/pdf' }), 'ปลอม.pdf');
  const res = await call('POST', '/api/jobs/server', { formData: form });
  assert.equal(res.status, 415);
  assert.equal(res.data.errorCode, 'UNSUPPORTED_FILE');
});

await test('งานฝั่งเซิร์ฟเวอร์: แปลง PDF เป็น Word', async () => {
  const file = path.join(FIXTURES, 'doc-a.pdf');
  const form = new FormData();
  form.append('tool', 'pdf-to-word');
  form.append('ocr', 'off');
  form.append('files', new Blob([fs.readFileSync(file)], { type: 'application/pdf' }), 'doc-a.pdf');

  const submit = await call('POST', '/api/jobs/server', { formData: form });
  assert.equal(submit.status, 202, `คาดหวัง 202 แต่ได้ ${submit.status}`);

  let job = submit.data;
  for (let attempt = 0; attempt < 40 && !['SUCCESS', 'FAILED'].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    job = (await call('GET', `/api/jobs/${job.jobId}`)).data;
  }
  assert.equal(job.status, 'SUCCESS', `งานล้มเหลว: ${job.message || job.errorCode}`);
  assert.ok(job.files?.[0]?.filename.endsWith('.docx'), 'ไม่ได้ไฟล์ .docx');

  const download = await fetch(BASE + job.files[0].downloadUrl, { headers: { Cookie: cookieHeader() } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert.ok(bytes.length > 1000, 'ไฟล์ผลลัพธ์เล็กผิดปกติ');
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b], 'ไฟล์ .docx ต้องขึ้นต้นด้วยลายเซ็น ZIP');
});

await test('security headers ครบถ้วน', async () => {
  const res = await call('GET', '/');
  const required = [
    'content-security-policy', 'x-content-type-options',
    'referrer-policy', 'permissions-policy', 'x-frame-options',
  ];
  for (const header of required) {
    assert.ok(res.headers.get(header), `ขาด header: ${header}`);
  }
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

await test('/api/status รายงานสถานะทุกส่วนประกอบ', async () => {
  const res = await call('GET', '/api/status');
  assert.equal(res.status, 200);
  assert.ok(res.data.components.length >= 8, 'ส่วนประกอบน้อยเกินไป');
  assert.ok(['operational', 'degraded', 'down'].includes(res.data.overall));
});

console.log(`\n${passed}/${passed + failed} ผ่าน\n`);
process.exit(failed ? 1 : 0);
