/**
 * Rate limiting (spec ข้อ 54) — นับแบบ fixed window รายชั่วโมง เก็บใน SQLite
 * ผู้ดูแลระบบไม่ถูกจำกัด
 */
import db from '../db/index.js';
import { getSetting } from './../services/settings.js';
import { ApiError } from '../utils/http.js';

const WINDOW_MS = 3600000;

function subjectOf(req) {
  if (req.user) return { type: req.user.role === 'admin' ? 'admin' : 'user', id: req.user.id };
  return { type: 'guest', id: req.session?.id || 'unknown' };
}

export function consumeQuota(req, scope = 'job', cost = 1) {
  const subject = subjectOf(req);
  if (subject.type === 'admin') return { allowed: true, remaining: Infinity, limit: Infinity };

  const limit = subject.type === 'guest' ? getSetting('RATE_LIMIT_GUEST') : getSetting('RATE_LIMIT_USER');
  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const key = `${subject.type}:${subject.id}:${scope}`;

  const row = db.get('SELECT count FROM rate_limits WHERE bucket_key = ? AND window_start = ?', key, windowStart);
  const used = Number(row?.count || 0);
  if (used + cost > limit) {
    return { allowed: false, remaining: 0, limit, resetAt: windowStart + WINDOW_MS };
  }
  db.run(
    `INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, ?)
     ON CONFLICT(bucket_key, window_start) DO UPDATE SET count = count + ?`,
    key, windowStart, cost, cost,
  );
  return { allowed: true, remaining: limit - used - cost, limit, resetAt: windowStart + WINDOW_MS };
}

export function rateLimit(scope = 'job', cost = 1) {
  return (req, res, next) => {
    const result = consumeQuota(req, scope, cost);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return next(new ApiError(429, 'RATE_LIMITED',
        'ใช้งานครบจำนวนที่กำหนดในชั่วโมงนี้แล้ว กรุณารอสักครู่หรือเข้าสู่ระบบเพื่อเพิ่มโควตา',
        { resetAt: result.resetAt, limit: result.limit }));
    }
    return next();
  };
}

/** rate limit เบา ๆ สำหรับ endpoint ที่ถูกเรียกถี่ (heartbeat, analytics) */
const memoryBuckets = new Map();
export function burstLimit({ windowMs = 10000, max = 20, scope = null } = {}) {
  return (req, res, next) => {
    // แยกโควตาตามเส้นทาง เพื่อไม่ให้ heartbeat กับ visit แย่งโควตากันเอง
    // และรองรับกรณีผู้ใช้เปิดหลายแท็บพร้อมกัน
    const key = `${scope || req.path}:${req.session?.id || req.ip}`;
    const now = Date.now();
    let bucket = memoryBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      memoryBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return next(new ApiError(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอถี่เกินไป กรุณารอสักครู่'));
    }
    return next();
  };
}

export function pruneRateLimits() {
  const cutoff = Date.now() - WINDOW_MS * 3;
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) {
    if (now - bucket.start > 60000) memoryBuckets.delete(key);
  }
  return db.run('DELETE FROM rate_limits WHERE window_start < ?', cutoff).changes;
}
