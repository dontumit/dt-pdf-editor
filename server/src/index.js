/**
 * DT PDF Editor — API server + static host
 *
 * หลักการ: "Process Locally Whenever Possible, Upload Only When Necessary"
 * เซิร์ฟเวอร์ตัวนี้ทำ 4 อย่างเท่านั้น
 *   1) เสิร์ฟ frontend (static, PWA)
 *   2) ยืนยันตัวตนผ่าน LINE
 *   3) เก็บสถิติจริง (online / visitor / job)
 *   4) ประมวลผลงานที่ browser ทำไม่ได้ (PDF->Word, OCR, รหัสผ่าน PDF, บีบอัดคุณภาพสูง)
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import config, { ROOT } from './config/index.js';
import { initDatabase, db } from './db/index.js';
import { logger } from './utils/logger.js';
import { securityHeaders, cors, csrfProtection } from './middleware/security.js';
import { sessionContext } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import { getSetting } from './services/settings.js';

import authRoutes from './routes/auth.js';
import telemetryRoutes from './routes/telemetry.js';
import webhookRoutes from './routes/webhook.js';
import jobRoutes from './routes/jobs.js';
import filesRoutes, { shareRouter } from './routes/files.js';
import historyRoutes from './routes/history.js';
import adminRoutes from './routes/admin.js';
import healthRoutes from './routes/health.js';

import { startQueue, stopQueue, recoverStuckJobs } from './workers/queue.js';
import { startCleanupWorker, stopCleanupWorker } from './workers/cleanup.js';

await initDatabase();

const app = express();
const WEB_DIR = path.join(ROOT, 'web');

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(cors);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(sessionContext);
app.use(csrfProtection);

/** โหมดปิดปรับปรุงระบบ — ผู้ดูแลยังเข้าได้ */
app.use((req, res, next) => {
  if (!getSetting('MAINTENANCE_MODE')) return next();
  if (req.user?.role === 'admin') return next();
  if (req.path.startsWith('/api/health') || req.path.startsWith('/api/status') || req.path.startsWith('/api/auth')) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({
      success: false, errorCode: 'MAINTENANCE',
      message: 'ระบบกำลังปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่ภายหลัง',
    });
  }
  return next();
});

// ---------------- API ----------------
app.use('/webhook', webhookRoutes);
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', telemetryRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/s', shareRouter);

// ---------------- Static frontend ----------------
/**
 * กลยุทธ์แคช (spec ข้อ 32, 97)
 *   - asset ที่มี ?v= : cache ยาว immutable
 *   - HTML / service worker : ห้าม cache เพื่อให้ผู้ใช้ได้เวอร์ชันใหม่ทันที
 *   - ไฟล์ของผู้ใช้ : no-store (จัดการที่ routes/files.js)
 */
app.use(express.static(WEB_DIR, {
  etag: true,
  lastModified: true,
  index: false,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (filePath.endsWith('service-worker.js') || ext === '.html' || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.js', '.css', '.woff2', '.ttf', '.png', '.svg', '.webp', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

/** ฉีดค่า runtime config ลง HTML เพื่อไม่ต้องเรียก API รอบแรก */
function serveHtml(fileName) {
  return (req, res, next) => {
    const filePath = path.join(WEB_DIR, fileName);
    if (!fs.existsSync(filePath)) return next();
    let html = fs.readFileSync(filePath, 'utf8');
    const bootstrap = {
      appName: config.appName,
      orgName: config.orgName,
      creditText: config.creditText,
      cacheVersion: config.cacheVersion,
      csrfToken: req.csrfToken,
      liffId: config.line.liffId,
      lineEnabled: config.line.enabled,
      requireFriend: config.line.requireFriend,
      addFriendUrl: config.line.addFriendUrl,
      heartbeatInterval: config.presence.heartbeatInterval,
      maxFileSizeMb: getSetting('MAX_FILE_SIZE_MB'),
      maxPdfPages: getSetting('MAX_PDF_PAGES'),
      announcement: getSetting('ANNOUNCEMENT') || '',
    };
    html = html
      .replace('__BOOTSTRAP__', JSON.stringify(bootstrap).replace(/</g, '\\u003c'))
      .replace(/__CACHE_VERSION__/g, config.cacheVersion);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(html);
  };
}

// แผงผู้ดูแลเป็นแอปแยกจากหน้าเว็บหลัก (ไม่โหลดโค้ดเครื่องมือ PDF โดยไม่จำเป็น)
app.get('/admin', serveHtml('admin.html'));
app.get('/admin/*', serveHtml('admin.html'));

// เส้นทางอื่นทั้งหมดที่ไม่ใช่ /api ให้ index.html จัดการ routing ฝั่ง client เอง
// (รวมถึง /status /privacy /help /tool/* /scan /history /settings)
app.get(/^(?!\/api|\/s\/).*/, serveHtml('index.html'));

app.use(notFound);
app.use(errorHandler);

// ---------------- Start ----------------
const server = app.listen(config.port, () => {
  logger.info('server started', {
    port: config.port,
    env: config.isProd ? 'production' : 'development',
    baseUrl: config.publicBaseUrl,
    dbDriver: db.driver,
    lineEnabled: config.line.enabled,
  });
});

// worker จะรันในโปรเซสนี้เฉพาะเมื่อไม่ได้แยก container ออกไป
if (config.runInlineWorker) {
  recoverStuckJobs();
  startQueue();
  startCleanupWorker();
} else {
  logger.info('inline worker disabled — คาดว่ามี worker แยกโปรเซสทำงานอยู่');
}

function shutdown(signal) {
  logger.info('shutting down', { signal });
  stopQueue();
  stopCleanupWorker();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { message: String(reason) }));

export default app;
