/**
 * ค่าตั้งระบบที่ผู้ดูแลแก้ได้จาก /admin โดยไม่ต้องแก้ source code (spec ข้อ 83, 84)
 * อ่านจาก DB ก่อน ถ้าไม่มีจะใช้ค่าจาก environment
 */
import db from '../db/index.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

export const SETTING_DEFS = [
  { key: 'MAX_FILE_SIZE_MB', type: 'number', label: 'ขนาดไฟล์สูงสุดต่อไฟล์ (MB)', min: 1, max: 2048, def: () => config.limits.maxFileSizeMb },
  { key: 'MAX_PDF_PAGES', type: 'number', label: 'จำนวนหน้า PDF สูงสุดต่อไฟล์', min: 1, max: 10000, def: () => config.limits.maxPdfPages },
  { key: 'TEMP_FILE_TTL', type: 'number', label: 'อายุไฟล์ชั่วคราวก่อนถูกลบ (วินาที)', min: 60, max: 86400, def: () => config.storage.tempTtl },
  { key: 'ONLINE_TIMEOUT', type: 'number', label: 'ไม่ส่ง heartbeat เกินกี่วินาทีถือว่าออฟไลน์', min: 30, max: 600, def: () => config.presence.onlineTimeout },
  { key: 'HEARTBEAT_INTERVAL', type: 'number', label: 'ช่วงเวลาส่ง heartbeat (วินาที)', min: 5, max: 120, def: () => config.presence.heartbeatInterval },
  { key: 'RATE_LIMIT_GUEST', type: 'number', label: 'จำนวนงานสูงสุดต่อชั่วโมง (ผู้ใช้ทั่วไป)', min: 1, max: 100000, def: () => config.limits.rateLimitGuest },
  { key: 'RATE_LIMIT_USER', type: 'number', label: 'จำนวนงานสูงสุดต่อชั่วโมง (ผู้ที่เข้าสู่ระบบ)', min: 1, max: 100000, def: () => config.limits.rateLimitUser },
  { key: 'MAX_CONCURRENT_JOBS', type: 'number', label: 'จำนวนงานฝั่งเซิร์ฟเวอร์ที่ประมวลผลพร้อมกัน', min: 1, max: 32, def: () => config.limits.maxConcurrentJobs },
  { key: 'PROCESSING_TIMEOUT_SECONDS', type: 'number', label: 'เวลาสูงสุดต่อ 1 งาน (วินาที)', min: 10, max: 3600, def: () => config.limits.processingTimeoutSeconds },
  { key: 'ANALYTICS_RETENTION_DAYS', type: 'number', label: 'เก็บสถิติดิบย้อนหลัง (วัน)', min: 1, max: 730, def: () => config.presence.analyticsRetentionDays },
  { key: 'GUEST_MAX_FILES', type: 'number', label: 'จำนวนไฟล์ต่อครั้ง (ผู้ใช้ทั่วไป)', min: 1, max: 200, def: () => 5 },
  { key: 'USER_MAX_FILES', type: 'number', label: 'จำนวนไฟล์ต่อครั้ง (ผู้ที่เข้าสู่ระบบ)', min: 1, max: 500, def: () => 50 },
  { key: 'SHARE_LINK_TTL', type: 'number', label: 'อายุลิงก์แชร์ (วินาที)', min: 60, max: 86400, def: () => 900 },
  { key: 'MAINTENANCE_MODE', type: 'boolean', label: 'โหมดปิดปรับปรุงระบบ', def: () => false },
  { key: 'ANNOUNCEMENT', type: 'string', label: 'ข้อความประกาศบนหน้าแรก', def: () => '' },
];

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

let cache = new Map();
let cacheAt = 0;
const CACHE_TTL = 5000;

function parseValue(rawValue, type) {
  if (type === 'number') return Number(rawValue);
  if (type === 'boolean') return rawValue === 'true' || rawValue === '1';
  if (type === 'json') { try { return JSON.parse(rawValue); } catch { return null; } }
  return rawValue;
}

function refresh() {
  if (Date.now() - cacheAt < CACHE_TTL) return;
  const rows = db.all('SELECT key, value, value_type FROM system_settings');
  const next = new Map();
  for (const row of rows) next.set(row.key, parseValue(row.value, row.value_type));
  cache = next;
  cacheAt = Date.now();
}

/** อ่านค่าตั้ง 1 ตัว */
export function getSetting(key) {
  refresh();
  if (cache.has(key)) return cache.get(key);
  const def = DEF_BY_KEY.get(key);
  return def ? def.def() : undefined;
}

/** อ่านค่าตั้งทั้งหมดพร้อม metadata สำหรับหน้า admin */
export function listSettings() {
  refresh();
  return SETTING_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    type: def.type,
    value: cache.has(def.key) ? cache.get(def.key) : def.def(),
    isOverridden: cache.has(def.key),
    defaultValue: def.def(),
    min: def.min,
    max: def.max,
  }));
}

/** บันทึกค่าตั้ง พร้อมตรวจช่วงค่าที่อนุญาต */
export function setSetting(key, value, updatedBy) {
  const def = DEF_BY_KEY.get(key);
  if (!def) throw new Error(`ไม่รู้จักค่าตั้ง: ${key}`);

  let normalized = value;
  if (def.type === 'number') {
    normalized = Number(value);
    if (!Number.isFinite(normalized)) throw new Error(`${def.label} ต้องเป็นตัวเลข`);
    if (def.min !== undefined && normalized < def.min) throw new Error(`${def.label} ต้องไม่น้อยกว่า ${def.min}`);
    if (def.max !== undefined && normalized > def.max) throw new Error(`${def.label} ต้องไม่เกิน ${def.max}`);
  } else if (def.type === 'boolean') {
    normalized = value === true || value === 'true' || value === 1 || value === '1';
  } else {
    normalized = String(value ?? '').slice(0, 500);
  }

  db.run(
    `INSERT INTO system_settings (key, value, value_type, label, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key, String(normalized), def.type, def.label, Date.now(), updatedBy || null,
  );
  cacheAt = 0;
  logger.info('setting updated', { key, updatedBy });
  return normalized;
}

export function resetSetting(key) {
  db.run('DELETE FROM system_settings WHERE key = ?', key);
  cacheAt = 0;
}
