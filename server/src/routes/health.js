/**
 * /api/health และข้อมูลสำหรับหน้า /status (spec ข้อ 87)
 */
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import db from '../db/index.js';
import config from '../config/index.js';
import { ok } from '../utils/http.js';
import { queueDepth } from '../services/jobs.js';
import { getSetting } from '../services/settings.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

let capabilityCache = null;
let capabilityCheckedAt = 0;

/** ตรวจว่ามีเครื่องมือฝั่ง server ตัวไหนติดตั้งอยู่บ้าง */
export async function detectCapabilities() {
  if (capabilityCache && Date.now() - capabilityCheckedAt < 60000) return capabilityCache;

  const probe = async (bin, args) => {
    try { await execFileAsync(bin, args, { timeout: 4000 }); return true; } catch { return false; }
  };
  const [qpdf, ghostscript, tesseract] = await Promise.all([
    probe(config.bin.qpdf, ['--version']),
    probe(config.bin.ghostscript, ['--version']),
    (async () => { try { await import('tesseract.js'); return true; } catch { return false; } })(),
  ]);

  capabilityCache = {
    qpdf,          // ใส่/ปลดรหัสผ่าน PDF
    ghostscript,   // บีบอัด PDF คุณภาพสูงโดยคงข้อความ
    ocr: tesseract,
    pdfToWord: true, // ใช้ pdfjs-dist + docx (เป็น dependency หลัก)
    line: config.line.enabled,
  };
  capabilityCheckedAt = Date.now();
  return capabilityCache;
}

router.get('/health', async (req, res) => {
  let dbOk = true;
  try { db.get('SELECT 1 AS ok'); } catch { dbOk = false; }
  const storageOk = fs.existsSync(config.storage.dir);
  const healthy = dbOk && storageOk;
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    version: config.cacheVersion,
  });
});

/** ข้อมูลสาธารณะสำหรับหน้า /status */
router.get('/status', async (req, res) => {
  const capabilities = await detectCapabilities();
  const queue = queueDepth();
  let dbOk = true;
  try { db.get('SELECT 1 AS ok'); } catch { dbOk = false; }

  const components = [
    { key: 'web', label: 'เว็บแอปพลิเคชัน', status: 'operational' },
    { key: 'database', label: 'ฐานข้อมูล', status: dbOk ? 'operational' : 'down' },
    { key: 'storage', label: 'พื้นที่จัดเก็บชั่วคราว', status: fs.existsSync(config.storage.dir) ? 'operational' : 'down' },
    { key: 'client-pdf', label: 'ประมวลผล PDF บนเครื่องผู้ใช้', status: 'operational' },
    { key: 'queue', label: 'คิวงานฝั่งเซิร์ฟเวอร์', status: queue.waiting > 50 ? 'degraded' : 'operational' },
    { key: 'pdf-to-word', label: 'แปลง PDF เป็น Word', status: capabilities.pdfToWord ? 'operational' : 'unavailable' },
    { key: 'ocr', label: 'OCR (อ่านข้อความจากภาพ)', status: capabilities.ocr ? 'operational' : 'unavailable' },
    { key: 'pdf-password', label: 'ใส่/ปลดรหัสผ่าน PDF', status: capabilities.qpdf ? 'operational' : 'unavailable' },
    { key: 'pdf-compress-server', label: 'บีบอัด PDF คุณภาพสูง', status: capabilities.ghostscript ? 'operational' : 'unavailable' },
    { key: 'line', label: 'การเชื่อมต่อ LINE', status: capabilities.line ? 'operational' : 'unavailable' },
  ];

  const overall = components.some((c) => c.status === 'down') ? 'down'
    : components.some((c) => c.status === 'degraded') ? 'degraded' : 'operational';

  return ok(res, {
    overall,
    components,
    queue,
    maintenance: Boolean(getSetting('MAINTENANCE_MODE')),
    announcement: getSetting('ANNOUNCEMENT') || '',
    version: config.cacheVersion,
    serverTime: Date.now(),
  });
});

/** frontend ใช้ตัดสินว่าจะเปิด/ปิดปุ่มของเครื่องมือที่ต้องใช้ server */
router.get('/capabilities', async (req, res) => ok(res, { capabilities: await detectCapabilities() }));

export default router;
