/**
 * Job service — บันทึกงานทั้งฝั่ง client และ server ไว้ที่เดียวกัน
 * งานฝั่ง client (mode='client') คือสถิติล้วน ๆ ไม่มีไฟล์อยู่บนเซิร์ฟเวอร์
 * งานฝั่ง server (mode='server') มีไฟล์ชั่วคราวและถูกลบตาม TTL
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import config from '../config/index.js';
import { newId } from '../utils/id.js';
import { dayKey } from '../utils/time.js';
import { getSetting } from './settings.js';
import { rollupDay } from './analytics.js';
import { logger } from '../utils/logger.js';

export const JOB_STATUS = {
  WAITING: 'WAITING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

/** เครื่องมือที่ต้องประมวลผลฝั่ง server เท่านั้น */
export const SERVER_TOOLS = new Set([
  'pdf-to-word', 'ocr', 'pdf-protect', 'pdf-unlock', 'pdf-compress-server',
]);

export function createJob({ tool, mode = 'client', userId, sessionId, userType, params = {}, fileCount = 0, bytesIn = 0 }) {
  const id = newId('job');
  const now = Date.now();
  const ttl = getSetting('TEMP_FILE_TTL') * 1000;
  db.run(
    `INSERT INTO jobs (id, tool, mode, status, progress, user_id, session_id, user_type, params_json,
                       file_count, bytes_in, created_at, expires_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, tool, mode,
    mode === 'server' ? JOB_STATUS.WAITING : JOB_STATUS.PROCESSING,
    userId || null, sessionId || null, userType || 'guest',
    JSON.stringify(sanitizeParams(params)), fileCount, bytesIn, now, now + ttl,
  );
  return getJob(id);
}

/** ตัดข้อมูลอ่อนไหวออกจาก params ก่อนบันทึกลง DB (spec ข้อ 85, 113) */
function sanitizeParams(params) {
  const blocked = new Set(['password', 'userPassword', 'ownerPassword', 'signature', 'signatureData', 'imageData', 'text']);
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (blocked.has(key)) { out[key] = '[omitted]'; continue; }
    if (typeof value === 'string' && value.length > 200) { out[key] = `${value.slice(0, 200)}…`; continue; }
    if (typeof value === 'object' && value !== null) { out[key] = '[object]'; continue; }
    out[key] = value;
  }
  return out;
}

export const getJob = (id) => db.get('SELECT * FROM jobs WHERE id = ?', id);

export function updateJob(id, patch) {
  const allowed = ['status', 'progress', 'stage', 'bytes_out', 'error_code', 'error_message', 'started_at', 'finished_at', 'processing_ms', 'attempts', 'file_count'];
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return getJob(id);
  values.push(id);
  db.run(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`, ...values);
  return getJob(id);
}

/**
 * ปิดงานพร้อมบันทึกสถิติและประวัติ
 * เรียกได้ทั้งจาก client (แจ้งผลงานที่ประมวลผลบนเครื่องตัวเอง) และจาก worker
 */
