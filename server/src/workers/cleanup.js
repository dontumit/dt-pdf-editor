/**
 * Cleanup worker (spec ข้อ 30, 72)
 * ทำงานทุก CLEANUP_INTERVAL วินาที ลบ:
 *  - ไฟล์ชั่วคราวที่เกิน TTL
 *  - โฟลเดอร์อัปโหลดที่ค้าง
 *  - presence / session / rate limit / share link ที่หมดอายุ
 *  - ข้อมูล analytics ดิบที่เกินระยะเก็บรักษา (PDPA)
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prunePresence } from '../services/presence.js';
import { pruneAnalytics } from '../services/analytics.js';
import { pruneShareLinks } from '../services/share.js';
import { pruneRateLimits } from '../middleware/rateLimit.js';
import { getSetting } from '../services/settings.js';

let timer = null;

function logCleanup(scope, removed, freed, durationMs, note = null) {
  if (!removed && !freed) return;
  db.run(
    'INSERT INTO cleanup_logs (ts, scope, removed_count, freed_bytes, duration_ms, note) VALUES (?, ?, ?, ?, ?, ?)',
    Date.now(), scope, removed, freed, durationMs, note,
  );
}

/** ลบไฟล์ผลลัพธ์ที่หมดอายุ */
function cleanExpiredJobFiles() {
  const started = Date.now();
  const rows = db.all(
    'SELECT * FROM job_files WHERE expires_at < ? AND deleted_at IS NULL LIMIT 500', Date.now(),
  );
  let freed = 0;
  let removed = 0;
  for (const file of rows) {
    try {
      if (fs.existsSync(file.storage_path)) {
        freed += fs.statSync(file.storage_path).size;
        fs.rmSync(file.storage_path, { force: true });
      }
      removed += 1;
    } catch (err) { logger.warn('cleanup: remove file failed', { message: err.message }); }
  }
  if (rows.length) {
    db.run(
      `UPDATE job_files SET deleted_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`,
      Date.now(), ...rows.map((r) => r.id),
    );
  }
  // ทำเครื่องหมายงานที่ไฟล์หมดอายุ
  db.run(
    "UPDATE jobs SET status = 'EXPIRED' WHERE expires_at < ? AND status = 'SUCCESS' AND mode = 'server'",
    Date.now(),
  );
  logCleanup('temp_files', removed, freed, Date.now() - started);
  return { removed, freed };
}

/** ลบโฟลเดอร์ที่ไม่มีเจ้าของแล้ว (เช่น อัปโหลดค้างเพราะ browser ปิดกลางคัน) */
function cleanOrphanDirectories() {
  const started = Date.now();
  const ttl = getSetting('TEMP_FILE_TTL') * 1000;
  const cutoff = Date.now() - ttl;
  let removed = 0;
  let freed = 0;

  const sweep = (base) => {
    if (!fs.existsSync(base)) return;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > cutoff) continue;
        if (entry.isDirectory()) {
          const size = folderSize(full);
          fs.rmSync(full, { recursive: true, force: true });
          removed += 1;
          freed += size;
        } else {
          freed += stat.size;
          fs.rmSync(full, { force: true });
          removed += 1;
        }
      } catch { /* ignore */ }
    }
  };

  sweep(path.join(config.storage.dir, 'tmp'));
  sweep(path.join(config.storage.dir, 'jobs'));
  logCleanup('orphan_files', removed, freed, Date.now() - started);
  return { removed, freed };
}

function folderSize(dir) {
  let total = 0;
  const walk = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return total;
}

function cleanSessions() {
  const started = Date.now();
  // เก็บ session ไว้ 30 วันเพื่อให้ประวัติของผู้ใช้ที่ยังไม่ login ไม่หายทันที
  const cutoff = Date.now() - 30 * 86400000;
  const removed = db.run('DELETE FROM sessions WHERE last_seen_at < ? AND user_id IS NULL', cutoff).changes;
  const presence = prunePresence();
  logCleanup('sessions', removed + presence, 0, Date.now() - started);
  return { removed: removed + presence };
}

export async function runCleanup({ force = false } = {}) {
  const started = Date.now();
  const files = cleanExpiredJobFiles();
  const orphans = cleanOrphanDirectories();
  const sessions = cleanSessions();
  const shares = pruneShareLinks();
  const limits = pruneRateLimits();
  const analytics = force ? pruneAnalytics() : (Math.random() < 0.05 ? pruneAnalytics() : 0);

  const summary = {
    filesRemoved: files.removed + orphans.removed,
    bytesFreed: files.freed + orphans.freed,
    sessionsRemoved: sessions.removed,
    shareLinksRemoved: shares,
    rateLimitRowsRemoved: limits,
    analyticsRowsRemoved: analytics,
    durationMs: Date.now() - started,
  };
  if (summary.filesRemoved || summary.bytesFreed || force) logger.info('cleanup finished', summary);
  return summary;
}

export function startCleanupWorker() {
  if (timer) return;
  const intervalMs = Math.max(60, config.storage.cleanupInterval) * 1000;
  const loop = async () => {
    try { await runCleanup(); } catch (err) { logger.error('cleanup failed', { message: err.message }); }
    timer = setTimeout(loop, intervalMs);
    if (timer.unref) timer.unref();
  };
  timer = setTimeout(loop, 10000);
  if (timer.unref) timer.unref();
  logger.info('cleanup worker started', { intervalSeconds: intervalMs / 1000 });
}

export function stopCleanupWorker() {
  if (timer) clearTimeout(timer);
  timer = null;
}
