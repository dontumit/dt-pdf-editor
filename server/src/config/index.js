/**
 * Central configuration.
 * ค่าทั้งหมดอ่านจาก environment variable เท่านั้น — ห้าม hard-code secret
 * ค่าที่ผู้ดูแลระบบแก้ได้ระหว่างรัน จะถูก override ด้วยตาราง system_settings
 * (ดู services/settings.js)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../../..');

// โหลด .env แบบง่าย ๆ (ไม่พึ่ง dependency) — ถ้ามี process.env อยู่แล้วจะไม่ทับ
function loadDotEnv() {
  for (const candidate of [path.join(ROOT, '.env'), path.join(ROOT, 'server/.env')]) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadDotEnv();

const str = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();
const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (key, fallback) => {
  const raw = (process.env[key] ?? '').toString().trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};
const list = (key) => str(key).split(',').map((s) => s.trim()).filter(Boolean);

const isProd = str('NODE_ENV', 'development') === 'production';

// JWT secret เป็นค่าบังคับใน production
const jwtSecret = str('JWT_SECRET');
if (isProd && (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('CHANGE_ME'))) {
  throw new Error('JWT_SECRET ต้องกำหนดและยาวอย่างน้อย 32 ตัวอักษรเมื่อ NODE_ENV=production');
}

const storageDir = path.resolve(ROOT, str('STORAGE_DIR', './storage'));
const dbUrl = str('DATABASE_URL', 'file:./data/dtpdf.db');
const dbFile = path.resolve(ROOT, dbUrl.replace(/^file:/, ''));

export const config = {
  isProd,
  appName: str('APP_NAME', 'DT PDF Editor'),
  orgName: str('ORG_NAME', ''),
  creditText: str('CREDIT_TEXT', 'พัฒนาโดย นางสาวชุติมา วัจรินทร์ นักวิชาการคอมพิวเตอร์ โรงพยาบาลดอนตูม'),
  port: num('PORT', 8080),
  publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${num('PORT', 8080)}`).replace(/\/$/, ''),
  cacheVersion: str('CACHE_VERSION', '1.0.0'),

  security: {
    jwtSecret: jwtSecret || 'dev-only-insecure-secret-do-not-use-in-production',
    jwtTtlSeconds: num('JWT_TTL_SECONDS', 604800),
    cookieName: str('SESSION_COOKIE_NAME', 'dtpdf_session'),
    cookieSecure: bool('COOKIE_SECURE', isProd),
    corsOrigins: list('CORS_ORIGINS'),
  },

  db: { file: dbFile },
  storage: {
    dir: storageDir,
    tempTtl: num('TEMP_FILE_TTL', 1800),
    cleanupInterval: num('CLEANUP_INTERVAL', 300),
  },

  limits: {
    maxFileSizeMb: num('MAX_FILE_SIZE_MB', 100),
    maxPdfPages: num('MAX_PDF_PAGES', 500),
    maxConcurrentJobs: num('MAX_CONCURRENT_JOBS', 2),
    processingTimeoutSeconds: num('PROCESSING_TIMEOUT_SECONDS', 180),
    rateLimitGuest: num('RATE_LIMIT_GUEST', 20),
    rateLimitUser: num('RATE_LIMIT_USER', 100),
  },

  presence: {
    heartbeatInterval: num('HEARTBEAT_INTERVAL', 25),
    onlineTimeout: num('ONLINE_TIMEOUT', 75),
    analyticsRetentionDays: num('ANALYTICS_RETENTION_DAYS', 90),
  },

  line: {
    channelId: str('LINE_CHANNEL_ID'),
    channelSecret: str('LINE_CHANNEL_SECRET'),
    liffId: str('LINE_LIFF_ID'),
    messagingToken: str('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'),
    messagingSecret: str('LINE_MESSAGING_CHANNEL_SECRET'),
    callbackPath: str('LINE_CALLBACK_PATH', '/api/auth/line/callback'),
    oaBasicId: str('LINE_OA_BASIC_ID'),
    requireFriend: bool('REQUIRE_LINE_FRIEND', false),
    get enabled() { return Boolean(this.channelId && this.channelSecret); },
    get addFriendUrl() {
      const id = this.oaBasicId.replace(/^@/, '');
      return id ? `https://line.me/R/ti/p/@${id}` : '';
    },
  },

  admin: {
    lineUserIds: list('ADMIN_LINE_USER_IDS'),
    emails: list('ADMIN_EMAILS').map((e) => e.toLowerCase()),
    localUsername: str('ADMIN_LOCAL_USERNAME', 'admin'),
    localPassword: str('ADMIN_LOCAL_PASSWORD'),
  },

  /**
   * รัน queue worker ในโปรเซสเดียวกับ API หรือไม่
   * ติดตั้งขนาดเล็ก (เครื่องเดียว) ให้เป็น true
   * ติดตั้งแบบแยก container ให้ตั้ง false แล้วรัน workers/standalone.js แยก
   */
  runInlineWorker: bool('RUN_INLINE_WORKER', true),

  bin: {
    qpdf: str('QPDF_BIN', 'qpdf'),
    ghostscript: str('GHOSTSCRIPT_BIN', 'gs'),
  },
  ocrLangs: str('OCR_LANGS', 'tha+eng'),
};

// สร้างโฟลเดอร์ที่จำเป็น
for (const dir of [path.dirname(config.db.file), config.storage.dir, path.join(config.storage.dir, 'tmp'), path.join(config.storage.dir, 'out')]) {
  fs.mkdirSync(dir, { recursive: true });
}

export default config;
