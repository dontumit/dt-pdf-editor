/**
 * Online user counter ด้วย heartbeat (spec ข้อ 8)
 * browser ส่ง heartbeat ทุก ~25 วินาที  ระบบถือว่า online เมื่อ last_seen อยู่ในช่วง ONLINE_TIMEOUT
 * ตัวเลขทั้งหมดมาจากข้อมูลจริงในฐานข้อมูล ไม่มีการสร้างตัวเลขจำลอง
 */
import db from '../db/index.js';
import { getSetting } from './settings.js';

export function recordHeartbeat({ sessionId, userId, userType, page, device, browser }) {
  const now = Date.now();
  db.run(
    `INSERT INTO presence (session_id, user_id, user_type, page, device, browser, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       user_id = excluded.user_id, user_type = excluded.user_type, page = excluded.page,
       device = excluded.device, browser = excluded.browser, last_seen = excluded.last_seen`,
    sessionId, userId || null, userType || 'guest', page || null, device || null, browser || null, now,
  );
  db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now, sessionId);
  return now;
}

export function onlineSnapshot() {
  const cutoff = Date.now() - getSetting('ONLINE_TIMEOUT') * 1000;
  const rows = db.all(
    `SELECT user_type, COUNT(*) AS n FROM presence WHERE last_seen >= ? GROUP BY user_type`,
    cutoff,
  );
  const byType = { guest: 0, user: 0, line: 0, admin: 0 };
  let total = 0;
  for (const row of rows) {
    const count = Number(row.n);
    total += count;
    if (byType[row.user_type] !== undefined) byType[row.user_type] += count;
    else byType.guest += count;
  }
  return { total, byType, cutoff };
}

/** ลบ presence ที่หมดอายุ — เรียกจาก cleanup worker */
export function prunePresence() {
  const cutoff = Date.now() - Math.max(getSetting('ONLINE_TIMEOUT') * 4, 600) * 1000;
  const res = db.run('DELETE FROM presence WHERE last_seen < ?', cutoff);
  return res.changes;
}

export function onlinePages(limit = 10) {
  const cutoff = Date.now() - getSetting('ONLINE_TIMEOUT') * 1000;
  return db.all(
    `SELECT page, COUNT(*) AS count FROM presence WHERE last_seen >= ? AND page IS NOT NULL
     GROUP BY page ORDER BY count DESC LIMIT ?`,
    cutoff, limit,
  ).map((r) => ({ page: r.page, count: Number(r.count) }));
}
