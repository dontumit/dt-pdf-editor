import db from '../db/index.js';

/** บันทึก audit log — ใครทำอะไร เมื่อไหร่ ผลลัพธ์อะไร (ไม่เก็บเนื้อหาเอกสาร) */
export function audit({ actorId = null, actorRef = null, action, target = null, result = 'success', detail = {} }) {
  db.run(
    'INSERT INTO audit_logs (ts, actor_id, actor_ref, action, target, result, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    Date.now(), actorId, actorRef, action, target ? String(target).slice(0, 120) : null, result, JSON.stringify(detail),
  );
}

export function listAudit({ limit = 100, offset = 0 } = {}) {
  return db.all(
    'SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ? OFFSET ?', limit, offset,
  ).map((row) => ({
    ts: row.ts, actorRef: row.actor_ref, action: row.action,
    target: row.target, result: row.result, detail: JSON.parse(row.detail_json || '{}'),
  }));
}
