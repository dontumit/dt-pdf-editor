/**
 * Admin API (spec ข้อ 48-52, 83, 86)
 * ตัวเลขทั้งหมดมาจากฐานข้อมูลจริง
 */
import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import config from '../config/index.js';
import { ok, asyncRoute, ApiError } from '../utils/http.js';
import { int, str } from '../utils/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { onlineSnapshot, onlinePages } from '../services/presence.js';
import { dailySeries, todayStats, totals, vitalsSummary } from '../services/analytics.js';
import { listSettings, setSetting, resetSetting } from '../services/settings.js';
import { queueDepth, cancelJob, deleteJobFiles } from '../services/jobs.js';
import { listAudit, audit } from '../services/audit.js';
import { lastNDays } from '../utils/time.js';
import { runCleanup } from '../workers/cleanup.js';

const router = express.Router();
router.use(requireAdmin);

function directorySize(dir) {
  let total = 0;
  let files = 0;
  const walk = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try { total += fs.statSync(full).size; files += 1; } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

/** ภาพรวม dashboard */
router.get('/overview', asyncRoute(async (req, res) => {
  const online = onlineSnapshot();
  const today = todayStats();
  const all = totals();
  const queue = queueDepth();

  const jobStats = db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
            AVG(CASE WHEN status = 'SUCCESS' THEN processing_ms END) AS avg_ms
     FROM jobs WHERE created_at >= ?`, Date.now() - 7 * 86400000,
  ) || {};

  const storage = directorySize(config.storage.dir);
  const successRate = Number(jobStats.total) ? Number(jobStats.success) / Number(jobStats.total) : null;

  return ok(res, {
    online: { total: online.total, byType: online.byType, topPages: onlinePages(8) },
    today: {
      visits: Number(today.visits || 0),
      visitors: Number(today.unique_sessions || 0),
      newUsers: Number(today.new_users || 0),
      jobs: Number(today.jobs_total || 0),
      jobsSuccess: Number(today.jobs_success || 0),
      jobsFailed: Number(today.jobs_failed || 0),
      files: Number(today.files_processed || 0),
      bytesIn: Number(today.bytes_in || 0),
      bytesOut: Number(today.bytes_out || 0),
    },
    total: all,
    queue,
    jobs7d: {
      total: Number(jobStats.total || 0),
      success: Number(jobStats.success || 0),
      failed: Number(jobStats.failed || 0),
      successRate,
      avgProcessingMs: jobStats.avg_ms ? Math.round(Number(jobStats.avg_ms)) : null,
    },
    storage: { ...storage, dir: config.storage.dir },
  });
}));

/** กราฟผู้ใช้งาน/งานรายวัน */
router.get('/series', asyncRoute(async (req, res) => {
  const days = int(req.query.days, { name: 'days', min: 1, max: 180, fallback: 14 });
  return ok(res, { series: dailySeries(days) });
}));

/** เครื่องมือยอดนิยม */
router.get('/tools', asyncRoute(async (req, res) => {
  const days = int(req.query.days, { name: 'days', min: 1, max: 180, fallback: 30 });
  const from = lastNDays(days)[0];
  const rows = db.all(
    `SELECT tool, SUM(count) AS uses, SUM(success) AS success, SUM(failed) AS failed, SUM(total_ms) AS total_ms
     FROM tool_usage WHERE day >= ? GROUP BY tool ORDER BY uses DESC`, from,
  );
  return ok(res, {
    tools: rows.map((r) => ({
      tool: r.tool,
      uses: Number(r.uses),
      success: Number(r.success),
      failed: Number(r.failed),
      avgMs: Number(r.uses) ? Math.round(Number(r.total_ms) / Number(r.uses)) : 0,
    })),
  });
}));

/** สุขภาพระบบ (spec ข้อ 50) */
router.get('/system', asyncRoute(async (req, res) => {
  const memory = process.memoryUsage();
  const load = os.loadavg();
  const storage = directorySize(config.storage.dir);
  const errorRate = db.get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed
     FROM jobs WHERE created_at >= ?`, Date.now() - 86400000,
  ) || {};

  return ok(res, {
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    dbDriver: db.driver,
    cpu: { count: os.cpus().length, load1: load[0], load5: load[1], load15: load[2] },
    memory: {
      rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal,
      systemTotal: os.totalmem(), systemFree: os.freemem(),
    },
    storage,
    queue: queueDepth(),
    errorRate24h: Number(errorRate.total) ? Number(errorRate.failed) / Number(errorRate.total) : 0,
    vitals: vitalsSummary(7),
  });
}));

