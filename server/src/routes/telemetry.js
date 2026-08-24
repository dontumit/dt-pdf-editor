/**
 * Heartbeat / visit / web vitals — แหล่งข้อมูลของตัวเลข "กำลังใช้งาน" และ "ผู้เข้าชม"
 * ทุกตัวเลขบนหน้าเว็บมาจากตารางเหล่านี้ ไม่มีข้อมูลจำลอง
 */
import express from 'express';
import { ok } from '../utils/http.js';
import { str, int } from '../utils/validate.js';
import { recordHeartbeat, onlineSnapshot } from '../services/presence.js';
import { recordVisit, recordVital, todayStats, totals } from '../services/analytics.js';
import { burstLimit } from '../middleware/rateLimit.js';
import { getSetting } from '../services/settings.js';

const router = express.Router();

router.post('/heartbeat', burstLimit({ windowMs: 30000, max: 20 }), (req, res) => {
  const page = str(req.body?.page, { name: 'page', max: 120 });
  recordHeartbeat({
    sessionId: req.session.id,
    userId: req.user?.id,
    userType: req.session.userType,
    page,
    device: str(req.body?.device, { name: 'device', max: 20 }),
    browser: str(req.body?.browser, { name: 'browser', max: 20 }),
  });
  const online = onlineSnapshot();
  return ok(res, {
    online: online.total,
    nextHeartbeatIn: getSetting('HEARTBEAT_INTERVAL'),
    serverTime: Date.now(),
  });
});

router.post('/visit', burstLimit({ windowMs: 30000, max: 30 }), (req, res) => {
  recordVisit({
    sessionId: req.session.id,
    userType: req.session.userType,
    page: str(req.body?.page, { name: 'page', max: 120 }),
    referrer: str(req.body?.referrer, { name: 'referrer', max: 300 }),
    userAgent: req.get('user-agent'),
    isLiff: req.body?.isLiff === true,
  });
  return ok(res, { recorded: true });
});

router.post('/vitals', burstLimit({ windowMs: 30000, max: 12 }), (req, res) => {
  const metrics = Array.isArray(req.body?.metrics) ? req.body.metrics.slice(0, 8) : [];
  for (const metric of metrics) {
    const name = str(metric?.name, { name: 'metric', allow: ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'], max: 8 });
    if (!name) continue;
    recordVital({
      metric: name,
      value: int(Math.round(Number(metric.value) * 1000), { name: 'value', min: 0, max: 3600000, fallback: 0 }) / 1000,
      rating: str(metric?.rating, { name: 'rating', allow: ['good', 'needs-improvement', 'poor'], max: 20 }) || null,
      page: str(metric?.page, { name: 'page', max: 120 }),
      device: str(metric?.device, { name: 'device', max: 20 }),
    });
  }
  return ok(res, { recorded: metrics.length });
});

/** ตัวเลขสาธารณะที่แสดงบนหน้าแรก (spec ข้อ 6, 7) */
router.get('/stats/public', (req, res) => {
  const online = onlineSnapshot();
  const today = todayStats();
  const all = totals();
  return ok(res, {
    online: {
      total: online.total,
      guest: online.byType.guest,
      user: online.byType.user + online.byType.admin,
      line: online.byType.line,
    },
    today: {
      visits: Number(today.visits || 0),
      visitors: Number(today.unique_sessions || 0),
      jobs: Number(today.jobs_total || 0),
      files: Number(today.files_processed || 0),
    },
    total: {
      visits: all.visits,
      visitors: all.uniqueVisitors,
      users: all.users,
      lineUsers: all.lineUsers,
      jobs: all.jobs,
      files: all.filesProcessed,
    },
    serverTime: Date.now(),
  });
});

router.get('/stats/online', (req, res) => {
  const online = onlineSnapshot();
  return ok(res, { online: online.total, byType: online.byType });
});

export default router;
