/**
 * Visitor analytics (spec ข้อ 9)
 * เก็บเฉพาะข้อมูลที่จำเป็นและไม่ระบุตัวบุคคล — ไม่เก็บ IP address, ไม่เก็บ user agent ดิบ
 */
import db from '../db/index.js';
import { dayKey, lastNDays } from '../utils/time.js';
import { getSetting } from './settings.js';

/** แปลง user agent เป็นหมวดกว้าง ๆ พอสำหรับสถิติ โดยไม่เก็บ fingerprint */
export function classifyUserAgent(ua = '') {
  const text = String(ua);
  let device = 'desktop';
  if (/iPad|Tablet/i.test(text)) device = 'tablet';
  else if (/Mobi|Android|iPhone/i.test(text)) device = 'mobile';

  let browser = 'other';
  if (/Line\//i.test(text)) browser = 'line';
  else if (/Edg\//i.test(text)) browser = 'edge';
  else if (/OPR\//i.test(text)) browser = 'opera';
  else if (/Chrome\//i.test(text)) browser = 'chrome';
  else if (/Firefox\//i.test(text)) browser = 'firefox';
  else if (/Safari\//i.test(text)) browser = 'safari';

  let os = 'other';
  if (/Windows/i.test(text)) os = 'windows';
  else if (/Android/i.test(text)) os = 'android';
  else if (/iPhone|iPad|iOS/i.test(text)) os = 'ios';
  else if (/Mac OS X/i.test(text)) os = 'macos';
  else if (/Linux/i.test(text)) os = 'linux';

  return { device, browser, os };
}

/** เก็บเฉพาะ origin + path แรกของ referrer ไม่เก็บ query string */
export function normalizeReferrer(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return `${url.hostname}${url.pathname.slice(0, 60)}`;
  } catch { return null; }
}

export function recordVisit({ sessionId, userType, page, referrer, userAgent, isLiff }) {
  const now = Date.now();
  const day = dayKey(now);
  const { device, browser, os } = classifyUserAgent(userAgent);

  db.run(
    `INSERT INTO visits (day, ts, session_id, user_type, page, referrer, device, browser, os, is_liff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    day, now, sessionId, userType || 'guest', String(page || '/').slice(0, 120),
    normalizeReferrer(referrer), device, browser, os, isLiff ? 1 : 0,
  );

  rollupDay(day);
  return { day, device, browser, os };
}

/** คำนวณสรุปรายวันใหม่จาก raw visits (idempotent) */
export function rollupDay(day = dayKey()) {
  const v = db.get(
    `SELECT COUNT(*) AS visits,
            COUNT(DISTINCT session_id) AS uniq,
            COUNT(DISTINCT CASE WHEN user_type = 'guest' THEN session_id END) AS guests,
            COUNT(DISTINCT CASE WHEN user_type = 'user'  THEN session_id END) AS users,
            COUNT(DISTINCT CASE WHEN user_type = 'line'  THEN session_id END) AS lines
     FROM visits WHERE day = ?`, day,
  ) || {};

  const jobs = db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'FAILED'  THEN 1 ELSE 0 END) AS failed,
            SUM(file_count) AS files, SUM(bytes_in) AS bin, SUM(bytes_out) AS bout
     FROM jobs WHERE created_at >= ? AND created_at < ?`,
    dayStartTs(day), dayStartTs(day) + 86400000,
  ) || {};

  const newUsers = db.get(
    'SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?',
    dayStartTs(day), dayStartTs(day) + 86400000,
  )?.n || 0;

  db.run(
    `INSERT INTO daily_stats (day, visits, unique_sessions, guest_sessions, user_sessions, line_sessions,
                              new_users, jobs_total, jobs_success, jobs_failed, files_processed, bytes_in, bytes_out, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       visits = excluded.visits, unique_sessions = excluded.unique_sessions,
       guest_sessions = excluded.guest_sessions, user_sessions = excluded.user_sessions,
       line_sessions = excluded.line_sessions, new_users = excluded.new_users,
       jobs_total = excluded.jobs_total, jobs_success = excluded.jobs_success,
       jobs_failed = excluded.jobs_failed, files_processed = excluded.files_processed,
       bytes_in = excluded.bytes_in, bytes_out = excluded.bytes_out, updated_at = excluded.updated_at`,
    day, Number(v.visits || 0), Number(v.uniq || 0), Number(v.guests || 0), Number(v.users || 0),
    Number(v.lines || 0), Number(newUsers), Number(jobs.total || 0), Number(jobs.success || 0),
    Number(jobs.failed || 0), Number(jobs.files || 0), Number(jobs.bin || 0), Number(jobs.bout || 0), Date.now(),
  );
}

/** เวลาเริ่มต้นของวัน (เขตเวลาไทย) เป็น epoch ms */
export function dayStartTs(day) {
  return new Date(`${day}T00:00:00+07:00`).getTime();
}

export function todayStats() {
  const day = dayKey();
  rollupDay(day);
  const row = db.get('SELECT * FROM daily_stats WHERE day = ?', day);
  return row || { day, visits: 0, unique_sessions: 0, guest_sessions: 0, user_sessions: 0, line_sessions: 0, jobs_total: 0 };
}

export function totals() {
  const visits = db.get('SELECT COALESCE(SUM(visits),0) AS n FROM daily_stats')?.n || 0;
  const uniqueVisitors = db.get('SELECT COUNT(DISTINCT session_id) AS n FROM visits')?.n || 0;
  const users = db.get('SELECT COUNT(*) AS n FROM users')?.n || 0;
  const lineUsers = db.get("SELECT COUNT(*) AS n FROM users WHERE provider = 'line'")?.n || 0;
  const jobs = db.get('SELECT COUNT(*) AS n FROM jobs')?.n || 0;
  const filesProcessed = db.get('SELECT COALESCE(SUM(file_count),0) AS n FROM jobs')?.n || 0;
  return {
    visits: Number(visits),
    uniqueVisitors: Number(uniqueVisitors),
    users: Number(users),
    lineUsers: Number(lineUsers),
    jobs: Number(jobs),
    filesProcessed: Number(filesProcessed),
  };
}

export function dailySeries(days = 14) {
  const keys = lastNDays(days);
  const rows = db.all(
    `SELECT * FROM daily_stats WHERE day >= ? ORDER BY day ASC`, keys[0],
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return keys.map((day) => {
    const r = byDay.get(day);
    return {
      day,
      visits: Number(r?.visits || 0),
      uniqueSessions: Number(r?.unique_sessions || 0),
      users: Number(r?.user_sessions || 0) + Number(r?.line_sessions || 0),
      newUsers: Number(r?.new_users || 0),
      jobs: Number(r?.jobs_total || 0),
      jobsSuccess: Number(r?.jobs_success || 0),
      jobsFailed: Number(r?.jobs_failed || 0),
    };
  });
}

export function recordVital({ metric, value, rating, page, device }) {
  const now = Date.now();
  db.run(
    'INSERT INTO web_vitals (ts, day, metric, value, rating, page, device) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now, dayKey(now), metric, Number(value), rating || null, String(page || '').slice(0, 120), device || null,
  );
}

export function vitalsSummary(days = 7) {
  const from = lastNDays(days)[0];
  return db.all(
    `SELECT metric, COUNT(*) AS samples, AVG(value) AS avg_value,
            SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) AS good
     FROM web_vitals WHERE day >= ? GROUP BY metric`, from,
  ).map((r) => ({
    metric: r.metric,
    samples: Number(r.samples),
    average: Number(r.avg_value || 0),
    goodRatio: Number(r.samples) ? Number(r.good) / Number(r.samples) : 0,
  }));
}

/** ลบข้อมูลดิบที่เกินระยะเก็บรักษา (PDPA) — สรุปรายวันยังอยู่ */
export function pruneAnalytics() {
  const retention = getSetting('ANALYTICS_RETENTION_DAYS');
  const cutoff = Date.now() - retention * 86400000;
  const visits = db.run('DELETE FROM visits WHERE ts < ?', cutoff).changes;
  const vitals = db.run('DELETE FROM web_vitals WHERE ts < ?', cutoff).changes;
  return visits + vitals;
}
