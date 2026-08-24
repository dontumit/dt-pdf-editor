/**
 * ประวัติการใช้งาน — เก็บเฉพาะ metadata ไม่มีไฟล์ (spec ข้อ 45)
 */
import express from 'express';
import db from '../db/index.js';
import { ok, asyncRoute } from '../utils/http.js';
import { int, str } from '../utils/validate.js';
import { audit } from '../services/audit.js';

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  const limit = int(req.query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 });
  const offset = int(req.query.offset, { name: 'offset', min: 0, max: 100000, fallback: 0 });

  const rows = req.user
    ? db.all('SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', req.user.id, limit, offset)
    : db.all('SELECT * FROM history WHERE session_id = ? AND user_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?', req.session.id, limit, offset);

  const total = req.user
    ? db.get('SELECT COUNT(*) AS n FROM history WHERE user_id = ?', req.user.id)?.n
    : db.get('SELECT COUNT(*) AS n FROM history WHERE session_id = ? AND user_id IS NULL', req.session.id)?.n;

  return ok(res, {
    items: rows.map((row) => ({
      id: row.id,
      tool: row.tool,
      mode: row.mode,
      filename: row.filename,
      fileCount: row.file_count,
      sizeIn: row.size_in,
      sizeOut: row.size_out,
      status: row.status,
      processingMs: row.processing_ms,
      createdAt: row.created_at,
    })),
    total: Number(total || 0),
    limit,
    offset,
  });
}));

/** เครื่องมือที่ใช้ล่าสุด (spec ข้อ 44) */
router.get('/recent-tools', asyncRoute(async (req, res) => {
  const rows = req.user
    ? db.all(`SELECT tool, MAX(created_at) AS last_used, COUNT(*) AS uses FROM history
              WHERE user_id = ? GROUP BY tool ORDER BY last_used DESC LIMIT 6`, req.user.id)
    : db.all(`SELECT tool, MAX(created_at) AS last_used, COUNT(*) AS uses FROM history
              WHERE session_id = ? GROUP BY tool ORDER BY last_used DESC LIMIT 6`, req.session.id);
  return ok(res, { tools: rows.map((r) => ({ tool: r.tool, lastUsed: Number(r.last_used), uses: Number(r.uses) })) });
}));

router.delete('/', asyncRoute(async (req, res) => {
  const result = req.user
    ? db.run('DELETE FROM history WHERE user_id = ?', req.user.id)
    : db.run('DELETE FROM history WHERE session_id = ? AND user_id IS NULL', req.session.id);
  audit({ actorId: req.user?.id, action: 'history.clear', result: 'success', detail: { removed: result.changes } });
  return ok(res, { removed: result.changes });
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  const id = str(req.params.id, { name: 'id', required: true, max: 40 });
  const result = req.user
    ? db.run('DELETE FROM history WHERE id = ? AND user_id = ?', id, req.user.id)
    : db.run('DELETE FROM history WHERE id = ? AND session_id = ?', id, req.session.id);
  return ok(res, { removed: result.changes });
}));

export default router;