export function completeJob(id, { status, bytesOut = 0, processingMs = null, errorCode = null, errorMessage = null, filename = null, fileCount = null }) {
  const job = getJob(id);
  if (!job) return null;
  const now = Date.now();
  const duration = processingMs ?? (job.started_at ? now - job.started_at : now - job.created_at);

  updateJob(id, {
    status,
    progress: status === JOB_STATUS.SUCCESS ? 100 : job.progress,
    bytes_out: bytesOut,
    processing_ms: duration,
    finished_at: now,
    error_code: errorCode,
    error_message: errorMessage ? String(errorMessage).slice(0, 300) : null,
    ...(fileCount !== null ? { file_count: fileCount } : {}),
  });

  db.run(
    `INSERT INTO history (id, user_id, session_id, tool, mode, filename, file_count, size_in, size_out, status, processing_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('hist'), job.user_id, job.session_id, job.tool, job.mode,
    filename ? String(filename).slice(0, 200) : null,
    fileCount ?? job.file_count, job.bytes_in, bytesOut, status, duration, now,
  );

  const day = dayKey(now);
  db.run(
    `INSERT INTO tool_usage (day, tool, mode, count, success, failed, total_ms)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(day, tool, mode) DO UPDATE SET
       count = count + 1,
       success = success + excluded.success,
       failed = failed + excluded.failed,
       total_ms = total_ms + excluded.total_ms`,
    day, job.tool, job.mode,
    status === JOB_STATUS.SUCCESS ? 1 : 0,
    status === JOB_STATUS.FAILED ? 1 : 0,
    duration,
  );

  rollupDay(day);
  return getJob(id);
}

export function cancelJob(id, reason = 'ผู้ใช้ยกเลิกงาน') {
  const job = getJob(id);
  if (!job) return null;
  if ([JOB_STATUS.SUCCESS, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(job.status)) return job;
  completeJob(id, { status: JOB_STATUS.CANCELLED, errorCode: 'CANCELLED', errorMessage: reason });
  deleteJobFiles(id);
  return getJob(id);
}

// ---------------- ไฟล์ของ job ----------------

export function jobStorageDir(jobId) {
  return path.join(config.storage.dir, 'jobs', jobId);
}

export function addJobFile({ jobId, kind, filename, mime, sizeBytes, storagePath }) {
  const id = newId('jf');
  const now = Date.now();
  const ttl = getSetting('TEMP_FILE_TTL') * 1000;
  db.run(
    `INSERT INTO job_files (id, job_id, kind, filename, mime, size_bytes, storage_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, jobId, kind, filename, mime || null, sizeBytes || 0, storagePath, now, now + ttl,
  );
  return db.get('SELECT * FROM job_files WHERE id = ?', id);
}

export const getJobFile = (id) => db.get('SELECT * FROM job_files WHERE id = ? AND deleted_at IS NULL', id);
export const listJobFiles = (jobId, kind = null) => (kind
  ? db.all('SELECT * FROM job_files WHERE job_id = ? AND kind = ? AND deleted_at IS NULL ORDER BY created_at', jobId, kind)
  : db.all('SELECT * FROM job_files WHERE job_id = ? AND deleted_at IS NULL ORDER BY created_at', jobId));

/** ลบไฟล์จริงบนดิสก์และ mark ใน DB */
export function deleteJobFiles(jobId) {
  const files = listJobFiles(jobId);
  let freed = 0;
  for (const file of files) {
    try {
      if (fs.existsSync(file.storage_path)) {
        freed += fs.statSync(file.storage_path).size;
        fs.rmSync(file.storage_path, { force: true });
      }
    } catch (err) { logger.warn('failed to remove job file', { jobId, message: err.message }); }
  }
  db.run('UPDATE job_files SET deleted_at = ? WHERE job_id = ? AND deleted_at IS NULL', Date.now(), jobId);
  try { fs.rmSync(jobStorageDir(jobId), { recursive: true, force: true }); } catch { /* ignore */ }
  return { count: files.length, freed };
}

// ---------------- คิวงาน ----------------

/** ดึงงานถัดไปแบบ atomic ป้องกัน worker หลายตัวหยิบงานเดียวกัน */
export const claimNextJob = db.transaction(() => {
  const running = db.get(
    "SELECT COUNT(*) AS n FROM jobs WHERE status = 'PROCESSING' AND mode = 'server'",
  )?.n || 0;
  if (Number(running) >= getSetting('MAX_CONCURRENT_JOBS')) return null;

  const next = db.get(
    "SELECT * FROM jobs WHERE status = 'WAITING' AND mode = 'server' ORDER BY created_at ASC LIMIT 1",
  );
  if (!next) return null;

  db.run(
    "UPDATE jobs SET status = 'PROCESSING', started_at = ?, attempts = attempts + 1, progress = 1, stage = ? WHERE id = ?",
    Date.now(), 'เริ่มประมวลผล', next.id,
  );
  return getJob(next.id);
});

export function queueDepth() {
  const row = db.get(
    `SELECT
       SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing
     FROM jobs WHERE mode = 'server'`,
  ) || {};
  return { waiting: Number(row.waiting || 0), processing: Number(row.processing || 0) };
}

export function toPublicJob(job, files = []) {
  if (!job) return null;
  return {
    jobId: job.id,
    tool: job.tool,
    mode: job.mode,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    fileCount: job.file_count,
    bytesIn: job.bytes_in,
    bytesOut: job.bytes_out,
    errorCode: job.error_code,
    message: job.error_message,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    processingMs: job.processing_ms,
    expiresAt: job.expires_at,
    files: files.map((f) => ({
      fileId: f.id, filename: f.filename, size: f.size_bytes, mime: f.mime,
      downloadUrl: `/api/files/${f.id}`,
    })),
  };
}