/** รายการงานล่าสุด */
router.get('/jobs', asyncRoute(async (req, res) => {
  const limit = int(req.query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 });
  const status = str(req.query.status, { name: 'status', max: 20 });
  const rows = status
    ? db.all('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?', status, limit)
    : db.all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', limit);
  return ok(res, {
    jobs: rows.map((j) => ({
      jobId: j.id, tool: j.tool, mode: j.mode, status: j.status, progress: j.progress,
      userType: j.user_type, fileCount: j.file_count, bytesIn: j.bytes_in, bytesOut: j.bytes_out,
      errorCode: j.error_code, createdAt: j.created_at, processingMs: j.processing_ms,
    })),
  });
}));

router.delete('/jobs/:id', asyncRoute(async (req, res) => {
  const id = str(req.params.id, { name: 'jobId', required: true, max: 40 });
  cancelJob(id, 'ยกเลิกโดยผู้ดูแลระบบ');
  deleteJobFiles(id);
  audit({ actorId: req.user.id, actorRef: req.user.public_ref, action: 'admin.job_cancel', target: id });
  return ok(res, { cancelled: true });
}));

/** ผู้ใช้งาน */
router.get('/users', asyncRoute(async (req, res) => {
  const limit = int(req.query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 });
  const rows = db.all('SELECT * FROM users ORDER BY last_login_at DESC LIMIT ?', limit);
  return ok(res, {
    users: rows.map((u) => ({
      ref: u.public_ref, displayName: u.display_name, provider: u.provider, role: u.role,
      isFriend: Boolean(u.is_friend), createdAt: u.created_at, lastLoginAt: u.last_login_at,
    })),
  });
}));

/** ค่าตั้งระบบ — แก้ได้โดยไม่ต้องแก้ source code */
router.get('/settings', asyncRoute(async (req, res) => ok(res, { settings: listSettings() })));

router.put('/settings', asyncRoute(async (req, res) => {
  const updates = req.body?.settings;
  if (!updates || typeof updates !== 'object') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'รูปแบบข้อมูลไม่ถูกต้อง');
  }
  const applied = {};
  for (const [key, value] of Object.entries(updates)) {
    try { applied[key] = setSetting(key, value, req.user.public_ref); } catch (err) {
      throw new ApiError(400, 'VALIDATION_ERROR', err.message);
    }
  }
  audit({ actorId: req.user.id, actorRef: req.user.public_ref, action: 'admin.settings_update', detail: { keys: Object.keys(applied) } });
  return ok(res, { settings: listSettings(), applied });
}));

router.delete('/settings/:key', asyncRoute(async (req, res) => {
  resetSetting(str(req.params.key, { name: 'key', required: true, max: 60 }));
  return ok(res, { settings: listSettings() });
}));

/** สั่งล้างไฟล์ชั่วคราวทันที */
router.post('/cleanup', asyncRoute(async (req, res) => {
  const result = await runCleanup({ force: true });
  audit({ actorId: req.user.id, actorRef: req.user.public_ref, action: 'admin.cleanup', detail: result });
  return ok(res, result);
}));

router.get('/cleanup-logs', asyncRoute(async (req, res) => {
  const rows = db.all('SELECT * FROM cleanup_logs ORDER BY ts DESC LIMIT 50');
  return ok(res, { logs: rows });
}));

router.get('/audit', asyncRoute(async (req, res) => {
  const limit = int(req.query.limit, { name: 'limit', min: 1, max: 200, fallback: 100 });
  return ok(res, { logs: listAudit({ limit }) });
}));

export default router;
